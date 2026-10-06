// État global de la session côté client.
export const state = {
  user: null,
  settings: null,
  idleMinutes: 20,
  unread: 0,
  serverOffsetMs: 0, // décalage horloge serveur / navigateur
};

export const isRole = (...roles) => state.user && roles.includes(state.user.role);
export const serverNow = () => new Date(Date.now() + state.serverOffsetMs);
