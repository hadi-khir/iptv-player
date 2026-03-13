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

// EPG
const BASE64_RE = /^[A-Za-z0-9+/\n\r]+=*$/;
function tryDecodeBase64(str) {
  if (!str || str.length < 4 || !BASE64_RE.test(str.trim())) return str;
  try {
    const decoded = Buffer.from(str, 'base64').toString('utf-8');
    // Verify the decoded result is printable text (not binary garbage)
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return str;
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

    const index = await xtream.buildSearchIndex(conn);
    const results = [];
    for (const item of index.items) {
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
