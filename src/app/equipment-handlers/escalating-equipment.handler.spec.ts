// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentFlag } from '../models/equipment-flags.type';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MiscEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { HeatDissipationState } from '../models/rules/heat-management';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { BlueShieldHandler } from './blue-shield.handler';
import {
    RADICAL_HEAT_SINK_ACTIVE_STATE_KEY,
    RadicalHeatSinkHandler,
} from './radical-heat-sink.handler';
import {
    RISC_EMERGENCY_COOLANT_SYSTEM_ACTIVE_STATE_KEY,
    RiscEmergencyCoolantSystemHandler,
} from './risc-emergency-coolant-system.handler';
import {
    RISC_VIRAL_JAMMER_ACTIVE_STATE_KEY,
    RiscViralJammerHandler,
} from './risc-viral-jammer.handler';

interface EquipmentFixture {
    entry: MountedEquipment;
    turnState: TurnState;
}

function equipmentFixture(
    flag: EquipmentFlag,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
    unitType: 'Mek' | 'Aero' = 'Mek',
    turnStateOverrides: Partial<Record<'moveMode' | 'weaponsHeat', () => unknown>> = {},
): EquipmentFixture {
    const moveMode = turnStateOverrides.moveMode ?? (() => null);
    const turnState = {
        moveMode,
        effectiveMoveMode: moveMode,
        weaponsHeat: () => 0,
        ...turnStateOverrides,
    } as unknown as TurnState;
    const { owner, inventory } = createTestEquipmentOwner({
        gameRules,
        unit: { type: unitType },
    });
    Object.assign(owner, {
        getNotificationDisplayName: () => 'Test Unit',
        turnState: () => turnState,
        isEquipmentResolvedCommittedDestroyed: (candidate: MountedEquipment) => candidate.committedDestroyed(),
        isInventoryControlEntrySelected: () => false,
    });
    const entry = new MountedEquipment({
        owner,
        id: flag,
        name: flag,
        equipment: new MiscEquipment({
            id: flag,
            name: flag,
            type: 'misc',
            flags: [flag],
        }),
    });
    inventory.push(entry);
    return { entry, turnState };
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY, 'turn-summary');
const notifications = () => jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);

describe('additional escalating-failure equipment handlers', () => {
    it('tracks Radical Heat Sink checks numerically and preserves the TW automatic-failure step', () => {
        const handler = new RadicalHeatSinkHandler();
        const core = equipmentFixture('F_RADICAL_HEATSINK').entry;
        const tw = equipmentFixture('F_RADICAL_HEATSINK', TW_GAME_RULES).entry;

        expect(handler.getChoices(core, queryContext).slice(0, -1).map(choice => choice.failureTarget))
            .toEqual([3, 5, 7, 10, 11]);
        expect(handler.getChoices(tw, queryContext).slice(0, -1).map(choice => choice.failureTarget))
            .toEqual([3, 5, 7, 10, 11, 13]);
        expect(handler.getChoices(tw, queryContext).at(-2)).toEqual(jasmine.objectContaining({
            label: '!!',
            failureTarget: 13,
        }));
    });

    it('adds one Radical Heat Sink cooling point per functioning enabled sink only while active', () => {
        const handler = new RadicalHeatSinkHandler();
        const { entry } = equipmentFixture('F_RADICAL_HEATSINK');
        const dissipation: HeatDissipationState = {
            totalPips: 10,
            healthyPips: 8,
            damagedCount: 2,
            heatsinksOff: 1,
            totalDissipation: 7,
        };

        expect(handler.getHeatDissipationBonus(entry, dissipation, queryContext)).toBe(0);

        entry.setState(RADICAL_HEAT_SINK_ACTIVE_STATE_KEY, 'true');

        expect(handler.getHeatDissipationBonus(entry, dissipation, queryContext)).toBe(7);

        entry.setState(ENTRY_DISABLED_STATE_KEY, 'true');

        expect(handler.getHeatDissipationBonus(entry, dissipation, queryContext)).toBe(0);
    });

    it('applies failed coolant-system leak heat only after committed damage', () => {
        const handler = new RadicalHeatSinkHandler();
        const { entry, turnState } = equipmentFixture('F_RADICAL_HEATSINK', CORE_2026_GAME_RULES, 'Mek', {
            moveMode: () => 'run',
            weaponsHeat: () => 5,
        });

        entry.setPendingDestroyed(true);
        expect(handler.getInventoryHeatSources(entry, turnState, queryContext)).toEqual([]);

        entry.commitPendingDestroyed();
        expect(handler.getInventoryHeatSources(entry, turnState, queryContext)).toEqual([
            { id: 'radical-heat-sink:F_RADICAL_HEATSINK:movement', label: 'Radical Heat Sink leak', value: 1 },
            { id: 'radical-heat-sink:F_RADICAL_HEATSINK:weapons', label: 'Radical Heat Sink leak', value: 1 },
        ]);
    });

    it('models Core and TW Blue Shield safe uses as zero targets and never recovers them', () => {
        const handler = new BlueShieldHandler();
        const core = equipmentFixture('F_BLUE_SHIELD').entry;
        const tw = equipmentFixture('F_BLUE_SHIELD', TW_GAME_RULES).entry;

        expect(handler.getChoices(core, queryContext).slice(0, 6).map(choice => ({
            label: choice.label,
            target: choice.failureTarget,
        }))).toEqual([
            { label: '1', target: 0 },
            { label: '2', target: 0 },
            { label: '3', target: 0 },
            { label: '4', target: 0 },
            { label: '5', target: 0 },
            { label: '3+', target: 3 },
        ]);
        expect(handler.getChoices(tw, queryContext).slice(0, 7).map(choice => choice.failureTarget))
            .toEqual([0, 0, 0, 0, 0, 0, 3]);

        BlueShieldHandler.setSequenceState(core, 4);
        handler.onEndTurn(core, notifications());

        expect(BlueShieldHandler.getSequenceState(core)).toBe(4);
    });

    it('omits legacy TW Blue Shield failure checks for fighters', () => {
        const handler = new BlueShieldHandler();
        const twFighter = equipmentFixture('F_BLUE_SHIELD', TW_GAME_RULES, 'Aero').entry;

        expect(handler.getChoices(twFighter, queryContext)).toEqual([]);
    });

    it('uses standardized Core and legacy TW targets for the RISC Emergency Coolant System', () => {
        const handler = new RiscEmergencyCoolantSystemHandler();
        const core = equipmentFixture('F_EMERGENCY_COOLANT_SYSTEM').entry;
        const tw = equipmentFixture('F_EMERGENCY_COOLANT_SYSTEM', TW_GAME_RULES).entry;

        expect(handler.getChoices(core, queryContext).slice(0, -1).map(choice => choice.failureTarget))
            .toEqual([3, 5, 7, 10, 11]);
        expect(handler.getChoices(tw, queryContext).slice(0, -1).map(choice => choice.failureTarget))
            .toEqual([3, 5, 7, 10, 13]);

        RiscEmergencyCoolantSystemHandler.setSequenceState(core, 2);
        handler.onEndTurn(core, notifications());

        expect(RiscEmergencyCoolantSystemHandler.getSequenceState(core)).toBe(1);
        expect(core.states.has(RISC_EMERGENCY_COOLANT_SYSTEM_ACTIVE_STATE_KEY)).toBeFalse();
    });

    it('supports both RISC Viral Jammer flags, adds active heat, and never recovers the sequence', () => {
        const handler = new RiscViralJammerHandler();
        const decoy = equipmentFixture('F_VIRAL_JAMMER_DECOY').entry;
        const homing = equipmentFixture('F_VIRAL_JAMMER_HOMING', TW_GAME_RULES).entry;

        expect(handler.applicableTo(decoy)).toBeTrue();
        expect(handler.applicableTo(homing)).toBeTrue();
        expect(handler.getChoices(decoy, queryContext).slice(0, -1).map(choice => choice.failureTarget))
            .toEqual([3, 5, 7, 10, 11]);
        expect(handler.getChoices(homing, queryContext).slice(0, -1).map(choice => choice.failureTarget))
            .toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

        RiscViralJammerHandler.setSequenceState(decoy, 2);
        decoy.setState(RISC_VIRAL_JAMMER_ACTIVE_STATE_KEY, 'true');

        expect(handler.getInventoryHeatSources(decoy, decoy.owner.turnState(), queryContext)).toEqual([{
            id: 'risc-viral-jammer:F_VIRAL_JAMMER_DECOY',
            label: 'RISC Viral Jammer',
            value: 12,
        }]);

        handler.onEndTurn(decoy, notifications());
        handler.onEndTurn(decoy, notifications());

        expect(RiscViralJammerHandler.getSequenceState(decoy)).toBe(2);
        expect(decoy.states.has(RISC_VIRAL_JAMMER_ACTIVE_STATE_KEY)).toBeFalse();
    });
});
