-- Schéma de la base « Autorisations de sortie »
-- Toutes les dates/heures techniques (created_at, debut_at, ...) sont stockées en UTC (ISO 8601).
-- Les champs "date_sortie" / "heure_*_prevue" conservent la saisie en heure locale de l'entreprise.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id         INTEGER PRIMARY KEY,
  nom        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  actif      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id          INTEGER PRIMARY KEY,
  nom         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type        TEXT NOT NULL DEFAULT 'operateur' CHECK (type IN ('operateur','administratif')),
  heure_debut TEXT NOT NULL,
  heure_fin   TEXT NOT NULL,
  pause_debut TEXT,
  pause_fin   TEXT,
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  nom                  TEXT NOT NULL,
  prenom               TEXT NOT NULL,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email                TEXT,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin','chef','rh','gardien')),
  team_id              INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  droit_toutes_equipes INTEGER NOT NULL DEFAULT 0,
  poste_garde          TEXT,
  actif                INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  password_changed_at  TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id             INTEGER PRIMARY KEY,
  nom            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  chef_equipe_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shift_id       INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  service_id     INTEGER REFERENCES services(id) ON DELETE SET NULL,
  actif          INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id         INTEGER PRIMARY KEY,
  matricule  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nom        TEXT NOT NULL,
  prenom     TEXT NOT NULL,
  service_id INTEGER REFERENCES services(id),
  team_id    INTEGER REFERENCES teams(id),
  shift_id   INTEGER REFERENCES shifts(id),
  telephone  TEXT,
  fonction   TEXT,                 -- ex. Opératrice, Chef d'équipe (information)
  regime     TEXT,                 -- Mensuel / Horaire (information)
  reserve_rh INTEGER NOT NULL DEFAULT 0, -- 1 = seul le RH (ou l'admin) peut autoriser cette personne (cadres, administration)
  photo      TEXT,
  qr_token   TEXT NOT NULL UNIQUE,
  actif      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS exit_authorizations (
  id                   INTEGER PRIMARY KEY,
  numero               TEXT UNIQUE,
  employee_id          INTEGER NOT NULL REFERENCES employees(id),
  created_by           INTEGER NOT NULL REFERENCES users(id),
  approved_by          INTEGER REFERENCES users(id),
  rejected_by          INTEGER REFERENCES users(id),
  cancelled_by         INTEGER REFERENCES users(id),
  date_sortie          TEXT NOT NULL,            -- date locale (YYYY-MM-DD) de la sortie prévue
  heure_sortie_prevue  TEXT NOT NULL,            -- HH:MM locale
  heure_retour_prevue  TEXT,                     -- HH:MM locale (peut être le lendemain) ; NULL si sortie sans retour
  avec_retour          INTEGER NOT NULL DEFAULT 1, -- 0 = sortie sans retour (l'opérateur quitte son poste)
  debut_at             TEXT NOT NULL,            -- instant UTC de début de validité
  fin_at               TEXT NOT NULL,            -- instant UTC de fin de validité (retour prévu, ou fin de poste si sans retour)
  type_sortie          TEXT NOT NULL CHECK (type_sortie IN ('PERSONNELLE','URGENCE','PROFESSIONNELLE','RENDEZ_VOUS','AUTRE')),
  motif                TEXT NOT NULL,
  commentaire          TEXT,
  commentaire_rh       TEXT,
  motif_refus          TEXT,
  motif_annulation     TEXT,
  piece_jointe         TEXT,
  piece_jointe_nom     TEXT,
  piece_jointe_type    TEXT,
  statut               TEXT NOT NULL CHECK (statut IN ('BROUILLON','EN_ATTENTE','VALIDEE','REFUSEE','ANNULEE','SORTIE_EFFECTUEE','RETOUR_EFFECTUE','SORTIE_DEFINITIVE','EXPIREE')),
  retard_notifie       INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  submitted_at         TEXT,
  approved_at          TEXT,
  rejected_at          TEXT,
  cancelled_at         TEXT,
  expired_at           TEXT,
  updated_at           TEXT
);

CREATE TABLE IF NOT EXISTS gate_movements (
  id                  INTEGER PRIMARY KEY,
  authorization_id    INTEGER NOT NULL UNIQUE REFERENCES exit_authorizations(id),
  guard_id            INTEGER NOT NULL REFERENCES users(id),
  poste_garde_sortie  TEXT,
  heure_sortie_reelle TEXT NOT NULL,
  guard_retour_id     INTEGER REFERENCES users(id),
  poste_garde_retour  TEXT,
  heure_retour_reel   TEXT,
  statut              TEXT NOT NULL CHECK (statut IN ('SORTI','RENTRE')),
  created_at          TEXT NOT NULL
);

-- Historique des contrôles effectués au poste de garde (recherche matricule / scan QR)
CREATE TABLE IF NOT EXISTS gate_checks (
  id               INTEGER PRIMARY KEY,
  guard_id         INTEGER NOT NULL REFERENCES users(id),
  poste_garde      TEXT,
  methode          TEXT NOT NULL,
  saisie           TEXT,
  employee_id      INTEGER REFERENCES employees(id),
  authorization_id INTEGER REFERENCES exit_authorizations(id),
  resultat         TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- Journal d'audit : en ajout seul, chaîné par empreinte SHA-256.
CREATE TABLE IF NOT EXISTS audit_logs (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER,
  username        TEXT NOT NULL,
  role            TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       INTEGER,
  ancienne_valeur TEXT,
  nouvelle_valeur TEXT,
  date            TEXT NOT NULL,   -- date locale
  heure           TEXT NOT NULL,   -- heure locale HH:MM:SS
  created_at      TEXT NOT NULL,   -- instant UTC
  ip_address      TEXT,
  user_agent      TEXT,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Le journal d''audit est en lecture seule'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Le journal d''audit est en lecture seule'); END;

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  titre       TEXT NOT NULL,
  message     TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  lu          INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,   -- empreinte SHA-256 du jeton
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_statut      ON exit_authorizations(statut);
CREATE INDEX IF NOT EXISTS idx_auth_employee    ON exit_authorizations(employee_id, debut_at);
CREATE INDEX IF NOT EXISTS idx_auth_date        ON exit_authorizations(date_sortie);
CREATE INDEX IF NOT EXISTS idx_auth_fin         ON exit_authorizations(statut, fin_at);
CREATE INDEX IF NOT EXISTS idx_auth_created_by  ON exit_authorizations(created_by);
CREATE INDEX IF NOT EXISTS idx_emp_team         ON employees(team_id);
CREATE INDEX IF NOT EXISTS idx_emp_nom          ON employees(nom, prenom);
CREATE INDEX IF NOT EXISTS idx_audit_entity     ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date       ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notif_user       ON notifications(user_id, lu);
CREATE INDEX IF NOT EXISTS idx_checks_date      ON gate_checks(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
