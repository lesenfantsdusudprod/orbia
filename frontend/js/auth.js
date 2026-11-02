/** Connexion Google. Côté navigateur, le jeton est un simple laissez-passer : tout est revérifié par le serveur. */
let token = null;
let expiresAt = 0;
let onSignedIn = () => {};

function decodeExp(jwt) {
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return Number(JSON.parse(atob(payload)).exp) * 1000;
  } catch (err) {
    return 0;
  }
}

export const currentToken = () => (Date.now() < expiresAt - 30000 ? token : null);

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

export async function initAuth(callback) {
  onSignedIn = callback;
  const gis = await waitForGoogle();
  gis.initialize({
    client_id: window.ORBIA_CONFIG.googleClientId,
    auto_select: true,
    use_fedcm_for_prompt: true,
    callback: ({ credential }) => {
      token = credential;
      expiresAt = decodeExp(credential);
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
}

export function signOut() {
  clearToken();
  window.google?.accounts?.id?.disableAutoSelect();
}
