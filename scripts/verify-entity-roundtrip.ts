// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Entity System Generated-output Idempotence Verification Script
 *
 * Walks the mm-data corpus, parses every .mtf / .blk file, writes it back,
 * re-parses the output, writes again, and compares the two serialised forms.
 * A match proves generated output is stable after the first normalization;
 * it does not prove that the first write preserves every source-file detail.
 * For that there is compare-entity-output.ts
 *
 * Usage:
 *   npx tsx scripts/verify-entity-roundtrip.ts [--input PATH] [--output PATH] [--type TYPE] [--fail-fast] [--profile] [--verbose]
 *
 * Options:
 *   --input  PATH   Unit file or root directory (default: ..\..\mm-data\data\mekfiles)
 *   --output PATH   Directory to write diff files for failures (default: ..\..\tmp\roundtrip)
 *   --type   TYPE   Filter by entity type: meks|fighters|vehicles|battlearmor|infantry|protomeks|dropships|smallcraft|jumpships|warship|spacestation|ge|handheld|convfighter
 *   --fail-fast      Stop on the first failure
 *   --profile        Print cumulative timing by verification phase
 *   --verbose        Print every file result, not just failures
 */

import * as fs from 'fs';
import * as path from 'path';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import { createEquipment, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { encodeNativeEntity } from '../src/app/models/entity/write-entity';
import { loadQuirkResolver } from './quirk-fixture';

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const INPUT_DIR = path.resolve(getArg('input', String.raw`..\..\mm-data\data\mekfiles`));
const OUTPUT_DIR = path.resolve(getArg('output', String.raw`..\..\tmp\roundtrip`));
const TYPE_FILTER = getArg('type', '');
const FAIL_FAST = hasFlag('fail-fast');
const PROFILE = hasFlag('profile');
const VERBOSE = hasFlag('verbose');
const READ_BATCH_SIZE = 16;
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
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) {
    const ext = path.extname(dir).toLowerCase();
    return ext === '.mtf' || ext === '.blk' ? [dir] : [];
  }

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
// Generated-output idempotence verification for a single file
// ═══════════════════════════════════════════════════════════════════════════

interface VerifyResult {
  file: string;
  status: 'pass' | 'parse-error' | 'write-error' | 'diff';
  entityType?: string;
  error?: string;
  write1?: string;
  write2?: string;
  timings?: VerifyTimings;
  diagnostics?: string[];
}

interface VerifyTimings {
  read: number;
  parse1: number;
  write1: number;
  parse2: number;
  write2: number;
  normalise: number;
}

async function verifyFile(
  filePath: string,
  content: string,
  equipmentRegistry: EquipmentRegistry,
): Promise<VerifyResult> {
  const timings: VerifyTimings = { read: 0, parse1: 0, write1: 0, parse2: 0, write2: 0, normalise: 0 };
  let phaseStart = performance.now();
  const fileName = path.basename(filePath);
  const diagnostics: string[] = [];

  // ── Pass 1: Parse original ──
  let entity1;
  try {
    phaseStart = performance.now();
    const parsed = parseEntity(content, fileName, equipmentRegistry, { quirkResolver });
    entity1 = parsed.entity;
    diagnostics.push(...parsed.diagnostics.map(diagnostic =>
      `pass1 ${diagnostic.severity} ${diagnostic.field}: ${diagnostic.message}`));
    if (parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
      return {
        file: filePath,
        status: 'parse-error',
        entityType: entity1.entityType,
        error: 'Pass1 produced parser errors',
        diagnostics,
        timings,
      };
    }
    timings.parse1 = performance.now() - phaseStart;
  } catch (caught) {
    return {
      file: filePath,
      status: 'parse-error',
      error: `Pass1 parse: ${errorMessage(caught)}`,
      diagnostics,
      timings,
    };
  }

  // ── Pass 1: Write ──
  let written1: string;
  try {
    phaseStart = performance.now();
    written1 = encodeNativeEntity(entity1);
    timings.write1 = performance.now() - phaseStart;
  } catch (caught) {
    return {
      file: filePath, status: 'write-error', entityType: entity1.entityType,
      error: `Pass1 write: ${errorMessage(caught)}`, diagnostics, timings,
    };
  }
  // ── Pass 2: Parse the written output ──
  let entity2;
  try {
    phaseStart = performance.now();
    const parsed = parseEntity(written1, fileName, equipmentRegistry, { quirkResolver });
    entity2 = parsed.entity;
    diagnostics.push(...parsed.diagnostics.map(diagnostic =>
      `pass2 ${diagnostic.severity} ${diagnostic.field}: ${diagnostic.message}`));
    if (parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
      return {
        file: filePath,
        status: 'parse-error',
        entityType: entity1.entityType,
        error: 'Pass2 produced parser errors',
        write1: written1,
        diagnostics,
        timings,
      };
    }
    timings.parse2 = performance.now() - phaseStart;
  } catch (caught) {
    return {
      file: filePath, status: 'parse-error', entityType: entity1.entityType,
      error: `Pass2 parse: ${errorMessage(caught)}`, write1: written1, diagnostics, timings,
    };
  }

  // ── Pass 2: Write again ──
  let written2: string;
  try {
    phaseStart = performance.now();
    written2 = encodeNativeEntity(entity2);
    timings.write2 = performance.now() - phaseStart;
  } catch (caught) {
    return {
      file: filePath, status: 'write-error', entityType: entity2.entityType,
      error: `Pass2 write: ${errorMessage(caught)}`, write1: written1, diagnostics, timings,
    };
  }
  // ── Compare ──
  phaseStart = performance.now();
  const norm1 = normalise(written1);
  const norm2 = normalise(written2);
  timings.normalise = performance.now() - phaseStart;

  if (norm1 === norm2) {
    return { file: filePath, status: 'pass', entityType: entity1.entityType, diagnostics, timings };
  }

  return {
    file: filePath, status: 'diff', entityType: entity1.entityType,
    write1: written1, write2: written2, timings,
    diagnostics,
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
  if (result.diagnostics?.length) {
    fs.writeFileSync(base + '.diagnostics', result.diagnostics.join('\n') + '\n', 'utf-8');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Entity System – Generated-output Idempotence Verification');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (TYPE_FILTER) console.log(`Filter: ${TYPE_FILTER}`);
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

  // Ensure output dir
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Run verification
  const stats = {
    total: 0,
    pass: 0,
    parseError: 0,
    writeError: 0,
    diff: 0,
    diagnostics: 0,
  };

  const byType = new Map<string, { pass: number; fail: number }>();
  const failures: VerifyResult[] = [];
  const profileTotals: VerifyTimings = { read: 0, parse1: 0, write1: 0, parse2: 0, write2: 0, normalise: 0 };

  const startTime = Date.now();

  let stoppedEarly = false;
  for (let offset = 0; offset < files.length && !stoppedEarly; offset += READ_BATCH_SIZE) {
    const batchFiles = files.slice(offset, offset + READ_BATCH_SIZE);
    const readStart = performance.now();
    const batchContents = await Promise.all(batchFiles.map(file => fs.promises.readFile(file, 'utf-8')));
    profileTotals.read += performance.now() - readStart;

    for (let batchIndex = 0; batchIndex < batchFiles.length; batchIndex++) {
      const file = batchFiles[batchIndex];
      const content = batchContents[batchIndex];
      stats.total++;

      const result = await verifyFile(file, content, equipmentRegistry);
      stats.diagnostics += result.diagnostics?.length ?? 0;
      if (result.timings) {
        for (const phase of Object.keys(profileTotals) as (keyof VerifyTimings)[]) {
          profileTotals[phase] += result.timings[phase];
        }
      }

      const typeKey = result.entityType ?? 'unknown';
      if (!byType.has(typeKey)) byType.set(typeKey, { pass: 0, fail: 0 });

      switch (result.status) {
        case 'pass':
          stats.pass++;
          byType.get(typeKey)!.pass++;
          if (VERBOSE) {
            console.log(`  ✓ ${path.relative(INPUT_DIR, file)}`);
            for (const diagnostic of result.diagnostics ?? []) {
              console.log(`      ! ${diagnostic}`);
            }
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
        stoppedEarly = true;
        break;
      }

      // Progress indicator every 500 files
      if (stats.total % 500 === 0) {
        console.log(`  ... ${stats.total} / ${files.length} processed`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total:        ${stats.total}`);
  console.log(`  Pass:         ${stats.pass}`);
  console.log(`  Parse errors: ${stats.parseError}`);
  console.log(`  Write errors: ${stats.writeError}`);
  console.log(`  Diff (unstable): ${stats.diff}`);
  console.log(`  Parser diagnostics retained: ${stats.diagnostics}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log(`  Pass rate:    ${stats.total > 0 ? ((stats.pass / stats.total) * 100).toFixed(1) : 0}%`);

  // ── Per-type breakdown ──
  const testedTypes = [...byType.entries()]
    .filter(([, counts]) => counts.pass + counts.fail > 0)
    .sort();
  if (testedTypes.length > 0) console.log('\n  By Entity Type:');
  for (const [type, counts] of testedTypes) {
    const total = counts.pass + counts.fail;
    const pct = total > 0 ? ((counts.pass / total) * 100).toFixed(1) : '0.0';
    const icon = counts.fail === 0 ? '✓' : '✗';
    console.log(`    ${icon} ${type.padEnd(20)} ${counts.pass}/${total} (${pct}%)`);
  }

  if (PROFILE) {
    const measured = Object.values(profileTotals).reduce((sum, duration) => sum + duration, 0);
    console.log('\n  Profile:');
    for (const [phase, duration] of Object.entries(profileTotals)) {
      const percent = measured > 0 ? duration / measured * 100 : 0;
      console.log(`    ${phase.padEnd(12)} ${(duration / 1000).toFixed(2).padStart(7)}s  ${percent.toFixed(1).padStart(5)}%`);
    }
  }

  console.log('');

  // Exit code
  const totalFail = stats.parseError + stats.writeError + stats.diff;
  if (totalFail > 0) {
    console.log(`${totalFail} failure(s). Diff files written to: ${OUTPUT_DIR}`);
    process.exit(1);
  } else {
    console.log('All generated outputs are stable after first normalization! ✓');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
