/**
 * Connexion Google. Côté navigateur, le jeton est un simple laissez-passer : tout est
 * revérifié par le serveur. Il est gardé au plus une heure, sa durée de vie chez Google,
 * pour éviter de se reconnecter à chaque rechargement.
 */
const KEY = 'orbia.idToken';
let token = null;
let expiresAt = 0;
let onSignedIn = () => {};
let nonce = '';

function claims(jwt) {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch (err) {
    return {};
  }
}
const decodeExp = (jwt) => Number(claims(jwt).exp || 0) * 1000;

function remember(value) {
  try {
    if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY);
  } catch (err) { /* Navigation privée stricte : la session reste en mémoire. */ }
}

function restore() {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) return;
    if (decodeExp(saved) > Date.now() + 60000) {
      token = saved;
      expiresAt = decodeExp(saved);
    } else {
      localStorage.removeItem(KEY);
    }
  } catch (err) { /* Rien à restaurer. */ }
}

restore();

/** Un jeton n'est valable que pour le serveur de la société choisie. */
export const currentToken = () => (Date.now() < expiresAt - 30000 && claims(token).nonce === nonce ? token : null);

function waitForGoogle(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else if (Date.now() - start > timeoutMs) reject(new Error('gsi'));
      else setTimeout(poll, 50);
    })();
  });
}

export async function initAuth(callback, serverNonce) {
  onSignedIn = callback;
  nonce = serverNonce;
  const gis = await waitForGoogle();
  gis.initialize({
    client_id: window.ORBIA_CONFIG.googleClientId,
    auto_select: true,
    use_fedcm_for_prompt: true,
    nonce: serverNonce,
    callback: ({ credential }) => {
      token = credential;
      expiresAt = decodeExp(credential);
      remember(credential);
      onSignedIn();
    }
  });
  return gis;
}

export function renderSignIn(gis, container) {
  gis.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'fr', width: 280 });
  gis.prompt();
}

export function clearToken() {
  token = null;
  expiresAt = 0;
  remember(null);
}

export function signOut() {
  clearToken();
  window.google?.accounts?.id?.disableAutoSelect();
}
