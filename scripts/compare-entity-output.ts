// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Entity Output Comparison Script
 *
 * Parses every .mtf / .blk file from the input folder, writes each one out
 * to the output folder preserving the original directory structure and file
 * name, then compares the written output against the original file. The only
 * ignored rows are rows that literally start with `#` or `generator:`.
 *
 * Usage:
 *   npx tsx scripts/compare-entity-output.ts [--input PATH] [--output PATH] [--type TYPE] [--fail-fast] [--verbose]
 *
 * Options:
 *   --input  PATH   Root directory of unit files (default: sibling mm-data/data/mekfiles)
 *   --output PATH   Directory to write generated files (default: .tmp/entity-compare-all)
 *   --type   TYPE   Filter by entity type: meks|fighters|vehicles|battlearmor|infantry|protomeks|dropships|smallcraft|jumpships|warship|spacestation|ge|handheld|convfighter
 *   --name   TEXT   Filter by chassis/model name (space-separated tokens, all must match, case-insensitive)
 *   --fail-fast      Stop on the first failure
 *   --verbose        Print every file result, not just failures
 */

import * as fs from 'fs';
import * as path from 'path';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import { createEquipment, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { encodeNativeEntity } from '../src/app/models/entity/write-entity';
import type { BaseEntity } from '../src/app/models/entity/base-entity';
import { loadQuirkResolver } from './quirk-fixture';
import { nativeEntityComparisonRows } from './lib/native-entity-comparison';

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const INPUT_DIR = path.resolve(getArg(
  'input',
  path.resolve(__dirname, '..', '..', 'mm-data', 'data', 'mekfiles'),
));
const OUTPUT_DIR = path.resolve(getArg(
  'output',
  path.resolve(__dirname, '..', '.tmp', 'entity-compare-all'),
));
const TYPE_FILTER = getArg('type', '');
const NAME_FILTER = getArg('name', '');
const NAME_TOKENS = NAME_FILTER
  ? NAME_FILTER.toLowerCase().split(/\s+/).filter(Boolean)
  : [];
const FAIL_FAST = hasFlag('fail-fast');
const VERBOSE = hasFlag('verbose');
const quirkResolver = loadQuirkResolver();

// ═══════════════════════════════════════════════════════════════════════════
// Equipment database loading
// ═══════════════════════════════════════════════════════════════════════════

function loadEquipmentRegistry(): EquipmentRegistry {
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

  const registry = new EquipmentRegistry(equipmentDb);
  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed, ${registry.lookupKeyCount} lookup keys\n`);
  return registry;
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

// ═══════════════════════════════════════════════════════════════════════════
// Single-file processing
// ═══════════════════════════════════════════════════════════════════════════

interface CompareResult {
  file: string;
  status: 'match' | 'skipped' | 'diff' | 'parse-error' | 'write-error';
  entityType?: string;
  error?: string;
  /** First differing row index after removing the two explicitly ignored row forms. */
  firstDiffLine?: number;
  expectedLine?: string;
  actualLine?: string;
  /** The parsed entity, available for diagnostic inspection on diff. */
  entity?: BaseEntity;
  /** Parser and encoder evidence retained even when the file is skipped or blocked. */
  diagnostics?: readonly string[];
}

const createdOutputDirectories = new Set<string>();

/**
 * Check whether a file path matches all NAME_TOKENS (checked against the filename).
 * Returns true when there is no name filter or all tokens are found.
 */
function matchesNameFilter(filePath: string): boolean {
  if (NAME_TOKENS.length === 0) return true;
  const haystack = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return NAME_TOKENS.every(token => haystack.includes(token));
}

async function processFile(
  filePath: string,
  equipmentRegistry: EquipmentRegistry,
  contentOverride?: string,
): Promise<CompareResult> {
  const fileName = path.basename(filePath);
  const content = contentOverride ?? fs.readFileSync(filePath, 'utf-8');
  const diagnostics: string[] = [];

  // ── Parse ──
  let entity;
  try {
    const parsed = parseEntity(content, fileName, equipmentRegistry, { quirkResolver });
    entity = parsed.entity;
    diagnostics.push(...parsed.diagnostics.map(diagnostic =>
      `parse ${diagnostic.severity} ${diagnostic.field}: ${diagnostic.message}`));
    if (parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
      return {
        file: filePath,
        status: 'parse-error',
        entityType: entity.entityType,
        error: 'Parse produced error diagnostics',
        diagnostics,
      };
    }
  } catch (caught) {
    return { file: filePath, status: 'parse-error', error: `Parse: ${errorMessage(caught)}`, diagnostics };
  }

  // ── Write ──
  let written: string;
  try {
    written = encodeNativeEntity(entity);
  } catch (caught) {
    return {
      file: filePath, status: 'write-error', entityType: entity.entityType,
      error: `Write: ${errorMessage(caught)}`, diagnostics,
    };
  }

  // ── Save to output dir preserving folder structure ──
  const relPath = path.relative(INPUT_DIR, filePath);
  const outRelPath = relPath;
  const outPath = path.join(OUTPUT_DIR, outRelPath);
  const outDir = path.dirname(outPath);
  if (!createdOutputDirectories.has(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    createdOutputDirectories.add(outDir);
  }
  fs.writeFileSync(outPath, written, 'utf-8');

  // ── Bidirectional exact row comparison after the two explicit exclusions ──
  const origLines = nativeEntityComparisonRows(content);
  const writLines = nativeEntityComparisonRows(written);
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
        diagnostics,
      };
    }
  }

  return { file: filePath, status: 'match', entityType: entity.entityType, diagnostics };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printDiagnostics(result: CompareResult): void {
  for (const diagnostic of result.diagnostics ?? []) console.log(`           ! ${diagnostic}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Entity Output Comparison');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (TYPE_FILTER) console.log(`Filter: ${TYPE_FILTER}`);
  if (NAME_FILTER) console.log(`Name:   ${NAME_FILTER}`);
  console.log('');

  // Load equipment
  const equipmentRegistry = loadEquipmentRegistry();

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
    diagnostics: 0,
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

    const result = await processFile(file, equipmentRegistry);
    stats.diagnostics += result.diagnostics?.length ?? 0;

    const typeKey = result.entityType ?? 'unknown';
    if (!byType.has(typeKey)) byType.set(typeKey, { match: 0, diff: 0 });

    switch (result.status) {
      case 'skipped':
        stats.skipped++;
        if (VERBOSE) {
          console.log(`  - ${path.relative(INPUT_DIR, file)} (${result.error})`);
          printDiagnostics(result);
        }
        break;
      case 'match':
        stats.match++;
        byType.get(typeKey)!.match++;
        if (VERBOSE) {
          console.log(`  ✓ ${path.relative(INPUT_DIR, file)}`);
          printDiagnostics(result);
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
          // const reasons = result.entity.mixedTechReasons();
          // if (reasons.length > 0) {
          //   console.log(`           mixedTech: ${reasons.join('; ')}`);
          // }
        }
        printDiagnostics(result);
        break;
      case 'parse-error':
        stats.parseError++;
        byType.get(typeKey)!.diff++;
        failures.push(result);
        console.log(`  ✗ PARSE  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
        printDiagnostics(result);
        break;
      case 'write-error':
        stats.writeError++;
        byType.get(typeKey)!.diff++;
        failures.push(result);
        console.log(`  ✗ WRITE  ${path.relative(INPUT_DIR, file)}: ${result.error}`);
        printDiagnostics(result);
        break;
    }

    if (FAIL_FAST && result.status !== 'match' && result.status !== 'skipped') {
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
  console.log(`  Diagnostics retained: ${stats.diagnostics}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log(`  Match rate:   ${tested > 0 ? ((stats.match / tested) * 100).toFixed(1) : 0}%`);

  // ── Per-type breakdown ──
  const testedTypes = [...byType.entries()]
    .filter(([, counts]) => counts.match + counts.diff > 0)
    .sort();
  if (testedTypes.length > 0) console.log('\n  By Entity Type:');
  for (const [type, counts] of testedTypes) {
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
  } else if (tested === 0) {
    console.log('No capability-enabled native encode cells were tested; unsupported cells were skipped.');
  } else {
    console.log('All files match exactly after excluding # and generator: rows! ✓');
  }
}

/** Truncate a string for display */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
