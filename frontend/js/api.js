/** Client de l'API. Le jeton reste en mémoire, jamais dans le stockage du navigateur. */
export class ApiError extends Error {
  constructor(code, message, correlationId) {
    super(message);
    this.code = code;
    this.correlationId = correlationId;
  }
}

let getToken = () => null;
let onAccessLost = () => {};
export const setTokenProvider = (fn) => { getToken = fn; };
export const setAccessLostHandler = (fn) => { onAccessLost = fn; };

export async function api(action, payload) {
  const { apiUrl } = window.ORBIA_CONFIG;
  let response;
  try {
    // text/plain évite la requête préalable CORS, qu'Apps Script ne sait pas traiter.
    response = await fetch(apiUrl, {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ idToken: getToken(), action, payload })
    });
  } catch (err) {
    throw new ApiError('NETWORK', 'Orbia ne répond pas. Vérifiez votre connexion et réessayez.');
  }
  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new ApiError('BAD_RESPONSE', 'Le serveur Orbia a renvoyé une réponse illisible. Réessayez.');
  }
  if (!body.ok) {
    const error = new ApiError(body.error.code, body.error.message, body.error.correlationId);
    if (error.code === 'UNAUTHENTICATED' || error.code === 'NOT_ALLOWED') onAccessLost(error);
    throw error;
  }
  return body.data;
}
