/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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
 * Entity Load Benchmark Script
 *
 * Loads the equipment database and parses every .mtf / .blk file from the
 * input folder, measuring timing and collecting error statistics.
 *
 * Usage:
 *   npx tsx scripts/benchmark-entity-load.ts [--input PATH] [--type TYPE] [--verbose]
 *
 * Options:
 *   --input  PATH   Root directory of unit files (default: C:\Projects\megamek\svgexport\unitfiles)
 *   --type   TYPE   Filter by entity type: meks|fighters|vehicles|battlearmor|infantry|protomeks|dropships|smallcraft|jumpships|warship|spacestation|ge|handheld|convfighter
 *   --verbose        Print every file result, not just failures
 */

import * as fs from 'fs';
import * as path from 'path';
import { createEquipment, buildEquipmentAliasMap, type EquipmentAliasMap, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { resetMountIdCounter } from '../src/app/models/entity/utils/signal-helpers';

// ═══════════════════════════════════════════════════════════════════════════
// Unsupported UnitTypes - skipped without counting as failures
// ═══════════════════════════════════════════════════════════════════════════

const SKIPPED_UNIT_TYPES = new Set([
  'BuildingEntity',
  'GunEmplacement',
]);

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

const INPUT_DIR = path.resolve(getArg('input', String.raw`C:\Projects\megamek\svgexport\unitfiles`));
const TYPE_FILTER = getArg('type', '');
const VERBOSE = hasFlag('verbose');

// ═══════════════════════════════════════════════════════════════════════════
// Equipment database loading
// ═══════════════════════════════════════════════════════════════════════════

interface EquipmentLoadResult {
  equipmentDb: EquipmentMap;
  aliasMap: EquipmentAliasMap;
  loaded: number;
  failed: number;
  aliases: number;
  timeMs: number;
}

function loadEquipmentDb(): EquipmentLoadResult {
  const fixturesPath = path.join(__dirname, 'fixtures', 'equipment2.json');
  if (!fs.existsSync(fixturesPath)) {
    console.error(`Equipment file not found: ${fixturesPath}`);
    console.error('Copy equipment2.json into scripts/fixtures/');
    process.exit(1);
  }

  const t0 = performance.now();

  const raw: RawEquipmentData = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));
  const equipmentDb: EquipmentMap = {};
  let loaded = 0;
  let failed = 0;

  for (const [internalName, rawEquipment] of Object.entries(raw.equipment)) {
    try {
      equipmentDb[internalName] = createEquipment(rawEquipment);
      loaded++;
    } catch {
      failed++;
    }
  }

  const aliasMap = buildEquipmentAliasMap(equipmentDb);
  const timeMs = performance.now() - t0;

  return { equipmentDb, aliasMap, loaded, failed, aliases: aliasMap.size, timeMs };
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
// Single-file loading
// ═══════════════════════════════════════════════════════════════════════════

interface LoadResult {
  file: string;
  status: 'ok' | 'error';
  entityType?: string;
  error?: string;
  timeMs: number;
}

function loadFile(
  filePath: string,
  equipmentDb: EquipmentMap,
  aliasMap: EquipmentAliasMap,
): LoadResult {
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');

  const t0 = performance.now();
  try {
    resetMountIdCounter();
    const { entity } = parseEntity(content, fileName, equipmentDb, null, aliasMap);
    const timeMs = performance.now() - t0;
    return { file: filePath, status: 'ok', entityType: entity.entityType, timeMs };
  } catch (e: any) {
    const timeMs = performance.now() - t0;
    return { file: filePath, status: 'error', error: e.message, timeMs };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Statistics helpers
// ═══════════════════════════════════════════════════════════════════════════

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Entity Load Benchmark');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Input:  ${INPUT_DIR}`);
  if (TYPE_FILTER) console.log(`Filter: ${TYPE_FILTER}`);
  console.log('');

  // ── Load equipment ──
  console.log('Loading equipment database...');
  const eqResult = loadEquipmentDb();
  console.log(`  Equipment:  ${eqResult.loaded} loaded, ${eqResult.failed} failed, ${eqResult.aliases} aliases`);
  console.log(`  Time:       ${formatMs(eqResult.timeMs)}`);
  console.log('');

  // ── Discover files ──
  let files = findUnitFiles(INPUT_DIR);
  if (TYPE_FILTER) {
    files = files.filter(matchesTypeFilter);
  }
  console.log(`Found ${files.length} unit files\n`);

  if (files.length === 0) {
    console.log('No files to benchmark.');
    return;
  }

  // ── Parse all files ──
  console.log('Parsing unit files...');
  const stats = {
    total: 0,
    ok: 0,
    errors: 0,
    skipped: 0,
  };

  const timings: number[] = [];
  const byType = new Map<string, { count: number; errors: number; totalMs: number; timings: number[] }>();
  const errorList: { file: string; error: string }[] = [];

  const overallStart = performance.now();

  for (const file of files) {
    stats.total++;

    // ── Skip unsupported UnitTypes ──
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

    const result = loadFile(file, eqResult.equipmentDb, eqResult.aliasMap);

    const typeKey = result.entityType ?? 'unknown';
    if (!byType.has(typeKey)) {
      byType.set(typeKey, { count: 0, errors: 0, totalMs: 0, timings: [] });
    }
    const typeStats = byType.get(typeKey)!;

    if (result.status === 'ok') {
      stats.ok++;
      typeStats.count++;
      typeStats.totalMs += result.timeMs;
      typeStats.timings.push(result.timeMs);
      timings.push(result.timeMs);

      if (VERBOSE) {
        console.log(`  ✓ ${formatMs(result.timeMs).padStart(10)}  ${path.relative(INPUT_DIR, file)}`);
      }
    } else {
      stats.errors++;
      typeStats.errors++;
      errorList.push({ file: path.relative(INPUT_DIR, file), error: result.error ?? 'Unknown error' });
      console.log(`  ✗ ERROR  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
    }

    // Progress indicator every 500 files
    if (stats.total % 500 === 0) {
      console.log(`  ... ${stats.total} / ${files.length} processed`);
    }
  }

  const overallMs = performance.now() - overallStart;

  // Sort timings for percentile calculations
  timings.sort((a, b) => a - b);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════

  const tested = stats.total - stats.skipped;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total files:    ${stats.total}`);
  console.log(`  Skipped:        ${stats.skipped}`);
  console.log(`  Tested:         ${tested}`);
  console.log(`  Success:        ${stats.ok}`);
  console.log(`  Errors:         ${stats.errors}`);
  console.log(`  Success rate:   ${tested > 0 ? ((stats.ok / tested) * 100).toFixed(1) : 0}%`);

  // ── Timing summary ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Timing');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Equipment load: ${formatMs(eqResult.timeMs)}`);
  console.log(`  All units:      ${formatMs(overallMs)}`);
  if (timings.length > 0) {
    const totalParseMs = timings.reduce((a, b) => a + b, 0);
    const avgMs = totalParseMs / timings.length;
    const minMs = timings[0];
    const maxMs = timings[timings.length - 1];
    console.log(`  Total parse:    ${formatMs(totalParseMs)}  (CPU time spent parsing)`);
    console.log(`  Average:        ${formatMs(avgMs)} / unit`);
    console.log(`  Median (p50):   ${formatMs(percentile(timings, 50))}`);
    console.log(`  p90:            ${formatMs(percentile(timings, 90))}`);
    console.log(`  p95:            ${formatMs(percentile(timings, 95))}`);
    console.log(`  p99:            ${formatMs(percentile(timings, 99))}`);
    console.log(`  Min:            ${formatMs(minMs)}`);
    console.log(`  Max:            ${formatMs(maxMs)}`);
    console.log(`  Throughput:     ${(timings.length / (overallMs / 1000)).toFixed(0)} units/sec`);
  }

  // ── Per-type breakdown ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  By Entity Type');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const [type, data] of [...byType.entries()].sort()) {
    const total = data.count + data.errors;
    const avg = data.count > 0 ? data.totalMs / data.count : 0;
    data.timings.sort((a, b) => a - b);
    const p50 = percentile(data.timings, 50);
    const icon = data.errors === 0 ? '✓' : '✗';
    console.log(
      `  ${icon} ${type.padEnd(20)} ` +
      `${String(data.count).padStart(5)}/${String(total).padStart(5)} ok  ` +
      `avg ${formatMs(avg).padStart(10)}  ` +
      `p50 ${formatMs(p50).padStart(10)}  ` +
      `${data.errors > 0 ? `(${data.errors} errors)` : ''}`
    );
  }

  // ── Error details ──
  if (errorList.length > 0) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Errors (${errorList.length})`);
    console.log('═══════════════════════════════════════════════════════════════');
    for (const { file, error } of errorList) {
      console.log(`  ${file}`);
      console.log(`    ${error}`);
    }
  }

  console.log('');

  // Exit with error code if there were failures
  if (stats.errors > 0) {
    process.exit(1);
  }
}

main();
