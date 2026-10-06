'use strict';
const clock = require('./clock');

/**
 * Notifications : enregistrement en base (centre de notifications), envoi temps réel (SSE),
 * notification push (Web Push, si le navigateur y est abonné) et email optionnel (SMTP).
 */
function createNotifier({ db, realtime, audit, settings, config, log = () => {} }) {
  let webpush = null;
  let vapid = null;
  try {
    webpush = require('web-push');
    vapid = settings.getInternal('vapid');
    if (!vapid) {
      vapid = webpush.generateVAPIDKeys();
      settings.setInternal('vapid', vapid);
    }
    webpush.setVapidDetails(config.vapidSubject, vapid.publicKey, vapid.privateKey);
  } catch (e) {
    log(`Web Push indisponible : ${e.message}`);
    webpush = null;
  }

  let mailer = null;
  if (config.smtp) {
    try {
      mailer = require('nodemailer').createTransport(config.smtp);
    } catch (e) { log(`Email indisponible : ${e.message}`); }
  }

  const insert = db.prepare(`INSERT INTO notifications (user_id, type, titre, message, entity_type, entity_id, lu, created_at)
    VALUES (?,?,?,?,?,?,0,?)`);

  function recipientsByRole(...roles) {
    const ph = roles.map(() => '?').join(',');
    return db.all(`SELECT id FROM users WHERE actif = 1 AND role IN (${ph})`, ...roles).map((r) => r.id);
  }

  async function sendPush(userId, payload) {
    if (!webpush) return;
    const subs = db.all('SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = ?', userId);
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
      }
    }
  }

  async function sendEmail(userId, titre, message) {
    if (!mailer || !settings.get('notifications_email')) return;
    const u = db.get('SELECT email FROM users WHERE id = ? AND actif = 1', userId);
    if (!u || !u.email) return;
    try {
      await mailer.sendMail({ from: config.smtp.from, to: u.email, subject: `[${settings.get('entreprise_nom')}] ${titre}`, text: message });
    } catch (e) { log(`Échec email : ${e.message}`); }
  }

  /**
   * Notifie une liste d'utilisateurs. Enregistre une trace « Notification envoyée » dans le journal d'audit.
   */
  function notify({ userIds, type, titre, message, entityType = null, entityId = null, excludeUserId = null }) {
    const ids = [...new Set(userIds)].filter((id) => id != null && id !== excludeUserId);
    if (!ids.length) return [];
    const now = clock.nowIso();
    const created = [];
    for (const uid of ids) {
      const r = insert.run(uid, type, titre, message, entityType, entityId, now);
      const notif = { id: Number(r.lastInsertRowid), user_id: uid, type, titre, message, entity_type: entityType, entity_id: entityId, lu: 0, created_at: now };
      created.push(notif);
      realtime.sendToUser(uid, 'notification', notif);
    }
    const roles = db.all(`SELECT DISTINCT role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.role);
    audit.log({
      user: null, action: 'NOTIFICATION_ENVOYEE', entityType, entityId,
      after: { type, titre, destinataires: ids.length, roles },
    });
    // Envois externes asynchrones : n'impactent jamais la transaction métier.
    setImmediate(() => {
      for (const uid of ids) {
        sendPush(uid, { title: titre, body: message, tag: `${entityType || 'notif'}-${entityId || ''}-${type}`, url: entityId && entityType === 'authorization' ? `/#/autorisations/${entityId}` : '/' }).catch(() => {});
        sendEmail(uid, titre, message).catch(() => {});
      }
    });
    return created;
  }

  return {
    notify,
    recipientsByRole,
    vapidPublicKey: () => (vapid ? vapid.publicKey : null),
    pushEnabled: () => Boolean(webpush),
  };
}

module.exports = { createNotifier };
