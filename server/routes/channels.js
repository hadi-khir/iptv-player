import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as xtream from '../xtream.js';

const router = Router();
router.use(authMiddleware);

function getConnection(req, res) {
  const db = getDb();
  const conn = db
    .prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.connId, req.user.id);
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return null;
  }
  return conn;
}

// Live TV
router.get('/:connId/live/categories', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getLiveCategories(conn);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:connId/live/streams', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getLiveStreams(conn, req.query.category_id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VOD
router.get('/:connId/vod/categories', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getVodCategories(conn);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:connId/vod/streams', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getVodStreams(conn, req.query.category_id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Series
router.get('/:connId/series/categories', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getSeriesCategories(conn);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:connId/series/list', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getSeries(conn, req.query.category_id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:connId/series/:seriesId', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getSeriesInfo(conn, req.params.seriesId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// EPG - Xtream API often base64-encodes title/description
// Only decode if it looks like proper base64: length divisible by 4 with padding,
// no spaces, and decodes to clean printable text
function tryDecodeBase64(str) {
  if (!str) return str;
  const trimmed = str.trim();
  // Must be at least 4 chars, length divisible by 4, no spaces/punctuation outside base64 charset
  if (trimmed.length < 4 || trimmed.length % 4 !== 0) return str;
  if (/[^A-Za-z0-9+/=]/.test(trimmed)) return str;
  // Must have valid padding (0-2 trailing '=' chars)
  if (/={3,}/.test(trimmed)) return str;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    // Reject if decoded text contains control characters (binary garbage)
    if (/[\x00-\x08\x0E-\x1F\x7F]/.test(decoded)) return str;
    // Reject if decoded is empty or shorter than 1 char
    if (!decoded) return str;
    return decoded;
  } catch {
    return str;
  }
}

router.get('/:connId/epg/:streamId', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getEpg(conn, req.params.streamId);

    // Xtream API returns base64-encoded title/description in EPG listings
    if (data?.epg_listings) {
      for (const item of data.epg_listings) {
        if (item.title) item.title = tryDecodeBase64(item.title);
        if (item.description) item.description = tryDecodeBase64(item.description);
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search across all streams (uses pre-built index)
router.get('/:connId/search', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const query = (req.query.q || '').toLowerCase();
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const typeFilter = req.query.type || null; // 'live', 'movie', 'series'
    const index = await xtream.buildSearchIndex(conn);
    const results = [];
    for (const item of index.items) {
      if (typeFilter && item.type !== typeFilter) continue;
      if (item._name.includes(query)) {
        const { _name, ...rest } = item;
        results.push(rest);
        if (results.length >= 50) break;
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
