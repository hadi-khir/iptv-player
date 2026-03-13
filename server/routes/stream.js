import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';
import { buildStreamUrl } from '../xtream.js';
import { JWT_SECRET } from '../config.js';

const router = Router();

// Custom auth that also checks query param token (for video element src)
function streamAuth(req, res, next) {
  let token = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

router.use(streamAuth);

// Return proxy URLs (no xtream credentials exposed to the client)
router.get('/:connId/:type/:streamId/urls', (req, res) => {
  const db = getDb();
  const conn = db
    .prepare('SELECT id FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.connId, req.user.id);

  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  const { connId, type, streamId } = req.params;
  const containerExt = req.query.ext || null;
  const token = req.query.token || '';

  // Build proxy URLs that go through our backend (credentials stay server-side)
  const base = `/api/stream/${connId}/${type}/${streamId}?token=${encodeURIComponent(token)}`;

  const urls = {
    hls: `${base}&ext=m3u8`,
    ts: `${base}&ext=ts`,
    type,
    streamId,
  };

  if (type !== 'live') {
    urls.mp4 = `${base}&ext=mp4`;
    if (containerExt && containerExt !== 'mp4' && containerExt !== 'ts' && containerExt !== 'm3u8') {
      urls.direct = `${base}&ext=${encodeURIComponent(containerExt)}`;
    }
  }

  res.json(urls);
});

// Proxy a stream through the backend so credentials never reach the browser.
// Supports Range requests for VOD seeking.
router.get('/:connId/:type/:streamId', async (req, res) => {
  try {
    const db = getDb();
    const conn = db
      .prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
      .get(req.params.connId, req.user.id);

    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    const { type, streamId } = req.params;
    const extension = req.query.ext || 'm3u8';

    // Validate extension to prevent path traversal
    if (!/^[a-zA-Z0-9]{1,10}$/.test(extension)) {
      return res.status(400).json({ error: 'Invalid extension' });
    }

    // Helper: rewrite URLs inside an m3u8 playlist to go through our proxy
    // originUrl is the full URL the playlist was fetched from (used to resolve relative/absolute-path refs)
    function rewriteM3u8(text, originUrl) {
      const token = req.query.token || '';
      const proxyBase = `/api/stream/${req.params.connId}/${type}/${streamId}`;

      // Parse origin for resolving absolute-path URLs (e.g. /live/user/pass/123/seg.ts)
      const parsedOrigin = new URL(originUrl);
      const urlOrigin = parsedOrigin.origin; // e.g. http://server:port
      const baseUrl = originUrl.substring(0, originUrl.lastIndexOf('/') + 1); // directory

      return text.replace(/^(?!#)(.+)$/gm, (match) => {
        const trimmed = match.trim();
        if (!trimmed) return match;

        // Resolve to absolute URL handling three cases:
        // 1. http://... - already absolute
        // 2. /path/... - absolute path, prepend origin
        // 3. relative   - relative path, prepend base directory
        let absoluteUrl;
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          absoluteUrl = trimmed;
        } else if (trimmed.startsWith('/')) {
          absoluteUrl = urlOrigin + trimmed;
        } else {
          absoluteUrl = baseUrl + trimmed;
        }

        // Detect sub-playlists vs media segments
        const isPlaylist = /\.m3u8?(\?|$)/i.test(trimmed);
        const ext = isPlaylist ? 'm3u8' : 'ts';

        return `${proxyBase}?ext=${ext}&seg=${encodeURIComponent(absoluteUrl)}&token=${encodeURIComponent(token)}`;
      });
    }

    // Handle segment/sub-playlist proxy requests first (avoids fetching the main stream needlessly)
    if (req.query.seg) {
      const segUrl = req.query.seg;
      // Validate segment URL starts with http
      if (!segUrl.startsWith('http://') && !segUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid segment URL' });
      }

      const segResponse = await fetch(segUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'IPTV Player/1.0' },
      });

      if (!segResponse.ok) {
        console.log(`[stream] Segment fetch failed: ${segResponse.status} for ${segUrl.substring(0, 120)}`);
        return res.status(segResponse.status).end();
      }

      res.setHeader('Cache-Control', 'no-store');

      // If this is a sub-playlist (m3u8), rewrite its URLs too
      const ct = segResponse.headers.get('content-type') || '';
      const isM3u8 = extension === 'm3u8' || ct.includes('mpegurl') || ct.includes('m3u8') || /\.m3u8?(\?|$)/i.test(segUrl);

      if (isM3u8) {
        const text = await segResponse.text();
        // Use final URL after redirects for resolving relative refs
        const resolvedUrl = segResponse.url || segUrl;
        const rewritten = rewriteM3u8(text, resolvedUrl);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewritten);
        return;
      }

      if (ct) res.setHeader('Content-Type', ct);
      const cl = segResponse.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);

      const segReader = segResponse.body.getReader();
      req.on('close', () => segReader.cancel().catch(() => {}));

      while (true) {
        const { done, value } = await segReader.read();
        if (done) break;
        if (!res.writableEnded) res.write(Buffer.from(value));
        else break;
      }
      if (!res.writableEnded) res.end();
      return;
    }

    const streamUrl = buildStreamUrl(conn, type, streamId, extension);

    // Forward range headers for VOD seeking support
    const fetchHeaders = { 'User-Agent': 'IPTV Player/1.0' };
    if (req.headers.range) {
      fetchHeaders.Range = req.headers.range;
    }

    const response = await fetch(streamUrl, {
      signal: AbortSignal.timeout(30000),
      headers: fetchHeaders,
    });

    if (!response.ok && response.status !== 206) {
      return res.status(response.status).json({ error: 'Stream not available' });
    }

    // Forward relevant headers
    const forwardHeaders = [
      'content-type', 'content-length', 'content-range',
      'accept-ranges',
    ];
    for (const h of forwardHeaders) {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    res.status(response.status);
    res.setHeader('Cache-Control', 'no-store');

    // For m3u8 playlists, rewrite segment/sub-playlist URLs to go through our proxy
    if (extension === 'm3u8') {
      // Check content-type: if the server returned a TS stream or binary instead of m3u8,
      // don't try to read it as text (would hang forever on a live TS stream)
      const ct = response.headers.get('content-type') || '';
      const looksLikeM3u8 = ct.includes('mpegurl') || ct.includes('m3u8') || ct.includes('text') || ct.includes('utf-8') || !ct;

      if (!looksLikeM3u8) {
        // Server didn't return an m3u8 playlist - abort and let the client try other formats
        response.body?.cancel?.().catch(() => {});
        console.log(`[stream] m3u8 request returned non-playlist content-type: ${ct} for ${streamUrl}`);
        return res.status(415).json({ error: `Server did not return an HLS playlist (got ${ct})` });
      }

      const text = await response.text();

      // Verify it actually looks like an m3u8 (starts with #EXTM3U or has HLS tags)
      if (!text.trim().startsWith('#EXTM3U') && !text.includes('#EXT-X-')) {
        console.log(`[stream] m3u8 response is not a valid playlist. First 200 chars: ${text.substring(0, 200)}`);
        return res.status(415).json({ error: 'Server did not return a valid HLS playlist' });
      }

      // Use final URL after redirects for resolving relative refs
      const resolvedUrl = response.url || streamUrl;
      console.log(`[stream] Rewriting m3u8 from ${resolvedUrl}, lines: ${text.split('\n').length}`);
      const rewritten = rewriteM3u8(text, resolvedUrl);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
      return;
    }

    // Stream binary data
    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) {
          res.write(Buffer.from(value));
        } else {
          break;
        }
      }
      if (!res.writableEnded) res.end();
    };

    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    await pump();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream error' });
    }
  }
});

export default router;
