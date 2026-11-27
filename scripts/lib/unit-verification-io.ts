// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export interface VerificationInput {
  uuid: string | null;
  relativePath: string;
  contentSha256: string;
  byteLength: number;
  inCoreCatalog: boolean;
}

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const errorDetails = (error: unknown) => ({
  type: error instanceof Error ? error.name : 'Error',
  message: error instanceof Error ? error.message : String(error),
});

export function containedPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe relative path: ${relativePath}`);
  return resolved;
}

export function readJsonl(file: string): Record<string, any>[] {
  return readFileSync(file, 'utf8').split(/\r?\n/u).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: ${errorDetails(error).message}`); }
  });
}

export function readManifest(file: string): VerificationInput[] {
  const rows = readJsonl(file);
  const paths = new Set<string>();
  for (const row of rows) {
    if (typeof row.relativePath !== 'string' || !/^[a-f\d]{64}$/u.test(row.contentSha256)
      || !Number.isInteger(row.byteLength) || row.byteLength < 0 || typeof row.inCoreCatalog !== 'boolean'
      || !(row.uuid === null || typeof row.uuid === 'string')) throw new Error(`Invalid manifest row: ${JSON.stringify(row)}`);
    containedPath(path.dirname(file), row.relativePath);
    if (paths.has(row.relativePath)) throw new Error(`Duplicate manifest path: ${row.relativePath}`);
    paths.add(row.relativePath);
  }
  return rows as VerificationInput[];
}

/** Reject input drift before parsing; never treat a missing/changed file as a unit validation result. */
export function readVerifiedInput(root: string, input: VerificationInput): Buffer {
  const file = containedPath(root, input.relativePath);
  containedPath(realpathSync(root), path.relative(realpathSync(root), realpathSync(file)));
  const bytes = readFileSync(file);
  if (bytes.length !== input.byteLength || sha256(bytes) !== input.contentSha256) throw new Error(`Frozen input mismatch: ${input.relativePath}`);
  return bytes;
}

export function readVerifiedCorpus(corpusRoot: string) {
  const info = JSON.parse(readFileSync(path.join(corpusRoot, 'corpus.json'), 'utf8'));
  if (sha256(readFileSync(path.join(corpusRoot, 'manifest.jsonl'))) !== info.manifestSha256) throw new Error('Corpus manifest hash mismatch');
  for (const [relativePath, reference] of Object.entries(info.dependencies) as [string, { contentSha256: string; byteLength: number }][]) {
    readVerifiedInput(corpusRoot, { relativePath, ...reference, uuid: null, inCoreCatalog: false });
  }
  return info;
}

/** JSON cannot represent NaN/Infinity; fail the field instead of silently serializing it as null. */
export function assertFiniteNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite calculated value: ${value}`);
  if (Array.isArray(value)) value.forEach(assertFiniteNumbers);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertFiniteNumbers);
}

export function collectFields(fields: Record<string, () => unknown>) {
  const result: Record<string, any> = { errors: {} };
  for (const [field, calculate] of Object.entries(fields)) {
    try { const value = calculate(); assertFiniteNumbers(value); result[field] = value ?? null; }
    catch (error) { result[field] = null; result.errors[field] = errorDetails(error); }
  }
  return result;
}
