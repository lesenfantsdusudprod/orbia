import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBackend, claimsFor, CLIENT_ID, SERVER, nonceFor } from './harness.mjs';

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
  assert.equal(code(b.call(ADMIN, 'session.get')), 'UNAUTHENTICATED', 'identifiant par défaut, qui ne correspond pas au jeton de test');
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
  assert.ok(!/GOCSPX-/.test(bundle), 'aucun code secret Google');
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
  assert.ok(book(b).tabs.Settings.some((r) => r[0] === 'schemaVersion' && r[1] >= 1));
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

const CSV = 'Date;Libellé;Montant;Solde\n01/10/2026;SNCF;-98,00;1 000,00\n02/10/2026;Client;1 200,50;2 200,50\n';
const MAP = { date: 'Date', label: 'Libellé', amount: 'Montant', balance: 'Solde' };
const txs = (b) => book(b).tabs.BankTransactions.slice(1);
const imp = (b, content = CSV, mapping = MAP) => b.call(ADMIN, 'bank.import', { fileName: 'r.csv', content, mapping });

test('A3 : import, centimes entiers et formats français', () => {
  const b = ready();
  const r = imp(b);
  assert.equal(r.data.added, 2);
  assert.equal(txs(b)[0][5], -9800); assert.equal(txs(b)[1][5], 120050);
  assert.equal(txs(b)[0][2], '2026-10-01');
});

test('A3 : le même fichier importé deux fois ne crée aucun doublon', () => {
  const b = ready();
  imp(b);
  const r = imp(b);
  assert.equal(r.data.added, 0); assert.equal(r.data.alreadyImported, true);
  assert.equal(txs(b).length, 2);
});

test('A3 : deux paiements identiques réellement distincts sont conservés', () => {
  const b = ready();
  const csv = 'Date;Libellé;Montant\n05/10/2026;Café;-3,50\n05/10/2026;Café;-3,50\n';
  assert.equal(imp(b, csv, { date: 'Date', label: 'Libellé', amount: 'Montant' }).data.added, 2);
});

test('A3 : un export qui chevauche le précédent n\'ajoute que le nouveau', () => {
  const b = ready();
  imp(b);
  const r = imp(b, CSV + '03/10/2026;Loyer;-500,00;1 700,50\n');
  assert.equal(r.data.added, 1); assert.equal(r.data.skipped, 2);
});

test('A3 : l\'identifiant bancaire prime sur l\'empreinte', () => {
  const b = ready();
  const map = { date: 'd', label: 'l', amount: 'm', sourceId: 'id' };
  assert.equal(imp(b, 'id;d;l;m\nA;01/10/2026;X;-1,00\nB;01/10/2026;X;-1,00\n', map).data.added, 2);
  assert.equal(imp(b, 'id;d;l;m\nB;01/10/2026;X modifié;-1,00\n', map).data.added, 0);
});

test('A3 : un CSV invalide laisse tout intact et produit un rapport', () => {
  const b = ready();
  imp(b);
  const r = imp(b, 'Date;Libellé;Montant;Solde\n03/10/2026;A;-1,00;\n99/99/2026;B;-2,00;\n04/10/2026;C;abc;\n');
  assert.equal(code(r), 'VALIDATION');
  assert.ok(r.error.message.includes('2 ligne(s) en erreur'));
  assert.equal(txs(b).length, 2);
  assert.equal(book(b).tabs.BankImports.length, 3);
  const p = b.call(ADMIN, 'bank.preview', { content: 'Date;Libellé;Montant\n03/10/2026;A\n', mapping: { date: 'Date', label: 'Libellé', amount: 'Montant' } });
  assert.equal(p.data.report.errorCount, 1);
});

test('A3 : montants ambigus ou mal formés refusés', () => {
  const b = ready();
  for (const bad of ['1,234', '12,345', '1.2.3', '12a', '']) {
    const r = imp(b, `Date;Libellé;Montant\n01/10/2026;A;${bad}\n`, { date: 'Date', label: 'Libellé', amount: 'Montant' });
    assert.equal(code(r), 'VALIDATION', bad);
  }
  const map = { date: 'd', label: 'l', amount: 'm' };
  const ok = [['1 234,56', 123456], ['1.234,56', 123456], ['1,234.56', 123456], ['-12.5', -1250], ['+7', 700], ['−3,10', -310], ['0,01', 1], ['(4,00)', -400], ['1 000 000,10 €', 100000010]];
  ok.forEach(([text, cents], i) => {
    const r = imp(b, `d;l;m\n01/10/2026;U${i};"${text}"\n`, map);
    assert.equal(r.data.added, 1, text);
    assert.equal(txs(b).at(-1)[5], cents, text);
  });
});

test('A3 : colonnes débit et crédit séparées', () => {
  const b = ready();
  imp(b, 'd;l;deb;cre\n01/10/2026;A;50,00;\n02/10/2026;B;;20,00\n', { date: 'd', label: 'l', debit: 'deb', credit: 'cre' });
  assert.deepEqual(txs(b).map((t) => t[5]), [-5000, 2000]);
  assert.equal(code(imp(b, 'd;l;deb;cre\n03/10/2026;A;5,00;5,00\n', { date: 'd', label: 'l', debit: 'deb', credit: 'cre' })), 'VALIDATION');
});

test('A3 : séparateurs, guillemets, BOM, fins de ligne Windows', () => {
  const b = ready();
  const r = imp(b, '﻿d,l,m\r\n2026-10-01T08:00:00Z,"Paiement, avec ""virgule""\nsur 2 lignes",-1.00\r\n', { date: 'd', label: 'l', amount: 'm' });
  assert.equal(r.data.added, 1);
  assert.ok(txs(b)[0][4].includes('Paiement, avec "virgule"'));
  assert.equal(txs(b)[0][2], '2026-10-01');
});

test('A3 : une formule dans un libellé reste du texte, une date reste une date texte', () => {
  const b = ready();
  imp(b, 'd;l;m\n01/10/2026;=IMPORTXML("http://evil.test");-1,00\n', { date: 'd', label: 'l', amount: 'm' });
  assert.equal(txs(b)[0][4], '=IMPORTXML("http://evil.test")');
  assert.equal(typeof txs(b)[0][2], 'string');
});

test('A3 : aucun format n\'est imposé, les colonnes doivent être confirmées', () => {
  const b = ready();
  const p = b.call(ADMIN, 'bank.preview', { content: CSV }).data;
  assert.deepEqual(p.headers, ['Date', 'Libellé', 'Montant', 'Solde']);
  assert.equal(p.suggested.amount, 'Montant');
  assert.equal(txs(b).length, 0);
  assert.equal(code(imp(b, CSV, { date: 'Date', label: 'Inconnue', amount: 'Montant' })), 'VALIDATION');
  assert.equal(code(imp(b, CSV, { date: 'Date', amount: 'Montant' })), 'VALIDATION');
  for (const bad of ['', 'pas de colonnes', 'a;b\n']) assert.equal(code(imp(b, bad)), 'VALIDATION');
});

test('A3 : droits et absence d\'espace', () => {
  const b = ready();
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: true });
  imp(b);
  assert.equal(b.call('collab@example.test', 'bank.summary').ok, true);
  assert.equal(b.call('collab@example.test', 'bank.list').data.total, 2);
  for (const a of ['bank.import', 'bank.preview', 'bank.scanFolder']) assert.equal(code(b.call('collab@example.test', a, { content: CSV })), 'FORBIDDEN');
  const c = createBackend();
  assert.equal(c.call(ADMIN, 'bank.summary').data.ready, false);
  assert.equal(code(c.call(ADMIN, 'bank.import', { content: CSV, mapping: MAP })), 'STORAGE_MISSING');
});

test('A3 : reprise après une coupure en cours d\'import', () => {
  const b = ready();
  imp(b);
  const rows = book(b).tabs.BankImports;
  rows.pop();
  book(b).tabs.BankTransactions.pop();
  const r = imp(b);
  assert.equal(r.data.added, 1);
  assert.equal(txs(b).length, 2);
});

test('A3 : solde du dernier relevé, entrées et sorties du mois, mois manquants', () => {
  const b = ready();
  const month = new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-');
  imp(b, `d;l;m;s\n05/${m}/${y};A;-10,00;900,00\n06/${m}/${y};B;30,00;930,00\n01/02/2025;C;-1,00;5,00\n15/05/2025;D;-1,00;4,00\n`, { date: 'd', label: 'l', amount: 'm', balance: 's' });
  const s = b.call(ADMIN, 'bank.summary').data;
  assert.equal(s.balanceCents, 93000); assert.equal(s.monthInCents, 3000); assert.equal(s.monthOutCents, 1000);
  assert.equal(s.unmatched, 4); assert.ok(s.missingMonths.includes('2025-03')); assert.ok(s.missingMonths.includes('2025-04'));
  assert.ok(s.lastImportAt);
});

test('A3 : dossier Drive, seulement avec des colonnes déjà confirmées', () => {
  const b = ready();
  const ids = JSON.parse(b.store.ORBIA_FOLDER_IDS);
  const inbox = b.drive.folders.get(ids['01_Banque_Qonto/Imports_CSV']);
  const archive = ids['01_Banque_Qonto/Archives_imports'];
  const file = inbox.createFile('octobre.csv', CSV, 'text/csv');
  let r = b.call(ADMIN, 'bank.scanFolder').data;
  assert.equal(r.imported, 0); assert.deepEqual(r.waiting, ['octobre.csv']);
  assert.equal(txs(b).length, 0);
  imp(b, 'Date;Libellé;Montant;Solde\n09/09/2026;Avant;-1,00;1,00\n');
  r = b.call(ADMIN, 'bank.scanFolder').data;
  assert.equal(r.imported, 1); assert.equal(file.parent, archive); assert.equal(txs(b).length, 3);
  const twice = b.call(ADMIN, 'bank.scanFolder').data;
  assert.equal(twice.imported, 0); assert.equal(txs(b).length, 3);
});

test('A3 : un classeur A2 reçoit la nouvelle colonne sans perte', () => {
  const b = ready();
  const t = book(b).tabs.BankTransactions;
  t[0].pop();
  assert.equal(imp(b).data.added, 2);
  assert.equal(book(b).tabs.BankTransactions[0].at(-1), 'balanceCents');
});

test('A3 : une sauvegarde du schéma précédent reste restaurable', () => {
  const b = ready();
  const id = b.call(ADMIN, 'storage.backup').data.backups[0].id;
  b.drive.books.get(id).tabs.BankTransactions[0].pop();
  assert.equal(b.call(ADMIN, 'storage.restoreTest').data.restoreTest.ok, true);
});

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]).toString('base64');
const PDF = Buffer.from('%PDF-1.4 fictif').toString('base64');
const up = (b, base64 = PNG, mimeType = 'image/png', who = ADMIN) => b.call(who, 'documents.upload', { fileName: 'f.png', mimeType, base64 });
const fields = { type: 'facture_recue', supplier: 'Atelier', date: '2026-10-14', invoiceNumber: 'F1', net: '100,00', vat: '20,00', gross: '120,00' };

test('A4 : l\'original est gardé dans Drive, privé, et le lien Drive ne sort pas', () => {
  const b = ready();
  const r = up(b);
  assert.equal(r.data.duplicate, false);
  assert.ok(!JSON.stringify(r).includes('driveFileId'));
  const f = b.call(ADMIN, 'documents.file', { id: r.data.document.id }).data;
  assert.equal(f.base64, PNG);
  assert.equal(book(b).tabs.Documents[1][10], 'desactive');
});

test('A4 : même fichier deux fois, un seul document', () => {
  const b = ready();
  up(b);
  assert.equal(up(b).data.duplicate, true);
  assert.equal(book(b).tabs.Documents.length, 2);
});

test('A4 : type et contenu contrôlés', () => {
  const b = ready();
  assert.equal(code(up(b, PNG, 'text/html')), 'VALIDATION');
  assert.equal(code(up(b, PDF, 'image/png')), 'VALIDATION');
  assert.equal(code(up(b, '', 'image/png')), 'VALIDATION');
  assert.equal(up(b, PDF, 'application/pdf').ok, true);
});

test('A4 : 120 € TTC avec 20 % donne 100 € HT et 20 € de TVA, sinon refus', () => {
  const b = ready();
  const id = up(b).data.document.id;
  b.call(ADMIN, 'documents.update', { id, ...fields, gross: '121,00' });
  assert.ok(code(b.call(ADMIN, 'documents.validate', { id })) === 'VALIDATION');
  b.call(ADMIN, 'documents.update', { id, ...fields });
  assert.equal(b.call(ADMIN, 'documents.validate', { id }).ok, true);
  assert.equal(b.call(ADMIN, 'documents.list', { id }).data.document.grossCents, 12000);
});

test('A4 : doublon fournisseur, numéro et montant bloque la validation', () => {
  const b = ready();
  const a = up(b).data.document.id;
  const c = up(b, PDF, 'application/pdf').data.document.id;
  b.call(ADMIN, 'documents.update', { id: a, ...fields });
  b.call(ADMIN, 'documents.update', { id: c, ...fields, supplier: 'ATELIER', invoiceNumber: 'f1' });
  assert.ok(b.call(ADMIN, 'documents.validate', { id: c }).error.message.includes('Doublon'));
});

test('A4 : validé, le document est verrouillé, et chaque changement est tracé', () => {
  const b = ready();
  const id = up(b).data.document.id;
  b.call(ADMIN, 'documents.update', { id, ...fields });
  b.call(ADMIN, 'documents.validate', { id });
  assert.equal(code(b.call(ADMIN, 'documents.update', { id, ...fields, gross: '1,00' })), 'VALIDATION');
  assert.equal(code(b.call(ADMIN, 'documents.reopen', { id })), 'VALIDATION');
  assert.equal(b.call(ADMIN, 'documents.reopen', { id, reason: 'Erreur de montant' }).ok, true);
  const log = book(b).tabs.AuditLog.map((r) => r.join(' ')).join('\n');
  assert.ok(log.includes('grossCents')); assert.ok(log.includes('Erreur de montant'));
});

test('A4 : droits par rôle', () => {
  const b = ready();
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: true });
  b.call(ADMIN, 'users.save', { email: 'lecteur@example.test', role: 'lecture', active: true });
  const id = up(b, PNG, 'image/png', 'collab@example.test').data.document.id;
  b.call('collab@example.test', 'documents.update', { id, ...fields });
  assert.equal(code(b.call('collab@example.test', 'documents.validate', { id })), 'FORBIDDEN');
  assert.equal(code(up(b, PDF, 'application/pdf', 'lecteur@example.test')), 'FORBIDDEN');
  assert.equal(b.call('lecteur@example.test', 'documents.list').data.items.length, 1);
});

test('A4 : un texte hostile dans un document reste du texte', () => {
  const b = ready();
  const id = up(b).data.document.id;
  b.call(ADMIN, 'documents.update', { id, ...fields, supplier: '=IMPORTXML("x")' });
  assert.equal(book(b).tabs.Documents[1][4], '=IMPORTXML("x")');
  assert.equal(code(b.call(ADMIN, 'documents.update', { id, ...fields, gross: 'abc' })), 'VALIDATION');
});

const aiOk = JSON.stringify({ type: 'facture_recue', supplier: 'Atelier', date: '2026-10-14', invoiceNumber: 'F1', net: '100,00', vat: '20,00', gross: '120,00', uncertain: ['net', 'inconnu'] });

test('A4 : l\'IA propose, rien n\'est enregistré ni validé sans relecture', () => {
  const b = ready();
  const id = up(b).data.document.id;
  assert.equal(code(b.call(ADMIN, 'documents.extract', { id })), 'AI_KEY');
  b.store.ORBIA_ANTHROPIC_API_KEY = 'cle-secrete-test';
  b.state.aiText = 'Voici : ' + aiOk;
  const r = b.call(ADMIN, 'documents.extract', { id });
  assert.equal(r.data.suggestion.gross, '120,00');
  assert.deepEqual(r.data.suggestion.uncertain, ['net']);
  const d = b.call(ADMIN, 'documents.list', { id }).data.document;
  assert.equal(d.supplier, ''); assert.equal(d.validationStatus, 'a_verifier');
  assert.ok(!JSON.stringify(r).includes('cle-secrete-test'));
  assert.ok(book(b).tabs.AuditLog.some((row) => row.includes('DOCUMENT_SENT_TO_AI')));
});

test('A4 : réponse IA filtrée, valeurs farfelues écartées, panne sans fuite', () => {
  const b = ready();
  const id = up(b).data.document.id;
  b.store.ORBIA_ANTHROPIC_API_KEY = 'cle-secrete-test';
  b.state.aiText = JSON.stringify({ type: 'virus', date: '14 octobre', gross: 'beaucoup', supplier: 42 });
  const g = b.call(ADMIN, 'documents.extract', { id }).data.suggestion;
  assert.deepEqual([g.type, g.date, g.gross, g.supplier], ['', '', '', '']);
  b.state.aiText = 'je ne sais pas';
  assert.equal(code(b.call(ADMIN, 'documents.extract', { id })), 'AI_UNREADABLE');
  for (const [status, expected] of [[401, 'AI_KEY'], [529, 'AI_BUSY'], [400, 'AI_REFUSED']]) {
    b.state.aiStatus = status;
    const r = b.call(ADMIN, 'documents.extract', { id });
    assert.equal(code(r), expected);
    assert.ok(!JSON.stringify(r).includes('cle-secrete-test'));
  }
});

test('A4 : la lecture IA est interdite en lecture seule et sur un document inconnu', () => {
  const b = ready();
  b.store.ORBIA_ANTHROPIC_API_KEY = 'x';
  b.call(ADMIN, 'users.save', { email: 'lecteur@example.test', role: 'lecture', active: true });
  const id = up(b).data.document.id;
  assert.equal(code(b.call('lecteur@example.test', 'documents.extract', { id })), 'FORBIDDEN');
  assert.equal(code(b.call(ADMIN, 'documents.extract', { id: 'nimporte' })), 'VALIDATION');
  assert.equal(b.state.aiCalls ?? 0, 0);
});

test('A4 : aucune clé dans le code livré', () => {
  const bundle = readFileSync(new URL('../dist/Orbia_backend.gs', import.meta.url), 'utf8');
  assert.ok(!/sk-ant-/.test(bundle));
});

test('Demandes d\'accès : un inconnu demande, rien n\'est accordé avant acceptation', () => {
  const b = createBackend();
  b.call(ADMIN, 'session.get');
  assert.equal(b.call('nouveau@example.test', 'access.request').data.status, 'pending');
  assert.equal(b.call('nouveau@example.test', 'access.request').data.status, 'pending');
  assert.equal(code(b.call('nouveau@example.test', 'session.get')), 'NOT_ALLOWED');
  assert.equal(code(b.call('nouveau@example.test', 'users.requests')), 'NOT_ALLOWED');
  assert.equal(code(b.post({ action: 'access.request' })), 'UNAUTHENTICATED');
  assert.equal(b.call(ADMIN, 'users.requests').data.requests.length, 1);
  assert.equal(b.call(ADMIN, 'users.approve', { email: 'nouveau@example.test', role: 'lecture' }).ok, true);
  assert.equal(b.call('nouveau@example.test', 'session.get').data.user.role, 'lecture');
  assert.equal(b.call(ADMIN, 'users.requests').data.requests.length, 0);
  assert.equal(b.call('nouveau@example.test', 'access.request').data.status, 'authorized');
});

test('Demandes d\'accès : refus, compte désactivé, plafond, droits', () => {
  const b = createBackend();
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: true });
  b.call('x@example.test', 'access.request');
  assert.equal(code(b.call('collab@example.test', 'users.approve', { email: 'x@example.test', role: 'admin' })), 'FORBIDDEN');
  assert.equal(b.call(ADMIN, 'users.reject', { email: 'x@example.test' }).ok, true);
  assert.equal(code(b.call(ADMIN, 'users.approve', { email: 'x@example.test', role: 'admin' })), 'VALIDATION');
  b.call(ADMIN, 'users.save', { email: 'collab@example.test', role: 'collaborateur', active: false });
  assert.equal(b.call('collab@example.test', 'access.request').data.status, 'disabled');
  for (let i = 0; i < 50; i++) b.call(`p${i}@example.test`, 'access.request');
  assert.equal(code(b.call('trop@example.test', 'access.request')), 'REQUESTS_FULL');
});

test('Sociétés : un jeton destiné à un autre serveur Orbia est refusé', () => {
  const b = createBackend();
  const other = 'https://script.google.com/macros/s/AUTRE/exec';
  assert.equal(code(b.post({ idToken: b.issue(claimsFor(ADMIN, { nonce: nonceFor(other) })), action: 'session.get' })), 'UNAUTHENTICATED');
  assert.equal(code(b.post({ idToken: b.issue(claimsFor(ADMIN, { nonce: undefined })), action: 'session.get' })), 'UNAUTHENTICATED');
  assert.equal(b.call(ADMIN, 'session.get').ok, true);
});

test('Sociétés : sans adresse enregistrée, celle du déploiement sert, /u/N/ compris', () => {
  const b = createBackend({ props: { ORBIA_PUBLIC_URL: '' } });
  assert.equal(code(b.call(ADMIN, 'session.get')), 'NOT_CONFIGURED');
  b.state.serviceUrl = 'https://script.google.com/macros/u/3/s/AKfycbTESTserverIdentifier0123/exec';
  assert.equal(b.call(ADMIN, 'session.get').ok, true);
});

test('Copie du serveur : sans réglage, le propriétaire devient administrateur', () => {
  const b = createBackend({ props: { ORBIA_BOOTSTRAP_ADMIN: '' } });
  b.state.owner = 'Proprio@Example.test';
  assert.equal(b.call('proprio@example.test', 'session.get').data.user.role, 'admin');
  assert.equal(code(b.call('autre@example.test', 'session.get')), 'NOT_ALLOWED');
});
