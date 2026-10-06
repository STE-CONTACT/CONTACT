'use strict';
const express = require('express');
const clock = require('../lib/clock');
const { badRequest } = require('../lib/errors');

module.exports = function notificationRoutes(ctx) {
  const { db, auth, realtime, notifier } = ctx;
  const router = express.Router();

  router.get('/notifications', (req, res) => {
    const all = req.query.all === '1' && req.user.role === 'admin';
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const rows = all
      ? db.all(`SELECT n.*, u.username, u.role FROM notifications n JOIN users u ON u.id = n.user_id ORDER BY n.id DESC LIMIT ?`, limit)
      : db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', req.user.id, limit);
    const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND lu = 0', req.user.id).n;
    res.json({ unread, items: rows.map((r) => ({ ...r })) });
  });

  router.post('/notifications/:id/read', (req, res) => {
    db.run('UPDATE notifications SET lu = 1 WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', (req, res) => {
    db.run('UPDATE notifications SET lu = 1 WHERE user_id = ? AND lu = 0', req.user.id);
    res.json({ ok: true });
  });

  // Abonnement Web Push (notifications même lorsque l'application est en arrière-plan)
  router.post('/push/subscribe', (req, res) => {
    const s = req.body || {};
    if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) throw badRequest('Abonnement invalide');
    db.run(`INSERT INTO push_subscriptions (user_id, endpoint, keys, created_at) VALUES (?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`, req.user.id, s.endpoint, JSON.stringify({ p256dh: s.keys.p256dh, auth: s.keys.auth }), clock.nowIso());
    res.json({ ok: true, enabled: notifier.pushEnabled() });
  });
  router.post('/push/unsubscribe', (req, res) => {
    db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', String(req.body.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  return { router, events: eventsHandler };

  /** Flux temps réel (SSE). Ne compte pas comme une activité pour la déconnexion automatique. */
  function eventsHandler(req, res) {
    const r = auth.resolve(req, false);
    if (!r || r.expired) { res.status(401).end(); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ server_time: clock.nowIso() })}\n\n`);
    const remove = realtime.add(r.user, res);
    // Vérifie périodiquement que la session est toujours valide (inactivité, désactivation).
    const timer = setInterval(() => {
      const still = auth.resolve(req, false);
      if (!still || still.expired) { try { res.write('event: logout\ndata: {}\n\n'); res.end(); } catch { /* ignore */ } }
    }, 60000);
    req.on('close', () => { clearInterval(timer); remove(); });
  }
};
