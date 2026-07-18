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
 *   npx tsx scripts/compare-unit-output.ts --all-non-as             # strict non-AS parity gate
 *   npx tsx scripts/compare-unit-output.ts --verbose                # show every mismatch
 *   npx tsx scripts/compare-unit-output.ts --fail-on-mismatch       # exit 1 on any failure
 */

import * as fs from 'fs';
import * as path from 'path';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import { createEquipment, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { resetMountIdCounter } from '../src/app/models/entity/utils/signal-helpers';
import { UnitMetadataBuilder } from '../src/app/utils/unit-metadata-builder';
import type { Sourcebook } from '../src/app/models/sourcebook.model';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type CompareType = 'exact' | 'numeric' | 'setCompare' | 'componentSet' | 'skip';
type ParityStatus = 'verified' | 'partial' | 'missing';
type IssueKind = 'value-mismatch' | 'missing-output' | 'output-schema';

interface FieldCheck {
  field: string;
  compare: CompareType;
  tolerance?: number;
  parity: ParityStatus;
}

interface CompareResult {
  unitName: string;
  status: 'match' | 'mismatch' | 'parse-error' | 'build-error' | 'file-missing';
  issues: FieldIssue[];
  error?: string;
}

interface FieldIssue {
  kind: IssueKind;
  field: string;
  expected: unknown;
  actual: unknown;
  message?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Checked-fields registry - grows as we implement more fields
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fields that are currently checked against the oracle.
 * Add new entries here as each field is implemented and validated.
 *
 * Parity order is intentional:
 *   1. Complete every non-`.as` property except `name`.
 *   2. Implement Alpha Strike conversion and complete every property in `.as`.
 *   3. Enable `name`, which is composite stripped metadata built from the
 *      finalized Alpha Strike TP and the unit identity fields.
 */
const CHECKED_FIELDS: FieldCheck[] = [
  // ── Phase 0: Identity ──────────────────────────────────────────────
  { field: 'chassis',       compare: 'exact', parity: 'verified' },
  { field: 'model',         compare: 'exact', parity: 'verified' },
  { field: 'year',          compare: 'exact', parity: 'verified' },
  { field: 'tons',          compare: 'exact', parity: 'verified' },
  { field: 'omni',          compare: 'exact', parity: 'verified' },
  { field: 'role',          compare: 'exact', parity: 'verified' },
  { field: 'source',        compare: 'setCompare', parity: 'verified' },
  { field: 'published',     compare: 'setCompare', parity: 'verified' },
  { field: 'type',          compare: 'exact', parity: 'verified' },
  { field: 'id',            compare: 'exact', parity: 'verified' },
  { field: 'engine',        compare: 'exact', parity: 'verified' },
  { field: 'engineRating',  compare: 'exact', parity: 'verified' },
  { field: 'armorType',     compare: 'exact', parity: 'verified' },
  { field: 'structureType', compare: 'exact', parity: 'verified' },
  { field: 'armor',         compare: 'exact', parity: 'verified' },
  { field: 'techBase',      compare: 'exact', parity: 'verified' },

  // ── Phase 1: Movement ──────────────────────────────────────────────
  { field: 'walk',          compare: 'exact', parity: 'verified' },
  { field: 'run',           compare: 'exact', parity: 'verified' },
  { field: 'jump',          compare: 'exact', parity: 'verified' },
  { field: 'walk2',         compare: 'exact', parity: 'verified' },
  { field: 'run2',          compare: 'exact', parity: 'verified' },
  { field: 'jump2',         compare: 'exact', parity: 'verified' },

  // ── Remaining non-Alpha Strike fields ──────────────────────────────
  { field: 'armorPer',       compare: 'exact', parity: 'verified' },
  { field: 'bv',             compare: 'numeric', tolerance: 1, parity: 'missing' },
  { field: 'c3',             compare: 'exact', parity: 'verified' },
  { field: 'canon',          compare: 'exact', parity: 'verified' },
  { field: 'capital',        compare: 'exact', parity: 'verified' },
  { field: 'cargo',          compare: 'exact', parity: 'verified' },
  { field: 'comp',           compare: 'componentSet', parity: 'partial' },
  { field: 'cost',           compare: 'numeric', tolerance: 1, parity: 'missing' },
  { field: 'crewSize',       compare: 'exact', parity: 'missing' },
  { field: 'diss',           compare: 'exact', parity: 'missing' },
  { field: 'dissipation',    compare: 'numeric', tolerance: 1, parity: 'missing' },
  { field: 'dpt',            compare: 'numeric', tolerance: 0.5, parity: 'missing' },
  { field: 'engineHS',       compare: 'exact', parity: 'missing' },
  { field: 'engineHSType',   compare: 'exact', parity: 'missing' },
  { field: 'features',       compare: 'exact', parity: 'missing' },
  { field: 'fluff',          compare: 'exact', parity: 'missing' },
  { field: 'heat',           compare: 'numeric', tolerance: 1, parity: 'missing' },
  { field: 'icon',           compare: 'exact', parity: 'missing' },
  { field: 'internal',       compare: 'exact', parity: 'verified' },
  { field: 'level',          compare: 'exact', parity: 'missing' },
  { field: 'moveType',       compare: 'exact', parity: 'missing' },
  { field: 'offSpeedFactor', compare: 'exact', parity: 'missing' },
  { field: 'pv',             compare: 'exact', parity: 'missing' },
  { field: 'quirks',         compare: 'exact', parity: 'missing' },
  { field: 'sheets',         compare: 'exact', parity: 'missing' },
  { field: 'squadSize',      compare: 'exact', parity: 'verified' },
  { field: 'squads',         compare: 'exact', parity: 'verified' },
  { field: 'su',             compare: 'exact', parity: 'verified' },
  { field: 'subtype',        compare: 'exact', parity: 'verified' },
  { field: 'techRating',     compare: 'exact', parity: 'verified' },
  { field: 'umu',            compare: 'exact', parity: 'verified' },
  { field: 'weightClass',    compare: 'exact', parity: 'verified' },
  { field: 'unitFile',       compare: 'exact', parity: 'missing' },

  // ── Phase 2: Alpha Strike ──────────────────────────────────────────
  { field: 'as.Arm',       compare: 'exact', parity: 'missing' },
  { field: 'as.MV',        compare: 'exact', parity: 'missing' },
  { field: 'as.MVm',       compare: 'exact', parity: 'missing' },
  { field: 'as.MVp',       compare: 'exact', parity: 'missing' },
  { field: 'as.OV',        compare: 'exact', parity: 'missing' },
  { field: 'as.PV',        compare: 'exact', parity: 'missing' },
  { field: 'as.SZ',        compare: 'exact', parity: 'missing' },
  { field: 'as.Str',       compare: 'exact', parity: 'missing' },
  { field: 'as.TMM',       compare: 'exact', parity: 'missing' },
  { field: 'as.TP',        compare: 'exact', parity: 'missing' },
  { field: 'as.Th',        compare: 'exact', parity: 'missing' },
  { field: 'as.dmg',       compare: 'exact', parity: 'missing' },
  { field: 'as.frontArc',  compare: 'exact', parity: 'missing' },
  { field: 'as.leftArc',   compare: 'exact', parity: 'missing' },
  { field: 'as.rearArc',   compare: 'exact', parity: 'missing' },
  { field: 'as.rightArc',  compare: 'exact', parity: 'missing' },
  { field: 'as.specials',  compare: 'setCompare', parity: 'missing' },
  { field: 'as.usesArcs',  compare: 'exact', parity: 'missing' },
  { field: 'as.usesE',     compare: 'exact', parity: 'missing' },
  { field: 'as.usesOV',    compare: 'exact', parity: 'missing' },
  { field: 'as.usesTh',    compare: 'exact', parity: 'missing' },

  // ── Phase 3: Composite name (only after complete `.as` parity) ─────
  { field: 'name', compare: 'exact', parity: 'partial' },
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
const UNIT_FILES_DIR = path.resolve(getArg('unitfiles', String.raw`C:\Projects\megamek\sourceUnits`));
const TYPE_FILTER = getArg('type', '');
const UNIT_FILTER = getArg('unit', '');
const FIELDS_FILTER = getArg('fields', '');
const EXCLUDE_FIELDS = getArg('exclude-fields', '');
const VERBOSE = hasFlag('verbose');
const FAIL_ON_MISMATCH = hasFlag('fail-on-mismatch');
const ALL_NON_AS = hasFlag('all-non-as');
const STRICT = FAIL_ON_MISMATCH || ALL_NON_AS;

const VALUE_OPTIONS = new Set(['oracle', 'unitfiles', 'type', 'unit', 'fields', 'exclude-fields']);
const FLAG_OPTIONS = new Set(['verbose', 'fail-on-mismatch', 'all-non-as']);

function validateArguments(): void {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const name = argument.slice(2);
    if (FLAG_OPTIONS.has(name)) continue;
    if (!VALUE_OPTIONS.has(name)) throw new Error(`Unknown option: --${name}`);

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Option --${name} requires a value.`);
    }
    index++;
  }

  if (ALL_NON_AS && (FIELDS_FILTER || EXCLUDE_FIELDS)) {
    throw new Error('--all-non-as cannot be combined with --fields or --exclude-fields.');
  }
}

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
    } catch {
      failed++;
    }
  }

  const registry = new EquipmentRegistry(equipmentDb);
  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed, ${registry.lookupKeyCount} lookup keys`);
  return registry;
}

function loadSourcebooks(): ReadonlyMap<string, Sourcebook> {
  const sourcebooksPath = path.join(__dirname, '..', 'public', 'assets', 'sourcebooks.json');
  const sourcebooks: Sourcebook[] = JSON.parse(fs.readFileSync(sourcebooksPath, 'utf-8'));
  return new Map(sourcebooks.map(sourcebook => [sourcebook.abbrev, sourcebook]));
}

// ═══════════════════════════════════════════════════════════════════════════
// Oracle loading & filtering
// ═══════════════════════════════════════════════════════════════════════════

interface OracleEntry {
  [key: string]: unknown;
  name: string;
  chassis: string;
  model: string;
  type: string;
  unitFile: string;
}

interface OracleDocument {
  version: number;
  units: OracleEntry[];
}

type PlainObject = Record<string, unknown>;

const OPTIONAL_FIELDS = new Set(['capital', 'cargo', 'diss', 'fluff', 'umu']);
const STRING_FIELDS = new Set([
  'armorType', 'c3', 'chassis', 'icon', 'level', 'model', 'moveType', 'name',
  'role', 'subtype', 'techBase', 'techRating', 'type', 'unitFile', 'weightClass',
]);
const NULLABLE_STRING_FIELDS = new Set(['engine', 'engineHSType', 'structureType']);
const NUMBER_FIELDS = new Set([
  'armor', 'armorPer', 'bv', 'cost', 'crewSize', 'dissipation', 'dpt', 'engineHS',
  'engineRating', 'heat', 'id', 'internal', 'jump', 'jump2', 'offSpeedFactor', 'omni',
  'pv', 'run', 'run2', 'squadSize', 'squads', 'su', 'tons', 'umu', 'walk', 'walk2', 'year',
]);
const STRING_ARRAY_FIELDS = new Set(['features', 'published', 'quirks', 'sheets', 'source']);
const COMPONENT_REQUIRED_FIELDS = new Set(['id', 'n', 'p', 'q', 't']);
const COMPONENT_OPTIONAL_FIELDS = new Set([
  'bay', 'c', 'cw', 'd', 'l', 'm', 'md', 'os', 'q2', 'r', 'rear',
]);

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: PlainObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateFiniteNumber(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? null
    : `expected a finite number, received ${describeValue(value)}`;
}

function validateStringArray(value: unknown): string | null {
  if (!Array.isArray(value)) return `expected an array, received ${describeValue(value)}`;
  const invalidIndex = value.findIndex(item => typeof item !== 'string');
  return invalidIndex < 0
    ? null
    : `expected a string at index ${invalidIndex}, received ${describeValue(value[invalidIndex])}`;
}

function validateNumberArray(value: unknown): string | null {
  if (!Array.isArray(value)) return `expected an array, received ${describeValue(value)}`;
  const invalidIndex = value.findIndex(item => typeof item !== 'number' || !Number.isFinite(item));
  return invalidIndex < 0
    ? null
    : `expected a finite number at index ${invalidIndex}, received ${describeValue(value[invalidIndex])}`;
}

function validateKnownKeys(
  value: PlainObject,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string>,
): string | null {
  const missing = [...required].filter(key => !hasOwn(value, key));
  if (missing.length > 0) return `missing required properties: ${missing.join(', ')}`;

  const unknown = Object.keys(value).filter(key => !required.has(key) && !optional.has(key));
  return unknown.length > 0 ? `unknown properties: ${unknown.join(', ')}` : null;
}

function validateComponent(value: unknown, location = 'component'): string | null {
  if (!isPlainObject(value)) return `${location} must be an object, received ${describeValue(value)}`;

  const keysError = validateKnownKeys(value, COMPONENT_REQUIRED_FIELDS, COMPONENT_OPTIONAL_FIELDS);
  if (keysError) return `${location}: ${keysError}`;

  for (const field of ['id', 'n', 't']) {
    if (typeof value[field] !== 'string') {
      return `${location}.${field} must be a string, received ${describeValue(value[field])}`;
    }
  }
  for (const field of ['p', 'q', 'q2', 'os', 'cw']) {
    if (hasOwn(value, field)) {
      const error = validateFiniteNumber(value[field]);
      if (error) return `${location}.${field}: ${error}`;
    }
  }
  for (const field of ['c', 'd', 'l', 'm', 'md', 'r']) {
    if (hasOwn(value, field) && typeof value[field] !== 'string') {
      return `${location}.${field} must be a string, received ${describeValue(value[field])}`;
    }
  }
  if (hasOwn(value, 'rear') && typeof value['rear'] !== 'boolean') {
    return `${location}.rear must be a boolean, received ${describeValue(value['rear'])}`;
  }
  if (hasOwn(value, 'bay')) {
    if (!Array.isArray(value['bay'])) return `${location}.bay must be an array`;
    for (let index = 0; index < value['bay'].length; index++) {
      const error = validateComponent(value['bay'][index], `${location}.bay[${index}]`);
      if (error) return error;
    }
  }
  return null;
}

function validateComponents(value: unknown): string | null {
  if (!Array.isArray(value)) return `expected an array, received ${describeValue(value)}`;
  for (let index = 0; index < value.length; index++) {
    const error = validateComponent(value[index], `comp[${index}]`);
    if (error) return error;
  }
  return null;
}

function validateCargo(value: unknown): string | null {
  if (!Array.isArray(value)) return `expected an array, received ${describeValue(value)}`;
  const required = new Set(['capacity', 'doors', 'n', 'type']);
  for (let index = 0; index < value.length; index++) {
    const cargo = value[index];
    if (!isPlainObject(cargo)) return `cargo[${index}] must be an object`;
    const keysError = validateKnownKeys(cargo, required, new Set());
    if (keysError) return `cargo[${index}]: ${keysError}`;
    if (typeof cargo['capacity'] !== 'string' || typeof cargo['type'] !== 'string') {
      return `cargo[${index}].capacity and .type must be strings`;
    }
    for (const field of ['doors', 'n']) {
      const error = validateFiniteNumber(cargo[field]);
      if (error) return `cargo[${index}].${field}: ${error}`;
    }
  }
  return null;
}

function validateCapital(value: unknown): string | null {
  if (!isPlainObject(value)) return `expected an object, received ${describeValue(value)}`;
  const fields = new Set([
    'dropshipCapacity', 'escapePods', 'gravDecks', 'kfIntegrity', 'lifeBoats', 'sailIntegrity',
  ]);
  const keysError = validateKnownKeys(value, fields, new Set());
  if (keysError) return keysError;
  for (const field of fields) {
    const error = field === 'gravDecks'
      ? validateNumberArray(value[field])
      : validateFiniteNumber(value[field]);
    if (error) return `${field}: ${error}`;
  }
  return null;
}

function validateFluff(value: unknown): string | null {
  if (!isPlainObject(value)) return `expected an object, received ${describeValue(value)}`;
  const keysError = validateKnownKeys(value, new Set(['img']), new Set());
  if (keysError) return keysError;
  return typeof value['img'] === 'string'
    ? null
    : `img must be a string, received ${describeValue(value['img'])}`;
}

function validateNonAsField(field: string, value: unknown): string | null {
  if (STRING_FIELDS.has(field)) {
    if (typeof value !== 'string') return `expected a string, received ${describeValue(value)}`;
    if (field === 'unitFile') {
      if (value.length === 0 || path.isAbsolute(value)) return 'expected a nonempty relative path';
      const relative = path.relative(UNIT_FILES_DIR, path.resolve(UNIT_FILES_DIR, value));
      if (relative.startsWith('..') || path.isAbsolute(relative)) return 'path escapes the unit-files directory';
    }
    return null;
  }
  if (NULLABLE_STRING_FIELDS.has(field)) {
    return value === null || typeof value === 'string'
      ? null
      : `expected a string or null, received ${describeValue(value)}`;
  }
  if (NUMBER_FIELDS.has(field)) return validateFiniteNumber(value);
  if (STRING_ARRAY_FIELDS.has(field)) return validateStringArray(value);
  if (field === 'canon') {
    return typeof value === 'boolean' ? null : `expected a boolean, received ${describeValue(value)}`;
  }
  if (field === 'diss') return validateNumberArray(value);
  if (field === 'comp') return validateComponents(value);
  if (field === 'cargo') return validateCargo(value);
  if (field === 'capital') return validateCapital(value);
  if (field === 'fluff') return validateFluff(value);
  return `no runtime schema is registered for ${field}`;
}

function validateOracleDocument(value: unknown): OracleDocument {
  const errors: string[] = [];
  if (!isPlainObject(value)) throw new Error('Oracle root must be an object.');
  if (validateFiniteNumber(value['version'])) errors.push('version must be a finite number');
  if (!Array.isArray(value['units'])) errors.push('units must be an array');
  if (errors.length > 0) throw new Error(`Invalid oracle document: ${errors.join('; ')}`);

  const units = value['units'] as unknown[];
  const fieldsToCheck = CHECKED_FIELDS.filter(check => !check.field.startsWith('as.'));
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (!isPlainObject(unit)) {
      errors.push(`units[${index}] must be an object`);
      continue;
    }

    for (const check of fieldsToCheck) {
      if (!hasOwn(unit, check.field)) {
        if (!OPTIONAL_FIELDS.has(check.field)) {
          errors.push(`units[${index}].${check.field} is required`);
        }
        continue;
      }
      const error = validateNonAsField(check.field, unit[check.field]);
      if (error) errors.push(`units[${index}].${check.field}: ${error}`);
    }

    if (!hasOwn(unit, 'as') || !isPlainObject(unit['as'])) {
      errors.push(`units[${index}].as must be an object`);
    }
    if (errors.length >= 20) break;
  }

  if (errors.length > 0) {
    throw new Error(`Oracle schema validation failed:\n  ${errors.join('\n  ')}`);
  }
  return value as unknown as OracleDocument;
}

function loadOracle(): OracleEntry[] {
  if (!fs.existsSync(UNITS_JSON_PATH)) {
    throw new Error(`units.json not found: ${UNITS_JSON_PATH}`);
  }

  console.log(`Loading oracle: ${UNITS_JSON_PATH}`);
  const data = validateOracleDocument(JSON.parse(fs.readFileSync(UNITS_JSON_PATH, 'utf-8')) as unknown);
  const units = data.units;
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
  let checks = ALL_NON_AS
    ? CHECKED_FIELDS.filter(check => !check.field.startsWith('as.'))
    : FIELDS_FILTER
      ? [...CHECKED_FIELDS]
      : CHECKED_FIELDS.filter(check => check.parity === 'verified');

  // --fields filter: only check these specific fields
  if (FIELDS_FILTER) {
    const allowed = new Set(FIELDS_FILTER.split(',').map(f => f.trim()));
    const unknown = [...allowed].filter(field => !CHECKED_FIELDS.some(check => check.field === field));
    if (unknown.length > 0) throw new Error(`Unknown fields: ${unknown.join(', ')}`);
    checks = checks.filter(c => allowed.has(c.field));
  }

  // --exclude-fields filter: check all except these
  if (EXCLUDE_FIELDS) {
    const excluded = new Set(EXCLUDE_FIELDS.split(',').map(f => f.trim()));
    const unknown = [...excluded].filter(field => !CHECKED_FIELDS.some(check => check.field === field));
    if (unknown.length > 0) throw new Error(`Unknown excluded fields: ${unknown.join(', ')}`);
    checks = checks.filter(c => !excluded.has(c.field));
  }

  if (checks.length === 0) throw new Error('No fields were selected for comparison.');
  return checks;
}

function validateRegistry(entries: OracleEntry[]): void {
  const oracleFields = new Set(entries.flatMap(entry => Object.keys(entry)));
  const oracleAsFields = new Set(entries.flatMap(entry => Object.keys(entry.as ?? {})));
  const registryFields = new Set(CHECKED_FIELDS.map(check => check.field));
  const coveredTopLevel = new Set(
    CHECKED_FIELDS.map(check => check.field.startsWith('as.') ? 'as' : check.field),
  );

  const missingTopLevel = [...oracleFields].filter(field => !coveredTopLevel.has(field));
  const missingAs = [...oracleAsFields].filter(field => !registryFields.has(`as.${field}`));
  if (missingTopLevel.length > 0 || missingAs.length > 0) {
    throw new Error(
      `CHECKED_FIELDS is incomplete. Missing top-level: ${missingTopLevel.join(', ') || 'none'}; `
      + `missing as: ${missingAs.join(', ') || 'none'}`,
    );
  }
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
      if (typeof expected !== 'number' || typeof actual !== 'number') return false;
      return Math.abs(expected - actual) <= tolerance;
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
      return deepEqual(normaliseComponentSet(expected), normaliseComponentSet(actual));

    default:
      return deepEqual(expected, actual);
  }
}

function normaliseComponentSet(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .map(component => normaliseComponent(component))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normaliseComponent(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, fieldValue]) => [
        key,
        key === 'bay' ? normaliseComponentSet(fieldValue) : fieldValue,
      ]),
  );
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
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

function getFieldValue(value: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function hasOwnPath(value: unknown, field: string): boolean {
  const keys = field.split('.');
  let current = value;
  for (const key of keys) {
    if (!isPlainObject(current) || !hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

function validateOutputField(check: FieldCheck, value: unknown): string | null {
  return check.field.startsWith('as.') ? null : validateNonAsField(check.field, value);
}

// ═══════════════════════════════════════════════════════════════════════════
// Single-unit processing
// ═══════════════════════════════════════════════════════════════════════════

function processUnit(
  oracle: OracleEntry,
  checks: FieldCheck[],
  equipmentRegistry: EquipmentRegistry,
  builder: UnitMetadataBuilder,
  sourcebooks: ReadonlyMap<string, Sourcebook>,
): CompareResult {
  const unitName = `${oracle.chassis} ${oracle.model}`.trim();

  // Resolve unit file path
  const unitFilePath = path.join(UNIT_FILES_DIR, oracle.unitFile);
  if (!fs.existsSync(unitFilePath)) {
    return { unitName, status: 'file-missing', issues: [], error: `File not found: ${unitFilePath}` };
  }

  // Parse entity
  let entity;
  try {
    const content = fs.readFileSync(unitFilePath, 'utf-8');
    const fileName = path.basename(unitFilePath);
    resetMountIdCounter();
    const parsed = parseEntity(content, fileName, equipmentRegistry, {
      sourcebookResolver: source => sourcebooks.get(source),
    });
    entity = parsed.entity;
    const errors = parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (STRICT && errors.length > 0) {
      return {
        unitName,
        status: 'parse-error',
        issues: [],
        error: errors.map(error => `${error.field}: ${error.message}`).join('; '),
      };
    }
  } catch (err: any) {
    return {
      unitName,
      status: 'parse-error',
      issues: [],
      error: err.message || String(err),
    };
  }

  try {
    // Build metadata
    const metadata = builder.build(entity);

    // Compare fields
    const issues: FieldIssue[] = [];
    for (const check of checks) {
      const expected = getFieldValue(oracle, check.field);
      const actual = getFieldValue(metadata, check.field);

      if (hasOwnPath(oracle, check.field) && (!hasOwnPath(metadata, check.field) || actual === undefined)) {
        issues.push({
          kind: 'missing-output',
          field: check.field,
          expected,
          actual,
          message: 'required oracle field is absent from generated metadata',
        });
        continue;
      }

      if (actual !== undefined) {
        const schemaError = validateOutputField(check, actual);
        if (schemaError) {
          issues.push({
            kind: 'output-schema',
            field: check.field,
            expected,
            actual,
            message: schemaError,
          });
          continue;
        }
      }

      if (!compareField(check, expected, actual)) {
        issues.push({ kind: 'value-mismatch', field: check.field, expected, actual });
      }
    }

    return {
      unitName,
      status: issues.length > 0 ? 'mismatch' : 'match',
      issues,
    };
  } catch (err: any) {
    return {
      unitName,
      status: 'build-error',
      issues: [],
      error: err.message || String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════════════════

function printResults(
  results: CompareResult[],
  selectedChecks: FieldCheck[],
  comparedChecks: FieldCheck[],
): void {
  const matches = results.filter(r => r.status === 'match');
  const mismatches = results.filter(r => r.status === 'mismatch');
  const parseErrors = results.filter(r => r.status === 'parse-error');
  const buildErrors = results.filter(r => r.status === 'build-error');
  const fileMissing = results.filter(r => r.status === 'file-missing');
  const unimplemented = selectedChecks.filter(check => check.parity === 'missing');

  if (unimplemented.length > 0) {
    console.log(`\n═══ UNIMPLEMENTED FIELDS (${unimplemented.length}) ═══\n`);
    console.log(`  ${unimplemented.map(check => check.field).join(', ')}`);
  }

  // Print mismatches
  if (mismatches.length > 0) {
    console.log(`\n═══ MISMATCHES (${mismatches.length}) ═══\n`);

    const issueCounts = new Map<string, number>();
    for (const r of mismatches) {
      for (const issue of r.issues) {
        const key = `${issue.kind}:${issue.field}`;
        issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
      }
    }

    console.log('  Per-field issue counts:');
    for (const [issue, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${issue}: ${count}`);
    }

    if (VERBOSE) {
      console.log('');
      for (const r of mismatches) {
        console.log(`  ${r.unitName}:`);
        for (const issue of r.issues) {
          const message = issue.message ? ` (${issue.message})` : '';
          console.log(
            `    ${issue.kind}:${issue.field}${message}: `
            + `expected=${JSON.stringify(issue.expected)} actual=${JSON.stringify(issue.actual)}`,
          );
        }
      }
    } else if (mismatches.length <= 20) {
      console.log('');
      for (const r of mismatches) {
        console.log(`  ${r.unitName}:`);
        for (const issue of r.issues) {
          const message = issue.message ? ` (${issue.message})` : '';
          console.log(
            `    ${issue.kind}:${issue.field}${message}: `
            + `expected=${JSON.stringify(issue.expected)} actual=${JSON.stringify(issue.actual)}`,
          );
        }
      }
    } else {
      console.log(`\n  Use --verbose to see all mismatch details.`);
    }
  }

  if (buildErrors.length > 0) {
    console.log(`\n═══ BUILD ERRORS (${buildErrors.length}) ═══\n`);
    for (const r of buildErrors.slice(0, VERBOSE ? buildErrors.length : 10)) {
      console.log(`  ${r.unitName}: ${r.error}`);
    }
    if (!VERBOSE && buildErrors.length > 10) {
      console.log(`  ... and ${buildErrors.length - 10} more. Use --verbose to see all.`);
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
  console.log(`  Selected fields: ${selectedChecks.length}`);
  console.log(`  Compared fields: ${comparedChecks.length}`);
  console.log(`  Unimplemented:   ${unimplemented.length}`);
  console.log(`  Total units:     ${results.length}`);
  console.log(`  Match:           ${matches.length}`);
  console.log(`  Mismatch:        ${mismatches.length}`);
  console.log(`  Parse errors:    ${parseErrors.length}`);
  console.log(`  Build errors:    ${buildErrors.length}`);
  console.log(`  Missing files:   ${fileMissing.length}`);

  const passRate = results.length > 0
    ? ((matches.length / results.length) * 100).toFixed(1)
    : '0.0';
  console.log(`  Unit pass:       ${passRate}%`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log('Unit Metadata Comparison Script\n');
  validateArguments();

  // Load dependencies
  const equipmentRegistry = loadEquipmentRegistry();
  const sourcebooks = loadSourcebooks();
  const builder = new UnitMetadataBuilder();
  const selectedChecks = getActiveChecks();
  const comparedChecks = selectedChecks.filter(check => check.parity !== 'missing');
  console.log(`Selected checks: ${selectedChecks.map(c => c.field).join(', ')}`);
  if (selectedChecks.length !== comparedChecks.length) {
    console.log(`Implemented checks: ${comparedChecks.map(c => c.field).join(', ')}`);
  }
  console.log('');

  // Load and filter oracle
  const allEntries = loadOracle();
  validateRegistry(allEntries);
  const entries = filterOracle(allEntries);

  if (entries.length === 0) {
    throw new Error('No units matched the filter criteria.');
  }

  console.log(`\nProcessing ${entries.length} units...\n`);

  // Process each unit
  const results: CompareResult[] = [];
  let processed = 0;

  for (const entry of entries) {
    const result = processUnit(entry, comparedChecks, equipmentRegistry, builder, sourcebooks);
    results.push(result);
    processed++;

    // Progress indicator
    if (processed % 500 === 0) {
      process.stdout.write(`  ${processed}/${entries.length}...\r`);
    }
  }

  // Report
  printResults(results, selectedChecks, comparedChecks);

  // Exit code
  if (STRICT) {
    const hasUnimplemented = selectedChecks.some(check => check.parity === 'missing');
    const hasFailures = results.some(result => result.status !== 'match');
    if (hasUnimplemented || hasFailures) process.exitCode = 1;
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(`\nFatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
