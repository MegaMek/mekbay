// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MountedEquipment } from '../models/mounted-equipment.model';
import { Equipment, type AmmoEquipment } from '../models/equipment.model';
import type { EquipmentStatus } from '../models/equipment-status.model';
import { ArtemisVHandler } from './artemis-v.handler';
import { EquipmentFlag } from '../models/equipment-flags.type';
import { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);

function entry(
    flags: EquipmentFlag[] = [],
    options: { destroyed?: boolean; status?: EquipmentStatus; jammed?: boolean } = {}
): MountedEquipment {
    const getEquipmentStatus = (candidate: MountedEquipment): EquipmentStatus => candidate.committedDestroyed()
        ? 'destroyed'
        : options.status ?? 'available';
    return new MountedEquipment({
        owner: {
            getEquipmentStatus,
            isEquipmentOperational: (candidate: MountedEquipment) => getEquipmentStatus(candidate) === 'available',
            getCondition: (condition: string) => condition === 'jammed' && options.jammed === true
        } as never,
        id: flags.join('-') || 'entry',
        name: 'Entry',
        equipment: new Equipment({ id: 'entry', name: 'Entry', type: 'misc', flags }),
        destroyed: options.destroyed
    });
}

function ammo(munitionTypes: AmmoMunitionFlag[] = []): AmmoEquipment {
    return {
        shortName: 'Test Ammo',
        hasMunitionType: (munitionType: AmmoMunitionFlag) => munitionTypes.includes(munitionType)
    } as AmmoEquipment;
}

describe('ArtemisVHandler', () => {
    const handler = new ArtemisVHandler();

    it('applies the Artemis V bonus when linked to a launcher using Artemis V-capable ammo', () => {
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry', modifier: -1, weakened: false
        }]);
    });

    it('ignores the Artemis V bonus for an indirect-fire target', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
            {
                parent: entry(['F_ARTEMIS_COMPATIBLE']),
                selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']),
                target: { id: 'A', letter: 'A', name: 'Target', color: '#000', distance: 5, tnModifier: 1, tnCalculator: { indirectFire: true } },
            },
            queryContext
        )).toEqual([]);
    });

    it('keeps the Artemis V bonus when indirect calculator state is manually overridden', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
            {
                parent: entry(['F_ARTEMIS_COMPATIBLE']),
                selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']),
                target: { id: 'A', letter: 'A', name: 'Target', color: '#000', distance: 5, tnModifier: 2, manualTnModifier: 2, tnCalculator: { indirectFire: true } },
            },
            queryContext
        )).toEqual([jasmine.objectContaining({ modifier: -1, weakened: false })]);
    });

    it('no Artemis V hit modifier bonus when selected ammo is not Artemis V-capable', () => {
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_CAPABLE']) }, queryContext)).toEqual([{
            kind: 'add', label: 'Incompatible Ammo (Test Ammo)', modifier: 0, weakened: true
        }]);
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: null }, queryContext)).toEqual([{
            kind: 'add', label: 'Artemis V Ammo Not Selected', modifier: 0, weakened: true
        }]);
    });

    it('presents a destroyed linked Artemis V separately from its neutral modifier', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'], { destroyed: true });

        expect(handler.getToHitAdjustments(artemis, { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry Destroyed', modifier: 0, weakened: true
        }]);
    });

    it('presents a disabled linked Artemis V separately from a destroyed one', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'], { status: 'disabled' });

        expect(handler.getToHitAdjustments(artemis, { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry Disabled', modifier: 0, weakened: true
        }]);
    });

    it('does not apply the Artemis V bonus when the unit is jammed', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'], { jammed: true });

        expect(handler.getToHitAdjustments(artemis, { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) }, queryContext)).toEqual([{
            kind: 'add', label: 'Unit Jammed', modifier: 0, weakened: true
        }]);
    });

    it('does not apply the Artemis V bonus while standard Stealth Armor is active', () => {
        const { owner } = createTestEquipmentOwner();
        const mounted = (id: string, flags: EquipmentFlag[], modes: string[] = [], states = new Map<string, string>()) => {
            const mount = new MountedEquipment({
                owner,
                id,
                name: id,
                equipment: new Equipment({ id, name: id, type: 'misc', flags, modes }),
                states,
            });
            owner.setInventoryEntry(mount);
            return mount;
        };
        const artemis = mounted('Artemis V', ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']);
        const launcher = mounted('Launcher', ['F_ARTEMIS_COMPATIBLE']);
        mounted('Stealth Armor', ['F_STEALTH'], ['Off', 'On'], new Map([['state', 'enabled']]));
        mounted('ECM Suite', ['F_ECM']);

        expect(handler.getToHitAdjustments(
            artemis,
            { parent: launcher, selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) },
            queryContext,
        )).toEqual([{
            kind: 'add', label: 'Stealth ECM', modifier: 0, weakened: true,
        }]);
    });

    it('does not apply a modifier to a launcher that is not Artemis-compatible', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
            { parent: entry(), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) },
            queryContext
        )).toEqual([]);
    });

    it('does not apply a modifier when Artemis V is not linked to a launcher', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
            { selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) },
            queryContext
        )).toEqual([]);
    });
});
