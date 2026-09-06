// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PORTRAIT_SETS, type PortraitManifest, type PortraitPosition, type PortraitSheet } from '../src/app/models/portrait.model';
import { writeDeterministicFile } from './lib/deterministic-output';
import { loadOptionalEnvFile, resolveMmDataRoot } from './lib/script-paths';

// Half the source dimensions retains detail for the 80x100 editor and 64x80 picker.
// One pixel of padding prevents adjacent portraits bleeding when scaled down.
export const PORTRAIT_WIDTH = 128;
export const PORTRAIT_HEIGHT = 160;
export const PORTRAIT_QUALITY = 65;
export const MAX_PORTRAIT_SHEET_SIZE = 4096;
const PADDING = 1;
const CELL_WIDTH = PORTRAIT_WIDTH + PADDING * 2;
const CELL_HEIGHT = PORTRAIT_HEIGHT + PADDING * 2;
const MAX_COLUMNS = Math.floor(MAX_PORTRAIT_SHEET_SIZE / CELL_WIDTH);
const MAX_ROWS = Math.floor(MAX_PORTRAIT_SHEET_SIZE / CELL_HEIGHT);
const SHEET_CAPACITY = MAX_COLUMNS * MAX_ROWS;

interface SourcePortrait {
    readonly name: string;
    readonly category: string;
    readonly file: string;
}

export function portraitSheetLayout(count: number): { columns: number; width: number; height: number } {
    if (!Number.isInteger(count) || count < 1 || count > SHEET_CAPACITY) {
        throw new Error(`Portrait sheet requires 1–${SHEET_CAPACITY} images`);
    }
    const columns = Math.min(count, MAX_COLUMNS, Math.max(Math.ceil(count / MAX_ROWS),
        Math.ceil(Math.sqrt(count * CELL_HEIGHT / CELL_WIDTH))));
    return { columns, width: columns * CELL_WIDTH, height: Math.ceil(count / columns) * CELL_HEIGHT };
}

/** Generates only portraits; unit-sprite cleanup never touches this directory. */
export async function generatePortraitSheets(sourceRoot: string, outputDir: string): Promise<PortraitManifest> {
    const sources = new Map<string, string>();
    const sets = PORTRAIT_SETS.map(set => {
        const directory = path.join(sourceRoot, set);
        const images: SourcePortrait[] = [];
        for (const relative of fs.readdirSync(directory, { recursive: true }).map(String).sort()) {
            if (!/\.(?:png|gif|jpe?g|webp)$/iu.test(relative)) continue;
            const file = path.join(directory, relative);
            if (!fs.statSync(file).isFile()) continue;
            const name = path.parse(relative).name;
            const category = relative.split(path.sep)[0]!;
            if (category === relative) throw new Error(`Portrait must belong to a category folder: ${file}`);
            if (sources.has(name)) throw new Error(`Duplicate portrait key ${name}: ${sources.get(name)} and ${file}`);
            sources.set(name, file);
            images.push({ name, category, file });
        }
        if (!images.length) throw new Error(`No portraits found in ${directory}`);
        return { set, images };
    });

    const portraits: Record<string, PortraitPosition> = Object.create(null);
    const sheets: Record<string, PortraitSheet> = {};
    const generatedFiles = new Set<string>();
    let sourceBytes = 0;
    let sheetBytes = 0;
    for (const { set, images } of sets) {
        // The current collection fits one sheet per set. Page only if it outgrows 4096px.
        for (let offset = 0; offset < images.length; offset += SHEET_CAPACITY) {
            const page = images.slice(offset, offset + SHEET_CAPACITY);
            const sheet = `${set.toLowerCase()}-${Math.floor(offset / SHEET_CAPACITY) + 1}`;
            const layout = portraitSheetLayout(page.length);
            const composite: sharp.OverlayOptions[] = [];
            for (const [index, portrait] of page.entries()) {
                sourceBytes += fs.statSync(portrait.file).size;
                const x = (index % layout.columns) * CELL_WIDTH + PADDING;
                const y = Math.floor(index / layout.columns) * CELL_HEIGHT + PADDING;
                const input = await sharp(portrait.file).rotate().resize(PORTRAIT_WIDTH, PORTRAIT_HEIGHT, {
                    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
                }).ensureAlpha().raw().toBuffer();
                composite.push({ input, raw: { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, channels: 4 }, left: x, top: y });
                portraits[portrait.name] = { sheet, set, category: portrait.category, x, y };
            }
            const bytes = await sharp({ create: { width: layout.width, height: layout.height, channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composite)
                .webp({ quality: PORTRAIT_QUALITY, effort: 6, smartSubsample: true }).toBuffer();
            const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
            const filename = `${sheet}.${hash}.webp`;
            writeDeterministicFile(path.join(outputDir, filename), bytes);
            generatedFiles.add(filename);
            sheets[sheet] = { url: `online-assets/generated/portraits/${filename}`,
                hash: crypto.createHash('sha1').update(bytes).digest('base64url'), width: layout.width, height: layout.height };
            sheetBytes += bytes.length;
            console.log(`[Portraits] ${set}: ${page.length} portraits, ${layout.width}x${layout.height}, ${(bytes.length / 1024).toFixed(0)} KiB`);
        }
    }
    const manifest: PortraitManifest = { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, sheets, portraits };
    writeDeterministicFile(path.join(outputDir, 'portraits.json'), JSON.stringify(manifest));
    // Only remove obsolete files owned by this generator, after successful generation.
    for (const filename of fs.readdirSync(outputDir)) {
        if (/^(?:male|female)-\d+\.[0-9a-f]{16}\.webp$/u.test(filename) && !generatedFiles.has(filename)) {
            fs.unlinkSync(path.join(outputDir, filename));
        }
    }
    console.log(`[Portraits] ${sources.size} portraits: ${(sourceBytes / 1048576).toFixed(2)} MiB source → ${(sheetBytes / 1048576).toFixed(2)} MiB WebP (${(100 * (1 - sheetBytes / sourceBytes)).toFixed(1)}% smaller)`);
    return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
    const root = path.resolve(__dirname, '..');
    loadOptionalEnvFile(root, { logPrefix: 'Portraits' });
    void generatePortraitSheets(path.join(resolveMmDataRoot(root), 'data', 'images', 'portraits'),
        path.join(root, 'public', 'online-assets', 'generated', 'portraits'))
        .catch(error => { console.error('[Portraits]', error); process.exitCode = 1; });
}
