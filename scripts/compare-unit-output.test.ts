import assert from 'node:assert/strict';
import { getOracleFieldName, isCalculableLoadoutTons } from './loadout-tonnage-oracle';
import {
  formatBoundedDiagnosticValue,
  unorderedStructuralEqual,
} from './lib/unordered-value-comparison';
import { nativeUnitSourceDeclaresUuid } from './lib/native-unit-source-identity';

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
assert.equal(nativeUnitSourceDeclaresUuid('uuid:019f583e-d705-7a89-aa1a-b1554faebbd2\n', 'unit.mtf'), true);
assert.equal(nativeUnitSourceDeclaresUuid('UUID:   \n', 'unit.mtf'), false);
assert.equal(nativeUnitSourceDeclaresUuid('<UUID>\n019f583e-e2c6-7b99-a188-ba0759db128e\n</UUID>', 'unit.blk'), true);
assert.equal(nativeUnitSourceDeclaresUuid('<UUID> </UUID>', 'unit.blk'), false);

console.log('compare-unit-output tests passed');
