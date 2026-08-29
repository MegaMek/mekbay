// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { MiscEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import {
    isNovaCewsEffectivelyActive,
    NOVA_CEWS_OFF_STATE,
    NOVA_CEWS_ON_STATE,
    NOVA_CEWS_STATE_KEY,
    NOVA_CEWS_TURNING_OFF_STATE,
    NOVA_CEWS_TURNING_ON_STATE,
} from '../utils/ecm-state.util';
import { BAPHandler } from './bap.handler';
import { C3Handler } from './c3.handler';
import { ECMHandler } from './ecm.handler';
import { NOVA_CEWS_HANDLER_ID, NovaCewsHandler } from './nova-cews.handler';

function fixture() {
    const test = createTestEquipmentOwner({
        resolveEquipmentActionPermission: () => true,
    });
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    Object.assign(test.owner, {
        turnState: () => ({ markEquipmentStateChanged }),
    });
    spyOn(test.owner, 'setInventoryEntry').and.callThrough();

    const add = (id = 'nova', states = new Map<string, string>()) => {
        const equipment = new MiscEquipment({
            id: 'NovaCEWS',
            name: 'Nova Combined Electronic Warfare System (CEWS)',
            shortName: 'Nova CEWS',
            type: 'misc',
            flags: ['F_NOVA', 'F_ECM', 'F_BAP', 'ANY_C3'],
            modes: ['ECM', 'Off'],
        });
        const mounted = new MountedEquipment({
            owner: test.owner,
            id,
            name: equipment.name,
            equipment,
            states,
        });
        test.owner.setInventoryEntry(mounted);
        return mounted;
    };

    return { ...test, add, markEquipmentStateChanged };
}

describe('NovaCewsHandler', () => {
    const handler = new NovaCewsHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast', 'toasts']);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        toastService,
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    beforeEach(() => toastService.showToast.calls.reset());

    it('replaces the independent ECM and probe controls with one shared toggle', () => {
        const mounted = fixture().add();
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        registry.register(new ECMHandler());
        registry.register(new BAPHandler());
        registry.register(new C3Handler());

        expect(registry.getHandlers(mounted).map(candidate => candidate.id)).toEqual([
            NOVA_CEWS_HANDLER_ID,
            'c3-handler',
        ]);
        expect(registry.getChoices(mounted, queryContext).map(choice => choice.label)).toEqual([
            'Nova CEWS is ON',
            'Configure',
        ]);
    });

    it('defaults to active and contributes the rules-mandated two heat', () => {
        const mounted = fixture().add();

        expect(isNovaCewsEffectivelyActive(mounted)).toBeTrue();
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Nova CEWS is ON',
            value: NOVA_CEWS_TURNING_OFF_STATE,
            active: true,
            displayType: 'toggle',
        }));
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, queryContext)).toEqual([{
            id: 'nova-cews:nova',
            label: 'Nova CEWS',
            value: 2,
            group: 'Equipment',
        }]);
    });

    it('keeps its effects and heat through a pending End-Phase shutdown', () => {
        const test = fixture();
        const mounted = test.add();

        handler.handleSelection(
            mounted,
            handler.getChoices(mounted, queryContext)[0] as PickerChoice,
            commandContext,
        );

        expect(mounted.states.get(NOVA_CEWS_STATE_KEY)).toBe(NOVA_CEWS_TURNING_OFF_STATE);
        expect(isNovaCewsEffectivelyActive(mounted)).toBeTrue();
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, queryContext)[0].value).toBe(2);
        expect(test.markEquipmentStateChanged).toHaveBeenCalledTimes(1);

        handler.onEndTurn(mounted);

        expect(mounted.states.get(NOVA_CEWS_STATE_KEY)).toBe(NOVA_CEWS_OFF_STATE);
        expect(isNovaCewsEffectivelyActive(mounted)).toBeFalse();
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, queryContext)).toEqual([]);
    });

    it('does not activate or generate heat until a pending startup completes', () => {
        const test = fixture();
        const mounted = test.add('nova', new Map([[NOVA_CEWS_STATE_KEY, NOVA_CEWS_OFF_STATE]]));

        handler.handleSelection(
            mounted,
            handler.getChoices(mounted, queryContext)[0] as PickerChoice,
            commandContext,
        );

        expect(mounted.states.get(NOVA_CEWS_STATE_KEY)).toBe(NOVA_CEWS_TURNING_ON_STATE);
        expect(isNovaCewsEffectivelyActive(mounted)).toBeFalse();
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, queryContext)).toEqual([]);

        handler.onEndTurn(mounted);

        expect(mounted.states.get(NOVA_CEWS_STATE_KEY)).toBe(NOVA_CEWS_ON_STATE);
        expect(isNovaCewsEffectivelyActive(mounted)).toBeTrue();
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, queryContext)[0].value).toBe(2);
    });

    it('does not multiply heat when a unit carries multiple active mounts', () => {
        const test = fixture();
        const first = test.add('nova-1');
        const second = test.add('nova-2');
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        expect(isNovaCewsEffectivelyActive(first)).toBeTrue();
        expect(isNovaCewsEffectivelyActive(second)).toBeFalse();
        expect(registry.getInventoryHeatSources(
            [first, second],
            {} as TurnState,
            queryContext,
        )).toEqual([{
            id: 'nova-cews:nova-1',
            label: 'Nova CEWS',
            value: 2,
            group: 'Equipment',
        }]);
    });

    it('hands operation to another mount only after the End-Phase transition', () => {
        const test = fixture();
        const first = test.add('nova-1');
        const second = test.add('nova-2');

        expect(handler.getChoices(second, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Nova CEWS is OFF',
            value: NOVA_CEWS_TURNING_ON_STATE,
        }));

        handler.handleSelection(
            second,
            handler.getChoices(second, queryContext)[0] as PickerChoice,
            commandContext,
        );

        expect(first.states.has(NOVA_CEWS_STATE_KEY)).toBeFalse();
        expect(second.states.get(NOVA_CEWS_STATE_KEY)).toBe(NOVA_CEWS_TURNING_ON_STATE);
        expect(isNovaCewsEffectivelyActive(first)).toBeTrue();
        expect(isNovaCewsEffectivelyActive(second)).toBeFalse();

        handler.onEndTurn(first);
        handler.onEndTurn(second);

        expect(isNovaCewsEffectivelyActive(first)).toBeFalse();
        expect(isNovaCewsEffectivelyActive(second)).toBeTrue();
    });

    it('leaves the current mount active when a pending handoff is cancelled', () => {
        const test = fixture();
        const first = test.add('nova-1');
        const second = test.add('nova-2');

        handler.handleSelection(second, handler.getChoices(second, queryContext)[0], commandContext);
        handler.handleSelection(second, handler.getChoices(second, queryContext)[0], commandContext);
        handler.onEndTurn(first);
        handler.onEndTurn(second);

        expect(isNovaCewsEffectivelyActive(first)).toBeTrue();
        expect(isNovaCewsEffectivelyActive(second)).toBeFalse();
    });

    it('suppresses heat when the active mount cannot provide passive effects', () => {
        const test = createTestEquipmentOwner({ destroyed: true });
        const equipment = new MiscEquipment({
            id: 'NovaCEWS',
            name: 'Nova CEWS',
            type: 'misc',
            flags: ['F_NOVA'],
        });
        const mounted = new MountedEquipment({
            owner: test.owner,
            id: 'nova',
            name: equipment.name,
            equipment,
        });
        test.owner.setInventoryEntry(mounted);

        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, queryContext)).toEqual([]);
    });
});
