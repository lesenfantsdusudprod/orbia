import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, summarize, toCsv } from '../frontend/js/pdf-statement.js';

const row = (y, ...cells) => cells.map(([x, text]) => ({ page: 1, x, y, text }));

test('PDF : montants signés, année du relevé, libellé sur deux lignes, soldes ignorés', () => {
  const ops = parseStatement([
    ...row(800, [50, 'Relevé octobre 2026']),
    ...row(700, [50, '01/10'], [100, 'SNCF'], [400, '-98,00 EUR']),
    ...row(688, [100, 'Billet Marseille']),
    ...row(670, [50, '02/10'], [100, 'Client'], [400, '+1 200,50 EUR']),
    ...row(650, [50, '31/10/2026'], [100, 'Solde final'], [400, '1 102,50 EUR'])
  ]);
  assert.deepEqual(ops, [
    { date: '2026-10-01', label: 'SNCF Billet Marseille', cents: -9800 },
    { date: '2026-10-02', label: 'Client', cents: 120050 }
  ]);
  assert.ok(toCsv(ops).includes('2026-10-01;"SNCF Billet Marseille";-98,00'));
});

test('PDF : colonnes Débit et Crédit sans signe', () => {
  const ops = parseStatement([
    ...row(720, [50, 'Date'], [100, 'Libellé'], [350, 'Débit'], [450, 'Crédit']),
    ...row(700, [50, '01/10/2026'], [100, 'Loyer'], [352, '500,00']),
    ...row(680, [50, '02/10/2026'], [100, 'Virement'], [452, '900,00'])
  ]);
  assert.deepEqual(ops.map((o) => o.cents), [-50000, 90000]);
});

test('PDF : sens inconnu ou rien de lisible, on s\'arrête au lieu de deviner', () => {
  assert.throws(() => parseStatement(row(700, [50, '01/10/2026'], [100, 'Loyer'], [352, '500,00'])), /Sens/);
  assert.throws(() => parseStatement(row(700, [50, 'Bonjour'])), /Aucune opération/);
  assert.throws(() => parseStatement(row(700, [50, '01/10'], [100, 'X'], [300, '-1,00'])), /Année/);
});

const qonto = (extra = []) => [
  ...row(702, [70, 'Du 01/10/2026 au 31/10/2026']),
  ...row(650, [70, 'Société fictive'], [321, 'Solde au 01/10'], [479, '+ 0.00 EUR']),
  ...row(629, [321, 'Entrées'], [464, '+ 1000.00 EUR']),
  ...row(612, [321, 'Sorties'], [468, '- 250.25 EUR']),
  ...row(583, [321, 'Solde au 31/10'], [475, '+ 749.75 EUR']),
  ...row(524, [70, 'Date de valeur'], [148, 'Transactions'], [441, 'Débit'], [516, 'Crédit']),
  ...row(503, [70, '26/10'], [148, 'Client fictif'], [486, '+ 1000.00 EUR']),
  ...row(491, [148, 'Référence de la facture']),
  ...row(463, [70, '27/10'], [148, 'Fournisseur'], [422, '- 250.25 EUR']),
  ...row(452, [148, 'Envoyé depuis Qonto']),
  ...extra,
  ...row(284, [70, 'Toutes les cartes sont compatibles.'])
];

test('PDF : format Qonto, points décimaux, pied de page exclu, totaux contrôlés', () => {
  const r = summarize(qonto());
  assert.equal(r.count, 2); assert.equal(r.checked, true);
  assert.equal(r.inCents, 100000); assert.equal(r.outCents, 25025);
  assert.ok(r.csv.includes('2026-10-27;"Fournisseur Envoyé depuis Qonto";-250,25;749,75'));
  assert.ok(!r.csv.includes('cartes'));
});

test('PDF : une ligne de plus que les totaux du relevé bloque tout', () => {
  assert.throws(() => summarize(qonto(row(420, [70, '28/10'], [148, 'Fantôme'], [422, '- 1.00 EUR']))), /ne correspondent pas/);
});
