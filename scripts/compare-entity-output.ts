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
 * Entity Output Comparison Script
 *
 * Parses every .mtf / .blk file from the input folder, writes each one out
 * to the output folder preserving the original directory structure and file
 * name, then compares the written output against the original file ignoring
 * comment lines (lines starting with #).
 *
 * Usage:
 *   npx tsx scripts/compare-entity-output.ts [--input PATH] [--output PATH] [--type TYPE] [--fail-fast] [--verbose]
 *
 * Options:
 *   --input  PATH   Root directory of unit files (default: C:\Projects\megamek\svgexport\unitfiles)
 *   --output PATH   Directory to write generated files (default: C:\Projects\megamek\svgexport\mbunitfiles)
 *   --type   TYPE   Filter by entity type: meks|fighters|vehicles|battlearmor|infantry|protomeks|dropships|smallcraft|jumpships|warship|spacestation|ge|handheld|convfighter
 *   --name   TEXT   Filter by chassis/model name (space-separated tokens, all must match, case-insensitive)
 *   --fail-fast      Stop on the first failure
 *   --verbose        Print every file result, not just failures
 */

import * as fs from 'fs';
import * as path from 'path';
import { createEquipment, buildEquipmentAliasMap, type EquipmentAliasMap, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { writeEntity } from '../src/app/models/entity/write-entity';
import { resetMountIdCounter } from '../src/app/models/entity/utils/signal-helpers';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';
import { BaseEntity } from '../src/app/models/entity/base-entity';

/**
 * UnitTypes explicitly skipped - these entity types are not yet supported.
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

const INPUT_DIR = path.resolve(getArg('input', String.raw`C:\Projects\megamek\svgexport\unitfiles`));
const OUTPUT_DIR = path.resolve(getArg('output', String.raw`C:\Projects\megamek\svgexport\mbunitfiles`));
const TYPE_FILTER = getArg('type', '');
const NAME_FILTER = getArg('name', '');
const NAME_TOKENS = NAME_FILTER
  ? NAME_FILTER.toLowerCase().split(/\s+/).filter(Boolean)
  : [];
const FAIL_FAST = hasFlag('fail-fast');
const VERBOSE = hasFlag('verbose');

// ═══════════════════════════════════════════════════════════════════════════
// Equipment database loading
// ═══════════════════════════════════════════════════════════════════════════

function loadEquipmentDb(): { equipmentDb: EquipmentMap; aliasMap: EquipmentAliasMap } {
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

  const aliasMap = buildEquipmentAliasMap(equipmentDb);
  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed, ${aliasMap.size} aliases\n`);
  return { equipmentDb, aliasMap };
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
// Comment-stripping comparison
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fluff field prefixes whose *values* should be trimmed for comparison.
 * The originals sometimes have leading/trailing spaces in these fields;
 * our writer correctly trims them, so we normalise both sides.
 */
const FLUFF_PREFIXES = [
  'overview:', 'capabilities:', 'deployment:', 'history:',
  'manufacturer:', 'primaryfactory:',
  'systemmanufacturer:', 'systemmode:',
  'notes:', 'use:',
];

/**
 * Strip comment lines (starting with #), the MTF generator: line,
 * trim fluff field values, and normalise whitespace for comparison.
 */
function stripForComparison(text: string): string {
  const lines = text.split(/\r?\n/);
  const filtered: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    // Skip comment lines
    if (trimmed.startsWith('#')) continue;
    // Skip MTF generator line (e.g. "generator:MegaMek Suite 0.50.12 on 2026-02-25")
    if (trimmed.startsWith('generator:')) continue;

    // Trim values of fluff fields so whitespace differences are ignored
    const lower = trimmed.toLowerCase();
    let handled = false;
    for (const prefix of FLUFF_PREFIXES) {
      if (lower.startsWith(prefix)) {
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIdx + 1);
        const value = trimmed.substring(colonIdx + 1).trim();
        filtered.push(`${key}${value}`);
        handled = true;
        break;
      }
    }
    if (!handled) {
      filtered.push(line.trimEnd());
    }
  }

  return filtered
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Single-file processing
// ═══════════════════════════════════════════════════════════════════════════

interface CompareResult {
  file: string;
  status: 'match' | 'diff' | 'parse-error' | 'write-error';
  entityType?: string;
  error?: string;
  /** First differing line index (0-based) in the non-comment content */
  firstDiffLine?: number;
  expectedLine?: string;
  actualLine?: string;
  /** The parsed entity, available for diagnostic inspection on diff. */
  entity?: BaseEntity;
}

/**
 * Check whether a file path matches all NAME_TOKENS (checked against the filename).
 * Returns true when there is no name filter or all tokens are found.
 */
function matchesNameFilter(filePath: string): boolean {
  if (NAME_TOKENS.length === 0) return true;
  const haystack = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return NAME_TOKENS.every(token => haystack.includes(token));
}

function processFile(
  filePath: string,
  equipmentDb: EquipmentMap,
  aliasMap: EquipmentAliasMap,
): CompareResult {
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(fileName).toLowerCase();
  const isMtf = ext === '.mtf';

  // ── Parse ──
  let entity;
  try {
    resetMountIdCounter();
    entity = parseEntity(content, fileName, equipmentDb, null, aliasMap).entity;
  } catch (e: any) {
    return { file: filePath, status: 'parse-error', error: `Parse: ${e.message}` };
  }

  // ── Write ──
  let written: string;
  try {
    const format = isMtf && entity instanceof MekEntity ? 'mtf' : 'blk';
    written = writeEntity(entity, format);
  } catch (e: any) {
    return {
      file: filePath, status: 'write-error', entityType: entity.entityType,
      error: `Write: ${e.message}`,
    };
  }

  // ── Save to output dir preserving folder structure ──
  const relPath = path.relative(INPUT_DIR, filePath);
  // For MTF files that are non-Mek entities, the writer produces BLK - adjust extension
  const outRelPath = (isMtf && !(entity instanceof MekEntity))
    ? relPath.replace(/\.mtf$/i, '.blk')
    : relPath;
  const outPath = path.join(OUTPUT_DIR, outRelPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, written, 'utf-8');

  // ── Compare ignoring comments and generator block ──
  const originalStripped = stripForComparison(content);
  const writtenStripped = stripForComparison(written);

  if (originalStripped === writtenStripped) {
    return { file: filePath, status: 'match', entityType: entity.entityType };
  }

  // Find first differing line for reporting
  const origLines = originalStripped.split('\n');
  const writLines = writtenStripped.split('\n');
  const maxLen = Math.max(origLines.length, writLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oLine = origLines[i] ?? '<EOF>';
    const wLine = writLines[i] ?? '<EOF>';
    if (oLine !== wLine) {
      return {
        file: filePath, status: 'diff', entityType: entity.entityType,
        firstDiffLine: i,
        expectedLine: oLine,
        actualLine: wLine,
        entity,
      };
    }
  }

  // Should not reach here, but just in case
  return { file: filePath, status: 'diff', entityType: entity.entityType, entity };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Entity Output Comparison');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (TYPE_FILTER) console.log(`Filter: ${TYPE_FILTER}`);
  if (NAME_FILTER) console.log(`Name:   ${NAME_FILTER}`);
  console.log('');

  // Load equipment
  const { equipmentDb, aliasMap } = loadEquipmentDb();

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

  // Run
  const stats = {
    total: 0,
    match: 0,
    diff: 0,
    parseError: 0,
    writeError: 0,
    skipped: 0,
  };

  const byType = new Map<string, { match: number; diff: number }>();
  const failures: CompareResult[] = [];

  const startTime = Date.now();

  for (const file of files) {
    stats.total++;

    // ── Skip by name filter (filename check, no parsing needed) ──
    if (!matchesNameFilter(file)) {
      stats.skipped++;
      continue;
    }

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

    const result = processFile(file, equipmentDb, aliasMap);

    const typeKey = result.entityType ?? 'unknown';
    if (!byType.has(typeKey)) byType.set(typeKey, { match: 0, diff: 0 });

    switch (result.status) {
      case 'match':
        stats.match++;
        byType.get(typeKey)!.match++;
        if (VERBOSE) {
          console.log(`  ✓ ${path.relative(INPUT_DIR, file)}`);
        }
        break;
      case 'diff':
        stats.diff++;
        byType.get(typeKey)!.diff++;
        failures.push(result);
        console.log(`  ✗ DIFF   ${path.relative(INPUT_DIR, file)}  (line ${result.firstDiffLine})`);
        console.log(`           megamek: ${truncate(result.expectedLine ?? '', 100)}`);
        console.log(`           mekbay:   ${truncate(result.actualLine ?? '', 100)}`);
        if (result.entity) {
          const reasons = result.entity.mixedTechReasons();
          if (reasons.length > 0) {
            console.log(`           mixedTech: ${reasons.join('; ')}`);
          }
        }
        break;
      case 'parse-error':
        stats.parseError++;
        byType.get(typeKey)!.diff++;
        failures.push(result);
        console.log(`  ✗ PARSE  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
        break;
      case 'write-error':
        stats.writeError++;
        byType.get(typeKey)!.diff++;
        failures.push(result);
        console.log(`  ✗ WRITE  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
        break;
    }

    if (FAIL_FAST && result.status !== 'match') {
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
  console.log(`  Match:        ${stats.match}`);
  console.log(`  Diff:         ${stats.diff}`);
  console.log(`  Parse errors: ${stats.parseError}`);
  console.log(`  Write errors: ${stats.writeError}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log(`  Match rate:   ${tested > 0 ? ((stats.match / tested) * 100).toFixed(1) : 0}%`);

  // ── Per-type breakdown ──
  console.log('\n  By Entity Type:');
  for (const [type, counts] of [...byType.entries()].sort()) {
    const total = counts.match + counts.diff;
    const pct = total > 0 ? ((counts.match / total) * 100).toFixed(1) : '0.0';
    const icon = counts.diff === 0 ? '✓' : '✗';
    console.log(`    ${icon} ${type.padEnd(20)} ${counts.match}/${total} (${pct}%)`);
  }

  console.log('');

  // Exit code
  const totalFail = stats.diff + stats.parseError + stats.writeError;
  if (totalFail > 0) {
    console.log(`${totalFail} file(s) differ from original. Output written to: ${OUTPUT_DIR}`);
    process.exit(1);
  } else {
    console.log('All files match the originals (ignoring comments)! ✓');
  }
}

/** Truncate a string for display */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

main();
