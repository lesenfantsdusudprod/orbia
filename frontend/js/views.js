import { h, field } from './dom.js';
import { api } from './api.js';

const ROLE_LABELS = { admin: 'Administrateur', collaborateur: 'Collaborateur', lecture: 'Lecture seule' };
const VAT_REGIMES = [['a_confirmer', 'À confirmer'], ['reel_normal', 'Réel normal'], ['reel_simplifie', 'Réel simplifié'], ['franchise', 'Franchise en base']];
const VAT_PERIODS = [['a_confirmer', 'À confirmer'], ['mensuelle', 'Mensuelle'], ['trimestrielle', 'Trimestrielle'], ['annuelle', 'Annuelle']];
const LEVELS = { error: ['Erreur', 'status-error'], warn: ['Alerte', 'status-warn'], audit: ['Action', 'status-ok'], info: ['Info', ''] };

const can = (session, permission) => session.permissions.includes(permission);
const head = (title, text) => h('header', { class: 'page-head' }, h('h1', {}, title), text && h('p', {}, text));
const options = (pairs, current) => pairs.map(([value, label]) => h('option', { value, selected: value === current }, label));
const dateTime = (iso) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date(iso));

export function upcomingView(title, text) {
  return [head(title, text), h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Ce module n’est pas encore construit.'))];
}

export function moreView(session, links) {
  return [
    head('Plus'),
    h('nav', { class: 'card', 'aria-label': 'Autres sections' },
      h('div', {}, links.map(([href, label]) => h('a', { class: 'more-link', href }, label)))),
    h('section', { class: 'card' },
      h('p', { class: 'row-title' }, session.user.name || session.user.email),
      h('p', { class: 'muted' }, session.user.email),
      h('p', {}, h('span', { class: 'status' }, ROLE_LABELS[session.user.role])))
  ];
}

function settingsTabs(session, active) {
  const tabs = [['#/reglages', 'Société']];
  if (can(session, 'users:manage')) tabs.push(['#/reglages/utilisateurs', 'Utilisateurs']);
  if (can(session, 'storage:manage')) tabs.push(['#/reglages/stockage', 'Stockage']);
  if (can(session, 'logs:read')) tabs.push(['#/reglages/journal', 'Journal']);
  return h('nav', { class: 'subnav', 'aria-label': 'Réglages' },
    tabs.map(([href, label]) => h('a', { href, 'aria-current': href === active ? 'page' : null }, label)));
}

const LEGAL_FORMS = { 5710: 'SAS', 5720: 'SASU', 5499: 'SARL', 5498: 'EURL', 5599: 'SA', 6540: 'SCI', 9220: 'Association' };

/** Annuaire public de l'État : seul le SIRET saisi lui est envoyé. */
async function findCompany(siret) {
  const url = `https://recherche-entreprises.api.gouv.fr/search?q=${siret}`;
  let body;
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    body = await response.json();
  } catch (err) {
    throw new Error('L’annuaire des entreprises ne répond pas. Saisissez les informations à la main.');
  }
  const found = (body.results || []).find((r) => r.siren === siret.slice(0, 9));
  if (!found) throw new Error('Aucune entreprise trouvée pour ce SIRET. Vérifiez le numéro.');
  return found;
}

export function companyView(session, onSaved) {
  const editable = can(session, 'company:write');
  const c = session.company;
  const input = (name, attrs = {}) => h('input', { name, value: c[name], readOnly: !editable, autocomplete: 'off', ...attrs });
  const select = (name, pairs) => h('select', { name, disabled: !editable }, options(pairs, c[name]));
  const message = h('p', { role: 'status' });
  const lookup = h('p', { role: 'status' });

  async function fill(event) {
    const button = event.currentTarget;
    const form = button.form;
    const siret = form.elements.siret.value.replace(/\s/g, '');
    if (!/^\d{14}$/.test(siret)) {
      lookup.className = 'form-error';
      lookup.textContent = 'Saisissez les 14 chiffres du SIRET.';
      return;
    }
    button.disabled = true;
    lookup.className = 'muted';
    lookup.textContent = 'Recherche en cours';
    try {
      const found = await findCompany(siret);
      form.elements.legalName.value = found.nom_raison_sociale || found.nom_complet || '';
      form.elements.siren.value = found.siren;
      form.elements.siret.value = siret;
      const legal = LEGAL_FORMS[found.nature_juridique];
      if (legal) form.elements.legalForm.value = legal;
      lookup.className = 'form-ok';
      lookup.textContent = legal ? 'Vérifiez, puis enregistrez.' : 'Vérifiez, complétez la forme juridique, puis enregistrez.';
    } catch (err) {
      lookup.className = 'form-error';
      lookup.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type=submit]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    message.textContent = '';
    try {
      const { company } = await api('company.update', { ...values, currency: 'EUR', projectsEnabled: form.elements.projectsEnabled.checked });
      onSaved(company);
      message.className = 'form-ok';
      message.textContent = 'Société enregistrée.';
    } catch (err) {
      message.className = 'form-error';
      message.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  return [
    head('Réglages', editable ? null : 'Seul un administrateur peut modifier ces informations.'),
    settingsTabs(session, '#/reglages'),
    h('form', { class: 'card form', onsubmit: submit, novalidate: true },
      h('h2', {}, 'Société'),
      h('div', { class: 'form-grid' },
        field('Raison sociale', input('legalName', { maxlength: 160 })),
        field('Forme juridique', input('legalForm', { maxlength: 40 })),
        field('SIREN', input('siren', { inputmode: 'numeric', maxlength: 11 })),
        field('SIRET', input('siret', { inputmode: 'numeric', maxlength: 17 }))),
      editable && h('div', { class: 'form-foot' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: fill }, 'Remplir depuis le SIRET'), lookup),
      h('h2', {}, 'Exercice'),
      h('div', { class: 'form-grid' },
        field('Début', input('fiscalYearStart', { type: 'date' })),
        field('Fin', input('fiscalYearEnd', { type: 'date' }))),
      h('h2', {}, 'TVA'),
      h('div', { class: 'form-grid' },
        field('Régime', select('vatRegime', VAT_REGIMES), 'À vérifier dans votre espace impots.gouv.fr.'),
        field('Périodicité', select('vatPeriodicity', VAT_PERIODS))),
      h('h2', {}, 'Modules'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'projectsEnabled', checked: c.projectsEnabled, disabled: !editable }), 'Suivre la rentabilité par projet'),
      editable && h('div', { class: 'form-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Enregistrer la société'), message))
  ];
}

function userRow(session, user, reload, report) {
  const role = h('select', { 'aria-label': `Rôle de ${user.email}` }, options(Object.entries(ROLE_LABELS), user.role));
  const self = user.email === session.user.email;
  async function save(active) {
    try {
      await api('users.save', { email: user.email, role: role.value, active });
      await reload();
    } catch (err) {
      report(err.message);
    }
  }
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('p', { class: 'row-title' }, user.email),
      h('p', { class: 'muted' }, ROLE_LABELS[user.role], self ? ', votre compte' : ''),
      h('span', { class: `status ${user.active ? 'status-ok' : ''}` }, user.active ? 'Actif' : 'Désactivé')),
    !self && h('div', { class: 'row-controls' },
      role,
      h('button', { class: 'btn btn-ghost', onclick: () => save(user.active) }, 'Changer le rôle'),
      h('button', { class: 'btn btn-ghost', onclick: () => save(!user.active) }, user.active ? 'Désactiver' : 'Réactiver')));
}

export async function usersView(session) {
  const list = h('div', { 'aria-live': 'polite' });
  const message = h('p', { class: 'form-error', role: 'alert' });
  const report = (text) => { message.textContent = text; };

  async function reload() {
    report('');
    const { users } = await api('users.list');
    list.replaceChildren(...users.map((u) => userRow(session, u, reload, report)));
  }

  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      await api('users.save', { ...values, active: true });
      form.reset();
      await reload();
    } catch (err) {
      report(err.message);
    }
  }

  await reload();
  return [
    head('Réglages'),
    settingsTabs(session, '#/reglages/utilisateurs'),
    h('section', { class: 'card' }, h('h2', {}, 'Utilisateurs autorisés'), list),
    h('form', { class: 'card form', onsubmit: add, novalidate: true },
      h('h2', {}, 'Autoriser un compte Google'),
      h('div', { class: 'form-grid' },
        field('E-mail', h('input', { name: 'email', type: 'email', autocomplete: 'off', required: true })),
        field('Rôle', h('select', { name: 'role' }, options(Object.entries(ROLE_LABELS), 'collaborateur')))),
      message,
      h('div', { class: 'form-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Autoriser ce compte')))
  ];
}

export async function logsView(session) {
  const { entries } = await api('logs.list');
  return [
    head('Réglages'),
    settingsTabs(session, '#/reglages/journal'),
    h('section', { class: 'card' },
      h('h2', {}, 'Journal'),
      h('p', { class: 'muted' }, 'Les 100 derniers événements.'),
      entries.length === 0
        ? h('p', {}, 'Aucun événement pour le moment.')
        : h('div', {}, entries.map((e) => {
          const [label, cls] = LEVELS[e.level] || LEVELS.info;
          return h('article', { class: 'log-entry' },
            h('p', {}, h('span', { class: `status ${cls}` }, label), ' ', e.message),
            h('p', { class: 'log-meta' }, [dateTime(e.at), e.actor, e.source === 'client' ? 'navigateur' : null, `réf. ${e.correlationId.slice(0, 8)}`].filter(Boolean).join(', ')));
        })))
  ];
}

const STATE = (ok, yes, no) => h('span', { class: `status ${ok ? 'status-ok' : 'status-warn'}` }, ok ? yes : no);
const checkRow = (label, state) => h('div', { class: 'row' }, h('p', { class: 'row-main' }, label), state);

export async function storageView(session) {
  const slot = h('div', { class: 'form' });
  const message = h('p', { role: 'status' });
  const say = (text, ok) => { message.className = ok ? 'form-ok' : 'form-error'; message.textContent = text; };

  async function run(button, action, payload, done, pending) {
    button.disabled = true;
    say(pending, true);
    try {
      draw(await api(action, payload));
      say(done, true);
    } catch (err) {
      say(err.message, false);
      button.disabled = false;
    }
  }

  function restoreBlock(status) {
    const select = h('select', { name: 'backup', 'aria-label': 'Sauvegarde à restaurer' }, status.backups.map((b) => h('option', { value: b.id }, dateTime(b.name.replace('Orbia_sauvegarde_', '').replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3Z')))));
    const confirm = h('input', { type: 'checkbox' });
    const button = h('button', { class: 'btn btn-ghost', disabled: true, onclick: () => run(button, 'storage.restore', { backupId: select.value, confirm: 'RESTAURER' }, 'Sauvegarde restaurée. L’ancien classeur reste dans Drive.', 'Restauration en cours') }, 'Restaurer cette sauvegarde');
    confirm.addEventListener('change', () => { button.disabled = !confirm.checked; });
    return h('section', { class: 'card form' },
      h('h2', {}, 'Restaurer'),
      h('p', { class: 'muted' }, 'Orbia repartira d’une copie de cette sauvegarde. Une sauvegarde de l’état actuel est faite avant, et rien n’est supprimé.'),
      field('Sauvegarde', select),
      h('label', { class: 'check' }, confirm, 'Je veux revenir à cette sauvegarde'),
      h('div', { class: 'form-foot' }, button));
  }

  function draw(status) {
    if (!status.ready) {
      const button = h('button', { class: 'btn', onclick: () => run(button, 'storage.init', undefined, 'Espace Orbia créé.', 'Création en cours, cela peut prendre une minute') }, status.partial ? 'Reprendre la création' : 'Créer l’espace Orbia');
      slot.replaceChildren(h('section', { class: 'card form' },
        h('h2', {}, 'Espace de stockage'),
        h('p', { class: 'muted' }, 'Orbia va créer un dossier Drive privé et un classeur dans ce compte Google. Il ne touche à aucun fichier existant.'),
        h('div', { class: 'form-foot' }, button), message));
      return;
    }
    const check = h('button', { class: 'btn btn-ghost', onclick: () => run(check, 'storage.init', undefined, 'Structure vérifiée.', 'Vérification en cours') }, 'Vérifier la structure');
    const backup = h('button', { class: 'btn', onclick: () => run(backup, 'storage.backup', undefined, 'Sauvegarde créée.', 'Sauvegarde en cours') }, 'Sauvegarder maintenant');
    const test = h('button', { class: 'btn btn-ghost', disabled: status.backups.length === 0, onclick: () => run(test, 'storage.restoreTest', undefined, 'Test de restauration terminé.', 'Test en cours') }, 'Tester la dernière sauvegarde');
    const lastTest = status.lastRestoreTest;
    slot.replaceChildren(
      h('section', { class: 'card' },
        h('h2', {}, 'Espace de stockage'),
        h('div', {},
          checkRow('Dossier et classeur privés', STATE(status.isPrivate, 'Privés', 'Partagés : à vérifier')),
          checkRow('Sauvegarde quotidienne', STATE(status.automaticBackups, 'Active', 'Inactive')),
          checkRow('Test mensuel de restauration', STATE(status.monthlyRestoreTest, 'Actif', 'Inactif')),
          checkRow('Dernière sauvegarde', h('span', { class: 'muted' }, status.lastBackup ? dateTime(status.lastBackup.at) : 'Aucune')),
          checkRow('Dernier test', lastTest ? STATE(lastTest.ok, `Réussi, ${dateTime(lastTest.at)}`, 'Échec, voir le journal') : h('span', { class: 'muted' }, 'Aucun'))),
        h('div', { class: 'form-foot' },
          h('a', { class: 'btn btn-ghost', href: status.folderUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir le dossier Drive'),
          h('a', { class: 'btn btn-ghost', href: status.spreadsheetUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir le classeur'))),
      h('section', { class: 'card form' },
        h('h2', {}, 'Sauvegardes'),
        h('div', { class: 'form-foot' }, backup, test, check), message),
      status.backups.length > 0 && restoreBlock(status));
    slot.replaceChildren(...[...slot.children].filter(Boolean));
  }

  draw(await api('storage.status'));
  return [head('Réglages'), settingsTabs(session, '#/reglages/stockage'), slot];
}
