/**
 * Authentification : chaque appel porte un jeton d'identité Google, vérifié ici.
 * Apps Script ne sait pas vérifier une signature RS256 : on délègue à l'endpoint
 * tokeninfo de Google, puis on contrôle audience, émetteur, expiration et e-mail.
 */
function tokenCacheKey_(token) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  return 'tok_' + Utilities.base64EncodeWebSafe(digest);
}

/** Adresse publique de ce serveur, sans le /u/N/ ajouté quand plusieurs comptes sont ouverts. */
function serverUrl_() {
  const saved = PropertiesService.getScriptProperties().getProperty(PROP.PUBLIC_URL);
  let url = saved;
  if (!url) {
    try { url = ScriptApp.getService().getUrl(); } catch (err) { url = ''; }
  }
  return String(url || '').trim().replace(/\/macros\/u\/\d+\/s\//, '/macros/s/').replace(/\/dev$/, '/exec');
}

/**
 * Tous les serveurs Orbia partagent le même identifiant Google. Le jeton porte donc
 * l'empreinte du serveur visé : un serveur d'une autre société ne peut pas le rejouer ici.
 */
function checkNonce_(claims) {
  const url = serverUrl_();
  if (!url) throw ERR.notConfigured();
  if (claims.nonce !== hexDigest_(url)) throw ERR.unauthenticated();
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
  checkNonce_(claims);

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
