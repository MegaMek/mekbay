// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { ECMMode } from '../models/common.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import {
    ECM_MODE_STATE_KEY,
    NOVA_CEWS_STATE_KEY,
    NOVA_CEWS_TURNING_OFF_STATE,
    NOVA_CEWS_TURNING_ON_STATE,
} from './ecm-state.util';
import { getEcmDisplay, getTagDisplay } from './force-viewer-electronics-display.util';

interface MountDefinition {
    readonly id: string;
    readonly name: string;
    readonly flags: EquipmentFlag[];
    readonly mode?: string;
    readonly ranges?: number[];
}

function asUnit(specials: string[]): ASForceUnit {
    const unit = Object.create(ASForceUnit.prototype) as ASForceUnit;
    Object.assign(unit, { getUnit: () => ({ as: { specials } }) });
    return unit;
}

function cbtUnit(
    definitions: readonly MountDefinition[],
    unavailable = new Set<string>(),
): { unit: CBTForceUnit; mounts: MountedEquipment[] } {
    let mounts: MountedEquipment[] = [];
    const unit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
    Object.defineProperties(unit, {
        destroyed: { value: false },
        getInventory: { value: () => mounts },
        getMountedEquipmentByFlag: {
            value: (flag: EquipmentFlag) => mounts.filter(mount => mount.equipment?.flags.has(flag)),
        },
        getCondition: { value: () => false },
        isEquipmentOperational: {
            value: (mount: MountedEquipment) => !unavailable.has(mount.id),
        },
        canPerformEquipmentAction: {
            value: (mount: MountedEquipment) => !unavailable.has(mount.id),
        },
    });
    mounts = definitions.map(definition => {
        const equipment = definition.flags.includes('F_TAG')
            ? new WeaponEquipment({
                id: definition.id,
                name: definition.name,
                type: 'weapon',
                flags: definition.flags,
                weapon: { ranges: definition.ranges ?? [5, 9, 15, 18] },
            })
            : new MiscEquipment({
                id: definition.id,
                name: definition.name,
                type: 'misc',
                flags: definition.flags,
            });
        return new MountedEquipment({
            owner: unit,
            id: definition.id,
            name: definition.name,
            equipment,
            states: definition.mode ? new Map([[ECM_MODE_STATE_KEY, definition.mode]]) : undefined,
        });
    });
    return { unit, mounts };
}

describe('force viewer electronics display', () => {
    it('resolves Alpha Strike electronics directly from specials', () => {
        const unit = asUnit(['AECM', 'LTAG']);

        expect(getEcmDisplay(unit)).toEqual({ mode: 'AECM', unavailable: false });
        expect(getTagDisplay(unit)).toEqual({ label: 'LTAG', unavailable: false });
        expect(getEcmDisplay(asUnit([]))).toBeNull();
        expect(getTagDisplay(asUnit([]))).toBeNull();
    });

    it('selects an available TAG and identifies Light TAG from its range profile', () => {
        const unavailable = new Set(['standard-tag']);
        const { unit } = cbtUnit([
            { id: 'standard-tag', name: 'TAG', flags: ['F_TAG'], ranges: [5, 9, 15, 18] },
            { id: 'light-tag', name: 'Unlocalized Targeting Gear', flags: ['F_TAG'], ranges: [3, 6, 9, 12] },
        ], unavailable);

        expect(getTagDisplay(unit)).toEqual({ label: 'LTAG', unavailable: false });

        unavailable.add('light-tag');
        expect(getTagDisplay(unit)).toEqual({ label: 'TAG', unavailable: true });
    });

    it('prefers an active ECM mode instead of merely selecting the first available mount', () => {
        const { unit } = cbtUnit([
            { id: 'off', name: 'ECM Suite', flags: ['F_ECM'], mode: ECMMode.OFF },
            { id: 'eccm', name: 'Angel ECM Suite', flags: ['F_ECM'], mode: ECMMode.ECCM },
        ]);

        expect(getEcmDisplay(unit)).toEqual({ mode: ECMMode.ECCM, unavailable: false });
    });

    it('uses the shared effective ECM mode for Nova CEWS transitions', () => {
        const { unit, mounts } = cbtUnit([
            {
                id: 'nova',
                name: 'Nova CEWS',
                flags: ['F_ECM', 'F_NOVA'],
                mode: NOVA_CEWS_TURNING_OFF_STATE,
            },
        ]);

        expect(getEcmDisplay(unit)).toEqual({ mode: ECMMode.ECM, unavailable: false });

        mounts[0].states.set(NOVA_CEWS_STATE_KEY, NOVA_CEWS_TURNING_ON_STATE);
        expect(getEcmDisplay(unit)).toEqual({ mode: ECMMode.OFF, unavailable: false });
    });
});
