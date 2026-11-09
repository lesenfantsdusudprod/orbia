/**
 * Sociétés connues de ce navigateur. Chaque société a son propre serveur Apps Script,
 * dans le compte Google de son propriétaire. Seules des adresses Apps Script sont
 * acceptées : le jeton de connexion n'est jamais envoyé ailleurs.
 */
const KEY = 'orbia.companies';
const ACTIVE = 'orbia.activeCompany';
export const SERVER_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;

export function normalizeServer(raw) {
  const url = String(raw || '').trim().replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');
  return SERVER_URL.test(url) ? url : null;
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (err) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* Mémoire seule. */ }
}

function defaultCompany() {
  const url = normalizeServer(window.ORBIA_CONFIG?.apiUrl);
  return url ? { url, name: 'Société principale' } : null;
}

export function list() {
  const saved = read(KEY, []).filter((c) => normalizeServer(c.url));
  const main = defaultCompany();
  if (main && !saved.some((c) => c.url === main.url)) saved.unshift(main);
  return saved;
}

let sessionActive = null;
export function active() {
  const all = list();
  const wanted = sessionActive || read(ACTIVE, null);
  return all.find((c) => c.url === wanted) || all[0] || null;
}

export function add(url, name = 'Nouvelle société') {
  const clean = normalizeServer(url);
  if (!clean) throw new Error('Cette adresse n’est pas celle d’un serveur Orbia. Elle doit commencer par https://script.google.com/macros/s/ et finir par /exec.');
  const all = read(KEY, []);
  if (!all.some((c) => c.url === clean)) { all.push({ url: clean, name }); write(KEY, all); }
  select(clean);
  return clean;
}

export function select(url) {
  sessionActive = url;
  write(ACTIVE, url);
}

export function rename(url, name) {
  if (!name) return;
  const all = read(KEY, []);
  const found = all.find((c) => c.url === url);
  if (found) found.name = name; else all.push({ url, name });
  write(KEY, all);
}

export function remove(url) {
  write(KEY, read(KEY, []).filter((c) => c.url !== url));
}

/** Empreinte du serveur, glissée dans le jeton Google : un autre serveur ne peut pas le réutiliser. */
export async function serverNonce(url) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lien d'invitation : ?societe=<adresse du serveur>. Retiré de la barre d'adresse après lecture. */
export function takeInvitation() {
  const params = new URLSearchParams(location.search);
  const invited = params.get('societe');
  if (!invited) return null;
  params.delete('societe');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
  return add(invited);
}

export const inviteLink = (url) => `${location.origin}${location.pathname}?societe=${encodeURIComponent(url)}`;
