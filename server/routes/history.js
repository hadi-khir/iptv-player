import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

// Get recent watch history (last 20 items, deduplicated by series)
router.get('/', (req, res) => {
  const db = getDb();
  // For series episodes, only show the most recently watched episode per series.
  // We do this by fetching all history ordered by watched_at DESC, then deduplicating
  // in application code by series_id (since SQLite window functions are verbose).
  const history = db
    .prepare(
      `SELECT wh.*, c.name as connection_name
       FROM watch_history wh
       JOIN connections c ON c.id = wh.connection_id
       WHERE wh.user_id = ?
       ORDER BY wh.watched_at DESC
       LIMIT 50`
    )
    .all(req.user.id);

  // Deduplicate: for entries with the same series_id, keep only the most recent
  const seen = new Set();
  const deduplicated = [];
  for (const item of history) {
    if (item.series_id) {
      const key = `${item.connection_id}:${item.series_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    deduplicated.push(item);
    if (deduplicated.length >= 20) break;
  }

  res.json(deduplicated);
});

// Upsert watch progress
router.post('/', (req, res) => {
  try {
    const { connection_id, stream_id, stream_type, series_id, name, stream_icon, position, duration } = req.body;
    if (!connection_id || !stream_id) {
      return res.status(400).json({ error: 'connection_id and stream_id required' });
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO watch_history (user_id, connection_id, stream_id, stream_type, series_id, name, stream_icon, position, duration, watched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, connection_id, stream_id, stream_type)
       DO UPDATE SET position = excluded.position, duration = excluded.duration,
                     name = excluded.name, stream_icon = excluded.stream_icon,
                     series_id = excluded.series_id,
                     watched_at = CURRENT_TIMESTAMP`
    ).run(
      req.user.id,
      connection_id,
      stream_id,
      stream_type || 'live',
      series_id || null,
      name || '',
      stream_icon || '',
      position || 0,
      duration || 0
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Watch history error:', err);
    res.status(500).json({ error: 'Failed to save watch history' });
  }
});

// Get progress for a specific stream
router.get('/:connId/:streamId/:streamType', (req, res) => {
  const db = getDb();
  const entry = db
    .prepare(
      'SELECT position, duration FROM watch_history WHERE user_id = ? AND connection_id = ? AND stream_id = ? AND stream_type = ?'
    )
    .get(req.user.id, req.params.connId, req.params.streamId, req.params.streamType);
  res.json(entry || { position: 0, duration: 0 });
});

// Delete a history entry
router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM watch_history WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Entry not found' });
  res.json({ success: true });
});

export default router;
