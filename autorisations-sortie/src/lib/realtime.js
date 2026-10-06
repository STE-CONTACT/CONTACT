'use strict';
/**
 * Temps réel via Server-Sent Events (SSE) : simple, compatible avec tous les navigateurs
 * de tablette, et traverse facilement les proxys HTTP.
 */
function createRealtime() {
  const clients = new Map(); // userId -> Set<{res, role}>

  function add(user, res) {
    let set = clients.get(user.id);
    if (!set) { set = new Set(); clients.set(user.id, set); }
    const client = { res, role: user.role, userId: user.id };
    set.add(client);
    return () => { set.delete(client); if (!set.size) clients.delete(user.id); };
  }

  function write(client, event, data) {
    try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client parti */ }
  }

  function sendToUser(userId, event, data) {
    const set = clients.get(userId);
    if (set) for (const c of set) write(c, event, data);
  }

  /** Diffuse un évènement aux clients connectés, filtrés par rôle si précisé. */
  function broadcast(event, data, roles = null) {
    for (const set of clients.values()) for (const c of set) if (!roles || roles.includes(c.role)) write(c, event, data);
  }

  function closeUser(userId) {
    const set = clients.get(userId);
    if (set) for (const c of set) { write(c, 'logout', {}); try { c.res.end(); } catch { /* ignore */ } }
  }

  function heartbeat() {
    for (const set of clients.values()) for (const c of set) { try { c.res.write(': ping\n\n'); } catch { /* ignore */ } }
  }

  function closeAll() {
    for (const set of clients.values()) for (const c of set) { try { c.res.end(); } catch { /* ignore */ } }
    clients.clear();
  }

  function connectedCount() { let n = 0; for (const s of clients.values()) n += s.size; return n; }

  return { add, sendToUser, broadcast, closeUser, heartbeat, closeAll, connectedCount };
}

module.exports = { createRealtime };
