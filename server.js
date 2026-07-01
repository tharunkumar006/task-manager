/**
 * src/server.js
 * Express HTTP server + WebSocket server for real-time task updates.
 *
 * WebSocket protocol:
 *   → client sends:  { type: 'auth', token: '<jwt>' }
 *   ← server sends:  { event: 'task:created' | 'task:updated' | 'task:deleted', data: {...} }
 *   ← server sends:  { event: 'connected', message: '...' }
 */

require('dotenv').config();

const http    = require('http');
const express = require('express');
const path    = require('path');
const cors    = require('cors');
const helmet  = require('helmet');
const { WebSocketServer } = require('ws');
const jwt     = require('jsonwebtoken');

// Import DB first so tables are created & demo user seeded before routes load
require('./db');

const authRoutes  = require('./routes/auth');
const taskRoutes  = require('./routes/tasks');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend SPA from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/tasks', taskRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date() }));

// SPA fallback — any non-API route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// Map of ws client → authenticated userId (null until authed)
const clients = new Map();

// Broadcast a message to all authenticated clients
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  clients.forEach((userId, ws) => {
    if (userId && ws.readyState === ws.OPEN) ws.send(msg);
  });
}

// Give the tasks router access to broadcast
taskRoutes.setBroadcast(broadcast);

wss.on('connection', (ws) => {
  clients.set(ws, null);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      // Client must authenticate first: { type: 'auth', token: '...' }
      if (msg.type === 'auth') {
        const payload = jwt.verify(msg.token, process.env.JWT_SECRET);
        clients.set(ws, payload.id);
        ws.send(JSON.stringify({ event: 'connected', message: `Welcome, ${payload.name}!` }));
      }
    } catch {
      ws.send(JSON.stringify({ event: 'error', message: 'Authentication failed.' }));
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ── START ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀  TaskManager running  →  http://localhost:${PORT}`);
  console.log(`🔌  WebSocket ready      →  ws://localhost:${PORT}`);
  console.log(`📋  Demo login           →  demo@taskmanager.app  /  demo1234\n`);
});

module.exports = { app, server };
