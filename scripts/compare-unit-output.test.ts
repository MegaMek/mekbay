import assert from 'node:assert/strict';
import { getOracleFieldName, isCalculableLoadoutTons } from './loadout-tonnage-oracle';

assert.equal(isCalculableLoadoutTons(12.5), true);
assert.equal(isCalculableLoadoutTons(0.001), true);
assert.equal(isCalculableLoadoutTons(0), false);
assert.equal(isCalculableLoadoutTons(-1), false);
assert.equal(isCalculableLoadoutTons(Number.NaN), false);
assert.equal(isCalculableLoadoutTons(undefined), false);
assert.equal(getOracleFieldName('effectiveTonnage'), 'loadoutTons');
assert.equal(getOracleFieldName('tons'), 'tons');

console.log('compare-unit-output tests passed');