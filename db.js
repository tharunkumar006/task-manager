/**
 * src/db.js
 * SQLite database — auto-creates tables and a demo user on first run.
 * Zero configuration required.
 */

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || './taskmanager.db';
const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    status      TEXT DEFAULT 'todo'     CHECK(status IN ('todo','inprogress','done')),
    priority    TEXT DEFAULT 'medium'   CHECK(priority IN ('low','medium','high')),
    due_date    TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
`);

// ── SEED DEMO ACCOUNT ────────────────────────────────────────────────────────
const demoExists = db.prepare('SELECT id FROM users WHERE email=?').get('demo@taskmanager.app');
if (!demoExists) {
  const { v4: uuidv4 } = require('uuid');
  const hash = bcrypt.hashSync('demo1234', 10);
  const userId = uuidv4();
  db.prepare(`INSERT INTO users (id,name,email,password) VALUES (?,?,?,?)`).run(userId,'Demo User','demo@taskmanager.app',hash);

  const now = new Date();
  const fmt = (d) => d.toISOString().split('T')[0];
  const tasks = [
    { id:uuidv4(), user_id:userId, title:'Set up project repository', description:'Initialise Git, add .gitignore, push to GitHub.', status:'done',       priority:'high',   due_date:fmt(new Date(now-864e5*3)) },
    { id:uuidv4(), user_id:userId, title:'Design database schema',     description:'Model users and tasks tables with proper constraints.', status:'done', priority:'high',   due_date:fmt(new Date(now-864e5*2)) },
    { id:uuidv4(), user_id:userId, title:'Build REST API',             description:'Implement auth and CRUD endpoints with Express.', status:'inprogress', priority:'high',   due_date:fmt(new Date(now+864e5)) },
    { id:uuidv4(), user_id:userId, title:'Add WebSocket support',      description:'Real-time task updates using the ws library.', status:'inprogress',   priority:'medium', due_date:fmt(new Date(now+864e5*2)) },
    { id:uuidv4(), user_id:userId, title:'Write unit tests',           description:'Cover auth middleware and task routes with Jest.', status:'todo',       priority:'medium', due_date:fmt(new Date(now+864e5*4)) },
    { id:uuidv4(), user_id:userId, title:'Deploy to production',       description:'Deploy on Railway or Render with env vars set.', status:'todo',        priority:'low',    due_date:fmt(new Date(now+864e5*7)) },
  ];
  const ins = db.prepare(`INSERT INTO tasks (id,user_id,title,description,status,priority,due_date) VALUES (@id,@user_id,@title,@description,@status,@priority,@due_date)`);
  db.transaction(() => tasks.forEach(t => ins.run(t)))();
  console.log('🌱  Demo account created  →  demo@taskmanager.app  /  demo1234');
}

module.exports = db;
