/**
 * Orbia - constantes du backend.
 * Aucun secret ni identifiant de ressource ici : tout passe par les propriétés de script.
 * Le dépôt peut être public.
 */
const ORBIA_VERSION = '0.1.0-a1';

const PROP = Object.freeze({
  GOOGLE_CLIENT_ID: 'ORBIA_GOOGLE_CLIENT_ID',
  BOOTSTRAP_ADMIN: 'ORBIA_BOOTSTRAP_ADMIN',
  COMPANY_ID: 'ORBIA_COMPANY_ID',
  USERS: 'ORBIA_USERS',
  COMPANY_PREFIX: 'ORBIA_COMPANY_',
  LOG_HEAD: 'ORBIA_LOGHEAD',
  LOG_PREFIX: 'ORBIA_LOG_'
});

const LIMITS = Object.freeze({
  MAX_BODY_CHARS: 100000,
  LOG_SLOTS: 100,
  LOG_MESSAGE_CHARS: 500,
  TOKEN_CACHE_SECONDS: 300,
  CLOCK_SKEW_SECONDS: 30,
  LOCK_WAIT_MS: 5000,
  DENIED_LOG_WINDOW_SECONDS: 3600
});

const ROLES = Object.freeze({ ADMIN: 'admin', COLLABORATEUR: 'collaborateur', LECTURE: 'lecture' });

/** Matrice des droits : tout ce qui n'est pas listé est refusé. */
const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['session:read', 'company:read', 'company:write', 'users:manage', 'logs:read', 'logs:write']),
  collaborateur: Object.freeze(['session:read', 'company:read', 'logs:write']),
  lecture: Object.freeze(['session:read', 'company:read', 'logs:write'])
});
