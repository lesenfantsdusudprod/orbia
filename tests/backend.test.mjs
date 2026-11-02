import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBackend, claimsFor, CLIENT_ID } from './harness.mjs';

const ADMIN = 'admin@example.test';
const company = { legalName: 'Société Test', legalForm: 'SAS', siren: '123456789', siret: '12345678900011', fiscalYearStart: '2026-01-01', fiscalYearEnd: '2026-12-31', currency: 'EUR', vatRegime: 'a_confirmer', vatPeriodicity: 'a_confirmer', projectsEnabled: true };
const code = (r) => r.error?.code;

function withUsers() {
  const b = createBackend();
  assert.equal(b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: true }).ok, true);
  assert.equal(b.call(ADMIN, 'users.save', { email: 'lecteur@example.test', role: 'lecture', active: true }).ok, true);
  return b;
}

test('sans jeton : aucune action, connue ou non, ne répond', () => {
  const b = createBackend();
  for (const action of ['session.get', 'users.list', 'logs.list', 'inconnue']) assert.equal(code(b.post({ action })), 'UNAUTHENTICATED');
});

test('jetons refusés : invalide, mauvaise audience, émetteur, expiré, e-mail non vérifié', () => {
  const b = createBackend();
  assert.equal(code(b.post({ idToken: 'x'.repeat(50), action: 'session.get' })), 'UNAUTHENTICATED');
  const past = String(Math.floor(Date.now() / 1000) - 120);
  for (const extra of [{ aud: 'autre-appli' }, { iss: 'https://evil.test' }, { exp: past }, { email_verified: 'false' }, { sub: '' }]) {
    assert.equal(code(b.post({ idToken: b.issue(claimsFor(ADMIN, extra)), action: 'session.get' })), 'UNAUTHENTICATED', JSON.stringify(extra));
  }
});

test('jeton en cache : une fois expiré, il est refusé sans rappeler Google', () => {
  const b = createBackend();
  const t = b.issue(claimsFor(ADMIN, { exp: String(Math.floor(Date.now() / 1000) + 40) }));
  assert.equal(b.post({ idToken: t, action: 'session.get' }).ok, true);
  b.sandbox.__skewMs = 120000;
  assert.equal(code(b.post({ idToken: t, action: 'session.get' })), 'UNAUTHENTICATED');
  assert.equal(b.state.tokenCalls, 1);
});

test('le cache évite un second appel à Google pour le même jeton', () => {
  const b = createBackend();
  const t = b.issue(claimsFor(ADMIN));
  b.post({ idToken: t, action: 'session.get' });
  b.post({ idToken: t, action: 'session.get' });
  assert.equal(b.state.tokenCalls, 1);
});

test('Google indisponible : refus, jamais d\'accès par défaut', () => {
  const b = createBackend();
  b.state.tokeninfoStatus = 503;
  assert.equal(code(b.post({ idToken: b.issue(claimsFor(ADMIN)), action: 'session.get' })), 'AUTH_UNAVAILABLE');
});

test('configuration absente : le serveur refuse', () => {
  const b = createBackend({ props: { ORBIA_GOOGLE_CLIENT_ID: '' } });
  assert.equal(code(b.call(ADMIN, 'session.get')), 'NOT_CONFIGURED');
  const c = createBackend({ props: { ORBIA_BOOTSTRAP_ADMIN: '' } });
  assert.equal(code(c.call(ADMIN, 'session.get')), 'NOT_CONFIGURED');
});

test('le premier administrateur est créé une seule fois', () => {
  const b = createBackend();
  const r = b.call(ADMIN.toUpperCase(), 'session.get');
  assert.equal(r.data.user.role, 'admin');
  b.store.ORBIA_BOOTSTRAP_ADMIN = 'pirate@example.test';
  assert.equal(code(b.call('pirate@example.test', 'session.get')), 'NOT_ALLOWED');
});

test('compte hors liste : refus, et journalisé une seule fois par heure', () => {
  const b = createBackend();
  for (let i = 0; i < 5; i++) assert.equal(code(b.call('inconnu@example.test', 'session.get')), 'NOT_ALLOWED');
  const entries = b.call(ADMIN, 'logs.list').data.entries.filter((e) => e.code === 'NOT_ALLOWED');
  assert.equal(entries.length, 1);
});

test('compte hors liste : même réponse sur une action admin ou inexistante', () => {
  const b = createBackend();
  assert.equal(code(b.call('inconnu@example.test', 'users.list')), 'NOT_ALLOWED');
  assert.equal(code(b.call('inconnu@example.test', 'nimporte')), 'NOT_ALLOWED');
});

test('droits par rôle, vérifiés côté serveur', () => {
  const b = withUsers();
  for (const email of ['collab@example.test', 'lecteur@example.test']) {
    assert.equal(b.call(email, 'session.get').ok, true);
    for (const [action, payload] of [['users.list'], ['users.save', { email: 'x@example.test', role: 'admin', active: true }], ['logs.list'], ['company.update', company]]) {
      assert.equal(code(b.call(email, action, payload)), 'FORBIDDEN', `${email} ${action}`);
    }
  }
  assert.equal(b.call(ADMIN, 'users.list').data.users.length, 3);
});

test('une désactivation prend effet au prochain appel, même avec le même jeton', () => {
  const b = withUsers();
  const t = b.issue(claimsFor('collab@example.test'));
  assert.equal(b.post({ idToken: t, action: 'session.get' }).ok, true);
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: false });
  assert.equal(code(b.post({ idToken: t, action: 'session.get' })), 'NOT_ALLOWED');
});

test('actions inconnues et noms piégés refusés', () => {
  const b = createBackend();
  for (const action of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 42, null]) {
    assert.equal(code(b.call(ADMIN, action)), 'BAD_REQUEST', String(action));
  }
});

test('corps invalides ou trop gros refusés sans trace technique', () => {
  const b = createBackend();
  for (const body of ['pas du json', '[]', 'null', 'x'.repeat(100001)]) assert.equal(code(b.post(body)), 'BAD_REQUEST');
  assert.equal(JSON.parse(b.sandbox.doPost({}).text).error.code, 'BAD_REQUEST');
});

test('doGet ne révèle aucune donnée', () => {
  const b = createBackend();
  assert.deepEqual(JSON.parse(b.sandbox.doGet().text), { ok: true, service: 'orbia' });
});

test('on ne peut pas se retirer ses droits ni laisser Orbia sans administrateur', () => {
  const b = withUsers();
  assert.equal(code(b.call(ADMIN, 'users.save', { email: ADMIN, role: 'admin', active: false })), 'VALIDATION');
  assert.equal(code(b.call(ADMIN, 'users.save', { email: ADMIN, role: 'lecture', active: true })), 'VALIDATION');
  assert.equal(b.call(ADMIN, 'session.get').data.user.role, 'admin');
});

test('validation des utilisateurs', () => {
  const b = createBackend();
  for (const bad of [{ email: 'pas-un-mail', role: 'admin', active: true }, { email: 'a@b.fr', role: 'superadmin', active: true }, { email: 'a@b.fr', role: '__proto__', active: true }, { email: 'a@b.fr', role: 'admin', active: 'oui' }]) {
    assert.equal(code(b.call(ADMIN, 'users.save', bad)), 'VALIDATION', JSON.stringify(bad));
  }
});

test('configuration société : aucune valeur inventée par défaut', () => {
  const c = createBackend().call(ADMIN, 'session.get').data.company;
  assert.equal(c.legalName, ''); assert.equal(c.siren, ''); assert.equal(c.vatPeriodicity, 'a_confirmer');
});

test('configuration société : enregistrement et validation', () => {
  const b = createBackend();
  assert.equal(b.call(ADMIN, 'company.update', company).ok, true);
  assert.equal(b.call(ADMIN, 'session.get').data.company.legalName, 'Société Test');
  const bads = [{ siren: '123' }, { siret: '999' }, { siret: '99999999900011' }, { fiscalYearStart: '2026-02-30' }, { fiscalYearEnd: '2025-01-01' }, { vatRegime: 'x' }, { currency: 'USD' }, { projectsEnabled: 'oui' }, { legalName: 'x'.repeat(161) }, { legalName: 12 }];
  for (const bad of bads) assert.equal(code(b.call(ADMIN, 'company.update', { ...company, ...bad })), 'VALIDATION', JSON.stringify(bad));
  assert.equal(b.call(ADMIN, 'session.get').data.company.legalName, 'Société Test');
});

test('champs supplémentaires ignorés', () => {
  const b = createBackend();
  const r = b.call(ADMIN, 'company.update', { ...company, isAdmin: true });
  assert.equal('isAdmin' in r.data.company, false);
});

test('écriture refusée si le verrou n\'est pas obtenu', () => {
  const b = createBackend();
  b.call(ADMIN, 'session.get');
  b.state.lockFree = false;
  assert.equal(code(b.call(ADMIN, 'company.update', company)), 'BUSY');
  b.state.lockFree = true;
  assert.equal(b.call(ADMIN, 'session.get').data.company.legalName, '');
});

test('erreur interne : réponse générique, détail au journal seulement', () => {
  const b = createBackend();
  b.call(ADMIN, 'session.get');
  b.store.ORBIA_USERS = '{cassé';
  const r = b.call(ADMIN, 'session.get');
  assert.equal(code(r), 'INTERNAL');
  assert.equal(r.error.message, 'Une erreur est survenue. Réessayez.');
  assert.ok(r.error.correlationId);
  assert.ok(b.state.logs.some((l) => l.includes('"INTERNAL"') && l.includes(r.error.correlationId)));
});

test('journal : jetons masqués, texte tronqué, journal circulaire', () => {
  const b = createBackend();
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  b.call(ADMIN, 'logs.client', { where: 'test', message: 'échec ' + jwt + ' ' + 'x'.repeat(900) });
  const [entry] = b.call(ADMIN, 'logs.list').data.entries;
  assert.ok(!entry.message.includes('eyJ')); assert.ok(entry.message.includes('[jeton masqué]'));
  assert.ok(entry.message.length <= 500);
  assert.equal(entry.source, 'client');
  for (let i = 0; i < 120; i++) b.call(ADMIN, 'logs.client', { where: 'test', message: 'n' + i });
  const entries = b.call(ADMIN, 'logs.list').data.entries;
  assert.equal(entries.length, 100);
  assert.equal(entries[0].message, 'n119');
});

test('les actions sensibles sont tracées', () => {
  const b = withUsers();
  b.call(ADMIN, 'company.update', company);
  const entries = b.call(ADMIN, 'logs.list').data.entries.filter((e) => e.level === 'audit');
  assert.deepEqual(entries.map((e) => e.code), ['COMPANY_UPDATED', 'USER_SAVED', 'USER_SAVED']);
});

test('aucun secret ni donnée réelle dans le code livré au dépôt', () => {
  const bundle = readFileSync(new URL('../dist/Orbia_backend.gs', import.meta.url), 'utf8');
  assert.ok(!/gmail\.com|lesenfantsdusud|Enfants du Sud/i.test(bundle));
  assert.ok(!bundle.includes(CLIENT_ID));
});
