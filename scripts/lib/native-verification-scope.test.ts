import assert from 'node:assert/strict';
import { nativeVerificationSkip } from './native-verification-scope';

const excluded = 'infantry/Clan/Clan Engineer Point (Minesweeper).blk';
assert.equal(nativeVerificationSkip(excluded.replaceAll('/', '\\'), '', [excluded])?.status, 'excluded');
assert.equal(nativeVerificationSkip('other/Clan Engineer Point (Minesweeper).blk', '', [excluded]), undefined);
assert.equal(nativeVerificationSkip(excluded, '', []), undefined);
assert.equal(nativeVerificationSkip('ge/turret.blk', '<UnitType>\nGunEmplacement\n</UnitType>', [])?.status, 'unsupported');
for (const unitType of ['BuildingEntity', 'Tank', 'GunEmplacment', 'NewUnitType']) {
    assert.equal(nativeVerificationSkip('unit.blk', `<UnitType>\n${unitType}\n</UnitType>`, []), undefined);
}
assert.equal(nativeVerificationSkip('unit.blk', '<UnitType>\nGunEmplacement', []), undefined);
assert.equal(nativeVerificationSkip('unit.mtf', '<UnitType>\nGunEmplacement\n</UnitType>', []), undefined);
console.log('native-verification-scope tests passed');
