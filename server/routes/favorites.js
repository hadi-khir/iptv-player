import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const db = getDb();
  const favorites = db
    .prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json(favorites);
});

router.get('/:connId', (req, res) => {
  const db = getDb();
  const favorites = db
    .prepare('SELECT * FROM favorites WHERE user_id = ? AND connection_id = ? ORDER BY created_at DESC')
    .all(req.user.id, req.params.connId);
  res.json(favorites);
});

router.post('/', (req, res) => {
  try {
    const { connection_id, stream_id, stream_type, name, stream_icon } = req.body;
    if (!connection_id || !stream_id) {
      return res.status(400).json({ error: 'connection_id and stream_id required' });
    }

    const db = getDb();
    const result = db
      .prepare(
        'INSERT OR IGNORE INTO favorites (user_id, connection_id, stream_id, stream_type, name, stream_icon) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(req.user.id, connection_id, stream_id, stream_type || 'live', name || '', stream_icon || '');

    if (result.changes === 0) {
      return res.json({ message: 'Already in favorites' });
    }

    res.status(201).json({ id: result.lastInsertRowid, message: 'Added to favorites' });
  } catch (err) {
    console.error('Add favorite error:', err);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Favorite not found' });
  res.json({ success: true });
});

router.delete('/stream/:connId/:streamId/:streamType', (req, res) => {
  const db = getDb();
  const result = db
    .prepare(
      'DELETE FROM favorites WHERE user_id = ? AND connection_id = ? AND stream_id = ? AND stream_type = ?'
    )
    .run(req.user.id, req.params.connId, req.params.streamId, req.params.streamType);
  if (result.changes === 0) return res.status(404).json({ error: 'Favorite not found' });
  res.json({ success: true });
});

export default router;
