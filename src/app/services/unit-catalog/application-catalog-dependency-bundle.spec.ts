// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    buildApplicationCatalogDependencyBundle,
    isApplicationCatalogDependencyBundle,
    parseApplicationCatalogDependencyBundle,
    serializeApplicationCatalogDependencyBundle,
} from './application-catalog-dependency-bundle';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';

describe('application catalog dependency bundle', () => {
    it('uses the five external catalog values directly without wrapper metadata', () => {
        const input = validBundle();

        const built = buildApplicationCatalogDependencyBundle(input);

        expect(built).toBe(input);
        expect(Object.keys(built).sort()).toEqual([
            'equipment', 'factions', 'quirks', 'sourcebooks', 'spriteManifest',
        ]);
    });

    it('round-trips the direct JSON payload', () => {
        const serialized = serializeApplicationCatalogDependencyBundle(validBundle());
        const parsed = parseApplicationCatalogDependencyBundle(serialized.bytes);

        expect(parsed).toEqual(validBundle());
        expect(serialized.byteLength).toBeGreaterThan(0);
    });

    it('rejects missing catalog members and invalid JSON', () => {
        const missing = { ...validBundle() } as Record<string, unknown>;
        delete missing['equipment'];

        expect(isApplicationCatalogDependencyBundle(missing)).toBeFalse();
        expect(() => parseApplicationCatalogDependencyBundle('{')).toThrowError(/invalid JSON/u);
    });
});

function validBundle(): ApplicationCatalogDependencyBundle {
    return {
        equipment: { version: '', equipment: {} },
        quirks: { version: '', assetHash: '', quirks: [] },
        sourcebooks: { assetHash: '', sourcebooks: [] },
        factions: { version: '', assetHash: '', factions: [] },
        spriteManifest: { manifestDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', manifestText: '{}' },
    } as unknown as ApplicationCatalogDependencyBundle;
}
