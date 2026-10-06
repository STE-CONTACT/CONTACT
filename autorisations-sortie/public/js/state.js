// État global de la session côté client.
/** Doit correspondre à la version du serveur (package.json). */
export const APP_VERSION = '1.1.0';

export const state = {
  user: null,
  settings: null,
  idleMinutes: 20,
  unread: 0,
  serverOffsetMs: 0, // décalage horloge serveur / navigateur
};

export const isRole = (...roles) => state.user && roles.includes(state.user.role);
export const serverNow = () => new Date(Date.now() + state.serverOffsetMs);
