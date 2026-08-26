// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time/review-time packer for externally supplied catalog oracles.
 * Source fixtures remain ignored; the compact deterministic gzip artifacts are
 * the durable CI inputs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'scripts', 'fixtures');
const OUTPUT = path.join(ROOT, 'scripts', 'testdata', 'presentation-catalogs');

interface LegacyUnitSource {
  readonly uuid?: unknown;
  readonly name?: unknown;
  readonly unitFile?: unknown;
  readonly sheets?: unknown;
  readonly dpt?: unknown;
}

function main(): void {
  fs.mkdirSync(OUTPUT, { recursive: true });

  pack('images.json', canonicalize(readJson('images.json')));
  pack('sheets.json', canonicalize(readJson('sheets.json')));
  pack('unit-images.json', canonicalize(readJson('unit-images.json')));
  pack('equipment2.json', canonicalize(readJson('equipment2.json')));
  pack('quirks.json', canonicalize(readJson('quirks.json')));

  const unitsDocument = readJson('units.json');
  if (!isObject(unitsDocument) || !Array.isArray(unitsDocument['units'])) {
    throw new Error('units.json must contain a units array');
  }
  const units = unitsDocument['units'].map((raw, index) => compactUnit(raw, index));
  pack('presentation-units-oracle.json', { units });
}

function compactUnit(raw: unknown, index: number): LegacyUnitSource {
  if (!isObject(raw)) throw new Error(`units.json units[${index}] is not an object`);
  const uuid = requiredString(raw['uuid'], `units[${index}].uuid`);
  const name = requiredString(raw['name'], `units[${index}].name`);
  const unitFile = requiredString(raw['unitFile'], `units[${index}].unitFile`);
  if (!Array.isArray(raw['sheets']) || raw['sheets'].some(item => typeof item !== 'string')) {
    throw new Error(`units[${index}].sheets is not a string array`);
  }
  if (typeof raw['dpt'] !== 'number' || !Number.isFinite(raw['dpt'])) {
    throw new Error(`units[${index}].dpt is not finite`);
  }
  return { uuid, name, unitFile, sheets: raw['sheets'], dpt: raw['dpt'] };
}

function pack(name: string, value: unknown): void {
  const canonical = JSON.stringify(canonicalize(value));
  const compressed = gzipSync(Buffer.from(canonical, 'utf8'), { level: 9 });
  fs.writeFileSync(path.join(OUTPUT, `${name}.gz`), compressed);
  process.stdout.write(`${name}: ${Buffer.byteLength(canonical)} -> ${compressed.byteLength} bytes\n`);
}

function readJson(name: string): unknown {
  const file = path.join(SOURCE, name);
  if (!fs.existsSync(file)) throw new Error(`Missing source fixture: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be nonempty`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

main();
