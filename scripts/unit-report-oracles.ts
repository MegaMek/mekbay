/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay and is licensed under GPL-3.0-or-later.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WeightReportOracle {
  calculatedWeight: number;
}

export interface TechLevelReportOracle {
  techBase: string;
  introductionYear: number;
  evaluationYear: number;
  rule: string;
  staticLevel: string;
  variableLevelYear: number;
  variableLevel: string;
  effectiveLevel: string;
  prototype?: string;
  production?: string;
  common?: string;
  extinct?: string;
}

export interface AlphaStrikeDamageReport {
  dmgS: string;
  dmgM: string;
  dmgL: string;
  dmgE: string;
}

export interface AlphaStrikeReportOracle {
  chassis: string;
  model: string;
  mulId: number;
  typeCode: string;
  size: number;
  tmm?: number;
  armor: number;
  structure?: number;
  threshold?: number;
  damage?: AlphaStrikeDamageReport;
  overheat: number;
  pointValue: number;
  usesArcs: boolean;
}

export interface ReportIndex {
  readonly directory: string;
  readonly files: ReadonlyMap<string, string>;
}

function requiredMatch(text: string, pattern: RegExp, label: string): RegExpMatchArray {
  const match = text.match(pattern);
  if (!match) throw new Error(`Missing or invalid ${label}.`);
  return match;
}

function parseFiniteNumber(value: string, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid ${label}: ${value}`);
  return result;
}

function normalizeWeight(value: string, unit: string | undefined): number {
  const weight = parseFiniteNumber(value, 'weight');
  return unit ? weight / 1_000 : weight;
}

function parseLabel(text: string, label: string, required = true): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^\\s{2,}${escaped}:\\s*(.*?)\\s*$`, 'm'));
  if (!match && required) throw new Error(`Missing or invalid ${label}.`);
  return match?.[1];
}

export function parseWeightReport(text: string): WeightReportOracle {
  const valid = text.match(
    /^Weight:\s+([+-]?\d+(?:\.\d+)?)\s*(kg)?\s+\(([+-]?\d+(?:\.\d+)?)\s*(kg)?\)\s*$/m,
  );
  if (valid) {
    if (Boolean(valid[2]) !== Boolean(valid[4])) throw new Error('Weight line uses inconsistent units.');
    return { calculatedWeight: normalizeWeight(valid[3], valid[4]) };
  }

  const invalid = text.match(
    /^Weight:\s+([+-]?\d+(?:\.\d+)?)\s*(kg)?\s+is\s+(less|greater)\s+than\s+([+-]?\d+(?:\.\d+)?)\s*(kg)?\s*$/m,
  );
  if (invalid) {
    if (Boolean(invalid[2]) !== Boolean(invalid[5])) throw new Error('Weight line uses inconsistent units.');
    return { calculatedWeight: normalizeWeight(invalid[1], invalid[2]) };
  }

  const infantry = text.match(/^\s*Final Weight:.*?([+-]?\d+(?:\.\d+)?)\s*t\s*$/m);
  if (infantry) {
    return { calculatedWeight: normalizeWeight(infantry[1], undefined) };
  }

  throw new Error('Missing or invalid Weight line.');
}

export function parseTechLevelReport(text: string): TechLevelReportOracle {
  const variable = requiredMatch(
    text,
    /^\s{2}Variable tech level in\s+(\d+):\s+(.+?)\s*$/m,
    'Variable tech level',
  );

  return {
    techBase: parseLabel(text, 'Tech base')!,
    introductionYear: parseFiniteNumber(parseLabel(text, 'Introduction year')!, 'introduction year'),
    evaluationYear: parseFiniteNumber(parseLabel(text, 'Evaluation year')!, 'evaluation year'),
    rule: parseLabel(text, 'Tech level rule')!,
    staticLevel: parseLabel(text, 'Static tech level')!,
    variableLevelYear: parseFiniteNumber(variable[1], 'variable tech level year'),
    variableLevel: variable[2].trim(),
    effectiveLevel: parseLabel(text, 'Effective tech level')!,
    prototype: parseLabel(text, 'Prototype', false),
    production: parseLabel(text, 'Production', false),
    common: parseLabel(text, 'Common', false),
    extinct: parseLabel(text, 'Extinct', false),
  };
}

function parseAlphaStrikeDamage(text: string): AlphaStrikeDamageReport | undefined {
  const values = new Map<string, string>();
  for (const match of text.matchAll(/^\s+Final ([SMLE]) damage:.*=\s*(\d+\*?)\s*$/gm)) {
    values.set(match[1], match[2]);
  }
  if (values.size === 0) return undefined;

  for (const range of ['S', 'M', 'L']) {
    if (!values.has(range)) throw new Error(`Missing Final ${range} damage.`);
  }
  return {
    dmgS: values.get('S')!,
    dmgM: values.get('M')!,
    dmgL: values.get('L')!,
    dmgE: values.get('E') ?? '0',
  };
}

export function parseAlphaStrikeReport(text: string): AlphaStrikeReportOracle {
  const type = requiredMatch(text, /^\s+Unit Type:\s+.*?\s{2,}([A-Z][A-Z0-9]*)\s*$/m, 'Unit Type');
  if (type[1] === 'UNKNOWN') throw new Error('Unsupported Alpha Strike unit type: UNKNOWN.');

  const size = requiredMatch(text, /^\s+Size:\s+.*?\s{2,}(\d+)\s*$/m, 'Size');
  const armor = requiredMatch(text, /^\s+Final Armor Value\s+.*=\s*(-?\d+)\s*$/m, 'Final Armor Value');
  const pointValue = requiredMatch(text, /^\s+Base Point Value\s+.*?(-?\d+)\s*$/m, 'Base Point Value');
  const structure = text.match(/^\s+Structure\s+(?:.*=\s*)?(-?\d+(?:\.\d+)?)\s*$/m);
  const threshold = text.match(/^\s+Threshold\s+.*=\s*(-?\d+)\s*$/m);
  const tmm = text.match(/^\s+TMM\s+of\s+\S+\s+(\d+)\s*$/m);
  const overheat = text.match(/^\s+Damage difference\s+.*\bOV\s+(\d+)\s*$/m);

  return {
    chassis: parseLabel(text, 'Chassis')!,
    model: parseLabel(text, 'Model') ?? '',
    mulId: parseFiniteNumber(parseLabel(text, 'MUL ID')!, 'MUL ID'),
    typeCode: type[1],
    size: parseFiniteNumber(size[1], 'Alpha Strike size'),
    tmm: tmm ? parseFiniteNumber(tmm[1], 'TMM') : undefined,
    armor: parseFiniteNumber(armor[1], 'Alpha Strike armor'),
    structure: structure ? parseFiniteNumber(structure[1], 'Alpha Strike structure') : undefined,
    threshold: threshold ? parseFiniteNumber(threshold[1], 'Alpha Strike threshold') : undefined,
    damage: parseAlphaStrikeDamage(text),
    overheat: overheat ? parseFiniteNumber(overheat[1], 'overheat') : 0,
    pointValue: parseFiniteNumber(pointValue[1], 'point value'),
    usesArcs: /^\s+--- (?:Front|Left|Right|Rear) Arc /m.test(text),
  };
}

export function indexReportDirectory(directory: string): ReportIndex {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Report directory not found: ${directory}`);
  }

  const files = new Map<string, string>();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.txt') continue;
    const key = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (files.has(key)) throw new Error(`Case-insensitive report filename collision in ${directory}: ${entry.name}`);
    files.set(key, path.join(directory, entry.name));
  }
  return { directory, files };
}

export function findReport(index: ReportIndex, unitName: string): string | undefined {
  if (!unitName || path.basename(unitName) !== unitName || /[\\/]/.test(unitName)) {
    throw new Error(`Invalid report unit name: ${unitName}`);
  }
  return index.files.get(unitName.toLowerCase());
}
