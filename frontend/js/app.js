import { h, icon } from './dom.js';
import { api, setTokenProvider, setAccessLostHandler } from './api.js';
import { initAuth, renderSignIn, currentToken, clearToken, signOut } from './auth.js';
import { upcomingView, moreView, companyView, usersView, logsView, storageView } from './views.js';
import { homeView, PAGES, documentDetail } from './pages.js';

const root = document.getElementById('app');
let session = null;
let gis = null;

const SECTIONS = [
  { path: '/', label: 'Accueil', icon: 'home', tab: true },
  { path: '/banque', label: 'Banque', icon: 'bank', tab: true },
  { path: '/factures', label: 'Factures', icon: 'docs', tab: true },
  { path: '/projets', label: 'Événements', icon: 'calendar', optional: true },
  { path: '/tva', label: 'TVA', icon: 'vat' },
  { path: '/deplacements', label: 'Déplacements', icon: 'car' },
  { path: '/comptabilite', label: 'Comptabilité', icon: 'ledger' },
  { path: '/reglages', label: 'Réglages', icon: 'settings' }
];

const visibleSections = () => SECTIONS.filter((s) => !s.optional || session.company.projectsEnabled);
const currentPath = () => location.hash.replace(/^#/, '') || '/';

function gate(title, text, ...extra) {
  root.replaceChildren(h('main', { class: 'gate' },
    h('span', { class: 'brand' }, 'orbia'),
    h('p', { class: 'gate-tagline' }, 'La comptabilité des Enfants du Sud, au même endroit.'),
    h('section', { class: 'gate-card' },
      h('h1', {}, title),
      text && h('p', {}, text),
      ...extra),
    h('a', { class: 'gate-legal', href: 'confidentialite.html' }, 'Règles de confidentialité')));
}

function retryButton() {
  return h('button', { class: 'btn', onclick: start }, 'Réessayer');
}

function showSignIn(text = 'Connectez-vous avec votre compte Google autorisé.') {
  const slot = h('div', { class: 'gate-action' });
  gate('Connexion', text, slot);
  renderSignIn(gis, slot);
}

function shell() {
  const path = currentPath();
  const isActive = (s) => (s.path === '/' ? path === '/' : path.startsWith(s.path));
  const current = (s) => (isActive(s) ? 'page' : null);
  const sections = visibleSections();
  const tabHit = sections.some((s) => s.tab && isActive(s));
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });

  const who = session.company.legalName || session.user.name || session.user.email;
  const initials = (session.user.name || session.user.email).split(/[\s.@]+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const account = (extraClass) => h('details', { class: `account ${extraClass}` },
    h('summary', { 'aria-label': 'Compte' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials), h('span', { class: 'account-name' }, who)),
    h('div', { class: 'account-menu' },
      h('p', { class: 'muted' }, session.user.email),
      h('button', { class: 'btn btn-ghost', onclick: logout }, 'Se déconnecter')));

  root.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'rail' },
      h('a', { class: 'brand', href: '#/' }, 'orbia'),
      h('nav', { 'aria-label': 'Navigation principale' }, sections.map((s) =>
        h('a', { class: 'rail-link', href: `#${s.path}`, 'aria-current': current(s) }, icon(s.icon), s.label)))),
    h('div', { class: 'content' },
      h('header', { class: 'topbar' },
        h('div', { class: 'topbar-start' },
          path !== '/' && h('a', { class: 'back', href: tabHit ? '#/' : (path === '/plus' ? '#/' : '#/plus'), 'aria-label': 'Retour' }, icon('back')),
          h('a', { class: 'brand brand-mobile', href: '#/' }, 'orbia')),
        h('div', { class: 'topbar-end' }, account('')) ),
      main),
    h('nav', { class: 'tabbar', 'aria-label': 'Navigation principale' },
      sections.filter((s) => s.tab).map((s) => h('a', { href: `#${s.path}`, 'aria-current': current(s) }, icon(s.icon), s.label)),
      h('a', { href: '#/plus', 'aria-current': tabHit ? null : 'page' }, icon('more'), 'Plus'))));
  return main;
}

async function resolveView(path) {
  if (path === '/') return homeView(session);
  if (path === '/plus') {
    const links = visibleSections().filter((s) => !s.tab).map((s) => [`#${s.path}`, s.label]);
    return [...moreView(session, links), h('button', { class: 'btn btn-ghost', onclick: logout }, 'Se déconnecter')];
  }
  if (path === '/reglages') {
    return companyView(session, (company) => { session.company = company; });
  }
  if (path === '/reglages/utilisateurs' && session.permissions.includes('users:manage')) return usersView(session);
  if (path === '/reglages/stockage' && session.permissions.includes('storage:manage')) return storageView(session);
  if (path === '/reglages/journal' && session.permissions.includes('logs:read')) return logsView(session);
  if (path.startsWith('/factures/')) return documentDetail(session, path.slice('/factures/'.length));
  if (PAGES[path] && (path !== '/projets' || session.company.projectsEnabled)) return PAGES[path](session);
  return upcomingView('Page introuvable', 'Cette adresse ne correspond à aucune page.');
}

let renderId = 0;
async function render() {
  if (!session) return;
  const id = ++renderId;
  const main = shell();
  main.append(h('p', { class: 'muted', role: 'status' }, 'Chargement'));
  try {
    const nodes = await resolveView(currentPath());
    if (id === renderId) { main.replaceChildren(...nodes.flat().filter(Boolean)); window.scrollTo(0, 0); }
  } catch (err) {
    if (id === renderId && session) {
      main.replaceChildren(h('div', { class: 'notice', role: 'alert' }, h('p', {}, err.message), h('button', { class: 'btn', onclick: render }, 'Réessayer')));
    }
  }
}

function handleAccessLost(err) {
  if (err.code === 'UNAUTHENTICATED') {
    session = null;
    clearToken();
    showSignIn('Votre session a expiré. Reconnectez-vous.');
    return;
  }
  session = null;
  const note = h('p', { role: 'status' }, 'Ce compte Google n’a pas encore accès à Orbia.');
  const ask = h('button', { class: 'btn', onclick: async () => {
    ask.disabled = true;
    try {
      const r = await api('access.request');
      if (r.status === 'authorized') { loadSession(); return; }
      note.textContent = r.status === 'disabled'
        ? 'Ce compte a été désactivé. Contactez un administrateur.'
        : 'Demande envoyée. Un administrateur doit l’accepter, puis rechargez cette page.';
      ask.remove();
    } catch (e) { note.textContent = e.message; ask.disabled = false; }
  } }, 'Demander l’accès');
  const other = h('button', { class: 'btn btn-ghost', onclick: () => { signOut(); showSignIn(); } }, 'Utiliser un autre compte');
  gate('Accès refusé', null, note, h('div', { class: 'form-foot' }, ask, other));
}

async function loadSession() {
  gate('Connexion en cours');
  try {
    session = await api('session.get');
    render();
  } catch (err) {
    if (err.code === 'UNAUTHENTICATED' || err.code === 'NOT_ALLOWED') return;
    gate(err.code === 'NOT_CONFIGURED' ? 'Serveur à configurer' : 'Connexion impossible', err.message, retryButton());
  }
}

function logout() {
  session = null;
  signOut();
  showSignIn('Vous êtes déconnecté.');
}

function reportClientError(where, message) {
  if (!session || !currentToken()) return;
  api('logs.client', { where, message: String(message) }).catch(() => {});
}

async function start() {
  const { apiUrl, googleClientId } = window.ORBIA_CONFIG || {};
  if (!apiUrl || !googleClientId) {
    gate('Installation à terminer', 'L’adresse du serveur ou l’identifiant Google manque dans la configuration du site.');
    return;
  }
  try {
    gis = await initAuth(loadSession);
  } catch (err) {
    gate('Connexion Google indisponible', 'Le service de connexion n’a pas pu être chargé. Désactivez un éventuel bloqueur, puis réessayez.', retryButton());
    return;
  }
  if (currentToken()) loadSession(); else showSignIn();
}

if (window.top !== window.self) {
  // GitHub Pages ne permet pas d'envoyer X-Frame-Options : on refuse l'affichage en cadre ici.
  root.replaceChildren();
} else {
  setTokenProvider(currentToken);
  setAccessLostHandler(handleAccessLost);
  window.addEventListener('hashchange', render);
  window.addEventListener('error', (e) => reportClientError('window.error', e.message));
  window.addEventListener('unhandledrejection', (e) => reportClientError('unhandledrejection', e.reason?.message || e.reason));
  start();
}
