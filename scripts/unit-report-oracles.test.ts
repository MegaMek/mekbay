import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  findReport,
  indexReportDirectory,
  parseAlphaStrikeReport,
  parseTechLevelReport,
  normalizeTechBaseDescription,
  parseWeightReport,
} from './unit-report-oracles';

function assertThrowsMessage(action: () => unknown, expected: RegExp): void {
  assert.throws(action, error => error instanceof Error && expected.test(error.message));
}

assert.equal(normalizeTechBaseDescription('Mixed (Inner Sphere base)'), 'Mixed');
assert.equal(normalizeTechBaseDescription('Mixed (Clan base)'), 'Mixed');
assert.equal(normalizeTechBaseDescription('Clan'), 'Clan');

function main(): void {
  assert.deepEqual(parseWeightReport('Weight: 100.0 (99.5)'), {
    calculatedWeight: 99.5,
  });
  assert.deepEqual(parseWeightReport('Weight: 27.0 is less than 30.0'), {
    calculatedWeight: 27,
  });
  assert.deepEqual(parseWeightReport('Weight: 31.0 is greater than 30.0'), {
    calculatedWeight: 31,
  });
  assert.deepEqual(parseWeightReport('Weight: 10000.0 kg (9750.0 kg)'), {
    calculatedWeight: 9.75,
  });
  assert.deepEqual(parseWeightReport(`Weight Calculation for Test
   Final Weight:     round up to nearest half ton     2.5 t`), {
    calculatedWeight: 2.5,
  });
  assertThrowsMessage(() => parseWeightReport('Weight: 10000 kg (9.5)'), /inconsistent units/);
  assertThrowsMessage(() => parseWeightReport('Weight: unknown'), /Weight line/);

  const tech = parseTechLevelReport(`Composite Tech Level - Test
  Tech base:          Inner Sphere
  Introduction year:  2755
  Evaluation year:    3060
  Tech level rule:    Variable Tech Level

Unit result
  Static tech level:            Standard
  Variable tech level in 3060:  Advanced
  Prototype:                    2700
  Production:                   2710+
  Common:                       2750+
  Extinct:                      --
  Effective tech level:         Advanced`);
  assert.deepEqual(tech, {
    techBase: 'Inner Sphere',
    introductionYear: 2755,
    evaluationYear: 3060,
    rule: 'Variable Tech Level',
    staticLevel: 'Standard',
    variableLevelYear: 3060,
    variableLevel: 'Advanced',
    effectiveLevel: 'Advanced',
    prototype: '2700',
    production: '2710+',
    common: '2750+',
    extinct: '--',
  });
  assertThrowsMessage(() => parseTechLevelReport('Unit result'), /Variable tech level/);

  const alphaStrike = parseAlphaStrikeReport(`Alpha Strike Conversion for Test
Basic Info:
   Chassis:                    Atlas
   Model:                      AS7-D
   MUL ID:                     140
   Unit Type:                  Biped Mek                            BM
   Size:                       Weight >= 80t                         4
Movement:
   TMM                         of 6                                  1
Armor:
   Final Armor Value           304 / 30, round normal             = 10
Structure:
   Structure                                                         8
Damage Conversion:
   Final S damage:             4.19, rt, ru                        = 5
   Final M damage:             4.762, rt, ru                       = 5
   Final L damage:             1.2, rt, ru                         = 2
   Damage difference           5 - 3                              OV 2
Point Value:
   Base Point Value            round normal                         52`);
  assert.deepEqual(alphaStrike, {
    chassis: 'Atlas',
    model: 'AS7-D',
    mulId: 140,
    typeCode: 'BM',
    size: 4,
    tmm: 1,
    armor: 10,
    structure: 8,
    threshold: undefined,
    damage: { dmgS: '5', dmgM: '5', dmgL: '2', dmgE: '0' },
    overheat: 2,
    pointValue: 52,
    usesArcs: false,
  });

  const arcUnit = parseAlphaStrikeReport(`
Basic Info:
   Chassis:                       Aegis Heavy Cruiser
   Model:                         (2372)
   MUL ID:                        3670
   Unit Type:                     WarShip                                                        WS
   Size:                          WarShip < 800000t                                               2
Armor:
   Final Armor Value              Capital: 0.33 x 586, round normal                           = 193
Structure:
   WS                             (SI)                                                         75.0
Threshold:
   Threshold                      193 / 3 / 4, round up                                        = 16
Damage Conversion:
   --- Front Arc CAP Damage:
Point Value:
   Base Point Value               round normal                                                  466`);
  assert.equal(arcUnit.usesArcs, true);
  assert.equal(arcUnit.structure, undefined);
  assert.equal(arcUnit.threshold, 16);
  assert.equal(arcUnit.damage, undefined);
  assertThrowsMessage(() => parseAlphaStrikeReport(`
   Chassis: X
   Model:
   MUL ID: 1
  Unit Type: Handheld Weapon  UNKNOWN
   Size: Unknown 1
   Final Armor Value = 0
   Base Point Value 0`), /UNKNOWN/);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-reports-'));
  try {
    fs.writeFileSync(path.join(temporaryDirectory, 'BMAtlas_AS7D.txt'), 'test');
    fs.writeFileSync(path.join(temporaryDirectory, 'ignore.json'), '{}');
    const index = indexReportDirectory(temporaryDirectory);
    assert.equal(findReport(index, 'BMAtlas_AS7D'), path.join(temporaryDirectory, 'BMAtlas_AS7D.txt'));
    assert.equal(findReport(index, 'bmatlas_as7d'), path.join(temporaryDirectory, 'BMAtlas_AS7D.txt'));
    assert.equal(findReport(index, 'missing'), undefined);
    assertThrowsMessage(() => findReport(index, '../escape'), /Invalid report unit name/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  assertThrowsMessage(() => indexReportDirectory(path.join(os.tmpdir(), 'missing-report-directory')), /not found/);

  console.log('[unit-report-oracles] parser and index tests passed');
}

main();
