// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Freeze identical native bytes for both verifiers; include unsupported files instead of silently skipping them. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';
import { parseMegaMekUnitFileMetadata } from './lib/megamek-unit-file-metadata';

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string', default: '../mm-data/data/mekfiles' },
    archive: { type: 'string', default: 'public/online-assets/generated/units.zip' },
    output: { type: 'string' },
    'official-units': { type: 'string' },
    sourcebooks: { type: 'string', default: '../mm-data/data/sourcebooks' },
    'native-config': { type: 'string', default: '../megamek/megamek/mmconf' },
  } });
  if (!values.output) throw new Error('--output is required (a new directory)');
  const source = path.resolve(values.source);
  const output = path.resolve(values.output);
  if (existsSync(output)) throw new Error(`Refusing to overwrite an existing corpus: ${output}`);
  const archive = await JSZip.loadAsync(readFileSync(values.archive));
  const summaries = JSON.parse(await archive.file('unit-summaries.json')!.async('string')) as {uuid: string; hash: string}[];
  const core = new Set(summaries.map(unit => `${unit.uuid}:${unit.hash}`));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && /\.(mtf|blk)$/iu.test(item.name)) files.push(file);
    }
  };
  walk(source);
  files.sort();
  mkdirSync(output, { recursive: true });
  const hash = (bytes: Uint8Array, algorithm = 'sha256', encoding: 'hex' | 'base64url' = 'hex') =>
    createHash(algorithm).update(bytes).digest(encoding);
  const manifest = files.map(file => {
    const bytes = readFileSync(file);
    const relativePath = path.relative(source, file).replaceAll('\\', '/');
    let uuid: string | null = null;
    try { uuid = parseMegaMekUnitFileMetadata(bytes.toString('utf8'), file, source)?.uuid ?? null; }
    catch { /* Preserve unsupported files in the manifest even when catalog metadata cannot classify them. */ }
    const destination = path.join(output, 'data/mekfiles', relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    return { uuid, relativePath, contentSha256: hash(bytes), byteLength: bytes.length,
      inCoreCatalog: uuid !== null && core.has(`${uuid}:${hash(bytes, 'sha1', 'base64url')}`) };
  });
  const dependencies: Record<string, {source: string; contentSha256: string; byteLength: number}> = {};
  const freeze = (from: string, to: string) => {
    if (!existsSync(from)) throw new Error(`Required reference input is missing: ${from}`);
    mkdirSync(path.dirname(to), {recursive: true});
    copyFileSync(from, to);
    const bytes = readFileSync(to);
    dependencies[path.relative(output, to).replaceAll('\\', '/')] = {
      source: path.resolve(from), contentSha256: hash(bytes), byteLength: bytes.length,
    };
  };
  freeze(path.join(source, 'UnitVerifierOptions.xml'), path.join(output, 'data/mekfiles/UnitVerifierOptions.xml'));
  freeze('public/online-assets/static/equipment.json', path.join(output, 'dependencies/equipment.json'));
  freeze('public/online-assets/static/quirks.json', path.join(output, 'dependencies/quirks.json'));
  freeze('public/online-assets/generated/sourcebooks.json', path.join(output, 'dependencies/sourcebooks.json'));
  // UnitUtil initializes a native Game; its suite startup reads milestones even in headless verification.
  for (const file of ['milestoneReleases.yml', 'log4j2.xml']) {
    freeze(path.join(values['native-config'], file), path.join(output, 'mmconf', file));
  }
  if (values['official-units']) freeze(values['official-units'], path.join(output, 'docs/OfficialUnitList.txt'));
  const sourcebooksRoot = path.resolve(values.sourcebooks);
  const copySourcebooks = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) copySourcebooks(file);
      else if (item.isFile()) freeze(file, path.join(output, 'data/sourcebooks', path.relative(sourcebooksRoot, file)));
    }
  };
  copySourcebooks(sourcebooksRoot);
  const jsonl = manifest.map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(path.join(output, 'manifest.jsonl'), jsonl);
  const info = { schemaVersion: 1, createdAt: new Date().toISOString(), sourceRoot: source,
    unitCount: manifest.length, coreUnitCount: manifest.filter(unit => unit.inCoreCatalog).length,
    archiveUnitCount: summaries.length, manifestSha256: hash(Buffer.from(jsonl)), dependencies,
    officialUnitsStatus: values['official-units'] ? 'provided' : 'not-provided',
    scope: 'All on-disk MTF/BLK files. BFS/Assets files excluded. Core catalog membership requires UUID and exact native-byte hash.' };
  writeFileSync(path.join(output, 'corpus.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify({ ...info, dependencies: Object.keys(dependencies).length }, null, 2));
  if (info.coreUnitCount !== summaries.length) throw new Error('Frozen files do not cover the current core archive exactly; inspect manifest before running comparisons');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
