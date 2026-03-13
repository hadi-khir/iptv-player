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
router.get('/:connId/epg/:streamId', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const data = await xtream.getEpg(conn, req.params.streamId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search across all streams
router.get('/:connId/search', async (req, res) => {
  try {
    const conn = getConnection(req, res);
    if (!conn) return;
    const query = (req.query.q || '').toLowerCase();
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const [live, vod, series] = await Promise.all([
      xtream.getLiveStreams(conn).catch(() => []),
      xtream.getVodStreams(conn).catch(() => []),
      xtream.getSeries(conn).catch(() => []),
    ]);

    const results = [];
    for (const s of live) {
      if (s.name && s.name.toLowerCase().includes(query)) {
        results.push({ ...s, type: 'live' });
        if (results.length >= 50) break;
      }
    }
    if (results.length < 50) {
      for (const s of vod) {
        if (s.name && s.name.toLowerCase().includes(query)) {
          results.push({ ...s, type: 'movie' });
          if (results.length >= 50) break;
        }
      }
    }
    if (results.length < 50) {
      for (const s of series) {
        if (s.name && s.name.toLowerCase().includes(query)) {
          results.push({ ...s, type: 'series' });
          if (results.length >= 50) break;
        }
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
