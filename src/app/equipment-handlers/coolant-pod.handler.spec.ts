// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { CriticalSlot } from '../models/force-serialization';
import { MountedAmmo } from '../models/mounted-equipment.model';
import type { HeatDissipationState } from '../models/rules/heat-management';
import type { DialogsService } from '../services/dialogs.service';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { COOLANT_POD_ACTIVE_STATE_KEY, CoolantPodHandler } from './coolant-pod.handler';

describe('CoolantPodHandler', () => {
    const handler = new CoolantPodHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    function fixture() {
        const equipment = new AmmoEquipment({
            id: 'CoolantPod',
            name: 'Coolant Pod',
            type: 'ammo',
            ammo: { type: 'COOLANT_POD', shots: 1 },
        });
        const slot: CriticalSlot = {
            id: 'Coolant Pod@LA#9',
            name: 'Coolant Pod',
            loc: 'LA',
            slot: 9,
            totalAmmo: 1,
            consumed: 0,
            eq: equipment,
        };
        const ownerFixture = createTestEquipmentOwner({ criticalSlots: [slot] });
        const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
        Object.assign(ownerFixture.owner, {
            getCritSlot: (loc: string, index: number) => ownerFixture.criticalSlots
                .find(candidate => candidate.loc === loc && candidate.slot === index) ?? null,
            turnState: () => ({ markEquipmentStateChanged }),
        });
        const mounted = new MountedAmmo({
            owner: ownerFixture.owner,
            id: slot.id,
            name: slot.name!,
            equipment,
            locations: new Set(['LA']),
            critSlots: [slot],
            totalAmmo: 1,
            originalTotalAmmo: 1,
            consumed: 0,
        });
        ownerFixture.inventory.push(mounted);
        return { ...ownerFixture, mounted, slot, markEquipmentStateChanged };
    }

    it('uses the pod directly, consumes its ammo slot, and adds one full bank of cooling', () => {
        const { mounted, criticalSlots, markEquipmentStateChanged } = fixture();
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Use Coolant Pod',
            value: 'use',
            disabled: false,
        }));

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        expect(mounted.consumed).toBe(1);
        expect(criticalSlots[0].consumed).toBe(1);
        expect(mounted.states.get(COOLANT_POD_ACTIVE_STATE_KEY)).toBe('true');
        expect(markEquipmentStateChanged).toHaveBeenCalled();
        const dissipation: HeatDissipationState = {
            totalPips: 12,
            healthyPips: 10,
            damagedCount: 2,
            heatsinksOff: 3,
            totalDissipation: 7,
        };
        expect(handler.getHeatDissipationBonus(mounted, dissipation, queryContext)).toBe(7);
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Coolant Pod Expended',
            disabled: true,
        }));
    });

    it('uses the live critical-slot count so ammo correction controls can undo a mistake', () => {
        const { mounted, criticalSlots } = fixture();
        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        criticalSlots[0] = { ...criticalSlots[0], consumed: 0 };

        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Use Coolant Pod',
            disabled: false,
        }));
    });

    it('clears the temporary cooling effect without refunding the pod', () => {
        const { mounted, criticalSlots } = fixture();
        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        handler.onEndTurn(mounted);

        expect(mounted.states.has(COOLANT_POD_ACTIVE_STATE_KEY)).toBeFalse();
        expect(mounted.consumed).toBe(1);
        expect(criticalSlots[0].consumed).toBe(1);
    });

    it('prevents a second pod from being used in the same turn', () => {
        const test = fixture();
        const secondSlot: CriticalSlot = {
            ...test.slot,
            id: 'Coolant Pod@RA#9',
            loc: 'RA',
        };
        test.criticalSlots.push(secondSlot);
        const second = new MountedAmmo({
            owner: test.owner,
            id: secondSlot.id,
            name: secondSlot.name!,
            equipment: test.mounted.equipment,
            locations: new Set(['RA']),
            critSlots: [secondSlot],
            totalAmmo: 1,
            originalTotalAmmo: 1,
            consumed: 0,
        });
        test.inventory.push(second);

        handler.handleSelection(test.mounted, handler.getChoices(test.mounted, queryContext)[0], commandContext);
        expect(handler.getChoices(second, queryContext)[0].disabled).toBeTrue();
        handler.handleSelection(second, { label: 'Use Coolant Pod', value: 'use' }, commandContext);

        expect(second.consumed).toBe(0);
        expect(second.states.has(COOLANT_POD_ACTIVE_STATE_KEY)).toBeFalse();
        expect(secondSlot.consumed).toBe(0);
    });

    it('does not reuse the active pod when malformed ammo data gives it extra capacity', () => {
        const { mounted } = fixture();
        Object.defineProperty(mounted, 'originalTotalAmmo', { value: 2 });
        mounted.totalAmmo = 2;

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        expect(handler.getChoices(mounted, queryContext)[0].disabled).toBeTrue();
        handler.handleSelection(mounted, { label: 'Use Coolant Pod', value: 'use' }, commandContext);
        expect(mounted.consumed).toBe(1);
    });
});
