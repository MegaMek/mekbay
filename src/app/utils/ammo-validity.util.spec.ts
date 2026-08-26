// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment } from '../models/equipment.model';
import type { WireSplitTechDates } from '../models/equipment-tech-codec';
import type { Era } from '../models/eras.model';
import { AmmoValidityUtil, type AmmoSelectionCompatibilityFacts } from './ammo-validity.util';
import { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';

function createEra(from: number | undefined, to: number | undefined): Era {
    return {
        id: 1,
        name: 'Test Era',
        years: { from, to },
        factions: [],
        units: [],
    };
}

function createAmmo(id: string, advancement: WireSplitTechDates): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        tech: {
            base: 'All',
            advancement,
        },
        ammo: { type: 'SNIPER', rackSize: 20, shots: 10, munitionType: ['M_STANDARD'] }
    });
}

function createSrmAmmo(id: string, munitionType: AmmoMunitionFlag[] = []): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        tech: { base: 'IS' },
        ammo: { type: 'SRM', rackSize: 4, shots: 25, munitionType }
    });
}

function issueReasons(ammo: AmmoEquipment, context: Parameters<typeof AmmoValidityUtil.getAmmoSelectionIssues>[1] = {}) {
    return AmmoValidityUtil.getAmmoSelectionIssues(ammo, context).map(issue => issue.reason);
}

function compatibilityFacts(
    artemisIV: readonly string[] = [],
    artemisV: readonly string[] = [],
): AmmoSelectionCompatibilityFacts {
    return { artemisIV, artemisV };
}

describe('AmmoValidityUtil', () => {
    it('marks ammo with a selection issue when its advancement is after the selected era', () => {
        const ammo = createAmmo('Future Ammo', { clan: { prototype: '3057', production: '~3079', common: '3088' } });

        expect(issueReasons(ammo, { era: createEra(3025, 3056) })).toEqual(['not-yet-existing-in-era']);
        expect(issueReasons(ammo, { era: createEra(3025, 3057) })).toEqual([]);
    });

    it('uses approximate advancement years as five years earlier for non-extinction dates', () => {
        const ammo = createAmmo('Approximate Future Ammo', { clan: { production: '~3079' } });

        expect(issueReasons(ammo, { era: createEra(3025, 3073) })).toEqual(['not-yet-existing-in-era']);
        expect(issueReasons(ammo, { era: createEra(3025, 3074) })).toEqual([]);
    });

    it('marks ammo with a selection issue while every advancement branch is extinct for the selected era', () => {
        const ammo = createAmmo('Extinct Ammo', {
            is: { prototype: '~2375'
                , production: '2377'
                , common: '3058'
                , extinct: '2790'
                , reintroduced: '3054' },
        });

        expect(issueReasons(ammo, { era: createEra(3025, 3049) })).toEqual(['extinct-in-era']);
        expect(issueReasons(ammo, { era: createEra(3025, 3054) })).toEqual([]);
    });

    it('uses approximate extinction years as five years later', () => {
        const ammo = createAmmo('Approximate Extinct Ammo', {
            is: { production: '2377', extinct: '~2790', reintroduced: '~3054' },
        });

        expect(issueReasons(ammo, { era: createEra(2794, 3048) })).toEqual([]);
        expect(issueReasons(ammo, { era: createEra(2795, 3048) })).toEqual(['extinct-in-era']);
        expect(issueReasons(ammo, { era: createEra(2795, 3049) })).toEqual([]);
    });

    it('does not mark mixed advancement ammo with a selection issue when one branch is valid for the selected era', () => {
        const ammo = createAmmo('Mixed Availability Ammo', {
            is: { prototype: '1950', production: '1950', common: '2100' },
            clan: { prototype: '2375', production: '2377', extinct: '2790' },
        });

        expect(issueReasons(ammo, { era: createEra(3025, 3049) })).toEqual([]);
    });

    it('treats unit-invalid ammo as incompatible', () => {
        const ammo = new AmmoEquipment({
            id: 'LBX Standard Ammo',
            name: 'LBX Standard Ammo',
            type: 'ammo',
            tech: { base: 'All' },
            ammo: { type: 'AC_LBX', rackSize: 10, shots: 10, munitionType: ['M_STANDARD'] }
        });

        expect(AmmoValidityUtil.isAmmoCompatible(ammo, ammo, { type: 'Aero', techBase: 'Inner Sphere' } as any)).toBeFalse();
    });

    it('does not hard-filter Artemis-capable ammo without a compatible Artemis-enhanced weapon', () => {
        const standardAmmo = createSrmAmmo('IS Ammo SRM-4');
        const artemisAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis-capable', ['M_ARTEMIS_CAPABLE']);
        const unit = { type: 'Mek', techBase: 'Inner Sphere' } as any;

        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit)).toBeTrue();
    });

    it('adds Artemis selection issues only when the matching Artemis component is missing', () => {
        const standardAmmo = createSrmAmmo('IS Ammo SRM-4');
        const artemisAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis-capable', ['M_ARTEMIS_CAPABLE']);
        const artemisVAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis V-capable', ['M_ARTEMIS_V_CAPABLE']);
        const unit = { type: 'Mek', techBase: 'Inner Sphere' } as any;

        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisVAmmo, unit)).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit)).toBeTrue();

        expect(issueReasons(artemisAmmo)).toEqual(['missing-artemis-iv-component']);
        expect(issueReasons(artemisAmmo, {
            compatibilityFacts: compatibilityFacts([artemisAmmo.internalName]),
        })).toEqual([]);
        expect(issueReasons(artemisAmmo, {
            compatibilityFacts: compatibilityFacts([], [artemisAmmo.internalName]),
        })).toEqual(['missing-artemis-iv-component']);
        expect(issueReasons(artemisVAmmo, {
            compatibilityFacts: compatibilityFacts([artemisVAmmo.internalName]),
        })).toEqual(['missing-artemis-v-component']);
        expect(issueReasons(artemisVAmmo, {
            compatibilityFacts: compatibilityFacts([], [artemisVAmmo.internalName]),
        })).toEqual([]);
    });
});
