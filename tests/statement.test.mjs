import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, toCsv } from '../frontend/js/pdf-statement.js';

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
