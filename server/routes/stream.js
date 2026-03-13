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

    // For m3u8 playlists, rewrite segment URLs to go through our proxy
    if (extension === 'm3u8') {
      const text = await response.text();
      const token = req.query.token || '';
      const proxyBase = `/api/stream/${req.params.connId}/${type}/${streamId}`;

      // Rewrite .ts segment references to proxy through us
      const rewritten = text.replace(/^(?!#)(.+)$/gm, (match) => {
        const trimmed = match.trim();
        if (!trimmed) return match;
        // Extract the segment filename and proxy it as a .ts extension
        // Xtream servers typically use relative paths for segments
        if (trimmed.startsWith('http')) {
          // Absolute URL - we need to proxy this too
          // Extract just the filename to build a proxy URL
          return `${proxyBase}?ext=ts&seg=${encodeURIComponent(trimmed)}&token=${encodeURIComponent(token)}`;
        }
        // Relative path - build full URL through proxy
        const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
        return `${proxyBase}?ext=ts&seg=${encodeURIComponent(baseUrl + trimmed)}&token=${encodeURIComponent(token)}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
      return;
    }

    // If there's a seg= param, proxy that specific segment URL instead
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
        return res.status(segResponse.status).end();
      }

      const ct = segResponse.headers.get('content-type');
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
