// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { Force } from '../models/force.model';
import { buildMultiForceQueryParams, parseForceUrl } from './force-url.util';

describe('parseForceUrl', () => {
    const units = [
        createEmptyUnit({ name: 'BMAtlas_AS7D', id: 140 }),
        createEmptyUnit({ name: 'BMAtlas_AS7K', id: 144 }),
        createEmptyUnit({ name: 'BMLocust_LCT1V', id: 1901 }),
    ];

    it('decodes case-insensitive native names without constructing runtime owners', () => {
        const groups = parseForceUrl('bmatlas_as7d,bmlocust_lct1v', units);

        expect(groups).toEqual([jasmine.objectContaining({
            name: null,
            formationId: null,
            units: [
                jasmine.objectContaining({ summary: units[0] }),
                jasmine.objectContaining({ summary: units[2] }),
            ],
        })]);
    });

    it('decodes MUL IDs, group metadata, and skills while keeping the first duplicate', () => {
        const logger = { warn: jasmine.createSpy('warn') };
        const groups = parseForceUrl('Alpha;assault~140:3:4,1901', units, logger, 'mulId');

        expect(groups).toEqual([{
            name: 'Alpha',
            formationId: 'assault',
            units: [
                { summary: units[0], gunnerySkill: 3, pilotingSkill: 4 },
                { summary: units[2] },
            ],
        }]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reports missing rows and never creates a compatibility runtime', () => {
        const logger = { warn: jasmine.createSpy('warn') };

        expect(parseForceUrl('missing', units, logger)).toEqual([{
            name: null,
            formationId: null,
            units: [],
        }]);
        expect(logger.warn).toHaveBeenCalledOnceWith('Unit with name "missing" not found in data');
    });
});

describe('force URL serialization', () => {
    it('omits session-only lobby forces', () => {
        const persistedForce = { instanceId: () => 'persisted-force' } as unknown as Force;
        const lobbyForce = { instanceId: () => 'lobby-force' } as unknown as Force;

        const params = buildMultiForceQueryParams([
            { force: persistedForce, alignment: 'friendly', changeSub: null },
            { force: lobbyForce, alignment: 'enemy', changeSub: null, persistInUrl: false },
        ]);

        expect(params.instance).toBe('persisted-force');
    });
});
