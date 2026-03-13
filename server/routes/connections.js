import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../auth.js';
import { authenticate, validateServerUrl } from '../xtream.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const db = getDb();
  const connections = db
    .prepare('SELECT id, name, server_url, username, created_at FROM connections WHERE user_id = ?')
    .all(req.user.id);
  res.json(connections);
});

router.post('/', async (req, res) => {
  try {
    const { name, server_url, username, password } = req.body;
    if (!name || !server_url || !username || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate URL is not targeting internal networks
    validateServerUrl(server_url);

    // Validate connection by authenticating with xtream server
    const conn = { server_url, username, password };
    const info = await authenticate(conn);

    const db = getDb();
    const result = db
      .prepare('INSERT INTO connections (user_id, name, server_url, username, password) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, name, server_url, username, password);

    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      server_url,
      username,
      server_info: info.server_info,
      user_info: {
        status: info.user_info.status,
        exp_date: info.user_info.exp_date,
        active_cons: info.user_info.active_cons,
        max_connections: info.user_info.max_connections,
      },
    });
  } catch (err) {
    console.error('Add connection error:', err);
    res.status(400).json({ error: err.message || 'Failed to add connection' });
  }
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const conn = db
    .prepare('SELECT id, name, server_url, username, created_at FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  res.json(conn);
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Connection not found' });
  res.json({ success: true });
});

router.get('/:id/info', async (req, res) => {
  try {
    const db = getDb();
    const conn = db
      .prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    const info = await authenticate(conn);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
