// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { generatePortraitSheets, MAX_PORTRAIT_SHEET_SIZE, portraitSheetLayout } from './generate-portrait-sheets';
import { buildRepositoryAssetsManifest } from './lib/repository-asset-manifest';

test('both current portrait sets fit one bounded sheet', () => {
    for (const count of [762, 615, 775]) {
        const { width, height } = portraitSheetLayout(count);
        assert.ok(width <= MAX_PORTRAIT_SHEET_SIZE && height <= MAX_PORTRAIT_SHEET_SIZE);
    }
});

test('generates deterministic WebP sheets with filename keys, folder categories, correct crops and repository hashes', async t => {
    const fixtureRoot = path.resolve(__dirname, '../.tmp/portrait-tests');
    fs.mkdirSync(fixtureRoot, { recursive: true });
    const root = fs.mkdtempSync(path.join(fixtureRoot, 'fixture-'));
    // libvips' file cache can otherwise retain Windows handles during cleanup.
    sharp.cache(false);
    t.after(() => {
        assert.ok(path.resolve(root).startsWith(fixtureRoot + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const source = path.join(root, 'source');
    const output = path.join(root, 'public', 'online-assets', 'generated', 'portraits');
    const examples = [
        { set: 'Male', category: 'Doctor', name: 'Doctor_M_8', color: '#cc2211' },
        { set: 'Male', category: 'Aerospace Pilot', name: 'Aerospace_M_1', color: '#2255ee' },
        { set: 'Female', category: 'Astech', name: 'Astech_F_2', color: '#33aa44' },
    ];
    for (const image of examples) {
        const directory = path.join(source, image.set, image.category);
        fs.mkdirSync(directory, { recursive: true });
        await sharp({ create: { width: 256, height: 320, channels: 3, background: image.color } })
            .png().toFile(path.join(directory, image.name + '.png'));
    }
    const manifest = await generatePortraitSheets(source, output);
    assert.deepEqual(Object.keys(manifest.sheets), ['male-1', 'female-1']);
    assert.equal(Object.keys(manifest.portraits).length, 3);
    const repositoryManifest = buildRepositoryAssetsManifest(path.join(root, 'public'));
    for (const image of examples) {
        const portrait = manifest.portraits[image.name]!;
        assert.equal(portrait.category, image.category);
        assert.equal(portrait.set, image.set);
        const sheet = manifest.sheets[portrait.sheet]!;
        const file = path.join(output, path.basename(sheet.url));
        const metadata = await sharp(file).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, sheet.width);
        assert.equal(metadata.height, sheet.height);
        assert.equal(repositoryManifest[sheet.url], sheet.hash);
        const pixel = await sharp(file).extract({ left: portrait.x + 64, top: portrait.y + 80, width: 1, height: 1 }).raw().toBuffer();
        for (let channel = 0; channel < 3; channel++) {
            const expected = parseInt(image.color.slice(1 + channel * 2, 3 + channel * 2), 16);
            assert.ok(Math.abs(pixel[channel]! - expected) <= 10, `Wrong crop for ${image.name}`);
        }
    }
    const bytesBefore = fs.readdirSync(output).map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')]);
    fs.writeFileSync(path.join(output, 'male-9.0123456789abcdef.webp'), 'obsolete');
    const again = await generatePortraitSheets(source, output);
    assert.deepEqual(again, manifest);
    assert.deepEqual(fs.readdirSync(output).map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')]), bytesBefore);
    // A filename collision cannot silently assign a different image to a saved person.
    fs.copyFileSync(path.join(source, 'Male', 'Doctor', 'Doctor_M_8.png'), path.join(source, 'Female', 'Astech', 'Doctor_M_8.png'));
    await assert.rejects(generatePortraitSheets(source, output), /Duplicate portrait key Doctor_M_8/);
});
