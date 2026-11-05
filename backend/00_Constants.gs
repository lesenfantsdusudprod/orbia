/**
 * Orbia - constantes du backend.
 * Aucun secret ni identifiant de ressource ici : tout passe par les propriétés de script.
 * Le dépôt peut être public.
 */
const ORBIA_VERSION = '0.4.0-a4';

const PROP = Object.freeze({
  GOOGLE_CLIENT_ID: 'ORBIA_GOOGLE_CLIENT_ID',
  BOOTSTRAP_ADMIN: 'ORBIA_BOOTSTRAP_ADMIN',
  COMPANY_ID: 'ORBIA_COMPANY_ID',
  USERS: 'ORBIA_USERS',
  COMPANY_PREFIX: 'ORBIA_COMPANY_',
  LOG_HEAD: 'ORBIA_LOGHEAD',
  LOG_PREFIX: 'ORBIA_LOG_',
  ROOT_FOLDER_ID: 'ORBIA_ROOT_FOLDER_ID',
  SPREADSHEET_ID: 'ORBIA_SPREADSHEET_ID',
  FOLDER_IDS: 'ORBIA_FOLDER_IDS',
  LAST_BACKUP: 'ORBIA_LAST_BACKUP',
  LAST_RESTORE_TEST: 'ORBIA_LAST_RESTORE_TEST',
  BANK_MAPPINGS: 'ORBIA_BANK_MAPPINGS'
});

const LIMITS = Object.freeze({
  MAX_BODY_CHARS: 15000000,
  MAX_DOCUMENT_BYTES: 10000000,
  MAX_CSV_CHARS: 5000000,
  MAX_CSV_ROWS: 20000,
  CSV_ERRORS_LISTED: 20,
  CSV_ALERT_WINDOW_SECONDS: 21600,
  LOG_SLOTS: 100,
  LOG_MESSAGE_CHARS: 500,
  TOKEN_CACHE_SECONDS: 300,
  CLOCK_SKEW_SECONDS: 30,
  LOCK_WAIT_MS: 5000,
  STORAGE_LOCK_WAIT_MS: 20000,
  BACKUPS_LISTED: 30,
  DENIED_LOG_WINDOW_SECONDS: 3600
});

const ROLES = Object.freeze({ ADMIN: 'admin', COLLABORATEUR: 'collaborateur', LECTURE: 'lecture' });

/** Matrice des droits : tout ce qui n'est pas listé est refusé. */
const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['session:read', 'company:read', 'company:write', 'users:manage', 'logs:read', 'logs:write', 'storage:manage', 'bank:read', 'bank:import', 'documents:read', 'documents:write', 'documents:validate']),
  collaborateur: Object.freeze(['session:read', 'company:read', 'logs:write', 'bank:read', 'documents:read', 'documents:write']),
  lecture: Object.freeze(['session:read', 'company:read', 'logs:write', 'bank:read', 'documents:read'])
});
