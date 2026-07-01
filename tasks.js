/**
 * src/routes/tasks.js
 * All routes are protected — require Bearer JWT.
 *
 * GET    /api/tasks          list user's tasks (filter by status/priority)
 * POST   /api/tasks          create task
 * GET    /api/tasks/:id      get single task
 * PUT    /api/tasks/:id      update task (full)
 * PATCH  /api/tasks/:id      partial update (e.g. status change)
 * DELETE /api/tasks/:id      delete task
 * GET    /api/tasks/stats    task counts by status
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body, query, validationResult } = require('express-validator');

const db   = require('../db');
const auth = require('../middleware/auth');

// Attach the WebSocket broadcast function after server starts
let broadcast = () => {};
router.setBroadcast = (fn) => { broadcast = fn; };

// Helper — ensure task belongs to current user
function ownTask(taskId, userId) {
  return db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId, userId);
}

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM tasks WHERE user_id=? GROUP BY status
  `).all(req.user.id);

  const stats = { todo: 0, inprogress: 0, done: 0, total: 0 };
  rows.forEach(r => { stats[r.status] = r.count; stats.total += r.count; });
  res.json({ success: true, data: stats });
});

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', auth, [
  query('status').optional().isIn(['todo','inprogress','done']),
  query('priority').optional().isIn(['low','medium','high']),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(422).json({ success: false, errors: errs.array() });

  const { status, priority, search } = req.query;
  let sql = 'SELECT * FROM tasks WHERE user_id=?';
  const params = [req.user.id];

  if (status)   { sql += ' AND status=?';   params.push(status); }
  if (priority) { sql += ' AND priority=?'; params.push(priority); }
  if (search)   { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  sql += ' ORDER BY CASE priority WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END, created_at DESC';

  const tasks = db.prepare(sql).all(...params);
  res.json({ success: true, data: tasks });
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', auth, [
  body('title').trim().notEmpty().withMessage('Title is required.').isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('status').optional().isIn(['todo','inprogress','done']),
  body('priority').optional().isIn(['low','medium','high']),
  body('due_date').optional({ nullable: true }).isISO8601().toDate(),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(422).json({ success: false, errors: errs.array() });

  const { title, description='', status='todo', priority='medium', due_date=null } = req.body;
  const id = uuidv4();

  db.prepare(`
    INSERT INTO tasks (id,user_id,title,description,status,priority,due_date)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, req.user.id, title, description, status, priority,
         due_date ? new Date(due_date).toISOString().split('T')[0] : null);

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  broadcast({ event: 'task:created', data: task });
  res.status(201).json({ success: true, data: task });
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const task = ownTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  res.json({ success: true, data: task });
});

// ── FULL UPDATE ───────────────────────────────────────────────────────────────
router.put('/:id', auth, [
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().trim(),
  body('status').optional().isIn(['todo','inprogress','done']),
  body('priority').optional().isIn(['low','medium','high']),
  body('due_date').optional({ nullable: true }).isISO8601(),
], (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(422).json({ success: false, errors: errs.array() });

  if (!ownTask(req.params.id, req.user.id))
    return res.status(404).json({ success: false, message: 'Task not found.' });

  const { title, description='', status='todo', priority='medium', due_date=null } = req.body;
  db.prepare(`
    UPDATE tasks SET title=?,description=?,status=?,priority=?,due_date=?,updated_at=datetime('now')
    WHERE id=? AND user_id=?
  `).run(title, description, status, priority,
         due_date ? new Date(due_date).toISOString().split('T')[0] : null,
         req.params.id, req.user.id);

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  broadcast({ event: 'task:updated', data: task });
  res.json({ success: true, data: task });
});

// ── PARTIAL UPDATE (status toggle etc.) ───────────────────────────────────────
router.patch('/:id', auth, (req, res) => {
  if (!ownTask(req.params.id, req.user.id))
    return res.status(404).json({ success: false, message: 'Task not found.' });

  const allowed = ['title','description','status','priority','due_date'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(422).json({ success: false, message: 'No valid fields provided.' });

  const sets = fields.map(f => `${f}=?`).join(', ');
  const vals = fields.map(f => req.body[f]);
  db.prepare(`UPDATE tasks SET ${sets}, updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(...vals, req.params.id, req.user.id);

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  broadcast({ event: 'task:updated', data: task });
  res.json({ success: true, data: task });
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete('/:id', auth, (req, res) => {
  if (!ownTask(req.params.id, req.user.id))
    return res.status(404).json({ success: false, message: 'Task not found.' });

  db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  broadcast({ event: 'task:deleted', data: { id: req.params.id } });
  res.json({ success: true, message: 'Task deleted.' });
});

module.exports = router;
