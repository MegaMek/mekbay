// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { approx } from './entity/types/tech';
import { decodeEquipmentTechData } from './equipment-tech-codec';

describe('equipment technology codec', () => {
    it('decodes wire-format technology dates', () => {
        expect(decodeEquipmentTechData({
            base: 'IS',
            rating: 'E',
            level: 'Standard',
            availability: { sl: 'X', sw: 'X', clan: 'E', da: 'D' },
            advancement: {
                is: { prototype: '~3055', production: '3067', common: '3072' },
            },
            factions: { prototype: ['FS'], production: ['FS', 'LC'], reintroduction: ['DC'] },
        })).toEqual({
            base: 'IS',
            rating: 'E',
            level: 'Standard',
            availability: { sl: 'X', sw: 'X', clan: 'E', da: 'D' },
            advancement: {
                is: {
                    prototype: approx(3055),
                    production: 3067,
                    common: 3072,
                    extinct: undefined,
                    reintroduced: undefined,
                },
                clan: undefined,
            },
            factions: { prototype: ['FS'], production: ['FS', 'LC'], reintroduction: ['DC'] },
        });
    });

    it('copies and freezes faction milestones at the wire boundary', () => {
        const prototype = ['FS'];
        const decoded = decodeEquipmentTechData({
            base: 'IS',
            rating: 'E',
            level: 'Standard',
            availability: {},
            advancement: {},
            factions: { prototype },
        });

        prototype.push('LC');

        expect(decoded.factions?.prototype).toEqual(['FS']);
        expect(Object.isFrozen(decoded.factions)).toBeTrue();
        expect(Object.isFrozen(decoded.factions?.prototype)).toBeTrue();
    });
});
