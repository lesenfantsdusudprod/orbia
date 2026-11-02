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

const ready = () => { const b = createBackend(); const r = b.call(ADMIN, 'storage.init'); assert.equal(r.ok, true, JSON.stringify(r)); return b; };
const book = (b) => b.drive.books.get(b.store.ORBIA_SPREADSHEET_ID);

test('A2 : création de l\'arborescence et du classeur complet', () => {
  const b = ready();
  assert.equal(b.drive.folders.size, 17);
  assert.equal(Object.keys(book(b).tabs).length, 18);
  assert.ok(!('Feuille 1' in book(b).tabs));
  assert.deepEqual(book(b).tabs.Users[0], ['email', 'role', 'active', 'addedAt', 'addedBy']);
  const status = b.call(ADMIN, 'storage.status').data;
  assert.equal(status.ready, true); assert.equal(status.isPrivate, true); assert.equal(status.automaticBackups, true); assert.equal(status.monthlyRestoreTest, true);
});

test('A2 : relancer ne recrée rien et ne touche pas aux données', () => {
  const b = ready();
  book(b).tabs.BankTransactions.push(['tx1', '', '2026-01-01', '', 'Paiement', 1000, 'EUR', '', 'non rapproché', 'imp1']);
  const folders = b.drive.folders.size; const sheetId = b.store.ORBIA_SPREADSHEET_ID; const triggers = b.drive.triggers.length;
  assert.equal(b.call(ADMIN, 'storage.init').ok, true);
  assert.equal(b.drive.folders.size, folders);
  assert.equal(b.store.ORBIA_SPREADSHEET_ID, sheetId);
  assert.equal(b.drive.triggers.length, triggers);
  assert.equal(book(b).tabs.BankTransactions.length, 2);
});

test('A2 : reprise après une panne, sans doublon', () => {
  const b = createBackend();
  b.drive.failNext = 'createFolder:Exports_FEC';
  assert.equal(code(b.call(ADMIN, 'storage.init')), 'INTERNAL');
  assert.equal(b.call(ADMIN, 'storage.status').data.ready, false);
  assert.equal(b.call(ADMIN, 'storage.status').data.partial, true);
  b.drive.failNext = 'insertSheet:Trips';
  assert.equal(code(b.call(ADMIN, 'storage.init')), 'INTERNAL');
  assert.equal(b.call(ADMIN, 'storage.init').ok, true);
  assert.equal(b.drive.folders.size, 17);
  assert.equal(b.drive.books.size, 1);
  assert.equal(Object.keys(book(b).tabs).length, 18);
});

test('A2 : un onglet modifié à la main est signalé, jamais écrasé', () => {
  const b = ready();
  book(b).tabs.Projects[0][1] = 'nom modifié';
  const r = b.call(ADMIN, 'storage.init');
  assert.equal(code(r), 'SCHEMA_CONFLICT');
  assert.equal(book(b).tabs.Projects[0][1], 'nom modifié');
});

test('A2 : une colonne ajoutée au schéma complète l\'onglet sans perte', () => {
  const b = ready();
  book(b).tabs.Projects[0].pop();
  book(b).tabs.Projects.push(['p1', 'Spectacle']);
  assert.equal(b.call(ADMIN, 'storage.init').ok, true);
  assert.equal(book(b).tabs.Projects[0].at(-1), 'active');
  assert.deepEqual(book(b).tabs.Projects[1], ['p1', 'Spectacle']);
});

test('A2 : stockage réservé à l\'administrateur', () => {
  const b = ready();
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: true });
  for (const action of ['storage.status', 'storage.init', 'storage.backup', 'storage.restoreTest', 'storage.restore']) {
    assert.equal(code(b.call('collab@example.test', action, { confirm: 'RESTAURER' })), 'FORBIDDEN', action);
    assert.equal(code(b.post({ action })), 'UNAUTHENTICATED', action);
  }
});

test('A2 : les identifiants Drive restent côté serveur', () => {
  const b = ready();
  assert.ok(!JSON.stringify(b.call(ADMIN, 'session.get')).includes(b.store.ORBIA_SPREADSHEET_ID));
});

test('A2 : un dossier devenu public est signalé', () => {
  const b = ready();
  b.drive.folders.get(b.store.ORBIA_ROOT_FOLDER_ID).access = 'ANYONE';
  assert.equal(b.call(ADMIN, 'storage.status').data.isPrivate, false);
});

test('A2 : copie lisible des utilisateurs et réglages, audit durable', () => {
  const b = ready();
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'lecture', active: true });
  b.call(ADMIN, 'company.update', company);
  assert.equal(book(b).tabs.Users.length, 3);
  assert.ok(book(b).tabs.Settings.some((r) => r[0] === 'legalName' && r[1] === 'Société Test'));
  assert.ok(book(b).tabs.Settings.some((r) => r[0] === 'schemaVersion' && r[1] === 1));
  assert.ok(book(b).tabs.AuditLog.some((r) => r.includes('COMPANY_UPDATED')));
});

test('A2 : la copie des utilisateurs reste alignée sur les colonnes', () => {
  const b = ready();
  b.call(ADMIN, 'users.save', { email: 'a@example.test', role: 'lecture', active: true });
  assert.equal(book(b).tabs.Users.length, 3);
  assert.deepEqual(book(b).tabs.Users[2].slice(0, 3), ['a@example.test', 'lecture', true]);
});

test('A2 : sauvegarde, test puis restauration sans rien détruire', () => {
  const b = ready();
  b.call(ADMIN, 'company.update', company);
  assert.equal(code(b.call(ADMIN, 'storage.restoreTest')), 'VALIDATION');
  const saved = b.call(ADMIN, 'storage.backup').data;
  assert.equal(saved.backups.length, 1);
  const exportFile = [...b.drive.files.values()].find((f) => f.name.endsWith('.json'));
  assert.equal(JSON.parse(exportFile.content).company.legalName, 'Société Test');
  assert.equal(b.call(ADMIN, 'storage.restoreTest').data.restoreTest.ok, true);

  const before = b.store.ORBIA_SPREADSHEET_ID;
  book(b).tabs.BankTransactions.push(['erreur']);
  const backupId = saved.backups[0].id;
  assert.equal(code(b.call(ADMIN, 'storage.restore', { backupId })), 'VALIDATION');
  assert.equal(b.call(ADMIN, 'storage.restore', { backupId, confirm: 'RESTAURER' }).ok, true);
  assert.notEqual(b.store.ORBIA_SPREADSHEET_ID, before);
  assert.equal(book(b).tabs.BankTransactions.length, 1);
  assert.equal(b.drive.books.get(before).tabs.BankTransactions.length, 2);
});

test('A2 : on ne restaure pas un fichier quelconque ni une sauvegarde abîmée', () => {
  const b = ready();
  const backupId = b.call(ADMIN, 'storage.backup').data.backups[0].id;
  assert.equal(code(b.call(ADMIN, 'storage.restore', { backupId: b.store.ORBIA_SPREADSHEET_ID, confirm: 'RESTAURER' })), 'VALIDATION');
  const current = b.store.ORBIA_SPREADSHEET_ID;
  delete b.drive.books.get(backupId).tabs.Trips;
  assert.equal(b.call(ADMIN, 'storage.restoreTest').data.restoreTest.ok, false);
  assert.equal(code(b.call(ADMIN, 'storage.restore', { backupId, confirm: 'RESTAURER' })), 'VALIDATION');
  assert.equal(b.store.ORBIA_SPREADSHEET_ID, current);
});

test('A2 : la sauvegarde planifiée trace aussi ses échecs', () => {
  const b = ready();
  b.sandbox.orbiaDailyBackup();
  assert.equal(b.call(ADMIN, 'storage.status').data.backups.length, 1);
  delete b.store.ORBIA_FOLDER_IDS;
  b.sandbox.orbiaDailyBackup();
  assert.ok(book(b).tabs.AuditLog.some((r) => r.includes('BACKUP_FAILED')));
});

test('A2 : le contrôle d\'installation essaie vraiment d\'écrire dans Drive et Sheets, puis nettoie', () => {
  const b = createBackend();
  b.sandbox.orbiaCheckSetup();
  const [folder] = b.drive.folders.values();
  assert.equal(folder.trashed, true);
  const [file] = b.drive.files.values();
  assert.equal(file.trashed, true);
});
