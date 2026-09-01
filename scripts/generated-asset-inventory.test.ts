// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  GENERATED_ASSET_FILES,
  GENERATED_ASSET_PATTERNS,
  listGeneratedAssetFiles,
} from './lib/generated-asset-inventory';
import {
  buildRepositoryAssetsManifest,
  writeRepositoryAssetsManifest,
} from './lib/repository-asset-manifest';

const UUID = '019f583e-c1e4-7d03-a9cd-ff4cf5046746';

test('generated inventory owns only the stable unit outputs', () => {
  const paths = new Set(GENERATED_ASSET_FILES.map(entry => entry.relativePath));
  assert.equal(paths.has('units-manifest.json'), true);
  assert.equal(paths.has('units.zip'), true);
  assert.equal(paths.has('eras.json'), false);
  assert.equal(paths.has('factions.json'), false);
  assert.equal([...paths].some(value => value.includes('core-units')), false);
  assert.deepEqual(GENERATED_ASSET_PATTERNS.map(entry => entry.directory), ['units']);
  assert.equal(GENERATED_ASSET_PATTERNS[0].pattern.test(`${UUID}.mtf`), true);
  assert.equal(GENERATED_ASSET_PATTERNS[0].pattern.test('content-hash.mtf'), false);
});

test('inventory lists required files and UUID unit files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-generated-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of GENERATED_ASSET_FILES.filter(entry => entry.required)) {
    const file = path.join(root, entry.relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}');
  }
  fs.mkdirSync(path.join(root, 'units'), { recursive: true });
  fs.writeFileSync(path.join(root, 'units', `${UUID}.mtf`), 'unit');

  const relative = listGeneratedAssetFiles(root).map(file => path.relative(root, file).replaceAll('\\', '/'));
  assert.ok(relative.includes('units-manifest.json'));
  assert.ok(relative.includes('units.zip'));
  assert.ok(relative.includes(`units/${UUID}.mtf`));
});

test('assets manifest is a direct SHA-1 map and excludes individual units', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-assets-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const online = path.join(root, 'online-assets');
  const generated = path.join(online, 'generated');
  fs.mkdirSync(path.join(generated, 'units'), { recursive: true });
  fs.mkdirSync(path.join(online, 'static'), { recursive: true });
  fs.writeFileSync(path.join(generated, 'units-manifest.json'), '{"unit":"hash"}');
  fs.writeFileSync(path.join(generated, 'units.zip'), 'zip');
  fs.writeFileSync(path.join(generated, 'units', `${UUID}.mtf`), 'unit');
  fs.writeFileSync(path.join(online, 'static', 'equipment.json'), '{}');
  fs.writeFileSync(path.join(online, 'static', 'eras.json'), '{}');
  fs.writeFileSync(path.join(online, 'static', 'factions.json'), '{}');
  fs.writeFileSync(path.join(online, 'asset-manifest.json'), 'obsolete');

  const manifest = buildRepositoryAssetsManifest(root);
  assert.deepEqual(Object.keys(manifest), [
    'online-assets/generated/units-manifest.json',
    'online-assets/generated/units.zip',
    'online-assets/static/equipment.json',
    'online-assets/static/eras.json',
    'online-assets/static/factions.json',
  ]);
  assert.equal(manifest['online-assets/generated/units.zip'], sha1(Buffer.from('zip')));
  assert.equal(Object.keys(manifest).some(key => key.includes('/units/')), false);

  const written = writeRepositoryAssetsManifest(root);
  assert.deepEqual(written, manifest);
  assert.equal(fs.existsSync(path.join(online, 'asset-manifest.json')), false);
  const wire = JSON.parse(fs.readFileSync(path.join(online, 'assets-manifest.json'), 'utf8'));
  assert.deepEqual(wire, manifest);
});

function sha1(bytes: Uint8Array): string {
  return crypto.createHash('sha1').update(bytes).digest('base64url');
}
