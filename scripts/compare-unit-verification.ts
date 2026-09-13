// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { appendFileSync, createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readManifest, readVerifiedCorpus, sha256 } from './lib/unit-verification-io';
import { assertExportProvenance, assertMatchingInput, compareVerificationRows } from './lib/unit-verification-comparison';

async function* rows(file: string) {
  const stream = createReadStream(file, 'utf8');
  try { for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line); }
  finally { stream.destroy(); }
}

async function main() {
  const { values } = parseArgs({ options: { corpus: { type: 'string' }, native: { type: 'string' }, mekbay: { type: 'string' }, output: { type: 'string' } } });
  if (!values.corpus || !values.native || !values.mekbay || !values.output) throw new Error('Required: --corpus --native --mekbay --output');
  const info = readVerifiedCorpus(values.corpus);
  const manifest = readManifest(path.join(values.corpus, 'manifest.jsonl'));
  assertExportProvenance(JSON.parse(readFileSync(`${values.mekbay}.provenance.json`, 'utf8')), info, 'mekbay');
  const nativeReferenceBytes = readFileSync(`${values.native}.references.json`);
  const nativeReferences = JSON.parse(nativeReferenceBytes.toString('utf8'));
  if (nativeReferences.corpusJsonSha256 !== sha256(readFileSync(path.join(values.corpus, 'corpus.json')))) {
    throw new Error('native: corpus metadata provenance mismatch');
  }
  assertExportProvenance(nativeReferences, info, 'native references');
  const nativeReferencesSha256 = sha256(nativeReferenceBytes);
  const native = rows(values.native), mekbay = rows(values.mekbay);
  mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
  writeFileSync(values.output, '');
  const counts: Record<string, Record<string, number>> = {};
  const increment = (group: string, key: string) => {
    counts[group] ??= {}; counts[group][key] = (counts[group][key] ?? 0) + 1;
  };
  for (const input of manifest) {
    const left = (await native.next()).value, right = (await mekbay.next()).value;
    assertMatchingInput(input, left, 'native'); assertMatchingInput(input, right, 'mekbay');
    if (left.provenance?.referenceHashesSha256 !== nativeReferencesSha256) throw new Error(`native: reference sidecar mismatch for ${input.relativePath}`);
    assertExportProvenance({ ...left.provenance, dependencyHashes: nativeReferences.dependencyHashes }, info, 'native');
    if (right.provenance?.manifestSha256 !== info.manifestSha256) throw new Error(`mekbay: row manifest provenance mismatch for ${input.relativePath}`);
    const result = compareVerificationRows(left, right);
    appendFileSync(values.output, JSON.stringify(result) + '\n');
    const scopes = ['all', input.inCoreCatalog ? 'core-catalog' : 'outside-catalog', `family:${result.family}`];
    for (const scope of scopes) {
      increment(`${scope}:parse`, `${left.parse?.status}/${right.parse?.status}`);
      increment(`${scope}:load`, `${result.loadStatus.native}/${result.loadStatus.mekbay}`);
      increment(`${scope}:verification`, `${result.validation.megamek}/${result.validation.megameklab}/${result.validation.mekbay}`);
      for (const value of result.values) {
        increment(`${scope}:value:${value.field}`, value.status);
        if ('disposition' in value) increment(`${scope}:difference:${value.field}`, String(value.disposition));
      }
      for (const value of result.identities) increment(`${scope}:identity:${value.field}`, value.status);
      increment(`${scope}:graph:composition`, result.graph.equipmentComposition?.status ?? 'unavailable');
      increment(`${scope}:graph:mekEquipmentCriticals`, result.graph.mekEquipmentCriticals?.status ?? 'unavailable');
      increment(`${scope}:graph:mekSystemsAndArmoring`, result.graph.mekSystemsAndArmoring?.status ?? 'unavailable');
      increment(`${scope}:graph:machineGunArrays`, result.graph.machineGunArrays?.status ?? 'unavailable');
      if (result.coreVsTW) increment(`${scope}:coreVsTW:bv`, result.coreVsTW.status);
    }
  }
  if (!(await native.next()).done || !(await mekbay.next()).done) throw new Error('Extra export rows beyond frozen manifest');
  const summary = { schemaVersion: 1, manifestSha256: info.manifestSha256, rows: manifest.length,
    inputs: { native: path.resolve(values.native), mekbay: path.resolve(values.mekbay) },
    notes: ['Native values compared only with explicit total-warfare calculations. Core results reported separately.',
      'Shared construction verifier has no combat-ruleset selector. Matching booleans do not prove identical coverage.',
      'Raw messages and graphs remain in exports. Graph checks have deliberately named limited scopes.',
      'Errors, unsupported fields and nulls never count as numeric matches. Assets rules excluded.'], counts };
  writeFileSync(`${values.output}.summary.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ rows: manifest.length, output: values.output,
    parse: counts['all:parse'], verification: counts['core-catalog:verification'] }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
