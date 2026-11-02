import { h, icon } from './dom.js';

/*
 * Pages métier. Elles reprennent la maquette, sans aucune donnée inventée :
 * tant qu'un module n'est pas branché, elles affichent des tirets et un état vide.
 */
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
const stat = (label, iconName, note) => h('section', { class: 'stat' },
  h('div', { class: 'stat-label' }, label, h('span', { class: 'stat-icon' }, icon(iconName))),
  h('p', { class: 'stat-value' }, NONE),
  h('p', { class: 'stat-note' }, note));

export function homeView(session) {
  const today = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date());
  const needsSetup = !session.company.legalName;
  return [
    title('Bonjour !', `Voici la situation de votre activité au ${today}.`),
    needsSetup && h('div', { class: 'notice' },
      h('p', {}, 'Renseignez la société avant de commencer.'),
      session.permissions.includes('company:write')
        ? h('a', { class: 'btn', href: '#/reglages' }, 'Configurer la société')
        : h('p', { class: 'muted' }, 'Un administrateur doit le faire.')),
    h('div', { class: 'stats' },
      stat('Trésorerie', 'bank', 'Aucun relevé importé'),
      stat('Recettes', 'chart', 'Aucune donnée'),
      stat('Dépenses', 'docs', 'Aucune donnée'),
      stat('TVA à payer', 'vat', 'Aucune période préparée')),
    h('div', { class: 'home-grid' },
      h('section', { class: 'card' },
        h('h2', {}, 'Trésorerie'),
        h('div', { class: 'chart-empty' }, h('span', {}, 'La courbe apparaîtra après votre premier import Qonto.'))),
      h('section', { class: 'card' },
        h('h2', {}, 'Activité récente'),
        empty('chart', 'Rien pour le moment', 'Vos factures, paiements et justificatifs apparaîtront ici.')))
  ];
}

function bankView() {
  return [
    title('Banque & rapprochement', 'Importez vos relevés et rapprochez vos transactions simplement.'),
    h('section', { class: 'card import' },
      h('span', { class: 'stat-icon' }, icon('bank')),
      h('div', {}, h('p', { class: 'row-title' }, 'Importer un relevé bancaire'), h('p', { class: 'muted' }, 'Fichier CSV exporté depuis Qonto')),
      soonButton('Importer depuis Qonto', 'upload')),
    h('section', { class: 'card' },
      tabs(['Toutes les opérations', 'Rapprochées', 'À rapprocher', 'Sans justificatif']),
      filters('Rechercher une opération', ['Période', 'Montant', 'Statut']),
      table(['Date', 'Libellé', '=Montant', 'Statut', 'Justificatif']),
      empty('bank', 'Aucune opération', 'Vos opérations apparaîtront ici après le premier import.'))
  ];
}

function invoicesView() {
  return [
    title('Factures & documents', 'Centralisez vos factures, justificatifs et documents comptables.', soonButton('Ajouter un document', 'plus')),
    h('section', { class: 'card' },
      tabs(['Tous', 'Factures', 'Justificatifs', 'À vérifier', 'Archivés']),
      filters('Rechercher un document', ['Type', 'Période', 'Statut']),
      h('div', { class: 'drop' },
        h('span', { class: 'empty-icon' }, icon('camera')),
        h('p', { class: 'drop-title' }, 'Scanner un justificatif'),
        h('p', {}, 'Prenez une photo ou glissez votre fichier ici.'),
        h('p', { class: 'soon' }, SOON)))
  ];
}

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
    title('TVA mensuelle', 'Préparez et suivez vos déclarations de TVA (CA3).'),
    h('ol', { class: 'steps', 'aria-label': 'Étapes de la déclaration' },
      ['Données', 'Contrôles', 'Validation'].map((s, i) => h('li', { class: i === 0 ? 'on' : '' }, h('b', {}, String(i + 1)), s))),
    h('div', { class: 'tva-grid' },
      h('section', { class: 'card' },
        h('h2', {}, 'Détail de la déclaration (CA3)'),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Opération'), h('th', { scope: 'col', class: 'num' }, 'Base imposable'), h('th', { scope: 'col', class: 'num' }, 'TVA'))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r), h('td', { class: 'num' }, NONE), h('td', { class: 'num' }, NONE)))))),
        h('div', { class: 'tva-total' }, h('span', {}, 'TVA à payer'), h('span', {}, NONE))),
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
