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
  if (can(session, 'logs:read')) tabs.push(['#/reglages/journal', 'Journal']);
  return h('nav', { class: 'subnav', 'aria-label': 'Réglages' },
    tabs.map(([href, label]) => h('a', { href, 'aria-current': href === active ? 'page' : null }, label)));
}

export function companyView(session, onSaved) {
  const editable = can(session, 'company:write');
  const c = session.company;
  const input = (name, attrs = {}) => h('input', { name, value: c[name], readOnly: !editable, autocomplete: 'off', ...attrs });
  const select = (name, pairs) => h('select', { name, disabled: !editable }, options(pairs, c[name]));
  const message = h('p', { role: 'status' });

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
