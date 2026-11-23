// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildingCollateral, exteriorInfantryDamage, INFANTRY_BUILDING_TYPES, interiorInfantryDamage } from './infantry-building-damage';

describe('TW damage to infantry occupying buildings', () => {
    it('uses distinct exterior and interior protection for each class', () => {
        expect(INFANTRY_BUILDING_TYPES.map(type => exteriorInfantryDamage(10, type))).toEqual([8, 5, 3, 0]);
        expect(INFANTRY_BUILDING_TYPES.map(type => interiorInfantryDamage(10, type))).toEqual([10, 10, 8, 5]);
    });

    it('converts the damage that passed through the building using the weapon class on TW p.172', () => {
        expect(buildingCollateral({ collateralBuilding: 'medium', types: ['DE', 'P'] }, 10)).toEqual({ damage: 5, troopers: 3 });
        expect(buildingCollateral({ collateralBuilding: 'medium', types: ['DB'] }, 20)).toEqual({ damage: 10, troopers: 1 });
        expect(buildingCollateral({ collateralBuilding: 'heavy', types: ['P'], infantryClass: 'burst-2' }, 2))
            .toEqual({ damage: 1, troopers: 1 });
        expect(buildingCollateral({ collateralBuilding: 'hardened', types: ['P'] }, 10)).toEqual({ damage: 0, troopers: 0 });
    });
});
