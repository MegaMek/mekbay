// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { Eras } from '../../src/app/models/eras.model';
import type { RawEquipmentData } from '../../src/app/models/equipment.model';
import type { RawMULFactions } from '../../src/app/models/mulfactions.model';
import type { Quirks } from '../../src/app/models/quirks.model';
import type { Sourcebooks } from '../../src/app/models/sourcebook.model';
import {
    buildApplicationCatalogDependencyBundle,
    verifyApplicationCatalogDependencyBundle,
    type ApplicationCatalogDependencyBundle,
} from '../../src/app/services/unit-catalog/application-catalog-dependency-bundle';
import { asUnitSpriteManifestDigest } from '../../src/app/utils/unit-sprite-assignment-resolver';

const TEST_SPRITE_MANIFEST = '{"types":{},"icons":{},"assignments":{"exact":{"DEFAULT_HEAVY":"defaults/heavy.png"},"chassis":{}}}';
const TEST_SPRITE_DIGEST = asUnitSpriteManifestDigest(
    '2a67e908563ccd8da12200ca479a4fe421b7f232005d917d2e231d0c5fe65def',
);

let cachedBundle: Promise<ApplicationCatalogDependencyBundle> | undefined;

function readGzipJson<T>(projectRoot: string, fileName: string): T {
    const filePath = path.join(
        projectRoot,
        'scripts',
        'testdata',
        'presentation-catalogs',
        `${fileName}.gz`,
    );
    const text = gunzipSync(fs.readFileSync(filePath)).toString('utf8');
    return JSON.parse(text) as T;
}

function createEras(): Eras {
    return {
        version: '',
        assetHash: '',
        eras: Array.from({ length: 12 }, (_, index) => ({
            id: index + 1,
            name: `Test Era ${index + 1}`,
            years: { from: 2000 + index * 10, to: 2009 + index * 10 },
            factions: [],
            units: [],
        })),
    };
}

function createFactions(): RawMULFactions {
    return {
        version: '',
        assetHash: '',
        factions: Array.from({ length: 82 }, (_, index) => ({
            id: index + 1,
            name: `Test Faction ${index + 1}`,
            group: 'Other' as const,
            img: '',
            eras: {},
        })),
    };
}

/**
 * Builds one production-valid dependency bundle from the tracked full catalog
 * fixtures. The promise is shared because equipment qualification is
 * intentionally realistic and comparatively expensive.
 */
export function loadVerifiedCoreDependencyBundleTestFixture(
    projectRoot: string,
): Promise<ApplicationCatalogDependencyBundle> {
    cachedBundle ??= buildFixture(path.resolve(projectRoot));
    return cachedBundle;
}

async function buildFixture(projectRoot: string): Promise<ApplicationCatalogDependencyBundle> {
    const equipment = readGzipJson<RawEquipmentData>(projectRoot, 'equipment2.json');
    const quirksSource = readGzipJson<Quirks>(projectRoot, 'quirks.json');
    const quirks: Quirks = { ...quirksSource, assetHash: '' };
    const sourcebooks: Sourcebooks = {
        assetHash: '',
        sourcebooks: [{
            id: 1,
            sku: 'TEST',
            abbrev: 'TEST',
            title: 'Test Sourcebook',
            canon: true,
        }],
    };
    const bundle = await buildApplicationCatalogDependencyBundle({
        equipment,
        quirks,
        sourcebooks,
        eras: createEras(),
        factions: createFactions(),
        spriteManifest: {
            manifestDigest: TEST_SPRITE_DIGEST,
            manifestText: TEST_SPRITE_MANIFEST,
        },
    });
    if (!await verifyApplicationCatalogDependencyBundle(bundle)) {
        throw new Error('Core dependency bundle test fixture did not pass full production verification');
    }
    return bundle;
}
