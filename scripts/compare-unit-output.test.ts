import assert from 'node:assert/strict';
import { getOracleFieldName, isCalculableLoadoutTons } from './loadout-tonnage-oracle';
import {
  formatBoundedDiagnosticValue,
  unorderedStructuralEqual,
} from './lib/unordered-value-comparison';

assert.equal(isCalculableLoadoutTons(12.5), true);
assert.equal(isCalculableLoadoutTons(0.001), true);
assert.equal(isCalculableLoadoutTons(0), false);
assert.equal(isCalculableLoadoutTons(-1), false);
assert.equal(isCalculableLoadoutTons(Number.NaN), false);
assert.equal(isCalculableLoadoutTons(undefined), false);
assert.equal(getOracleFieldName('loadoutTonnage'), 'loadoutTons');
assert.equal(getOracleFieldName('tons'), 'tons');

assert.equal(unorderedStructuralEqual(
  [['TM', 'TW'], ['Core']],
  [['Core'], ['TW', 'TM']],
), true, 'nested arrays should be unordered');
assert.equal(unorderedStructuralEqual(
  [{ id: 'laser', bay: ['left', 'right'] }, { id: 'ammo' }],
  [{ id: 'ammo' }, { bay: ['right', 'left'], id: 'laser' }],
), true, 'objects should retain key semantics while their arrays are unordered');
assert.equal(unorderedStructuralEqual(['TM', 'TM'], ['TM']), false, 'array duplicates should count');
assert.equal(unorderedStructuralEqual(['TM', 'TW'], ['TM', 'TM']), false, 'array multiplicity should match');
assert.match(formatBoundedDiagnosticValue({ large: 'abcdefghij' }, 8), /chars omitted/u);

console.log('compare-unit-output tests passed');
