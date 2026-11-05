import { h, icon, field } from './dom.js';
import { api } from './api.js';
import { readStatement } from './pdf-statement.js';

/*
 * Pages métier. Elles reprennent la maquette, sans aucune donnée inventée :
 * tant qu'un module n'est pas branché, elles affichent des tirets et un état vide.
 */
const euro = (cents, currency = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
const dayFr = (iso) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(String(iso).slice(0, 10) + 'T12:00:00Z'));
const monthFr = (key) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(key + '-15T12:00:00Z'));
const freshness = (s) => (s.balanceDate ? `Selon le relevé du ${dayFr(s.balanceDate)}` : 'Solde absent du relevé importé');
const SOON = 'Bientôt disponible';
const NONE = '—';

const title = (text, sub, action) => h('header', { class: 'page-title' }, h('div', {}, h('h1', {}, text), sub && h('p', {}, sub)), action);
const soonButton = (label, iconName) => h('button', { class: 'btn', disabled: true, title: SOON }, iconName && icon(iconName), label);
const tabs = (labels) => h('div', { class: 'tabs', 'aria-hidden': 'true' }, labels.map((l, i) => h('span', { class: i === 0 ? 'on' : '' }, l)));
const filters = (search, labels) => h('div', { class: 'filters', 'aria-hidden': 'true' },
  h('div', { class: 'filter filter-search' }, search), labels.map((l) => h('div', { class: 'filter' }, l)));
const empty = (iconName, heading, text) => h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(iconName)), h('p', { class: 'row-title' }, heading), h('p', {}, text));
const table = (columns) => h('div', { class: 'table-wrap' }, h('table', {},
  h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.startsWith('=') ? 'num' : '' }, c.replace('=', '')))))));
const mini = (label, iconName, value = NONE) => h('section', { class: 'mini' },
  h('span', { class: 'stat-icon' }, icon(iconName)),
  h('div', {}, h('p', { class: 'stat-note' }, label), h('p', { class: 'mini-value' }, value)));
const stat = (label, iconName, note, value = NONE) => h('section', { class: 'stat' },
  h('div', { class: 'stat-label' }, label, h('span', { class: 'stat-icon' }, icon(iconName))),
  h('p', { class: 'stat-value' }, value),
  h('p', { class: 'stat-note' }, note));

function todo(bank, toVerify = 0) {
  const items = [];
  const links = {};
  if (toVerify) { const t = `${toVerify} document${toVerify > 1 ? 's' : ''} à vérifier`; items.push(t); links[t] = '#/factures'; }
  if (bank.unmatched) items.push(`${bank.unmatched} opération${bank.unmatched > 1 ? 's' : ''} à rapprocher`);
  bank.missingMonths.slice(0, 3).forEach((m) => items.push(`Relevé manquant : ${monthFr(m)}`));
  if (!items.length) return h('p', { class: 'muted' }, 'Rien à traiter pour le moment.');
  return h('div', {}, items.map((t) => h('a', { class: 'more-link', href: links[t] || '#/banque' }, t, icon('chevron'))));
}

export async function homeView(session) {
  // Si le serveur a une version de retard, l'accueil reste utilisable.
  let serverBehind = false;
  const docs = await api('documents.list').catch(() => ({ items: [] }));
  const toVerify = docs.items.filter((d) => d.validationStatus !== 'valide').length;
  const bank = await api('bank.summary').catch((err) => {
    if (err.code !== 'BAD_REQUEST') throw err;
    serverBehind = true;
    return { count: 0, balanceCents: null, balanceDate: '', monthInCents: 0, monthOutCents: 0, unmatched: 0, missingMonths: [] };
  });
  const hasData = bank.count > 0;
  const money = (v) => (hasData ? euro(v) : NONE);
  const balance = bank.balanceCents === null ? NONE : euro(bank.balanceCents);
  const balanceNote = hasData ? freshness(bank) : 'Aucun relevé importé';
  const today = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date());
  const needsSetup = !session.company.legalName;
  return [
    title('Bonjour !', `Voici la situation de votre activité au ${today}.`),
    serverBehind && h('div', { class: 'notice', role: 'status' }, h('p', {}, 'Le serveur Orbia doit être mis à jour : les données bancaires ne sont pas disponibles.')),
    needsSetup && h('div', { class: 'notice' },
      h('p', {}, 'Renseignez la société avant de commencer.'),
      session.permissions.includes('company:write')
        ? h('a', { class: 'btn', href: '#/reglages' }, 'Configurer la société')
        : h('p', { class: 'muted' }, 'Un administrateur doit le faire.')),
    h('section', { class: 'hero only-mobile', 'aria-label': 'Trésorerie' },
      h('span', { class: 'hero-icon' }, icon('bank')),
      h('div', {}, h('p', {}, 'Trésorerie'), h('p', { class: 'stat-value' }, balance), h('p', { class: 'stat-note' }, balanceNote))),
    h('div', { class: 'pair only-mobile' }, mini('Encaissements ce mois-ci', 'in', money(bank.monthInCents)), mini('Décaissements ce mois-ci', 'out', money(bank.monthOutCents))),
    h('section', { class: 'card only-mobile' },
      h('h2', {}, 'À traiter'),
      todo(bank, toVerify)),
    h('div', { class: 'stats only-desktop' },
      stat('Trésorerie', 'bank', balanceNote, balance),
      stat('Encaissements', 'in', 'Ce mois-ci', money(bank.monthInCents)),
      stat('Décaissements', 'out', 'Ce mois-ci', money(bank.monthOutCents)),
      stat('TVA à payer', 'vat', 'Aucune période préparée')),
    h('div', { class: 'home-grid only-desktop' },
      h('section', { class: 'card' },
        h('h2', {}, 'Trésorerie'),
        h('div', { class: 'chart-empty' }, h('span', {}, 'La courbe arrivera avec l’historique de vos relevés.'))),
      h('section', { class: 'card' },
        h('h2', {}, 'À traiter'),
        todo(bank, toVerify)))
  ];
}

const BANK_FIELDS = [
  ['date', 'Date de l’opération', true], ['label', 'Libellé', true], ['amount', 'Montant signé'],
  ['debit', 'Débit'], ['credit', 'Crédit'], ['balance', 'Solde'], ['valueDate', 'Date de valeur'],
  ['currency', 'Devise'], ['account', 'Compte'], ['sourceId', 'Identifiant bancaire']
];

async function readCsv(file) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  return utf8.includes('\uFFFD') ? new TextDecoder('iso-8859-1').decode(buffer) : utf8;
}

function opRow(t) {
  return h('div', { class: 'op' },
    h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, t.label), h('p', { class: 'stat-note' }, dayFr(t.date))),
    h('div', { class: 'op-end' },
      h('p', { class: t.amountCents >= 0 ? 'amount-in' : 'amount-out' }, euro(t.amountCents, t.currency)),
      h('span', { class: `status ${t.status === 'non_rapproche' ? 'status-warn' : 'status-ok'}` }, t.status === 'non_rapproche' ? 'À rapprocher' : 'Rapprochée')));
}

async function bankView(session) {
  const canImport = session.permissions.includes('bank:import');
  const [summary, list] = await Promise.all([api('bank.summary'), api('bank.list', { limit: 50 })]);
  const wizard = h('div', { class: 'form' });
  const message = h('p', { role: 'status' });
  const say = (text, ok) => { message.className = ok ? 'form-ok' : 'form-error'; message.textContent = text; };
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  let file = { name: '', content: '' };

  function showReport(preview, mapping) {
    const r = preview.report;
    const blocked = r.errorCount > 0 || r.newCount === 0;
    const go = h('button', { class: 'btn', disabled: blocked, onclick: async () => {
      go.disabled = true;
      say('Import en cours', true);
      try {
        const done = await api('bank.import', { fileName: file.name, content: file.content, mapping });
        wizard.replaceChildren();
        say(`${done.added} opération(s) importée(s).`, true);
        setTimeout(reload, 900);
      } catch (err) { say(err.message, false); go.disabled = false; }
    } }, `Importer ${r.newCount} opération(s)`);
    wizard.replaceChildren(h('section', { class: 'card' },
      h('h2', {}, 'Vérifiez avant d’importer'),
      h('div', {},
        h('div', { class: 'row' }, h('p', { class: 'row-main' }, 'Lignes lues'), h('span', {}, String(r.total))),
        h('div', { class: 'row' }, h('p', { class: 'row-main' }, 'Nouvelles opérations'), h('span', {}, String(r.newCount))),
        h('div', { class: 'row' }, h('p', { class: 'row-main' }, 'Déjà présentes'), h('span', {}, String(r.valid - r.newCount))),
        h('div', { class: 'row' }, h('p', { class: 'row-main' }, 'Lignes en erreur'), h('span', { class: r.errorCount ? 'status status-error' : '' }, String(r.errorCount))),
        r.firstDate && h('div', { class: 'row' }, h('p', { class: 'row-main' }, 'Période'), h('span', {}, `${dayFr(r.firstDate)} au ${dayFr(r.lastDate)}`))),
      file.statement && h('div', { class: 'notice' },
        h('p', {}, `Lu dans le PDF : ${file.statement.count} opération(s), ${euro(file.statement.inCents)} d’entrées et ${euro(file.statement.outCents)} de sorties.`),
        file.statement.checked
          ? h('p', {}, 'Ces totaux correspondent à ceux imprimés sur le relevé.')
          : h('p', {}, h('strong', {}, 'Comparez ces totaux à ceux de votre relevé avant d’importer.'), ' Un PDF peut être mal lu.')),
      r.errors.length > 0 && h('ul', { class: 'errors' }, r.errors.map((e) => h('li', {}, e))),
      r.errorCount > 0 && h('p', { class: 'form-error' }, 'Corrigez le fichier ou les colonnes : rien ne sera importé tant qu’il reste une erreur.'),
      r.errorCount === 0 && r.newCount === 0 && h('p', { class: 'muted' }, 'Toutes ces opérations sont déjà dans Orbia.'),
      h('div', {}, r.preview.map((t) => opRow({ ...t, status: 'non_rapproche' }))),
      h('div', { class: 'form-foot' }, go, h('button', { class: 'btn btn-ghost', onclick: () => showMapping(preview) }, 'Modifier les colonnes'), h('button', { class: 'btn btn-ghost', onclick: () => wizard.replaceChildren() }, 'Annuler'))));
  }

  function showMapping(preview) {
    const selects = {};
    const check = h('button', { class: 'btn', type: 'submit' }, 'Vérifier le fichier');
    const fields = BANK_FIELDS.map(([key, label, required]) => {
      selects[key] = h('select', { name: key }, h('option', { value: '' }, required ? 'Choisir une colonne' : 'Aucune'),
        preview.headers.map((c) => h('option', { value: c, selected: preview.suggested[c] === undefined && preview.suggested[key] === c }, c)));
      return field(label, selects[key]);
    });
    wizard.replaceChildren(h('form', { class: 'card form', novalidate: true, onsubmit: async (event) => {
      event.preventDefault();
      const mapping = Object.fromEntries(Object.entries(selects).map(([k, el]) => [k, el.value]).filter(([, v]) => v));
      check.disabled = true;
      say('Vérification en cours', true);
      try {
        const result = await api('bank.preview', { content: file.content, mapping });
        say('', true);
        showReport(result, mapping);
      } catch (err) { say(err.message, false); check.disabled = false; }
    } },
      h('h2', {}, 'Confirmez les colonnes'),
      h('p', { class: 'muted' }, `${file.name} : ${preview.rowCount} ligne(s). Indiquez un montant signé, ou bien les colonnes débit et crédit.`),
      preview.alreadyImported && h('p', { class: 'form-error' }, 'Ce fichier a déjà été importé : il n’ajoutera rien.'),
      h('div', { class: 'form-grid' }, fields),
      h('div', { class: 'form-foot' }, check, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => wizard.replaceChildren() }, 'Annuler'))));
  }

  const input = h('input', { type: 'file', accept: '.csv,.pdf,application/pdf,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain', class: 'sr-only', 'aria-label': 'Choisir un fichier CSV', onchange: async () => {
    const chosen = input.files[0];
    input.value = '';
    if (!chosen) return;
    if (chosen.size > 4000000) { say('Ce fichier dépasse 4 Mo. Importez une période plus courte.', false); return; }
    say('Lecture du fichier', true);
    try {
      const isPdf = /\.pdf$/i.test(chosen.name) || chosen.type === 'application/pdf';
      const statement = isPdf ? await readStatement(chosen) : null;
      file = { name: chosen.name, content: statement ? statement.csv : await readCsv(chosen), statement };
      const preview = await api('bank.preview', { content: file.content });
      say('', true);
      showMapping(preview);
    } catch (err) { say(err.message, false); }
  } });
  const scan = h('button', { class: 'btn btn-ghost', onclick: async () => {
    scan.disabled = true;
    say('Lecture du dossier Drive', true);
    try {
      const r = await api('bank.scanFolder');
      say(`${r.imported} fichier(s) importé(s), ${r.added} opération(s) ajoutée(s).${r.waiting.length ? ` En attente : ${r.waiting.join(', ')}.` : ''}`, r.waiting.length === 0);
      if (r.imported) setTimeout(reload, 900);
    } catch (err) { say(err.message, false); }
    scan.disabled = false;
  } }, 'Vérifier le dossier Drive');

  const importCard = h('section', { class: 'card' },
    h('div', { class: 'import' },
      h('span', { class: 'stat-icon' }, icon('bank')),
      h('div', {}, h('p', { class: 'row-title' }, 'Importer un relevé bancaire'), h('p', { class: 'muted' }, 'Fichier CSV ou PDF de Qonto'))),
    !list.ready
      ? h('p', { class: 'muted' }, canImport ? 'Créez d’abord l’espace Orbia dans Réglages, Stockage.' : 'Un administrateur doit d’abord créer l’espace Orbia.')
      : canImport
        ? h('div', { class: 'form-foot' }, h('button', { class: 'btn', onclick: () => input.click() }, icon('upload'), 'Importer depuis Qonto'), scan, input)
        : h('p', { class: 'muted' }, 'Seul un administrateur peut importer un relevé.'),
    message);

  return [
    title('Banque & rapprochement', 'Importez vos relevés et retrouvez vos opérations.'),
    importCard,
    wizard,
    summary.missingMonths.length > 0 && h('div', { class: 'notice', role: 'status' },
      h('p', {}, `Aucune opération pour : ${summary.missingMonths.map(monthFr).join(', ')}. Vérifiez qu’aucun relevé ne manque.`)),
    h('section', { class: 'card' },
      h('p', { class: 'stat-note' }, 'Solde du compte'),
      h('p', { class: 'stat-value' }, summary.balanceCents === null ? NONE : euro(summary.balanceCents)),
      summary.count > 0 && h('p', { class: 'stat-note' }, freshness(summary))),
    h('section', { class: 'card' },
      h('h2', {}, list.total > list.items.length ? `Dernières opérations (${list.items.length} sur ${list.total})` : 'Dernières opérations'),
      list.items.length
        ? h('div', {}, list.items.map(opRow))
        : empty('bank', 'Aucune opération', 'Vos opérations apparaîtront ici après le premier import.')),
    list.imports.length > 0 && h('section', { class: 'card' },
      h('h2', {}, 'Historique des imports'),
      h('div', {}, list.imports.map((i) => h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, i.fileName), h('p', { class: 'stat-note' }, `${dayFr(i.importedAt)}, ${i.importedBy}`)),
        h('span', {}, `${i.rowCount} ligne(s)`)))))
  ];
}

const DOC_TYPES = [['facture_recue', 'Facture reçue'], ['facture_emise', 'Facture émise'], ['recu', 'Reçu'], ['avoir', 'Avoir'], ['contrat', 'Contrat'], ['decompte', 'Décompte de billetterie'], ['note_de_frais', 'Justificatif de note de frais']];
const docTypeLabel = (t) => (DOC_TYPES.find(([k]) => k === t) || [t, t])[1];
const centsText = (v) => (v === '' || v === null || v === undefined ? '' : (v / 100).toFixed(2).replace('.', ','));

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`Lecture impossible : ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function docRow(d) {
  return h('a', { class: 'op doc-link', href: `#/factures/${d.id}` },
    h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, d.supplier || d.fileName), h('p', { class: 'stat-note' }, `${docTypeLabel(d.type)}${d.date ? `, ${dayFr(d.date)}` : ''}`)),
    h('div', { class: 'op-end' },
      h('p', { class: 'row-title' }, d.grossCents === '' ? NONE : euro(d.grossCents)),
      h('span', { class: `status ${d.validationStatus === 'valide' ? 'status-ok' : 'status-warn'}` }, d.validationStatus === 'valide' ? 'Validé' : 'À vérifier')));
}

async function invoicesView(session) {
  const canWrite = session.permissions.includes('documents:write');
  const data = await api('documents.list').catch((err) => {
    if (err.code !== 'BAD_REQUEST') throw err;
    return null;
  });
  if (!data) {
    return [
      title('Factures & documents', 'Centralisez vos factures, justificatifs et documents comptables.'),
      h('div', { class: 'notice', role: 'status' }, h('p', {}, 'Le serveur Orbia doit être mis à jour pour activer les factures.'))
    ];
  }
  const message = h('p', { role: 'status' });
  const say = (text, ok) => { message.className = ok ? 'form-ok' : 'form-error'; message.textContent = text; };
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  async function send(files) {
    let added = 0;
    const problems = [];
    for (const [i, file] of [...files].entries()) {
      say(`Envoi ${i + 1} sur ${files.length} : ${file.name}`, true);
      try {
        if (file.size > 10000000) throw new Error('fichier de plus de 10 Mo');
        const r = await api('documents.upload', { fileName: file.name, mimeType: file.type, base64: await toBase64(file) });
        if (r.duplicate) problems.push(`${file.name} : déjà dans Orbia`); else added++;
      } catch (err) { problems.push(`${file.name} : ${err.message}`); }
    }
    if (problems.length) say(`${added} ajouté(s). ${problems.join('. ')}.`, false);
    else { say(`${added} document(s) ajouté(s).`, true); setTimeout(reload, 700); }
  }

  const pick = (attrs) => h('input', { type: 'file', class: 'sr-only', 'aria-hidden': 'true', tabindex: '-1', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) send(f); }, ...attrs });
  const camera = pick({ accept: 'image/*', capture: 'environment' });
  const upload = pick({ accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', multiple: true });
  const pending = data.items.filter((d) => d.validationStatus !== 'valide');
  const done = data.items.filter((d) => d.validationStatus === 'valide');

  return [
    title('Factures & documents', 'Centralisez vos factures, justificatifs et documents comptables.'),
    !data.ready
      ? h('div', { class: 'notice' }, h('p', {}, 'Créez d’abord l’espace Orbia dans Réglages, Stockage.'))
      : canWrite && h('section', { class: 'drop', ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); send([...e.dataTransfer.files]); } },
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => camera.click() }, icon('camera'), 'Photographier'),
          h('button', { class: 'btn btn-ghost', onclick: () => upload.click() }, icon('upload'), 'Télécharger')),
        h('p', { class: 'only-desktop' }, 'Ou glissez vos fichiers ici. PDF, JPG ou PNG, 10 Mo maximum.'),
        camera, upload, message),
    h('section', { class: 'card' },
      h('h2', {}, `À vérifier (${pending.length})`),
      pending.length ? h('div', {}, pending.map(docRow)) : empty('docs', 'Rien à vérifier', 'Vos nouveaux documents apparaîtront ici.')),
    done.length > 0 && h('section', { class: 'card' }, h('h2', {}, `Validés (${done.length})`), h('div', {}, done.map(docRow)))
  ];
}

async function invoiceDetailView(session, id) {
  const { document: d, issues } = await api('documents.list', { id });
  const locked = d.validationStatus === 'valide';
  const canWrite = session.permissions.includes('documents:write') && !locked;
  const canValidate = session.permissions.includes('documents:validate');
  const message = h('p', { role: 'status' });
  const say = (text, ok) => { message.className = ok ? 'form-ok' : 'form-error'; message.textContent = text; };
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const input = (name, label, value, attrs = {}) => field(label, h('input', { name, value, readOnly: !canWrite, autocomplete: 'off', ...attrs }));
  const preview = h('div', { class: 'doc-preview' }, h('p', { class: 'muted' }, 'Chargement du document'));

  api('documents.file', { id }).then((f) => {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
    preview.replaceChildren(f.mimeType.startsWith('image/')
      ? h('img', { src: url, alt: `Aperçu de ${d.fileName}` })
      : h('a', { class: 'btn btn-ghost', href: url, target: '_blank', rel: 'noopener' }, 'Ouvrir le PDF'));
  }).catch((err) => preview.replaceChildren(h('p', { class: 'form-error' }, err.message)));

  async function save(form) {
    const v = Object.fromEntries(new FormData(form));
    return api('documents.update', { id, ...v });
  }
  const run = (button, work, done) => async () => {
    button.disabled = true;
    say('', true);
    try { await work(); say(done, true); setTimeout(reload, 600); } catch (err) { say(err.message, false); button.disabled = false; }
  };

  const form = h('form', { class: 'card form', novalidate: true, onsubmit: (e) => e.preventDefault() },
    h('h2', {}, 'Informations'),
    field('Type', h('select', { name: 'type', disabled: !canWrite }, DOC_TYPES.map(([k, l]) => h('option', { value: k, selected: k === d.type }, l)))),
    h('div', { class: 'form-grid' },
      input('supplier', 'Fournisseur ou client', d.supplier, { maxlength: 160 }),
      input('date', 'Date', d.date, { type: 'date' }),
      input('invoiceNumber', 'Numéro', d.invoiceNumber, { maxlength: 60 })),
    h('div', { class: 'form-grid' },
      input('net', 'Montant HT', centsText(d.netCents), { inputmode: 'decimal' }),
      input('vat', 'TVA', centsText(d.vatCents), { inputmode: 'decimal' }),
      input('gross', 'Montant TTC', centsText(d.grossCents), { inputmode: 'decimal' })),
    issues.length > 0 && h('ul', { class: 'errors' }, issues.map((i) => h('li', {}, i))));
  const saveBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Enregistrer');
  saveBtn.addEventListener('click', run(saveBtn, () => save(form), 'Document enregistré.'));
  const validateBtn = h('button', { class: 'btn', type: 'button' }, 'Valider le document');
  validateBtn.addEventListener('click', run(validateBtn, async () => { await save(form); await api('documents.validate', { id }); }, 'Document validé.'));
  const reason = h('input', { 'aria-label': 'Motif de la réouverture', placeholder: 'Motif de la réouverture', maxlength: 200 });
  const reopenBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Rouvrir le document');
  reopenBtn.addEventListener('click', run(reopenBtn, () => api('documents.reopen', { id, reason: reason.value }), 'Document rouvert.'));
  form.append(h('div', { class: 'form-foot' },
    canWrite && saveBtn, canWrite && canValidate && validateBtn,
    locked && canValidate && reason, locked && canValidate && reopenBtn), message);

  return [
    title(d.supplier || d.fileName, docTypeLabel(d.type), h('a', { class: 'btn btn-ghost', href: '#/factures' }, 'Retour à la liste')),
    h('div', { class: 'tva-grid' }, form, h('section', { class: 'card' }, h('h2', {}, 'Document'), preview))
  ];
}

export const documentDetail = invoiceDetailView;

function eventsView() {
  return [
    title('Événements', 'Suivez la rentabilité de vos projets.', soonButton('Nouvel événement', 'plus')),
    h('section', { class: 'card' },
      tabs(['Vue globale', 'Par événement']),
      empty('calendar', 'Aucun événement', 'Créez un événement pour suivre son budget, ses recettes et ses dépenses.'))
  ];
}

function vatView() {
  const rows = ['Opérations au taux normal', 'Opérations au taux réduit', 'Opérations exonérées'];
  return [
    h('header', { class: 'page-title' }, h('div', {},
      h('h1', {}, h('span', { class: 'only-desktop' }, 'TVA mensuelle'), h('span', { class: 'only-mobile' }, 'Déclaration de TVA')),
      h('p', {}, 'Préparez et suivez vos déclarations de TVA (CA3).'))),
    h('div', { class: 'pair only-mobile' }, mini('TVA collectée', 'in'), mini('TVA déductible', 'out')),
    h('ol', { class: 'steps', 'aria-label': 'Étapes de la déclaration' },
      ['Données', 'Contrôles', 'Validation'].map((s, i) => h('li', { class: i === 0 ? 'on' : '' }, h('b', {}, String(i + 1)), s))),
    h('div', { class: 'tva-grid' },
      h('section', { class: 'card' },
        h('h2', {}, 'Détail de la déclaration (CA3)'),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Opération'), h('th', { scope: 'col', class: 'num' }, 'Base imposable'), h('th', { scope: 'col', class: 'num' }, 'TVA'))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r), h('td', { class: 'num' }, NONE), h('td', { class: 'num' }, NONE)))))),
        h('div', { class: 'tva-total' }, h('span', {}, 'TVA à payer'), h('span', {}, NONE)),
        h('div', { class: 'only-mobile' }, h('button', { class: 'btn btn-wide', disabled: true, title: SOON }, 'Préparer la déclaration'))),
      h('section', { class: 'card' },
        h('h2', {}, 'Contrôles et alertes'),
        empty('vat', 'Aucun contrôle lancé', 'Les contrôles porteront sur vos pièces une fois la période préparée.')))
  ];
}

function tripsView() {
  return [
    title('Déplacements & notes de frais', 'Suivez vos déplacements et générez vos notes de frais.', soonButton('Ajouter un déplacement', 'plus')),
    h('section', { class: 'card' },
      tabs(['Tous', 'À valider', 'Remboursés']),
      filters('Rechercher un déplacement', ['Période', 'Événement', 'Statut']),
      table(['Date', 'Trajet', 'Événement', '=Distance', '=Montant', 'Statut']),
      empty('car', 'Aucun déplacement', 'Vos trajets et notes de frais apparaîtront ici.'))
  ];
}

function ledgerView() {
  return [
    title('Comptabilité', 'Journaux, grand livre, balance et clôture.'),
    h('section', { class: 'card' },
      tabs(['Journaux', 'Grand livre', 'Balance', 'Clôture']),
      empty('ledger', 'Aucune écriture', 'Les écritures apparaîtront ici lorsque le module comptable sera en service.'))
  ];
}

export const PAGES = {
  '/banque': bankView,
  '/factures': invoicesView,
  '/projets': eventsView,
  '/tva': vatView,
  '/deplacements': tripsView,
  '/comptabilite': ledgerView
};
