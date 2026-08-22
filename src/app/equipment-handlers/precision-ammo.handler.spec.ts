// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment, type AmmoType } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { InventoryControlRuntimeTarget } from '../models/inventory-control-runtime-state.model';
import { MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { PrecisionAmmoHandler } from './precision-ammo.handler';

function autocannon(
    ammoType: AmmoType = 'AC',
    rackSize = 5,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
): MountedWeapon {
    return new MountedWeapon({
        owner: { gameRules } as never,
        id: 'ac',
        name: 'AC/5',
        equipment: new WeaponEquipment({
            id: 'AC5',
            name: 'AC/5',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType, rackSize, damage: 5, ranges: [6, 12, 18, 24] },
        }),
    });
}

function ammo(
    ammoType: AmmoType = 'AC',
    rackSize = 5,
    precision = true,
): AmmoEquipment {
    return new AmmoEquipment({
        id: precision ? 'PrecisionAmmo' : 'StandardAmmo',
        name: precision ? 'Precision Ammo' : 'Standard Ammo',
        type: 'ammo',
        ammo: {
            type: ammoType,
            rackSize,
            shots: 10,
            munitionType: precision ? ['M_PRECISION'] : [],
        },
    });
}

function target(
    tnCalculator: InventoryControlRuntimeTarget['tnCalculator'],
    manualTnModifier?: number,
): InventoryControlRuntimeTarget {
    return {
        id: 'A',
        letter: 'A',
        name: 'Target',
        color: '#000',
        distance: 6,
        tnModifier: 0,
        tnCalculator,
        ...(manualTnModifier !== undefined && { manualTnModifier }),
    };
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);

describe('PrecisionAmmoHandler', () => {
    const handler = new PrecisionAmmoHandler();

    it('reduces the complete target-movement modifier by at most two', () => {
        const weapon = autocannon('AC', 5, TW_GAME_RULES);
        const precisionAmmo = ammo();

        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: precisionAmmo,
            target: target({ targetMovementBracket: '3-4' }),
        }, queryContext)).toEqual([{ kind: 'add', label: 'Precision', modifier: -1 }]);

        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: precisionAmmo,
            target: target({ targetMovementBracket: '5-6', isAirborne: true, skidding: true }),
        }, queryContext)).toEqual([{ kind: 'add', label: 'Precision', modifier: -2 }]);
    });

    it('uses movement retained by a newly immobile target', () => {
        const weapon = autocannon();
        const precisionAmmo = ammo();

        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: precisionAmmo,
            target: target({ targetMovementBracket: '7-9', immobile: true }),
        }, queryContext)).toEqual([{ kind: 'add', label: 'Precision', modifier: -2 }]);
    });

    it('does not apply without a positive calculator-derived movement modifier', () => {
        const weapon = autocannon();
        const precisionAmmo = ammo();

        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: precisionAmmo,
            target: target({ targetMovementBracket: '0-2' }),
        }, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: precisionAmmo,
            target: target({ targetMovementBracket: '7-9' }, 3),
        }, queryContext)).toEqual([]);
    });

    it('requires compatible Precision ammunition from a supported AC family', () => {
        const weapon = autocannon();
        const movingTarget = target({ targetMovementBracket: '7-9' });

        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: ammo('AC', 5, false), target: movingTarget,
        }, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: ammo('AC', 10), target: movingTarget,
        }, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(weapon, {
            selectedAmmo: ammo('AC_ULTRA', 5), target: movingTarget,
        }, queryContext)).toEqual([]);

        for (const ammoType of ['AC', 'LAC', 'AC_IMP', 'PAC'] as const) {
            expect(handler.applicableTo(autocannon(ammoType))).withContext(ammoType).toBeTrue();
        }
        expect(handler.applicableTo(autocannon('AC_ULTRA'))).toBeFalse();
        expect(handler.flags).toEqual(['F_AC']);
    });
});
