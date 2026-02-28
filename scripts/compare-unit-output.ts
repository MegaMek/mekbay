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
 * Unit Metadata Comparison Script
 *
 * Incrementally validates the TypeScript UnitMetadataBuilder output against
 * the Java-generated `units.json` oracle. The script:
 *
 *   1. Loads `units.json` as the source of truth
 *   2. For each oracle entry (filtered by --type / --unit):
 *      a. Finds the unit file on disk via `unitFile` path
 *      b. Parses it into an entity via `parseEntity()`
 *      c. Feeds entity to `UnitMetadataBuilder` → `Partial<Unit>`
 *      d. Compares each checked field against the oracle
 *   3. Prints a summary of matches, mismatches, and errors
 *
 * Usage:
 *   npx tsx scripts/compare-unit-output.ts                          # all units
 *   npx tsx scripts/compare-unit-output.ts --type Mek               # only Meks
 *   npx tsx scripts/compare-unit-output.ts --unit "Atlas AS7-D"     # single unit
 *   npx tsx scripts/compare-unit-output.ts --unit "King*"           # glob match
 *   npx tsx scripts/compare-unit-output.ts --fields chassis,model   # check only these
 *   npx tsx scripts/compare-unit-output.ts --verbose                # show every mismatch
 *   npx tsx scripts/compare-unit-output.ts --fail-on-mismatch       # exit 1 on any failure
 */

import * as fs from 'fs';
import * as path from 'path';
import { createEquipment, buildEquipmentAliasMap, type EquipmentAliasMap, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { resetMountIdCounter } from '../src/app/models/entity/utils/signal-helpers';
import { UnitMetadataBuilder } from '../src/app/utils/unit-metadata-builder';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type CompareType = 'exact' | 'numeric' | 'setCompare' | 'componentSet' | 'skip';

interface FieldCheck {
  field: string;
  compare: CompareType;
  tolerance?: number;
}

interface CompareResult {
  unitName: string;
  status: 'match' | 'mismatch' | 'parse-error' | 'file-missing';
  mismatches: FieldMismatch[];
  error?: string;
}

interface FieldMismatch {
  field: string;
  expected: any;
  actual: any;
}

// ═══════════════════════════════════════════════════════════════════════════
// Checked-fields registry - grows as we implement more fields
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fields that are currently checked against the oracle.
 * Add new entries here as each field is implemented and validated.
 */
const CHECKED_FIELDS: FieldCheck[] = [
  // ── Phase 0: Identity ──────────────────────────────────────────────
  { field: 'chassis',       compare: 'exact' },
  { field: 'model',         compare: 'exact' },
  { field: 'name',          compare: 'exact' },
  { field: 'year',          compare: 'exact' },
  { field: 'tons',          compare: 'exact' },
  { field: 'omni',          compare: 'exact' },
  { field: 'role',          compare: 'exact' },
  { field: 'type',          compare: 'exact' },
  { field: 'id',            compare: 'exact' },
  { field: 'engine',        compare: 'exact' },
  { field: 'engineRating',  compare: 'exact' },
  { field: 'armorType',     compare: 'exact' },
  { field: 'structureType', compare: 'exact' },
  { field: 'armor',         compare: 'exact' },
  { field: 'techBase',      compare: 'exact' },

  // ── Phase 1: Movement ──────────────────────────────────────────────
  { field: 'walk',          compare: 'exact' },
  { field: 'run',           compare: 'exact' },
  { field: 'jump',          compare: 'exact' },

  // ── Future phases (uncomment as implemented) ───────────────────────
  // { field: 'source',        compare: 'setCompare' },
  // { field: 'walk2',         compare: 'exact' },
  // { field: 'run2',          compare: 'exact' },
  // { field: 'jump2',         compare: 'exact' },
  // { field: 'umu',           compare: 'exact' },
  // { field: 'heat',          compare: 'numeric', tolerance: 1 },
  // { field: 'dissipation',   compare: 'numeric', tolerance: 1 },
  // { field: 'comp',          compare: 'componentSet' },
  // { field: 'dpt',           compare: 'numeric', tolerance: 0.5 },
  // { field: 'bv',            compare: 'numeric', tolerance: 1 },
  // { field: 'cost',          compare: 'numeric', tolerance: 1 },
];

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const UNITS_JSON_PATH = path.resolve(getArg('oracle', String.raw`C:\Projects\megamek\svgexport\units.json`));
const UNIT_FILES_DIR = path.resolve(getArg('unitfiles', String.raw`C:\Projects\megamek\svgexport\unitfiles`));
const TYPE_FILTER = getArg('type', '');
const UNIT_FILTER = getArg('unit', '');
const FIELDS_FILTER = getArg('fields', '');
const EXCLUDE_FIELDS = getArg('exclude-fields', '');
const VERBOSE = hasFlag('verbose');
const FAIL_ON_MISMATCH = hasFlag('fail-on-mismatch');

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
    } catch {
      failed++;
    }
  }

  const aliasMap = buildEquipmentAliasMap(equipmentDb);
  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed, ${aliasMap.size} aliases`);
  return { equipmentDb, aliasMap };
}

// ═══════════════════════════════════════════════════════════════════════════
// Oracle loading & filtering
// ═══════════════════════════════════════════════════════════════════════════

interface OracleEntry {
  [key: string]: any;
  name: string;
  chassis: string;
  model: string;
  type: string;
  unitFile: string;
}

function loadOracle(): OracleEntry[] {
  if (!fs.existsSync(UNITS_JSON_PATH)) {
    console.error(`units.json not found: ${UNITS_JSON_PATH}`);
    process.exit(1);
  }

  console.log(`Loading oracle: ${UNITS_JSON_PATH}`);
  const data = JSON.parse(fs.readFileSync(UNITS_JSON_PATH, 'utf-8'));
  const units: OracleEntry[] = data.units;
  console.log(`Oracle contains ${units.length} units`);
  return units;
}

/**
 * Converts a user glob pattern (e.g. "King*") to a RegExp for matching
 * against chassis + model display names.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function filterOracle(entries: OracleEntry[]): OracleEntry[] {
  let filtered = entries;

  if (TYPE_FILTER) {
    filtered = filtered.filter(e => e.type.toLowerCase() === TYPE_FILTER.toLowerCase());
    console.log(`Filtered to type "${TYPE_FILTER}": ${filtered.length} units`);
  }

  if (UNIT_FILTER) {
    const regex = globToRegex(UNIT_FILTER);
    filtered = filtered.filter(e => {
      const displayName = `${e.chassis} ${e.model}`.trim();
      return regex.test(displayName) || regex.test(e.name);
    });
    console.log(`Filtered to unit "${UNIT_FILTER}": ${filtered.length} units`);
  }

  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════════
// Field selection
// ═══════════════════════════════════════════════════════════════════════════

function getActiveChecks(): FieldCheck[] {
  let checks = [...CHECKED_FIELDS];

  // --fields filter: only check these specific fields
  if (FIELDS_FILTER) {
    const allowed = new Set(FIELDS_FILTER.split(',').map(f => f.trim()));
    checks = checks.filter(c => allowed.has(c.field));
  }

  // --exclude-fields filter: check all except these
  if (EXCLUDE_FIELDS) {
    const excluded = new Set(EXCLUDE_FIELDS.split(',').map(f => f.trim()));
    checks = checks.filter(c => !excluded.has(c.field));
  }

  return checks;
}

// ═══════════════════════════════════════════════════════════════════════════
// Comparison logic
// ═══════════════════════════════════════════════════════════════════════════

function compareField(check: FieldCheck, expected: any, actual: any): boolean {
  switch (check.compare) {
    case 'skip':
      return true;

    case 'exact':
      return deepEqual(expected, actual);

    case 'numeric': {
      const tolerance = check.tolerance ?? 0;
      if (expected == null && actual == null) return true;
      if (expected == null || actual == null) return false;
      return Math.abs(Number(expected) - Number(actual)) <= tolerance;
    }

    case 'setCompare': {
      if (!Array.isArray(expected) || !Array.isArray(actual)) {
        return deepEqual(expected, actual);
      }
      const sortedA = [...expected].sort();
      const sortedB = [...actual].sort();
      return deepEqual(sortedA, sortedB);
    }

    case 'componentSet':
      // TODO: implement component-level comparison
      return true;

    default:
      return deepEqual(expected, actual);
  }
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val: any, i: number) => deepEqual(val, b[i]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Single-unit processing
// ═══════════════════════════════════════════════════════════════════════════

function processUnit(
  oracle: OracleEntry,
  checks: FieldCheck[],
  equipmentDb: EquipmentMap,
  aliasMap: EquipmentAliasMap,
  builder: UnitMetadataBuilder,
): CompareResult {
  const unitName = `${oracle.chassis} ${oracle.model}`.trim();

  // Resolve unit file path
  const unitFilePath = path.join(UNIT_FILES_DIR, oracle.unitFile);
  if (!fs.existsSync(unitFilePath)) {
    return { unitName, status: 'file-missing', mismatches: [], error: `File not found: ${unitFilePath}` };
  }

  // Parse entity
  try {
    const content = fs.readFileSync(unitFilePath, 'utf-8');
    const fileName = path.basename(unitFilePath);
    resetMountIdCounter();
    const { entity } = parseEntity(content, fileName, equipmentDb, null, aliasMap);

    // Build metadata
    const metadata = builder.build(entity);

    // Compare fields
    const mismatches: FieldMismatch[] = [];
    for (const check of checks) {
      const expected = oracle[check.field];
      const actual = (metadata as any)[check.field];

      if (!compareField(check, expected, actual)) {
        mismatches.push({ field: check.field, expected, actual });
      }
    }

    return {
      unitName,
      status: mismatches.length > 0 ? 'mismatch' : 'match',
      mismatches,
    };
  } catch (err: any) {
    return {
      unitName,
      status: 'parse-error',
      mismatches: [],
      error: err.message || String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════════════════

function printResults(results: CompareResult[], checks: FieldCheck[]) {
  const matches = results.filter(r => r.status === 'match');
  const mismatches = results.filter(r => r.status === 'mismatch');
  const parseErrors = results.filter(r => r.status === 'parse-error');
  const fileMissing = results.filter(r => r.status === 'file-missing');

  // Print mismatches
  if (mismatches.length > 0) {
    console.log(`\n═══ MISMATCHES (${mismatches.length}) ═══\n`);

    // Collect per-field mismatch counts
    const fieldCounts = new Map<string, number>();
    for (const r of mismatches) {
      for (const m of r.mismatches) {
        fieldCounts.set(m.field, (fieldCounts.get(m.field) ?? 0) + 1);
      }
    }

    // Print field summary
    console.log('  Per-field mismatch counts:');
    for (const [field, count] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${field}: ${count}`);
    }

    if (VERBOSE) {
      console.log('');
      for (const r of mismatches) {
        console.log(`  ${r.unitName}:`);
        for (const m of r.mismatches) {
          console.log(`    ${m.field}: expected=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`);
        }
      }
    } else if (mismatches.length <= 20) {
      // Show details for a small number of mismatches even without --verbose
      console.log('');
      for (const r of mismatches) {
        console.log(`  ${r.unitName}:`);
        for (const m of r.mismatches) {
          console.log(`    ${m.field}: expected=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`);
        }
      }
    } else {
      console.log(`\n  Use --verbose to see all mismatch details.`);
    }
  }

  // Print parse errors
  if (parseErrors.length > 0) {
    console.log(`\n═══ PARSE ERRORS (${parseErrors.length}) ═══\n`);
    for (const r of parseErrors.slice(0, VERBOSE ? parseErrors.length : 10)) {
      console.log(`  ${r.unitName}: ${r.error}`);
    }
    if (!VERBOSE && parseErrors.length > 10) {
      console.log(`  ... and ${parseErrors.length - 10} more. Use --verbose to see all.`);
    }
  }

  // Print file-missing
  if (fileMissing.length > 0) {
    console.log(`\n═══ FILE MISSING (${fileMissing.length}) ═══\n`);
    for (const r of fileMissing.slice(0, 5)) {
      console.log(`  ${r.unitName}: ${r.error}`);
    }
    if (fileMissing.length > 5) {
      console.log(`  ... and ${fileMissing.length - 5} more.`);
    }
  }

  // Summary
  console.log(`\n═══ SUMMARY ═══`);
  console.log(`  Checked fields: ${checks.map(c => c.field).join(', ')}`);
  console.log(`  Total:    ${results.length}`);
  console.log(`  Match:    ${matches.length}`);
  console.log(`  Mismatch: ${mismatches.length}`);
  console.log(`  Errors:   ${parseErrors.length}`);
  console.log(`  Missing:  ${fileMissing.length}`);

  const passRate = results.length > 0
    ? ((matches.length / (results.length - fileMissing.length - parseErrors.length)) * 100).toFixed(1)
    : '0.0';
  console.log(`  Pass:     ${passRate}%`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log('Unit Metadata Comparison Script\n');

  // Load dependencies
  const { equipmentDb, aliasMap } = loadEquipmentDb();
  const builder = new UnitMetadataBuilder();
  const checks = getActiveChecks();
  console.log(`Active checks: ${checks.map(c => c.field).join(', ')}\n`);

  // Load and filter oracle
  const allEntries = loadOracle();
  const entries = filterOracle(allEntries);

  if (entries.length === 0) {
    console.log('No units matched the filter criteria.');
    process.exit(0);
  }

  console.log(`\nProcessing ${entries.length} units...\n`);

  // Process each unit
  const results: CompareResult[] = [];
  let processed = 0;

  for (const entry of entries) {
    const result = processUnit(entry, checks, equipmentDb, aliasMap, builder);
    results.push(result);
    processed++;

    // Progress indicator
    if (processed % 500 === 0) {
      process.stdout.write(`  ${processed}/${entries.length}...\r`);
    }
  }

  // Report
  printResults(results, checks);

  // Exit code
  if (FAIL_ON_MISMATCH) {
    const failures = results.filter(r => r.status === 'mismatch');
    if (failures.length > 0) {
      process.exit(1);
    }
  }
}

main();
