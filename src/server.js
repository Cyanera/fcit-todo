import path from 'node:path';
import express from 'express';
import { config, activeMode } from './config.js';
import { store } from './db.js';

export function startServer({ wa, pipeline }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(config.root, 'public')));

  app.get('/api/tasks', (req, res) => {
    const status = ['open', 'done', 'all'].includes(req.query.status)
      ? req.query.status
      : 'open';
    res.json({ tasks: store.listTasks(status), counts: store.counts() });
  });

  app.post('/api/tasks', (req, res) => {
    const { title, details, due_date, priority } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'العنوان مطلوب' });
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date.trim())) {
      return res.status(400).json({ error: 'صيغة التاريخ يجب أن تكون YYYY-MM-DD' });
    }

    const id = store.addTask(
      {
        title: title.trim(),
        details: details?.trim() || null,
        due_date: due_date?.trim() || null,
        priority: ['urgent', 'high', 'normal'].includes(priority) ? priority : 'normal',
        requester: 'أنت',
        source: 'manual',
      },
      { skipDedup: true },
    );

    res.status(201).json({ id });
  });

  app.post('/api/tasks/:id/status', (req, res) => {
    const { status } = req.body;
    if (!['open', 'done'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    store.setStatus(Number(req.params.id), status);
    res.json({ ok: true });
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const { title, details, due_date, priority } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'العنوان مطلوب' });
    store.updateTask({
      id: Number(req.params.id),
      title: title.trim(),
      details: details?.trim() || null,
      due_date: due_date?.trim() || null,
      priority: ['urgent', 'high', 'normal'].includes(priority) ? priority : 'normal',
    });
    res.json({ ok: true });
  });

  app.delete('/api/tasks/:id', (req, res) => {
    store.deleteTask(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/status', (req, res) => {
    const mode = activeMode();
    res.json({
      whatsapp: wa.status,
      groups: config.groupJids,
      mode,
      model: mode === 'rules' ? 'قواعد (بدون تكلفة)' : config.model,
      pending: pipeline.buffer.length,
      stats: pipeline.stats,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(config.port, '127.0.0.1', () => {
      console.log(`🖥️  اللوحة جاهزة على http://localhost:${config.port}`);
      resolve(server);
    });
  });
}
