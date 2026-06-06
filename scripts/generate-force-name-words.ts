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
import * as fs from 'node:fs';
import * as path from 'node:path';

const {
    loadOptionalEnvFile,
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

const {
    writeFileWithContentTimestamp,
} = require('./lib/deterministic-output.js') as typeof import('./lib/deterministic-output');

interface WordListSource {
    key: string;
    fileName: string;
}

const APP_ROOT = path.resolve(__dirname, '..');
const RANDOM_COMPANY_NAME_GENERATOR_PATH = path.join(
    'data',
    'universe',
    'backgrounds',
    'randomCompanyNameGenerator'
);
const OUTPUT_PATH = path.join(APP_ROOT, 'public', 'assets', 'force-name-words.json');

const WORD_LIST_SOURCES: WordListSource[] = [
    { key: 'middleWordCorporate', fileName: 'middleWordCorporate.csv' },
    { key: 'endWordCorporate', fileName: 'endWordCorporate.csv' },
    { key: 'middleWordMercenary', fileName: 'middleWordMercenary.csv' },
    { key: 'endWordMercenary', fileName: 'endWordMercenary.csv' },
    { key: 'preFab', fileName: 'preFab.csv' },
];

const EXCLUDED_WORDS = new Set([
    'Test Name',
    'Your Name Here',
]);

loadOptionalEnvFile(APP_ROOT, { logPrefix: 'Force Name Words' });

function parseCsvRows(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i += 1) {
        const char = content[i];

        if (inQuotes) {
            if (char === '"') {
                if (content[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(cell);
            cell = '';
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && content[i + 1] === '\n') {
                i += 1;
            }
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    if (inQuotes) {
        throw new Error('CSV ended while inside a quoted value.');
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows.filter(candidate => candidate.some(cellValue => cellValue.trim().length > 0));
}

function parseWeight(rawWeight: string, filePath: string, rowNumber: number): number {
    const normalizedWeight = rawWeight.trim();
    if (!/^[0-9]+$/.test(normalizedWeight)) {
        throw new Error(`${filePath}:${rowNumber} has invalid Weight value: ${rawWeight}`);
    }

    return Number.parseInt(normalizedWeight, 10);
}

function readWeightedWords(filePath: string): string[] {
    const rows = parseCsvRows(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (rows.length < 2) {
        throw new Error(`${filePath} must contain a header and at least one word row.`);
    }

    const header = rows[0].map(cell => cell.trim());
    const wordIndex = header.indexOf('Word');
    const weightIndex = header.indexOf('Weight');
    if (wordIndex === -1 || weightIndex === -1) {
        throw new Error(`${filePath} must contain Word and Weight columns.`);
    }

    const words: string[] = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const hasExtraColumns = row.length > header.length && wordIndex === 0 && weightIndex === 1;
        const word = (hasExtraColumns ? row.slice(0, -1).join(',') : row[wordIndex] ?? '').trim();
        if (!word || EXCLUDED_WORDS.has(word)) continue;

        const rawWeight = hasExtraColumns ? row[row.length - 1] : row[weightIndex] ?? '1';
        const weight = parseWeight(rawWeight, filePath, rowIndex + 1);
        for (let count = 0; count < weight; count += 1) {
            words.push(word);
        }
    }

    if (words.length === 0) {
        throw new Error(`${filePath} did not contain any usable words.`);
    }

    return words;
}

function main(): void {
    const mmDataRoot = resolveMmDataRoot(APP_ROOT);
    const inputRoot = path.join(mmDataRoot, RANDOM_COMPANY_NAME_GENERATOR_PATH);
    const wordsByKey: Record<string, string[]> = {};

    for (const source of WORD_LIST_SOURCES) {
        const filePath = path.join(inputRoot, source.fileName);
        const words = readWeightedWords(filePath);
        wordsByKey[source.key] = words;
        console.log(`[Force Name Words] Loaded ${words.length} entries from ${filePath}`);
    }

    writeFileWithContentTimestamp(OUTPUT_PATH, `${JSON.stringify(wordsByKey, null, 2)}\n`);
    console.log(`[Force Name Words] Generated ${OUTPUT_PATH}`);
}

try {
    main();
} catch (error) {
    console.error('[Force Name Words] Error:', error);
    process.exit(1);
}