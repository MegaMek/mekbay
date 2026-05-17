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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
    writeFileWithContentTimestamp,
} = require('./lib/deterministic-output.js') as typeof import('./lib/deterministic-output');

const APP_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(APP_ROOT, 'public', 'assets', 'sarna-page-titles.json');
const SARNA_API_URL = 'https://www.sarna.net/wiki/api.php';
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

const VEHICLE_CATEGORIES = [
    'Assault_Combat_Vehicles',
    'Heavy_Combat_Vehicles',
    'Light_Combat_Vehicles',
    'Medium_Combat_Vehicles',
    'Super-Heavy_Combat_Vehicles',
    'OmniVehicles',
    'Naval_Vessels',
    'Support_Vehicles'
] as const;

const UNIT_TYPE_CATEGORIES = {
    Mek: [
        '\'Mechs'
    ],
    Aero: [
        'Aerospace_Fighter_classes',
        'DropShip_classes',
        'DropShuttle_classes',
        'Small_Craft_classes',
        'JumpShip_classes',
        'WarShip_classes',
        'Space_Station_classes',
        'Conventional_Fighters',
        'OmniFighter_classes'
    ],
    Tank: VEHICLE_CATEGORIES,
    Infantry: [
        'Battle_Armor',
        'Infantry_Units'
    ],
    ProtoMek: [
        'ProtoMechs',
        'Exoskeletons'
    ],
    'Handheld Weapon': []
} as const;

type SarnaUnitType = keyof typeof UNIT_TYPE_CATEGORIES;
type SarnaPageTitlesByUnitType = Record<SarnaUnitType, string[]>;

interface SarnaCategoryMember {
    title?: unknown;
}

interface SarnaCategoryMembersResponse {
    continue?: {
        cmcontinue?: unknown;
    };
    error?: {
        code?: unknown;
        info?: unknown;
    };
    query?: {
        categorymembers?: unknown;
    };
}

const titleCollator = new Intl.Collator('en-US', {
    numeric: true,
    sensitivity: 'base'
});
const categoryTitleCache = new Map<string, string[]>();

function buildCategoryMembersUrl(category: string, cmcontinue?: string): string {
    const url = new URL(SARNA_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', `Category:${category}`);
    url.searchParams.set('cmnamespace', '0');
    url.searchParams.set('cmprop', 'title');
    url.searchParams.set('cmlimit', '500');
    url.searchParams.set('format', 'json');

    if (cmcontinue) {
        url.searchParams.set('cmcontinue', cmcontinue);
    }

    return url.toString();
}

function sortTitles(titles: Iterable<string>): string[] {
    return [...titles].sort((a, b) => titleCollator.compare(a, b) || a.localeCompare(b));
}

function getCategoryMembers(data: SarnaCategoryMembersResponse): SarnaCategoryMember[] {
    const members = data.query?.categorymembers;
    if (!Array.isArray(members)) return [];
    return members as SarnaCategoryMember[];
}

function getCmcontinue(data: SarnaCategoryMembersResponse): string | undefined {
    const cmcontinue = data.continue?.cmcontinue;
    return typeof cmcontinue === 'string' && cmcontinue.length > 0 ? cmcontinue : undefined;
}

function formatSarnaApiError(data: SarnaCategoryMembersResponse): string | undefined {
    if (!data.error) return undefined;

    const code = typeof data.error.code === 'string' ? data.error.code : 'unknown';
    const info = typeof data.error.info === 'string' ? data.error.info : 'No error detail returned.';
    return `${code}: ${info}`;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSarnaJson(url: string): Promise<SarnaCategoryMembersResponse> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'MekBay Sarna page-title asset generator'
                }
            });

            if (!response.ok) {
                throw new Error(`Sarna API returned HTTP ${response.status} ${response.statusText}`);
            }

            return await response.json() as SarnaCategoryMembersResponse;
        } catch (error) {
            lastError = error;

            if (attempt < MAX_FETCH_ATTEMPTS) {
                await delay(RETRY_DELAY_MS * attempt);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchCategoryTitles(category: string): Promise<string[]> {
    const cachedTitles = categoryTitleCache.get(category);
    if (cachedTitles) return cachedTitles;

    const titles = new Set<string>();
    let cmcontinue: string | undefined;
    let page = 1;

    do {
        const url = buildCategoryMembersUrl(category, cmcontinue);
        const data = await fetchSarnaJson(url);
        const apiError = formatSarnaApiError(data);

        if (apiError) {
            throw new Error(`Sarna API failed for Category:${category}: ${apiError}`);
        }

        const members = getCategoryMembers(data);
        for (const member of members) {
            if (typeof member.title === 'string' && member.title.trim().length > 0) {
                titles.add(member.title.trim());
            }
        }

        cmcontinue = getCmcontinue(data);
        console.log(`[Sarna Titles] Category:${category} page ${page}: ${members.length} titles${cmcontinue ? ', continuing...' : ''}`);
        page += 1;
    } while (cmcontinue);

    const sortedTitles = sortTitles(titles);
    categoryTitleCache.set(category, sortedTitles);
    return sortedTitles;
}

async function collectTitlesForCategories(categories: readonly string[]): Promise<string[]> {
    const titles = new Set<string>();

    for (const category of categories) {
        for (const title of await fetchCategoryTitles(category)) {
            titles.add(title);
        }
    }

    return sortTitles(titles);
}

function writeJsonFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileWithContentTimestamp(filePath, `${JSON.stringify(data)}${os.EOL}`, 'utf8');
}

async function run(): Promise<void> {
    const output = {} as SarnaPageTitlesByUnitType;
    const unitTypeEntries = Object.entries(UNIT_TYPE_CATEGORIES) as Array<[SarnaUnitType, readonly string[]]>;

    for (const [unitType, categories] of unitTypeEntries) {
        if (categories.length === 0) {
            output[unitType] = [];
            console.log(`[Sarna Titles] ${unitType}: no Sarna categories configured.`);
            continue;
        }

        console.log(`[Sarna Titles] Fetching ${unitType} titles from ${categories.length} categories.`);
        output[unitType] = await collectTitlesForCategories(categories);
        console.log(`[Sarna Titles] ${unitType}: ${output[unitType].length} unique titles.`);
    }

    writeJsonFile(OUTPUT_PATH, output);
    console.log(`[Sarna Titles] Generated ${OUTPUT_PATH}.`);
}

run().catch(error => {
    console.error('[Sarna Titles] Error:', error);
    process.exit(1);
});