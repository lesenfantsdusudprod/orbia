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
  // Seule action ouverte à un compte Google prouvé mais non autorisé : demander l'accès.
  if (body.action === 'access.request') return AccessRequests.submit_(identity, correlationId);
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
