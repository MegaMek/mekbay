// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { WeaponEquipment } from '../equipment.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import { AeroRules } from './aero-rules';

function createHarness(heat: number, physical = false): { rules: AeroRules; entry: MountedEquipment } {
    const unit = {
        getHeat: () => ({ current: heat }),
        getInventory: () => [],
        getCritSlots: () => [],
        isEquipmentUnavailable: () => false,
    } as unknown as CBTForceUnit;
    const entry = {
        committedDestroyed: () => false,
        isPhysicalWeapon: () => physical,
        equipment: Object.create(WeaponEquipment.prototype),
        critSlots: [],
        states: new Map<string, string>(),
    } as unknown as MountedEquipment;
    return { rules: new AeroRules(unit), entry };
}

describe('AeroRules', () => {
    it('does not apply a fire modifier below the first heat threshold', () => {
        const { rules, entry } = createHarness(7);

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: []
        }));
    });

    it('includes heat as a named weakened entry-state modifier', () => {
        const { rules, entry } = createHarness(8);

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({
            hitMod: 1,
            hitModifierBreakdown: [
                { label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }
            ]
        }));
    });

    it('uses the cumulative modifier at higher heat thresholds', () => {
        const { rules, entry } = createHarness(24);

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({
            hitMod: 4,
            hitModifierBreakdown: [
                { label: 'Heat - Fire Modifier', modifier: 4, weakened: true, kind: 'heat' }
            ]
        }));
    });

    it('does not apply heat fire modifiers to physical attacks', () => {
        const { rules, entry } = createHarness(24, true);

        expect(rules.computeEntryState(entry)).toEqual(jasmine.objectContaining({
            hitMod: 0,
            hitModifierBreakdown: []
        }));
    });
});