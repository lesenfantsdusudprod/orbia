// Parcours réels dans Chromium : interface réelle + backend réel (simulateur Apps Script).
// Seuls Google Identity et l'URL de l'API sont interceptés.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createBackend, claimsFor } from '../harness.mjs';

const require = createRequire('/opt/npm-tools/');
const { chromium } = require('playwright');
const API = 'https://script.google.com/macros/s/TEST/exec';
const root = fileURLToPath(new URL('../../frontend/', import.meta.url));
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
await mkdir(shots, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html');
  try { res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }).end(await readFile(join(root, path))); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const origin = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();

const GSI = `window.google={accounts:{id:{initialize(o){window.__cb=o.callback},renderButton(el){const b=document.createElement('button');b.textContent='Continuer avec Google';b.id='fake-google';b.onclick=()=>window.__login();el.append(b)},prompt(){},disableAutoSelect(){}}}};`;
const jwtFor = (exp, email) => 'h.' + Buffer.from(JSON.stringify({ exp, email })).toString('base64url') + '.s';

async function session(backend, email, viewport) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  const claims = claimsFor(email);
  const jwt = jwtFor(Number(claims.exp), email);
  backend.tokens.set(jwt, claims);
  await page.route('**/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: GSI }));
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.ORBIA_CONFIG=${JSON.stringify({ apiUrl: API, googleClientId: 'x' })};` }));
  await page.addInitScript((t) => { window.__login = () => window.__cb({ credential: t }); }, jwt);
  await page.route(API, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: backend.sandbox.doPost({ postData: { contents: r.request().postData() } }).text }));
  await page.goto(origin);
  await page.click('#fake-google');
  return { page, problems, context };
}
const noOverflow = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `${label}: débordement horizontal de ${over}px`);
};

const PHONE = { width: 375, height: 760 };
const DESK = { width: 1280, height: 800 };
const backend = createBackend();

// Administrateur sur téléphone : accueil vide, sans chiffre inventé
{
  const { page, problems, context } = await session(backend, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  assert.ok(await page.getByText('Aucun relevé importé').first().isVisible());
  assert.ok(!/\d\s?€/.test(await page.locator('main').innerText()), 'aucun montant inventé');
  await noOverflow(page, 'accueil mobile');

  await page.getByRole('link', { name: 'Configurer la société' }).click();
  await page.getByLabel('Raison sociale').fill('Société Démo <img src=x onerror=alert(1)>');
  await page.getByLabel('SIREN').fill('123');
  await page.getByRole('button', { name: 'Enregistrer la société' }).click();
  await page.getByText('SIREN : 9 chiffres attendus.').waitFor();
  await page.screenshot({ path: shots + 'reglages-erreur-mobile.png', fullPage: true });
  await page.getByLabel('SIREN').fill('123456789');
  await page.getByRole('button', { name: 'Enregistrer la société' }).click();
  await page.getByText('Société enregistrée.').waitFor();
  await noOverflow(page, 'réglages mobile');

  await context.close();
  assert.deepEqual(problems, [], 'console admin mobile');
}

// Administrateur sur PC : utilisateurs, journal, XSS neutralisé
{
  const { page, problems, context } = await session(backend, 'admin@example.test', DESK);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.locator('.account-name', { hasText: 'Société Démo' }).waitFor();
  assert.equal(await page.locator('#app img').count(), 0, 'le HTML saisi reste du texte');
  await page.getByRole('link', { name: 'Réglages' }).first().click();
  await page.getByRole('link', { name: 'Utilisateurs' }).click();
  await page.getByLabel('E-mail').fill('collab@example.test');
  await page.getByRole('button', { name: 'Autoriser ce compte' }).click();
  await page.getByText('collab@example.test').waitFor();
  assert.equal(await page.locator('select[name=role]').inputValue(), 'collaborateur', 'le rôle par défaut reste Collaborateur');
  await page.screenshot({ path: shots + 'utilisateurs-pc.png', fullPage: true });
  await page.getByRole('link', { name: 'Journal' }).click();
  await page.getByText(/collab@example.test : rôle/).waitFor();
  await page.screenshot({ path: shots + 'journal-pc.png', fullPage: true });
  await context.close();
  assert.deepEqual(problems, [], 'console admin PC');
}

// Collaborateur : pas d'onglets admin, formulaire en lecture, URL directe sans effet
{
  const { page, problems, context } = await session(backend, 'collab@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.goto(origin + '#/reglages/utilisateurs');
  await page.getByRole('heading', { name: 'Page introuvable' }).waitFor();
  await page.goto(origin + '#/reglages');
  await page.getByLabel('Raison sociale').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Utilisateurs' }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Stockage' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Enregistrer la société' }).count(), 0);
  await page.goto(origin + '#/plus');
  await page.getByRole('link', { name: 'Comptabilité' }).waitFor();
  await noOverflow(page, 'plus mobile');
  await page.screenshot({ path: shots + 'plus-mobile.png' });
  await context.close();
  assert.deepEqual(problems, [], 'console collaborateur');
}

// Désactivé en cours de session : renvoyé dès l'action suivante
{
  backend.call('admin@example.test', 'users.save', { email: 'parti@example.test', role: 'admin', active: true });
  const s = await session(backend, 'parti@example.test', DESK);
  await s.page.getByRole('link', { name: 'Réglages' }).first().click();
  await s.page.getByRole('button', { name: 'Enregistrer la société' }).waitFor();
  backend.call('admin@example.test', 'users.save', { email: 'parti@example.test', role: 'admin', active: false });
  await s.page.getByRole('button', { name: 'Enregistrer la société' }).click();
  await s.page.getByRole('heading', { name: 'Accès refusé' }).waitFor();
  await s.context.close();
}

// Stockage : création, sauvegarde, test, restauration depuis l'interface
{
  const b = createBackend();
  const { page, problems, context } = await session(b, 'admin@example.test', DESK);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.goto(origin + '#/reglages/stockage');
  await page.getByRole('button', { name: 'Créer l’espace Orbia' }).click();
  await page.getByText('Espace Orbia créé.').waitFor();
  await page.getByRole('button', { name: 'Sauvegarder maintenant' }).click();
  await page.getByText('Sauvegarde créée.').waitFor();
  await page.getByRole('button', { name: 'Tester la dernière sauvegarde' }).click();
  await page.getByText('Test de restauration terminé.').waitFor();
  await page.screenshot({ path: shots + 'stockage-pc.png', fullPage: true });
  const restore = page.getByRole('button', { name: 'Restaurer cette sauvegarde' });
  assert.equal(await restore.isDisabled(), true, 'restauration verrouillée avant confirmation');
  await page.getByLabel('Je veux revenir à cette sauvegarde').check();
  await restore.click();
  await page.getByText('Sauvegarde restaurée.').waitFor();
  await context.close();
  assert.deepEqual(problems, [], 'console stockage');
}

// Connexion : un rechargement ne redemande rien, la déconnexion oublie le jeton
{
  const { page, problems, context } = await session(backend, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.locator('.account summary').click();
  await page.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await page.getByRole('heading', { name: 'Connexion' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('orbia.idToken')), null);
  await page.reload();
  await page.getByRole('heading', { name: 'Connexion' }).waitFor();
  await context.close();
  assert.deepEqual(problems, [], 'console connexion');
}

// Serveur en retard : l'accueil reste utilisable
{
  const b = createBackend();
  const { page, context } = await session(b, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.goto(origin + '#/plus');
  await page.getByRole('link', { name: 'Comptabilité' }).waitFor();
  await page.route(API, (r) => {
    const body = JSON.parse(r.request().postData());
    const answer = body.action === 'bank.summary' ? JSON.stringify({ ok: false, error: { code: 'BAD_REQUEST', message: 'La requête est invalide.', correlationId: 'x' } }) : b.sandbox.doPost({ postData: { contents: r.request().postData() } }).text;
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: answer });
  });
  await page.goto(origin + '#/');
  await page.getByText('Le serveur Orbia doit être mis à jour').waitFor();
  await context.close();
}

// Société : remplissage depuis le SIRET, sans enregistrement automatique
{
  const b = createBackend();
  const { page, problems, context } = await session(b, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.route('https://recherche-entreprises.api.gouv.fr/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [{ siren: '123456789', nom_raison_sociale: 'SOCIETE TEST', nature_juridique: '5710' }] }) }));
  await page.goto(origin + '#/reglages');
  await page.getByRole('button', { name: 'Remplir depuis le SIRET' }).click();
  await page.getByText('Saisissez les 14 chiffres du SIRET.').waitFor();
  await page.getByLabel('SIRET').fill('123 456 789 00011');
  await page.getByRole('button', { name: 'Remplir depuis le SIRET' }).click();
  await page.getByText('Vérifiez, puis enregistrez.').waitFor();
  assert.equal(await page.getByLabel('Raison sociale').inputValue(), 'SOCIETE TEST');
  assert.equal(await page.getByLabel('Forme juridique').inputValue(), 'SAS');
  assert.equal(await page.getByLabel('SIREN').inputValue(), '123456789');
  assert.equal(b.call('admin@example.test', 'session.get').data.company.legalName, '', 'rien enregistré sans validation');
  await context.close();
  assert.deepEqual(problems, [], 'console siret');
}

// Banque : import réel depuis l'interface, puis tableau de bord
{
  const b = createBackend();
  b.call('admin@example.test', 'storage.init');
  const { page, problems, context } = await session(b, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.goto(origin + '#/banque');
  const csv = 'Date;Libellé;Montant;Solde\n01/10/2026;SNCF;-98,00;1 000,00\n02/10/2026;Client <b>x</b>;1 200,50;2 200,50\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'octobre.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('heading', { name: 'Confirmez les colonnes' }).waitFor();
  await noOverflow(page, 'colonnes mobile');
  await page.getByRole('button', { name: 'Vérifier le fichier' }).click();
  await page.getByRole('heading', { name: 'Vérifiez avant d’importer' }).waitFor();
  await page.screenshot({ path: shots + 'import-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Importer 2 opération(s)' }).click();
  await page.getByText('Selon le relevé du').waitFor();
  await page.getByText('Client <b>x</b>').first().waitFor();
  await noOverflow(page, 'banque remplie');
  await page.screenshot({ path: shots + 'banque-remplie-mobile.png', fullPage: true });
  await page.goto(origin + '#/');
  await page.getByText('Selon le relevé du').first().waitFor();
  assert.ok((await page.locator('.hero').innerText()).replace(/\s/g, ' ').includes('2 200,50'));
  await page.screenshot({ path: shots + 'accueil-rempli-mobile.png' });
  await context.close();
  assert.deepEqual(problems, [], 'console banque');
}

// Relevé PDF : lu dans le navigateur, revu, puis importé
{
  const b = createBackend();
  b.call('admin@example.test', 'storage.init');
  const { page, problems, context } = await session(b, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.goto(origin + '#/banque');
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../fixtures/releve-fictif.pdf', import.meta.url)));
  await page.getByRole('heading', { name: 'Confirmez les colonnes' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Vérifier le fichier' }).click();
  await page.getByText('Lu dans le PDF : 3 opération(s)').waitFor();
  await page.screenshot({ path: shots + 'import-pdf-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Importer 3 opération(s)' }).click();
  await page.getByText('SNCF billet').first().waitFor();
  await context.close();
  assert.deepEqual(problems, [], 'console pdf');
}

// Factures : ajout, saisie, contrôle, validation, verrouillage
{
  const b = createBackend();
  b.call('admin@example.test', 'storage.init');
  const { page, problems, context } = await session(b, 'admin@example.test', PHONE);
  await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
  await page.goto(origin + '#/factures');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'facture.png', mimeType: 'image/png', buffer: png });
  await page.getByText('1 document(s) ajouté(s).').waitFor();
  await page.getByText('facture.png').first().click();
  b.store.ORBIA_ANTHROPIC_API_KEY = 'test';
  b.state.aiText = JSON.stringify({ type: 'facture_recue', supplier: 'Atelier fictif', date: '2026-10-14', invoiceNumber: 'F-12', net: '100,00', vat: '20,00', gross: '120,00', uncertain: ['invoiceNumber'] });
  await page.getByRole('button', { name: 'Lire avec l’IA' }).click();
  await page.getByText('Rien n’est enregistré pour l’instant.').waitFor();
  assert.equal(await page.getByLabel('Fournisseur ou client').inputValue(), 'Atelier fictif');
  await page.getByLabel('Montant TTC').fill('121,00');
  await page.getByRole('button', { name: 'Valider le document' }).click();
  await page.getByText('HT + TVA').first().waitFor();
  await page.getByLabel('Montant TTC').fill('120,00');
  await page.getByRole('button', { name: 'Valider le document' }).click();
  await page.getByRole('button', { name: 'Rouvrir le document' }).waitFor();
  await noOverflow(page, 'document mobile');
  await page.screenshot({ path: shots + 'document-mobile.png', fullPage: true });
  await context.close();
  assert.deepEqual(problems.filter((p) => !p.includes('favicon')), [], 'console factures');
}

// Toutes les pages : rendu sans erreur, sans chiffre inventé, sur PC et mobile
{
  const pages = [['banque', 'Banque & rapprochement'], ['factures', 'Factures & documents'], ['projets', 'Événements'], ['tva', /TVA/], ['deplacements', 'Déplacements & notes de frais'], ['comptabilite', 'Comptabilité']];
  for (const [viewport, tag] of [[DESK, 'pc'], [PHONE, 'mobile']]) {
    const { page, problems, context } = await session(backend, 'admin@example.test', viewport);
    await page.getByRole('heading', { name: 'Bonjour !' }).waitFor();
    await page.waitForTimeout(150);
    await page.screenshot({ path: shots + `accueil-${tag}.png` });
    for (const [path, title] of pages) {
      await page.goto(origin + '#/' + path);
      await page.getByRole('heading', { name: title, level: 1 }).waitFor();
      assert.ok(!/\d\s?€/.test(await page.locator('main').innerText()), `${path}: aucun montant inventé`);
      await noOverflow(page, `${path} ${tag}`);
      await page.screenshot({ path: shots + `${path}-${tag}.png`, fullPage: true });
    }
    await context.close();
    assert.deepEqual(problems, [], `console ${tag}`);
  }
}

// Compte non autorisé
{
  const { page, context } = await session(backend, 'inconnu@example.test', PHONE);
  await page.getByRole('heading', { name: 'Accès refusé' }).waitFor();
  await page.screenshot({ path: shots + 'refus-mobile.png' });
  await context.close();
}

// Écran de connexion, avec la vraie politique de sécurité chargée
{
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await page.route('**/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: GSI }));
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.ORBIA_CONFIG={apiUrl:'${API}',googleClientId:'x'};` }));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Connexion' }).waitFor();
  await page.screenshot({ path: shots + 'connexion-mobile.png' });
  await context.close();
}

await browser.close();
server.close();
console.log('Parcours e2e réussis');
