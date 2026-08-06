// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createEmptyUnit } from '../testing/unit-test-helpers';
import { getUnitTechBaseDisplay } from './tech.model';

describe('getUnitTechBaseDisplay', () => {
    it('returns the base for nonmixed Inner Sphere and Clan units', () => {
        expect(getUnitTechBaseDisplay(createEmptyUnit({ techBase: 'Inner Sphere', mixed: false })))
            .toBe('Inner Sphere');
        expect(getUnitTechBaseDisplay(createEmptyUnit({ techBase: 'Clan', mixed: false })))
            .toBe('Clan');
    });

    it('qualifies mixed units with their chassis tech base', () => {
        expect(getUnitTechBaseDisplay(createEmptyUnit({ techBase: 'Inner Sphere', mixed: true })))
            .toBe('Mixed (Inner Sphere)');
        expect(getUnitTechBaseDisplay(createEmptyUnit({ techBase: 'Clan', mixed: true })))
            .toBe('Mixed (Clan)');
    });
});