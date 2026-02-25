/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/**
 * Entity System – Round-trip Verification Script (Phase 8)
 *
 * Walks the mm-data corpus, parses every .mtf / .blk file, writes it back,
 * re-parses the output, writes again, and compares the two serialised forms.
 * If they match, the round-trip is lossless.
 *
 * Usage:
 *   npx tsx scripts/verify-entity-roundtrip.ts [--input PATH] [--output PATH] [--type TYPE] [--fail-fast] [--verbose]
 *
 * Options:
 *   --input  PATH   Root directory of unit files (default: ../mm-data/data/mekfiles)
 *   --output PATH   Directory to write diff files for failures (default: ./tmp/roundtrip)
 *   --type   TYPE   Filter by entity type: meks|fighters|vehicles|battlearmor|infantry|protomeks|dropships|smallcraft|jumpships|warship|spacestation|ge|handheld|convfighter
 *   --fail-fast      Stop on the first failure
 *   --verbose        Print every file result, not just failures
 */

import * as fs from 'fs';
import * as path from 'path';
import { createEquipment, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { writeEntity } from '../src/app/models/entity/write-entity';
import { resetMountIdCounter } from '../src/app/models/entity/utils/signal-helpers';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';

/**
 * UnitTypes explicitly skipped — these entity types are not yet supported.
 * Files with these types are counted separately and do NOT count as failures.
 */
const SKIPPED_UNIT_TYPES = new Set([
  'BuildingEntity',
  'GunEmplacement',
]);

/** Extract the UnitType string from a raw BLK file without full parsing. */
function peekBlkUnitType(content: string): string | null {
  const match = content.match(/<UnitType>\s*([^<\r\n]+)/i);
  return match ? match[1].trim() : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const INPUT_DIR = path.resolve(getArg('input', path.join(__dirname, '..', '..', '..', 'mm-data', 'data', 'mekfiles')));
const OUTPUT_DIR = path.resolve(getArg('output', path.join(__dirname, '..', 'tmp', 'roundtrip')));
const TYPE_FILTER = getArg('type', '');
const FAIL_FAST = hasFlag('fail-fast');
const VERBOSE = hasFlag('verbose');

// ═══════════════════════════════════════════════════════════════════════════
// Equipment database loading
// ═══════════════════════════════════════════════════════════════════════════

function loadEquipmentDb(): EquipmentMap {
  const fixturesPath = path.join(__dirname, 'fixtures', 'equipment2.json');
  if (!fs.existsSync(fixturesPath)) {
    console.error(`Equipment file not found: ${fixturesPath}`);
    console.error('Copy equipment2.json into scripts/fixtures/');
    process.exit(1);
  }

  const raw: RawEquipmentData = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));
  const equipmentDb: EquipmentMap = {};
  let loaded = 0;
  let failed = 0;

  for (const [internalName, rawEquipment] of Object.entries(raw.equipment)) {
    try {
      equipmentDb[internalName] = createEquipment(rawEquipment);
      loaded++;
    } catch (error) {
      failed++;
    }
  }

  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed\n`);
  return equipmentDb;
}

// ═══════════════════════════════════════════════════════════════════════════
// File discovery
// ═══════════════════════════════════════════════════════════════════════════

function findUnitFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.mtf' || ext === '.blk') {
          results.push(full);
        }
      }
    }
  }

  walk(dir);
  return results.sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// Type filter mapping
// ═══════════════════════════════════════════════════════════════════════════

/** Map CLI --type values to directory path fragments */
const TYPE_DIR_MAP: Record<string, string[]> = {
  meks:          ['meks'],
  fighters:      ['fighters'],
  vehicles:      ['vehicles'],
  battlearmor:   ['battlearmor'],
  infantry:      ['infantry'],
  protomeks:     ['protomeks'],
  dropships:     ['dropships'],
  smallcraft:    ['smallcraft'],
  jumpships:     ['jumpships'],
  warship:       ['warship'],
  spacestation:  ['spacestation'],
  ge:            ['ge'],
  handheld:      ['handheld'],
  convfighter:   ['convfighter'],
};

function matchesTypeFilter(filePath: string): boolean {
  if (!TYPE_FILTER) return true;
  const fragments = TYPE_DIR_MAP[TYPE_FILTER.toLowerCase()];
  if (!fragments) {
    console.error(`Unknown --type: ${TYPE_FILTER}. Valid: ${Object.keys(TYPE_DIR_MAP).join(', ')}`);
    process.exit(1);
  }
  const normalised = filePath.replace(/\\/g, '/').toLowerCase();
  return fragments.some(f => normalised.includes(`/${f}/`));
}

// ═══════════════════════════════════════════════════════════════════════════
// Normalisation – strip mount IDs and whitespace jitter for comparison
// ═══════════════════════════════════════════════════════════════════════════

function normalise(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())   // trailing whitespace
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')   // collapse multiple blank lines
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Round-trip verification for a single file
// ═══════════════════════════════════════════════════════════════════════════

interface VerifyResult {
  file: string;
  status: 'pass' | 'parse-error' | 'write-error' | 'diff';
  entityType?: string;
  error?: string;
  write1?: string;
  write2?: string;
}

function verifyFile(filePath: string, equipmentDb: EquipmentMap): VerifyResult {
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(fileName).toLowerCase();

  // Determine write format
  const isMtf = ext === '.mtf';

  // ── Pass 1: Parse original ──
  let entity1;
  try {
    resetMountIdCounter();
    entity1 = parseEntity(content, fileName, equipmentDb);
  } catch (e: any) {
    return { file: filePath, status: 'parse-error', error: `Pass1 parse: ${e.message}` };
  }

  // ── Pass 1: Write ──
  let written1: string;
  try {
    const format = isMtf && entity1 instanceof MekEntity ? 'mtf' : 'blk';
    written1 = writeEntity(entity1, format);
  } catch (e: any) {
    return {
      file: filePath, status: 'write-error', entityType: entity1.entityType,
      error: `Pass1 write: ${e.message}`,
    };
  }

  // ── Pass 2: Parse the written output ──
  let entity2;
  try {
    resetMountIdCounter();
    const pass2Name = isMtf && entity1 instanceof MekEntity ? fileName : fileName.replace(/\.mtf$/i, '.blk');
    entity2 = parseEntity(written1, pass2Name, equipmentDb);
  } catch (e: any) {
    return {
      file: filePath, status: 'parse-error', entityType: entity1.entityType,
      error: `Pass2 parse: ${e.message}`, write1: written1,
    };
  }

  // ── Pass 2: Write again ──
  let written2: string;
  try {
    const format = isMtf && entity2 instanceof MekEntity ? 'mtf' : 'blk';
    written2 = writeEntity(entity2, format);
  } catch (e: any) {
    return {
      file: filePath, status: 'write-error', entityType: entity2.entityType,
      error: `Pass2 write: ${e.message}`, write1: written1,
    };
  }

  // ── Compare ──
  const norm1 = normalise(written1);
  const norm2 = normalise(written2);

  if (norm1 === norm2) {
    return { file: filePath, status: 'pass', entityType: entity1.entityType };
  }

  return {
    file: filePath, status: 'diff', entityType: entity1.entityType,
    write1: written1, write2: written2,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Diff writing
// ═══════════════════════════════════════════════════════════════════════════

function writeDiffFiles(result: VerifyResult): void {
  if (!result.write1 && !result.write2) return;

  const relPath = path.relative(INPUT_DIR, result.file).replace(/\\/g, '__');
  const base = path.join(OUTPUT_DIR, relPath);

  fs.mkdirSync(path.dirname(base), { recursive: true });

  if (result.write1) fs.writeFileSync(base + '.pass1', result.write1, 'utf-8');
  if (result.write2) fs.writeFileSync(base + '.pass2', result.write2, 'utf-8');
  if (result.error) fs.writeFileSync(base + '.error', result.error, 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Entity System – Round-trip Verification');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (TYPE_FILTER) console.log(`Filter: ${TYPE_FILTER}`);
  console.log('');

  // Load equipment
  const equipmentDb = loadEquipmentDb();

  // Find files
  let files = findUnitFiles(INPUT_DIR);
  if (TYPE_FILTER) {
    files = files.filter(matchesTypeFilter);
  }
  console.log(`Found ${files.length} unit files\n`);

  if (files.length === 0) {
    console.log('No files to verify.');
    return;
  }

  // Ensure output dir
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Run verification
  const stats = {
    total: 0,
    pass: 0,
    parseError: 0,
    writeError: 0,
    diff: 0,
    skipped: 0,
  };

  const byType = new Map<string, { pass: number; fail: number }>();
  const failures: VerifyResult[] = [];

  const startTime = Date.now();

  for (const file of files) {
    stats.total++;

    // ── Skip unsupported UnitTypes before parsing ──
    if (file.toLowerCase().endsWith('.blk')) {
      const raw = fs.readFileSync(file, 'utf-8');
      const unitType = peekBlkUnitType(raw);
      if (unitType && SKIPPED_UNIT_TYPES.has(unitType)) {
        stats.skipped++;
        if (VERBOSE) {
          console.log(`  ⊘ SKIP   ${path.relative(INPUT_DIR, file)} (${unitType})`);
        }
        continue;
      }
    }

    const result = verifyFile(file, equipmentDb);

    const typeKey = result.entityType ?? 'unknown';
    if (!byType.has(typeKey)) byType.set(typeKey, { pass: 0, fail: 0 });

    switch (result.status) {
      case 'pass':
        stats.pass++;
        byType.get(typeKey)!.pass++;
        if (VERBOSE) {
          console.log(`  ✓ ${path.relative(INPUT_DIR, file)}`);
        }
        break;
      case 'parse-error':
        stats.parseError++;
        byType.get(typeKey)!.fail++;
        failures.push(result);
        console.log(`  ✗ PARSE  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
        writeDiffFiles(result);
        break;
      case 'write-error':
        stats.writeError++;
        byType.get(typeKey)!.fail++;
        failures.push(result);
        console.log(`  ✗ WRITE  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
        writeDiffFiles(result);
        break;
      case 'diff':
        stats.diff++;
        byType.get(typeKey)!.fail++;
        failures.push(result);
        console.log(`  ✗ DIFF   ${path.relative(INPUT_DIR, file)}`);
        writeDiffFiles(result);
        break;
    }

    if (FAIL_FAST && result.status !== 'pass') {
      console.log('\n--fail-fast: stopping at first failure');
      break;
    }

    // Progress indicator every 500 files
    if (stats.total % 500 === 0) {
      console.log(`  ... ${stats.total} / ${files.length} processed`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  const tested = stats.total - stats.skipped;
  console.log(`  Total:        ${stats.total}`);
  console.log(`  Skipped:      ${stats.skipped}`);
  console.log(`  Tested:       ${tested}`);
  console.log(`  Pass:         ${stats.pass}`);
  console.log(`  Parse errors: ${stats.parseError}`);
  console.log(`  Write errors: ${stats.writeError}`);
  console.log(`  Diff (lossy): ${stats.diff}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log(`  Pass rate:    ${tested > 0 ? ((stats.pass / tested) * 100).toFixed(1) : 0}%`);

  // ── Per-type breakdown ──
  console.log('\n  By Entity Type:');
  for (const [type, counts] of [...byType.entries()].sort()) {
    const total = counts.pass + counts.fail;
    const pct = total > 0 ? ((counts.pass / total) * 100).toFixed(1) : '0.0';
    const icon = counts.fail === 0 ? '✓' : '✗';
    console.log(`    ${icon} ${type.padEnd(20)} ${counts.pass}/${total} (${pct}%)`);
  }

  console.log('');

  // Exit code
  const totalFail = stats.parseError + stats.writeError + stats.diff;
  if (totalFail > 0) {
    console.log(`${totalFail} failure(s). Diff files written to: ${OUTPUT_DIR}`);
    process.exit(1);
  } else {
    console.log('All files passed! ✓');
  }
}

main();
