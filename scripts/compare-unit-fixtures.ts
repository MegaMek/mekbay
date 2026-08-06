// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Compares Battle Value (BV) and Alpha Strike Point Value (PV) between two
 * unit fixture files, matching units by their exported `name` field.
 *
 * Usage:
 *   npx tsx scripts/compare-unit-fixtures.ts
 *   npx tsx scripts/compare-unit-fixtures.ts --left fixtures/x/units.json --right fixtures/units.json
 *   npx tsx scripts/compare-unit-fixtures.ts --fail-on-difference
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FixtureUnit {
  name: string;
  bv?: number;
  asPV?: number;
}

export interface FixtureDocument {
  units: FixtureUnit[];
}

export interface UnitDifference {
  name: string;
  field: 'bv' | 'pv';
  left: number | undefined;
  right: number | undefined;
}

export interface ComparisonResult {
  onlyInLeft: string[];
  onlyInRight: string[];
  differences: UnitDifference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateValue(value: unknown, field: string, unitName: string, filePath: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${field} for unit "${unitName}" in ${filePath}: expected a finite number when present.`);
  }

  return value;
}

export function parseFixture(contents: string, filePath: string): FixtureDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse fixture ${filePath}: ${message}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.units)) {
    throw new Error(`Invalid fixture ${filePath}: expected an object containing a units array.`);
  }

  const names = new Set<string>();
  const units = parsed.units.map((value, index): FixtureUnit => {
    if (!isRecord(value) || typeof value.name !== 'string' || value.name.length === 0) {
      throw new Error(`Invalid unit at index ${index} in ${filePath}: expected a non-empty name.`);
    }

    if (names.has(value.name)) {
      throw new Error(`Duplicate unit name "${value.name}" in ${filePath}.`);
    }
    names.add(value.name);

    const alphaStrike = value.as;
    if (alphaStrike !== undefined && !isRecord(alphaStrike)) {
      throw new Error(`Invalid as value for unit "${value.name}" in ${filePath}: expected an object when present.`);
    }

    return {
      name: value.name,
      bv: validateValue(value.bv, 'bv', value.name, filePath),
      asPV: validateValue(alphaStrike?.PV, 'as.PV', value.name, filePath),
    };
  });

  return { units };
}

export function compareFixtures(left: FixtureDocument, right: FixtureDocument): ComparisonResult {
  const leftByName = new Map(left.units.map((unit) => [unit.name, unit]));
  const rightByName = new Map(right.units.map((unit) => [unit.name, unit]));
  const onlyInLeft = [...leftByName.keys()].filter((name) => !rightByName.has(name)).sort();
  const onlyInRight = [...rightByName.keys()].filter((name) => !leftByName.has(name)).sort();
  const differences: UnitDifference[] = [];

  for (const name of [...leftByName.keys()].sort()) {
    const leftUnit = leftByName.get(name)!;
    const rightUnit = rightByName.get(name);
    if (!rightUnit) {
      continue;
    }

    for (const field of ['bv', 'pv'] as const) {
      const leftValue = field === 'bv' ? leftUnit.bv : leftUnit.asPV;
      const rightValue = field === 'bv' ? rightUnit.bv : rightUnit.asPV;
      if (leftValue !== rightValue) {
        differences.push({ name, field, left: leftValue, right: rightValue });
      }
    }
  }

  return { onlyInLeft, onlyInRight, differences };
}

export function formatComparison(result: ComparisonResult): string[] {
  const lines: string[] = [];

  for (const name of result.onlyInLeft) {
    lines.push(`Only in left: ${name}`);
  }
  for (const name of result.onlyInRight) {
    lines.push(`Only in right: ${name}`);
  }
  for (const difference of result.differences) {
    lines.push(`${difference.name}: ${difference.field} ${String(difference.left)} -> ${String(difference.right)}`);
  }

  lines.push(
    `Summary: ${result.differences.length} BV/PV difference(s), ${result.onlyInLeft.length} left-only unit(s), ${result.onlyInRight.length} right-only unit(s).`,
  );
  return lines;
}

function getOption(args: string[], name: string, defaultValue: string): string {
  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    return defaultValue;
  }
  if (index === args.length - 1 || args[index + 1].startsWith('--')) {
    throw new Error(`Missing value for --${name}.`);
  }
  return args[index + 1];
}

export function runComparison(args: string[], projectRoot = path.resolve(__dirname, '..')): ComparisonResult {
  const fixturesRoot = path.join(projectRoot, 'scripts', 'fixtures');
  const leftPath = path.resolve(getOption(args, 'left', path.join(fixturesRoot, 'x', 'units.json')));
  const rightPath = path.resolve(getOption(args, 'right', path.join(fixturesRoot, 'units.json')));
  const result = compareFixtures(
    parseFixture(fs.readFileSync(leftPath, 'utf8'), leftPath),
    parseFixture(fs.readFileSync(rightPath, 'utf8'), rightPath),
  );

  for (const line of formatComparison(result)) {
    console.log(line);
  }

  if (args.includes('--fail-on-difference')
    && (result.differences.length > 0 || result.onlyInLeft.length > 0 || result.onlyInRight.length > 0)) {
    process.exitCode = 1;
  }

  return result;
}

if (require.main === module) {
  try {
    runComparison(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
