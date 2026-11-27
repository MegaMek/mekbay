// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectFields, containedPath, readManifest, readVerifiedInput, sha256 } from './lib/unit-verification-io';
import { assertExportProvenance, assertMatchingInput, compareNumber, compareVerificationRows, loadStatus, verifierStatus } from './lib/unit-verification-comparison';

const input = { relativePath: 'test.mtf', uuid: null, contentSha256: sha256('test'), byteLength: 4, inCoreCatalog: true };
test('frozen input and manifest checks reject changed bytes, duplicates and path escapes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mekbay-verification-'));
  try {
    writeFileSync(path.join(dir, 'test.mtf'), 'test');
    assert.equal(readVerifiedInput(dir, input).toString(), 'test');
    writeFileSync(path.join(dir, 'test.mtf'), 'drift');
    assert.throws(() => readVerifiedInput(dir, input), /mismatch/u);
    assert.throws(() => containedPath(dir, '../escape'), /Unsafe/u);
    const manifest = path.join(dir, 'manifest.jsonl');
    writeFileSync(manifest, `${JSON.stringify(input)}\n${JSON.stringify(input)}\n`);
    assert.throws(() => readManifest(manifest), /Duplicate/u);
  } finally { rmSync(dir, { recursive: true }); }
});
test('comparison refuses missing, reordered, stale or incompatible export rows', () => {
  const row = { ...input, schemaVersion: 1 };
  assert.doesNotThrow(() => assertMatchingInput(input, row, 'test'));
  for (const bad of [undefined, { ...row, relativePath: 'other.mtf' }, { ...row, contentSha256: 'f'.repeat(64) }, { ...row, schemaVersion: 2 }]) {
    assert.throws(() => assertMatchingInput(input, bad, 'test'));
  }
});
test('one broken calculation cannot erase successful fields or become a zero/null match', () => {
  const fields = collectFields({ zero: () => 0, bad: () => NaN, thrown: () => { throw new Error('bad'); }, good: () => 17 });
  assert.equal(fields.zero, 0); assert.equal(fields.good, 17); assert.equal(fields.bad, null); assert.equal(fields.errors.thrown.message, 'bad');
  assert.equal(compareNumber({ calculated: { bv: null } }, { calculated: { bv: 0 } }, 'bv', 0).status, 'unavailable');
  assert.equal(compareNumber({ calculated: { bv: 0 } }, { calculated: { bv: 0 } }, 'bv', 0).status, 'match');
  assert.equal(compareNumber({ calculated: { bv: 0, errors: { bv: { message: 'failed' } } } }, { calculated: { bv: 0 } }, 'bv', 0).status, 'calculation-error');
  assert.equal(compareNumber({ calculated: { cost: 10 } }, { calculated: { cost: 10.005 } }, 'cost', .01).status, 'match');
});
test('unlike native quantities retain their raw mismatches and an explicit explanation', () => {
  const compare = (field: string, nativeValue: number, mekbayValue: number, family: string, nativeSI = 10) => compareNumber(
    { calculated: { [field]: nativeValue, si: nativeSI } },
    { identity: { entityType: family }, calculated: { [field]: mekbayValue, si: 10 } }, field, 0);
  const internal = compare('internal', 0, 10, 'Aero');
  assert.equal(internal.status, 'mismatch');
  assert.equal('disposition' in internal && internal.disposition, 'different-quantity');
  assert.equal('delta' in internal && internal.delta, 10);
  const badSI = compare('internal', 0, 10, 'Aero', 9);
  assert.equal('disposition' in badSI && badSI.disposition, 'needs-evaluation');
  const sentinel = compare('heatCapacity', 999, 0, 'Tank');
  assert.equal('disposition' in sentinel && sentinel.disposition, 'different-quantity');
  const realCapacity = compare('heatCapacity', 999, 0, 'Mek');
  assert.equal('disposition' in realCapacity && realCapacity.disposition, 'needs-evaluation');
  const requiredSinks = compare('heatSinks', 5, 10, 'ConvFighter');
  assert.equal('disposition' in requiredSinks && requiredSinks.disposition, 'different-quantity');
  const generatedHeat = compareNumber({ calculated: { heatGeneration: 12 } },
    { flags: { tracksHeat: false }, calculated: { heatGeneration: -1 } }, 'heatGeneration', 0);
  assert.equal('disposition' in generatedHeat && generatedHeat.disposition, 'different-quantity');
  const manual = compareNumber({ flags: { useManualBV: true, manualBV: 99 }, calculated: { bv: 99 } },
    { flags: { manualBV: 99 }, calculated: { bv: 75 } }, 'bv', 0);
  assert.equal(manual.status, 'mismatch');
  assert.equal('disposition' in manual && manual.disposition, 'source-override-policy');
});
test('unsupported, skipped and failed verifiers cannot be reported valid', () => {
  const status = (verifier: any) => verifierStatus({ parse: { status: 'parsed' }, megamek: verifier }, 'megamek');
  assert.equal(status({ supported: false, valid: null }), 'unsupported');
  assert.equal(status({ supported: true, valid: true, skip: true }), 'skipped');
  assert.equal(status({ supported: true, valid: true, error: { message: 'failed' } }), 'error');
  assert.equal(verifierStatus({ parse: { status: 'error' } }, 'megamek'), 'parse-error');
});
test('ordered critical equipment detects a permutation with identical equipment totals', () => {
  const equipment = [{ internalName: 'Laser' }, { internalName: 'Ammo' }];
  const native = { parse: { status: 'parsed' }, graph: { equipment, locations: [{ abbr: 'LA', criticals: [{ mountIndex: 0 }, { mountIndex: 1 }] }] } };
  const mekbay = { parse: { status: 'ok' }, identity: { entityType: 'Mek' }, graph: { equipment, locations: [{ abbreviation: 'LA', criticalSlots: [{ equipmentIndices: [1] }, { equipmentIndices: [0] }] }] } };
  const result = compareVerificationRows(native, mekbay);
  assert.equal(result.graph.equipmentComposition.status, 'match');
  assert.equal(result.graph.mekEquipmentCriticals.status, 'mismatch');
  assert.equal(result.graph.mekEquipmentCriticals.differences.length, 2);
});
test('identical native bytes cannot excuse stale equipment/options provenance', () => {
  const corpus = { manifestSha256: 'manifest', dependencies: { 'equipment.json': { contentSha256: 'equipment', byteLength: 12 } } };
  const good = { manifestSha256: 'manifest', dependencyHashes: corpus.dependencies };
  assert.doesNotThrow(() => assertExportProvenance(good, corpus, 'mekbay'));
  assert.throws(() => assertExportProvenance({ ...good, dependencyHashes: {} }, corpus, 'mekbay'), /reference provenance/u);
  assert.throws(() => assertExportProvenance({ ...good, manifestSha256: 'stale' }, corpus, 'mekbay'), /manifest provenance/u);
});
test('a returned entity with missing equipment remains an incomplete load', () => {
  assert.equal(loadStatus({ parse: { status: 'parsed', failedEquipment: ['Laser'] } }, true), 'parsed-with-failed-equipment');
  assert.equal(loadStatus({ parse: { status: 'ok', diagnostics: [{ severity: 'error' }] } }, false), 'parsed-with-load-errors');
});
test('MGA regrouping is detected even when all critical slots and equipment totals match', () => {
  const equipment = [0, 1, 2, 3].map(index => ({ index, internalName: 'MG', isMachineGunArray: false }));
  equipment.push({ index: 4, internalName: 'MGA', isMachineGunArray: true }, { index: 5, internalName: 'MGA', isMachineGunArray: true });
  const native = { parse: { status: 'parsed' }, graph: {
    equipment: equipment.map(mount => ({ ...mount, bayWeaponIndices: mount.index === 4 ? [0, 1] : mount.index === 5 ? [2, 3] : [] })),
    locations: [{ abbr: 'LA', criticals: equipment.map(mount => ({ mountIndex: mount.index })) }],
  } };
  const mekbay = { parse: { status: 'ok' }, identity: { entityType: 'Mek' }, graph: { equipment,
    locations: [{ abbreviation: 'LA', criticalSlots: equipment.map(mount => ({ equipmentIndices: [mount.index] })) }],
    bays: [{ kind: 'machine-gun-array', controllerIndex: 4, weaponIndices: [0, 1, 2] }, { kind: 'machine-gun-array', controllerIndex: 5, weaponIndices: [3] }],
  } };
  const result = compareVerificationRows(native, mekbay);
  assert.equal(result.graph.mekEquipmentCriticals.status, 'match');
  assert.equal(result.graph.machineGunArrays.status, 'mismatch');
});
test('equal equipment occupancy does not hide an absent actuator or incorrect slot armoring', () => {
  const native = { parse: { status: 'parsed' }, graph: { equipment: [], locations: [{ abbr: 'LA',
    criticals: [{ type: 0, systemRawName: 'Hand Actuator', armored: true }] }] } };
  const mekbay = { parse: { status: 'ok' }, identity: { entityType: 'Mek' }, graph: { equipment: [], bays: [],
    locations: [{ abbreviation: 'LA', criticalSlots: [{ type: 'empty', armored: false }] }] } };
  const result = compareVerificationRows(native, mekbay);
  assert.equal(result.graph.mekEquipmentCriticals.status, 'match');
  assert.equal(result.graph.mekSystemsAndArmoring.status, 'mismatch');
});
test('native short actuator names preserve identity and armoring checks', () => {
  const native = { parse: { status: 'parsed' }, graph: { equipment: [], locations: [{ abbr: 'LA',
    criticals: [{ type: 0, systemRawName: 'Hand', armored: true }] }] } };
  const slot = { type: 'system', system: 'Hand Actuator', armored: true };
  const mekbay = { parse: { status: 'ok' }, identity: { entityType: 'Mek' }, graph: { equipment: [], bays: [],
    locations: [{ abbreviation: 'LA', criticalSlots: [slot] }] } };
  assert.equal(compareVerificationRows(native, mekbay).graph.mekSystemsAndArmoring.status, 'match');
  slot.armored = false;
  assert.equal(compareVerificationRows(native, mekbay).graph.mekSystemsAndArmoring.status, 'mismatch');
  slot.armored = true; slot.system = 'Foot Actuator';
  assert.equal(compareVerificationRows(native, mekbay).graph.mekSystemsAndArmoring.status, 'mismatch');
});
test('non-Mek MGA identities use ordered location mounts instead of native pseudo-critical slots', () => {
  const equipment = [0, 1, 2].map(index => ({ index, internalName: index === 2 ? 'MGA' : 'MG', isMachineGunArray: index === 2 }));
  const native = { parse: { status: 'parsed' }, graph: {
    equipment: equipment.map(mount => ({ ...mount, location: 0, bayWeaponIndices: mount.index === 2 ? [0, 1] : [] })),
    locations: [{ index: 0, abbr: 'NOS', name: 'Nose', criticals: equipment.map(mount => ({ mountIndex: mount.index })) }],
  } };
  const bay = { kind: 'machine-gun-array', controllerIndex: 2, weaponIndices: [0, 1] };
  const mekbay = { parse: { status: 'ok' }, identity: { entityType: 'Aero' }, graph: {
    equipment: equipment.map(mount => ({ ...mount, location: 'Nose' })),
    locations: [{ abbreviation: 'Nose', criticalSlots: null }], bays: [bay],
  } };
  assert.equal(compareVerificationRows(native, mekbay).graph.machineGunArrays.status, 'match');
  bay.weaponIndices = [1, 0];
  assert.equal(compareVerificationRows(native, mekbay).graph.machineGunArrays.status, 'mismatch');
  bay.weaponIndices = [0];
  assert.equal(compareVerificationRows(native, mekbay).graph.machineGunArrays.status, 'mismatch');
});
