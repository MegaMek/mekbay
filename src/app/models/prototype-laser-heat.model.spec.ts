// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from './entity/entity-identifiers';
import {
    prototypeLaserHeatForRoll,
    prototypeLaserHeatRollMap,
    prototypeLaserMaximumExtraHeat,
} from './prototype-laser-heat.model';

describe('prototype laser heat', () => {
    it('maps every supported prototype and recovered laser to its maximum extra heat', () => {
        expect(prototypeLaserMaximumExtraHeat('ISSmallPulseLaserPrototype')).toBe(3);
        expect(prototypeLaserMaximumExtraHeat('ISMediumPulseLaserPrototype')).toBe(6);
        expect(prototypeLaserMaximumExtraHeat('ISLargePulseLaserPrototype')).toBe(6);
        expect(prototypeLaserMaximumExtraHeat('ISERLargeLaserPrototype')).toBe(6);
        expect(prototypeLaserMaximumExtraHeat('ISMediumPulseLaserRecovered')).toBe(6);
        expect(prototypeLaserMaximumExtraHeat('ISMediumLaser')).toBe(0);
    });

    it('derives 1D3 small-pulse heat and 1D6 heat from explicit die evidence', () => {
        const weaponId = asComponentId('component:prototype');
        expect(prototypeLaserHeatForRoll('ISSmallPulseLaserPrototype', weaponId, 6)).toEqual({
            weaponId,
            roll: 6,
            additionalHeat: 3,
            detail: '1D3 (1D6 roll: 6)',
        });
        expect(prototypeLaserHeatForRoll('ISMediumPulseLaserPrototype', weaponId, 6)).toEqual({
            weaponId,
            roll: 6,
            additionalHeat: 6,
            detail: '1D6 roll: 6',
        });
        expect(prototypeLaserHeatForRoll('ISMediumPulseLaserPrototype', weaponId, 0)).toBeNull();
    });

    it('rejects malformed or duplicate command evidence', () => {
        const weaponId = asComponentId('component:prototype');
        expect(prototypeLaserHeatRollMap([{ weaponId, roll: 6 }]).accepted).toBeTrue();
        expect(prototypeLaserHeatRollMap([{ weaponId, roll: 7 }]).accepted).toBeFalse();
        expect(prototypeLaserHeatRollMap([
            { weaponId, roll: 1 },
            { weaponId, roll: 2 },
        ]).accepted).toBeFalse();
    });
});
