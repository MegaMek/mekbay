// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { parseInventoryComponentReference } from './inventory-component-reference.model';

describe('parseInventoryComponentReference', () => {
    it('parses component and optional bin indexes', () => {
        expect(parseInventoryComponentReference('Ammo@RT#3')).toEqual({ location: 'RT', componentIndex: 3, binIndex: null });
        expect(parseInventoryComponentReference('Ammo@RT#3.2')).toEqual({ location: 'RT', componentIndex: 3, binIndex: 2 });
        expect(parseInventoryComponentReference('Equipment@C/R/LT#12')).toEqual({
            location: 'C/R/LT', componentIndex: 12, binIndex: null,
        });
    });

    it('rejects malformed and negative component references', () => {
        expect(parseInventoryComponentReference('Ammo@RT')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@#3')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@RT#-1.0')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@RT#3.-1')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@RT#three.0')).toBeNull();
    });
});
