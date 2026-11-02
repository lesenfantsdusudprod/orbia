// Fichier généré par npm run bundle. Ne pas modifier ici.
// ===== 00_Constants.gs =====
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

// ===== 01_Errors.gs =====
/** Erreur métier : `message` est affiché à l'utilisateur, jamais de détail technique. */
class OrbiaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OrbiaError';
    this.code = code;
  }
}

const ERR = Object.freeze({
  notConfigured: () => new OrbiaError('NOT_CONFIGURED', "Orbia n'est pas encore configuré sur le serveur."),
  badRequest: (m) => new OrbiaError('BAD_REQUEST', m || 'La requête est invalide.'),
  unauthenticated: () => new OrbiaError('UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous.'),
  notAllowed: () => new OrbiaError('NOT_ALLOWED', "Ce compte Google n'a pas accès à Orbia."),
  forbidden: () => new OrbiaError('FORBIDDEN', "Votre rôle ne permet pas cette action."),
  validation: (m) => new OrbiaError('VALIDATION', m),
  busy: () => new OrbiaError('BUSY', 'Orbia est occupé. Réessayez dans quelques secondes.'),
  authUnavailable: () => new OrbiaError('AUTH_UNAVAILABLE', "La vérification Google n'a pas répondu. Réessayez.")
});

// ===== 02_Lock.gs =====
/** Sérialise les écritures : les propriétés de script n'ont pas de transaction. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITS.LOCK_WAIT_MS)) throw ERR.busy();
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ===== 10_LogRepository.gs =====
/**
 * Journal circulaire des erreurs et actions sensibles (100 dernières entrées).
 * Stockage provisoire : le journal d'audit durable arrive avec le classeur en A2.
 * Écrire au journal ne doit jamais faire échouer l'opération en cours.
 */
function sanitizeLogText_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+){0,2}/g, '[jeton masqué]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, LIMITS.LOG_MESSAGE_CHARS);
}

const LogRepository = {
  append(entry) {
    const clean = {
      at: new Date().toISOString(),
      level: ['error', 'warn', 'audit', 'info'].indexOf(entry.level) >= 0 ? entry.level : 'info',
      source: entry.source === 'client' ? 'client' : 'server',
      code: sanitizeLogText_(entry.code).slice(0, 40),
      action: sanitizeLogText_(entry.action).slice(0, 60),
      actor: sanitizeLogText_(entry.actor).slice(0, 254),
      message: sanitizeLogText_(entry.message),
      correlationId: sanitizeLogText_(entry.correlationId).slice(0, 40)
    };
    console.log(JSON.stringify(clean));
    try {
      withLock_(() => {
        const props = PropertiesService.getScriptProperties();
        const head = Number(props.getProperty(PROP.LOG_HEAD) || 0);
        props.setProperties({
          [PROP.LOG_PREFIX + (head % LIMITS.LOG_SLOTS)]: JSON.stringify(clean),
          [PROP.LOG_HEAD]: String(head + 1)
        });
      });
    } catch (err) {
      console.error('Journal indisponible');
    }
  },

  /** Du plus récent au plus ancien. */
  list() {
    const all = PropertiesService.getScriptProperties().getProperties();
    const head = Number(all[PROP.LOG_HEAD] || 0);
    const out = [];
    for (let i = 1; i <= Math.min(head, LIMITS.LOG_SLOTS); i++) {
      const raw = all[PROP.LOG_PREFIX + ((head - i) % LIMITS.LOG_SLOTS)];
      if (raw) out.push(JSON.parse(raw));
    }
    return out;
  }
};

// ===== 11_UserRepository.gs =====
/**
 * Liste blanche. Interface volontairement étroite pour migrer vers l'onglet
 * `Users` en A2 sans toucher aux appelants.
 */
function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

const UserRepository = {
  all() {
    const raw = PropertiesService.getScriptProperties().getProperty(PROP.USERS);
    return raw ? JSON.parse(raw) : [];
  },

  find(email) {
    const wanted = normalizeEmail_(email);
    return this.all().find((u) => u.email === wanted) || null;
  },

  saveAll_(users) {
    PropertiesService.getScriptProperties().setProperty(PROP.USERS, JSON.stringify(users));
  },

  /** Crée le premier administrateur, une seule fois, si la liste est vide. */
  bootstrapIfEmpty() {
    if (this.all().length) return;
    const admin = normalizeEmail_(PropertiesService.getScriptProperties().getProperty(PROP.BOOTSTRAP_ADMIN));
    if (!admin) throw ERR.notConfigured();
    withLock_(() => {
      if (this.all().length) return;
      this.saveAll_([{ email: admin, role: ROLES.ADMIN, active: true, addedAt: new Date().toISOString(), addedBy: 'bootstrap' }]);
    });
  },

  /** À appeler uniquement dans withLock_. Refuse de laisser Orbia sans administrateur actif. */
  upsert_(user, actorEmail) {
    const users = this.all();
    const index = users.findIndex((u) => u.email === user.email);
    const next = index >= 0
      ? Object.assign({}, users[index], { role: user.role, active: user.active })
      : { email: user.email, role: user.role, active: user.active, addedAt: new Date().toISOString(), addedBy: actorEmail };
    if (index >= 0) users[index] = next; else users.push(next);
    if (!users.some((u) => u.active && u.role === ROLES.ADMIN)) {
      throw ERR.validation('Orbia doit garder au moins un administrateur actif.');
    }
    this.saveAll_(users);
    return next;
  }
};

// ===== 12_CompanyRepository.gs =====
/**
 * Configuration par société, rangée sous son propre identifiant.
 * Rien n'est pré-rempli : les données légales sont saisies par un administrateur.
 */
const COMPANY_DEFAULTS = Object.freeze({
  legalName: '',
  legalForm: '',
  siren: '',
  siret: '',
  fiscalYearStart: '',
  fiscalYearEnd: '',
  currency: 'EUR',
  vatRegime: 'a_confirmer',
  vatPeriodicity: 'a_confirmer',
  projectsEnabled: true
});

const CompanyRepository = {
  key_() {
    const id = PropertiesService.getScriptProperties().getProperty(PROP.COMPANY_ID) || 'default';
    return PROP.COMPANY_PREFIX + id;
  },

  get() {
    const raw = PropertiesService.getScriptProperties().getProperty(this.key_());
    return Object.assign({}, COMPANY_DEFAULTS, raw ? JSON.parse(raw) : {});
  },

  /** À appeler uniquement dans withLock_. */
  save_(config) {
    PropertiesService.getScriptProperties().setProperty(this.key_(), JSON.stringify(config));
    return config;
  }
};

// ===== 20_Auth.gs =====
/**
 * Authentification : chaque appel porte un jeton d'identité Google, vérifié ici.
 * Apps Script ne sait pas vérifier une signature RS256 : on délègue à l'endpoint
 * tokeninfo de Google, puis on contrôle audience, émetteur, expiration et e-mail.
 */
function tokenCacheKey_(token) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  return 'tok_' + Utilities.base64EncodeWebSafe(digest);
}

function checkClaims_(claims, clientId) {
  const now = Math.floor(Date.now() / 1000);
  const issuerOk = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (claims.aud !== clientId || !issuerOk || !verified || !claims.email || !claims.sub) throw ERR.unauthenticated();
  if (!(Number(claims.exp) > now - LIMITS.CLOCK_SKEW_SECONDS)) throw ERR.unauthenticated();
}

function fetchClaims_(token) {
  let response;
  try {
    response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true, followRedirects: false }
    );
  } catch (err) {
    throw ERR.authUnavailable();
  }
  const status = response.getResponseCode();
  if (status >= 500) throw ERR.authUnavailable();
  if (status !== 200) throw ERR.unauthenticated();
  try {
    return JSON.parse(response.getContentText());
  } catch (err) {
    throw ERR.authUnavailable();
  }
}

/** Renvoie l'identité Google prouvée par le jeton, ou lève une erreur. */
function authenticate_(token) {
  const clientId = PropertiesService.getScriptProperties().getProperty(PROP.GOOGLE_CLIENT_ID);
  if (!clientId) throw ERR.notConfigured();
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw ERR.unauthenticated();

  const cache = CacheService.getScriptCache();
  const key = tokenCacheKey_(token);
  const cached = cache.get(key);
  const claims = cached ? JSON.parse(cached) : fetchClaims_(token);
  checkClaims_(claims, clientId);

  if (!cached) {
    const remaining = Number(claims.exp) - Math.floor(Date.now() / 1000);
    const ttl = Math.min(LIMITS.TOKEN_CACHE_SECONDS, remaining);
    if (ttl > 0) cache.put(key, JSON.stringify(claims), ttl);
  }
  return { email: normalizeEmail_(claims.email), name: String(claims.name || '') };
}

/** Limite à une entrée par compte et par heure : un inconnu ne peut pas vider le journal. */
function logDenied_(email, correlationId) {
  const cache = CacheService.getScriptCache();
  const key = 'den_' + tokenCacheKey_(email);
  if (cache.get(key)) return;
  cache.put(key, '1', LIMITS.DENIED_LOG_WINDOW_SECONDS);
  LogRepository.append({ level: 'warn', code: 'NOT_ALLOWED', actor: email, message: 'Connexion refusée : compte hors liste blanche ou désactivé.', correlationId });
}

/** Rôle et statut sont relus à chaque appel : une désactivation prend effet immédiatement. */
function resolveUser_(identity, correlationId) {
  UserRepository.bootstrapIfEmpty();
  const user = UserRepository.find(identity.email);
  if (!user || user.active !== true || !ROLE_PERMISSIONS[user.role]) {
    logDenied_(identity.email, correlationId);
    throw ERR.notAllowed();
  }
  return { email: user.email, role: user.role, name: identity.name };
}

function requirePermission_(user, permission) {
  if (ROLE_PERMISSIONS[user.role].indexOf(permission) < 0) throw ERR.forbidden();
}

// ===== 21_Validation.gs =====
function asPlainObject_(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw ERR.badRequest();
  return value;
}

function cleanString_(value, label, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw ERR.validation(label + ' : valeur invalide.');
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > max) throw ERR.validation(label + ' : ' + max + ' caractères maximum.');
  return text;
}

function cleanEnum_(value, label, allowed) {
  if (allowed.indexOf(value) < 0) throw ERR.validation(label + ' : valeur non reconnue.');
  return value;
}

function cleanDigits_(value, label, length) {
  const text = cleanString_(value, label, 40).replace(/\s/g, '');
  if (text && !new RegExp('^\\d{' + length + '}$').test(text)) {
    throw ERR.validation(label + ' : ' + length + ' chiffres attendus.');
  }
  return text;
}

function cleanDate_(value, label) {
  const text = cleanString_(value, label, 10);
  if (!text) return '';
  const parsed = new Date(text + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || isNaN(parsed) || parsed.toISOString().slice(0, 10) !== text) {
    throw ERR.validation(label + ' : date invalide.');
  }
  return text;
}

function validateCompany_(input) {
  const data = asPlainObject_(input);
  const siren = cleanDigits_(data.siren, 'SIREN', 9);
  const siret = cleanDigits_(data.siret, 'SIRET', 14);
  if (siren && siret && siret.indexOf(siren) !== 0) {
    throw ERR.validation('Le SIRET doit commencer par le SIREN.');
  }
  const fiscalYearStart = cleanDate_(data.fiscalYearStart, 'Début d’exercice');
  const fiscalYearEnd = cleanDate_(data.fiscalYearEnd, 'Fin d’exercice');
  if (fiscalYearStart && fiscalYearEnd && fiscalYearEnd <= fiscalYearStart) {
    throw ERR.validation('La fin de l’exercice doit suivre son début.');
  }
  if (typeof data.projectsEnabled !== 'boolean') throw ERR.validation('Suivi par projet : valeur invalide.');
  return {
    legalName: cleanString_(data.legalName, 'Raison sociale', 160),
    legalForm: cleanString_(data.legalForm, 'Forme juridique', 40),
    siren,
    siret,
    fiscalYearStart,
    fiscalYearEnd,
    currency: cleanEnum_(data.currency, 'Devise', ['EUR']),
    vatRegime: cleanEnum_(data.vatRegime, 'Régime de TVA', ['a_confirmer', 'reel_normal', 'reel_simplifie', 'franchise']),
    vatPeriodicity: cleanEnum_(data.vatPeriodicity, 'Périodicité de TVA', ['a_confirmer', 'mensuelle', 'trimestrielle', 'annuelle']),
    projectsEnabled: data.projectsEnabled
  };
}

function validateUser_(input) {
  const data = asPlainObject_(input);
  const email = normalizeEmail_(cleanString_(data.email, 'E-mail', 254));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ERR.validation('E-mail : adresse invalide.');
  if (typeof data.active !== 'boolean') throw ERR.validation('Statut : valeur invalide.');
  return { email, role: cleanEnum_(data.role, 'Rôle', Object.keys(ROLE_PERMISSIONS)), active: data.active };
}

// ===== 30_Actions.gs =====
/**
 * Registre des actions. Chaque action déclare son droit : pas de droit, pas d'accès.
 * Ajouter une fonction ailleurs ne l'expose jamais.
 */
const ACTIONS = Object.freeze({
  'session.get': {
    permission: 'session:read',
    run: (_, ctx) => ({
      user: { email: ctx.user.email, name: ctx.user.name, role: ctx.user.role },
      permissions: ROLE_PERMISSIONS[ctx.user.role],
      company: CompanyRepository.get(),
      version: ORBIA_VERSION
    })
  },

  'company.update': {
    permission: 'company:write',
    run: (payload, ctx) => {
      const config = validateCompany_(payload);
      withLock_(() => CompanyRepository.save_(config));
      LogRepository.append({ level: 'audit', code: 'COMPANY_UPDATED', action: ctx.action, actor: ctx.user.email, message: 'Configuration de la société modifiée.', correlationId: ctx.correlationId });
      return { company: config };
    }
  },

  'users.list': {
    permission: 'users:manage',
    run: () => ({ users: UserRepository.all() })
  },

  'users.save': {
    permission: 'users:manage',
    run: (payload, ctx) => {
      const input = validateUser_(payload);
      if (input.email === ctx.user.email && (!input.active || input.role !== ROLES.ADMIN)) {
        throw ERR.validation('Vous ne pouvez pas retirer vos propres droits d’administrateur.');
      }
      const saved = withLock_(() => UserRepository.upsert_(input, ctx.user.email));
      LogRepository.append({ level: 'audit', code: 'USER_SAVED', action: ctx.action, actor: ctx.user.email, message: input.email + ' : rôle ' + input.role + ', ' + (input.active ? 'actif' : 'désactivé') + '.', correlationId: ctx.correlationId });
      return { user: saved };
    }
  },

  'logs.list': {
    permission: 'logs:read',
    run: () => ({ entries: LogRepository.list() })
  },

  'logs.client': {
    permission: 'logs:write',
    run: (payload, ctx) => {
      const data = asPlainObject_(payload);
      LogRepository.append({ level: 'error', source: 'client', code: 'CLIENT_ERROR', action: data.where, actor: ctx.user.email, message: data.message, correlationId: ctx.correlationId });
      return {};
    }
  }
});

// ===== 40_Http.gs =====
/**
 * Point d'entrée de l'application web. Le déploiement est ouvert à « Tout le monde »
 * car l'interface vit sur GitHub Pages : la protection est ici, à chaque appel,
 * et rien n'est accessible sans jeton Google valide d'un compte autorisé.
 *
 * Apps Script renvoie toujours HTTP 200 : le résultat est dans l'enveloppe JSON.
 */
function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function parseRequest_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (typeof raw !== 'string' || !raw || raw.length > LIMITS.MAX_BODY_CHARS) throw ERR.badRequest();
  let body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    throw ERR.badRequest();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ERR.badRequest();
  return body;
}

function dispatch_(e, correlationId) {
  const body = parseRequest_(e);
  // L'identité passe avant l'action : un inconnu ne peut pas sonder la liste des actions.
  const identity = authenticate_(body.idToken);
  const user = resolveUser_(identity, correlationId);

  const name = body.action;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, name)) throw ERR.badRequest();
  const action = ACTIONS[name];
  requirePermission_(user, action.permission);
  return action.run(body.payload, { user, action: name, correlationId });
}

function doPost(e) {
  const correlationId = Utilities.getUuid();
  try {
    return jsonResponse_({ ok: true, data: dispatch_(e, correlationId) });
  } catch (err) {
    if (err instanceof OrbiaError) {
      return jsonResponse_({ ok: false, error: { code: err.code, message: err.message, correlationId } });
    }
    LogRepository.append({ level: 'error', code: 'INTERNAL', message: err && err.message, correlationId });
    return jsonResponse_({ ok: false, error: { code: 'INTERNAL', message: 'Une erreur est survenue. Réessayez.', correlationId } });
  }
}

/** Ne révèle rien : sert uniquement à vérifier que le déploiement répond. */
function doGet() {
  return jsonResponse_({ ok: true, service: 'orbia' });
}

// ===== 50_Setup.gs =====
/**
 * À lancer depuis l'éditeur Apps Script après avoir rempli les propriétés de script.
 * Déclenche aussi la demande d'autorisation Google. N'écrit rien.
 */
function orbiaCheckSetup() {
  const props = PropertiesService.getScriptProperties();
  const missing = [PROP.GOOGLE_CLIENT_ID, PROP.BOOTSTRAP_ADMIN].filter((key) => !props.getProperty(key));
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test', { muteHttpExceptions: true });
  if (missing.length) {
    console.log('Propriétés manquantes : ' + missing.join(', '));
  } else {
    console.log('Configuration complète. Version ' + ORBIA_VERSION);
  }
}
