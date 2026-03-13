import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb } from './server/db.js';
import authRoutes from './server/routes/auth.js';
import connectionRoutes from './server/routes/connections.js';
import channelRoutes from './server/routes/channels.js';
import favoriteRoutes from './server/routes/favorites.js';
import streamRoutes from './server/routes/stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.set('trust proxy', 1);

if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(compression());
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// ── Database ─────────────────────────────────────────────────────────────────
initDb();

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/connections', apiLimiter, connectionRoutes);
app.use('/api/channels', apiLimiter, channelRoutes);
app.use('/api/favorites', apiLimiter, favoriteRoutes);
app.use('/api/stream', streamRoutes);

// ── Static / SPA ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
