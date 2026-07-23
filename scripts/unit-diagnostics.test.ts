import assert from 'node:assert/strict';

import { formatBattleValueDetails, formatCostReport, formatDiagnosticNumber } from './unit-diagnostics';

function main(): void {
  assert.equal(formatDiagnosticNumber(1234567), '1,234,567');
  assert.equal(formatDiagnosticNumber(12.3456789), '12.345679');

  assert.deepEqual(formatCostReport({
    steps: [
      { type: 'Structure', amount: 1000, subtotal: 1000 },
      { type: 'Discount', amount: -100, subtotal: 900 },
      { type: 'Multiplier', factor: 1.5, subtotal: 1350 },
    ],
    total: 1350,
  }), [
    'Structure: + 1,000 => 1,000',
    'Discount: - 100 => 900',
    'Multiplier: × 1.5 => 1,350',
    'Total: 1,350',
  ]);

  assert.deepEqual(formatBattleValueDetails([{
    type: 'Defensive Battle Rating',
    details: [{ type: 'Armor', calculation: '20 x 2.5', delta: 50, total: 50 }],
  }, {
    type: 'Battle Value',
  }]), [
    'Defensive Battle Rating',
    '  Armor: 20 x 2.5 | Δ 50 | total 50',
    'Battle Value',
  ]);

  console.log('[unit-diagnostics] formatting tests passed');
}

main();