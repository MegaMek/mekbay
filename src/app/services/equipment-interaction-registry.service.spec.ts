// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { ApolloHandler } from '../equipment-handlers/apollo.handler';
import { AtmHandler } from '../equipment-handlers/atm.handler';
import { C3Handler } from '../equipment-handlers/c3.handler';
import { WeaponAmmoHandler } from '../equipment-handlers/weapon-ammo.handler';
import { InventoryModeHandler, INVENTORY_MODE_HANDLER_ID } from '../equipment-handlers/inventory-mode.handler';
import { MascHandler } from '../equipment-handlers/masc.handler';
import type { EquipmentAction, EquipmentStateEdit } from '../models/cbt-force-unit.model';
import { AmmoEquipment, type Equipment, WeaponEquipment } from '../models/equipment.model';
import type { EquipmentStatus } from '../models/equipment-status.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from '../models/rules/unit-type-rules';
import { createEmptyUnit, createTestEquipmentOwner } from '../testing/unit-test-helpers';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionHandler,
    EquipmentInteractionRegistryService,
    type HandlerCommandContext,
    type HandlerDialogsService,
    type HandlerQueryContext,
    type HandlerToastService,
} from './equipment-interaction-registry.service';
import type { Force } from '../models/force.model';
import type { AerospaceAttackValues } from '../utils/aerospace-range.util';
import { of } from 'rxjs';

function svgEntry(html: string): SVGElement {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as SVGElement;
}

function owner(gameRules?: CBTGameRules, operational = true, readOnly = false): never {
    return {
        gameRules,
        getUnit: () => createEmptyUnit(),
        getEquipmentStatus: () => operational ? 'available' : 'destroyed',
        getEquipmentStatusAtLocation: () => operational ? 'available' : 'destroyed',
        getInventoryControlSelectedAmmo: () => null,
        matchesInventoryControlAmmo: () => null,
        isEquipmentOperational: () => operational,
        canPerformEquipmentAction: () => operational,
        readOnly: () => readOnly,
    } as never;
}

function atmEntry(entryOwner: never = owner()): MountedEquipment {
    return new MountedEquipment({
        owner: entryOwner,
        id: 'ATM12@RA#1',
        name: 'ATM 12',
        equipment: new WeaponEquipment({ id: 'ATM12', name: 'ATM 12', type: 'weapon', weapon: { ammoType: 'ATM', rackSize: 12 } }),
        el: svgEntry(`
            <g class="inventoryEntry">
                <g class="alternativeMode" mode="Standard"><g class="name"><text>STD</text></g><g class="damage"><text>2/Msl</text></g></g>
                <g class="alternativeMode" mode="High Explosive"><g class="name"><text>HE</text></g><g class="damage"><text>3/Msl</text></g></g>
            </g>
        `)
    });
}

function mascEntry(readOnly = false): MountedEquipment {
    const getEquipmentStatus = (candidate: MountedEquipment): EquipmentStatus => candidate.committedDestroyed()
        ? 'destroyed'
        : candidate.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE
            ? 'disabled'
            : 'available';
    const mascOwner = {
        gameRules: CORE_2026_GAME_RULES,
        getEquipmentStatus,
        isEquipmentOperational: (candidate: MountedEquipment) => getEquipmentStatus(candidate) === 'available',
        canPerformEquipmentAction: (candidate: MountedEquipment) => getEquipmentStatus(candidate) === 'available',
        canEditEquipmentState: (candidate: MountedEquipment, edit: EquipmentStateEdit) => {
            if (readOnly) return false;
            const status = getEquipmentStatus(candidate);
            if (edit === 'enable') return status === 'disabled';
            if (edit === 'disable') return status === 'available';
            return false;
        },
        readOnly: () => readOnly,
        getNotificationDisplayName: () => 'Test Vehicle',
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        turnState: () => ({ airborne: () => null }),
    };
    return new MountedEquipment({
        owner: mascOwner as never,
        id: 'masc',
        name: 'MASC',
        equipment: { name: 'MASC', flags: new Set(['F_MASC']) } as Equipment,
    });
}

function queryContext(equipmentCatalog = new EquipmentRegistry({})): HandlerQueryContext {
    return createHandlerQueryContext(equipmentCatalog);
}

function commandContext(
    equipmentCatalog = new EquipmentRegistry({}),
    dialogsService = jasmine.createSpyObj<HandlerDialogsService>(
        'HandlerDialogsService',
        ['createDialog', 'showError', 'showNoticeHtml'],
    ),
): HandlerCommandContext {
    const toastService = jasmine.createSpyObj<HandlerToastService>(
        'HandlerToastService',
        ['showToast', 'toasts'],
    );
    return createHandlerCommandContext(equipmentCatalog, toastService, dialogsService);
}

class ExtraDropdownHandler extends EquipmentInteractionHandler {
    readonly id = 'extra-dropdown-handler';

    getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{ label: 'Extra', value: 'one', displayType: 'dropdown', choices: [{ label: 'One', value: 'one' }] }];
    }

    handleSelection(_equipment: MountedEquipment, _value: PickerChoice, _context: HandlerCommandContext): boolean {
        return true;
    }
}

class SelectionHandler extends EquipmentInteractionHandler {
    readonly id = 'selection-handler';

    getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{ label: 'Select', value: 'select' }];
    }

    handleSelection(_equipment: MountedEquipment, _value: PickerChoice, _context: HandlerCommandContext): boolean {
        return true;
    }
}

class ForceRuntimeHandler extends EquipmentInteractionHandler {
    readonly id = 'force-runtime-handler';
    override onForceRuntimeChanged = jasmine.createSpy('onForceRuntimeChanged');

    override getChoices(): PickerChoice[] {
        return [];
    }

    override handleSelection(): boolean {
        return false;
    }
}

class DamageHandler extends EquipmentInteractionHandler {
    constructor(readonly id: string, readonly amount: number, override readonly priority: number) {
        super();
    }

    override applyInventoryControlDamageEffects(
        _equipment: MountedEquipment,
        damage: { readonly values: readonly number[]; readonly maximum: number; readonly unit?: 'shot' },
    ) {
        return {
            ...damage,
            values: damage.values.map(value => value + this.amount),
            maximum: damage.maximum + this.amount,
        };
    }

    override getChoices(): PickerChoice[] {
        return [];
    }

    override handleSelection(): boolean {
        return false;
    }
}

class AerospaceAttackValueHandler extends EquipmentInteractionHandler {
    constructor(readonly id: string, readonly amount: number, override readonly priority: number) {
        super();
    }

    override applyInventoryControlAerospaceAttackValueEffects(
        _equipment: MountedEquipment,
        values: AerospaceAttackValues,
    ): AerospaceAttackValues {
        return [
            values[0] + this.amount,
            values[1] + this.amount,
            values[2] + this.amount,
            values[3] + this.amount,
        ];
    }

    override getChoices(): PickerChoice[] {
        return [];
    }

    override handleSelection(): boolean {
        return false;
    }
}

describe('EquipmentInteractionRegistryService', () => {
    it('creates pure query contexts from the equipment catalog without exposing DataService', () => {
        const equipmentCatalog = new EquipmentRegistry({});

        const queryContext = createHandlerQueryContext(equipmentCatalog, 'inventory');

        expect(queryContext).toEqual(jasmine.objectContaining({ equipmentCatalog, choiceSurface: 'inventory' }));
        expect(typeof queryContext.getStatus).toBe('function');
        expect(typeof queryContext.matchesAmmo).toBe('function');
        expect(typeof queryContext.canProvidePassiveEffect).toBe('function');
        expect(typeof queryContext.isReadOnly).toBe('function');
        expect('dataService' in queryContext).toBeFalse();
    });

    it('derives each canonical query from the mounted equipment owner', () => {
        const equipmentCatalog = new EquipmentRegistry({});
        const getEquipmentStatus = jasmine.createSpy('getEquipmentStatus').and.returnValue('disabled');
        const matchesInventoryControlAmmo = jasmine.createSpy('matchesInventoryControlAmmo').and.returnValue(true);
        const canPerformEquipmentAction = jasmine.createSpy('canPerformEquipmentAction').and.returnValue(false);
        const readOnly = jasmine.createSpy('readOnly').and.returnValue(true);
        const entry = new MountedEquipment({
            owner: {
                getEquipmentStatus,
                matchesInventoryControlAmmo,
                canPerformEquipmentAction,
                readOnly,
            } as never,
            id: 'query-entry',
            name: 'Query Entry',
        });
        const queryContext = createHandlerQueryContext(equipmentCatalog);

        expect(queryContext.getStatus(entry)).toBe('disabled');
        expect(queryContext.matchesAmmo(entry, {} as never, 'LRM')).toBeTrue();
        expect(queryContext.canProvidePassiveEffect(entry)).toBeFalse();
        expect(queryContext.isReadOnly(entry)).toBeTrue();
        expect(getEquipmentStatus).toHaveBeenCalledOnceWith(entry);
        expect(matchesInventoryControlAmmo).toHaveBeenCalledOnceWith(entry, {} as never, 'LRM');
        expect(canPerformEquipmentAction).toHaveBeenCalledOnceWith(entry, 'provide-passive-effect');
        expect(readOnly).toHaveBeenCalledOnceWith();
    });

    it('creates command contexts from narrow services without exposing DataService', () => {
        const equipmentCatalog = new EquipmentRegistry({});
        const toastService = { showToast: jasmine.createSpy('showToast') } as never;
        const dialogsService = {} as never;

        const commandContext = createHandlerCommandContext(equipmentCatalog, toastService, dialogsService);

        expect(commandContext).toEqual({ equipmentCatalog, toastService, dialogsService });
        expect('dataService' in commandContext).toBeFalse();
    });

    it('keeps SVG-owned mode choices with specialized ammo handlers present', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new InventoryModeHandler());
        registry.register(new AtmHandler());
        registry.register(new ExtraDropdownHandler());

        const handlers = registry.getHandlers(atmEntry()).map(handler => handler.id);

        expect(handlers).toContain('atm-handler');
        expect(handlers).toContain('extra-dropdown-handler');
        expect(handlers).toContain(INVENTORY_MODE_HANDLER_ID);

        const choices = registry.getChoices(atmEntry(), queryContext());
        const modeChoices = choices.filter(choice => choice.label === 'Mode' && choice.displayType === 'dropdown');
        expect(modeChoices.length).toBe(1);
        expect(modeChoices[0]._handler?.id).toBe(INVENTORY_MODE_HANDLER_ID);
        expect(modeChoices[0].value).toBe('Standard');
        expect(modeChoices[0].choices).toEqual([
            { label: 'STD', value: 'Standard', disabled: false },
            { label: 'ER', value: 'Extended Range', disabled: false },
            { label: 'HE', value: 'High Explosive', disabled: false },
        ]);
        expect(choices.some(choice => choice.label === 'Extra')).toBeTrue();
    });

    it('logs the stack trace before rejecting duplicate handler registration', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const consoleError = spyOn(console, 'error');
        registry.register(new AtmHandler());

        expect(() => registry.register(new AtmHandler())).toThrowError('Handler with id "atm-handler" is already registered');

        const loggedMessage = String(consoleError.calls.mostRecent().args[0]);
        expect(loggedMessage).toContain('Duplicate equipment handler registration attempted for "atm-handler".');
        expect(loggedMessage).toContain('Existing handler: AtmHandler.');
        expect(loggedMessage).toContain('Attempted handler: AtmHandler.');
        expect(loggedMessage).toContain('Error: Handler with id "atm-handler" is already registered');
    });

    it('delegates a handler selection to the selected handler', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const entry = atmEntry();
        registry.register(new SelectionHandler());

        const choice = registry.getChoices(entry, queryContext())[0];

        expect(registry.handleSelection(entry, choice, commandContext())).toBeTrue();
    });

    it('dispatches force runtime changes generically to interested handlers', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const handler = new ForceRuntimeHandler();
        const force = {} as Force;
        const notifications = commandContext().toastService;
        registry.register(handler);

        registry.onForceRuntimeChanged(force, notifications);

        expect(handler.onForceRuntimeChanged).toHaveBeenCalledOnceWith(force, notifications);
    });

    it('disables and rejects equipment actions when the owning unit cannot operate', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const handler = new SelectionHandler();
        const selection = spyOn(handler, 'handleSelection').and.callThrough();
        const entry = atmEntry();
        entry.owner.canPerformEquipmentAction = () => false;
        registry.register(handler);

        const choice = registry.getChoices(entry, queryContext())[0];

        expect(choice.disabled).toBeTrue();
        expect(registry.handleSelection(entry, choice, commandContext())).toBeFalse();
        expect(selection).not.toHaveBeenCalled();
    });

    it('rejects read-only commands without gating pure projections', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const selectionHandler = new SelectionHandler();
        const selection = spyOn(selectionHandler, 'handleSelection').and.callThrough();
        const entry = atmEntry(owner(undefined, true, true));
        registry.register(selectionHandler);
        registry.register(new DamageHandler('projection', 2, 1));

        const choice = registry.getChoices(entry, queryContext())[0];

        expect(choice.disabled).toBeTrue();
        expect(registry.handleSelection(entry, choice, commandContext())).toBeFalse();
        expect(selection).not.toHaveBeenCalled();
        expect(registry.applyInventoryControlDamageEffects(
            entry,
            { values: [5], maximum: 5, unit: 'shot' },
            {} as never,
            queryContext(),
        )).toEqual({ values: [7], maximum: 7, unit: 'shot' });
    });

    it('rejects read-only MASC sequence changes from the turn-summary choice surface', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const entry = mascEntry(true);
        registry.register(new MascHandler());
        const queryContext = createHandlerQueryContext(new EquipmentRegistry({}), 'turn-summary');

        const sequenceChoice = registry.getChoices(entry, queryContext)
            .find(choice => typeof choice.value === 'number')!;

        expect(sequenceChoice.disabled).toBeTrue();
        expect(registry.handleSelection(entry, sequenceChoice, commandContext())).toBeFalse();
        expect(entry.states.size).toBe(0);
        expect(entry.owner.setInventoryEntry).not.toHaveBeenCalled();
    });

    it('opens the read-only ammo dialog while keeping ammo mutations unavailable', async () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const ammo = new AmmoEquipment({
            id: 'LRM 10 Ammo',
            name: 'LRM 10 Ammo',
            type: 'ammo',
            ammo: { type: 'LRM', rackSize: 10, shots: 12 },
        });
        const ownerFixture = createTestEquipmentOwner({ readOnly: true });
        const ammoOwner = ownerFixture.owner;
        const weapon = new MountedEquipment({
            owner: ammoOwner,
            id: 'lrm-10',
            name: 'LRM 10',
            equipment: new WeaponEquipment({
                id: 'LRM 10', name: 'LRM 10', type: 'weapon',
                weapon: { ammoType: 'LRM', rackSize: 10 },
            }),
        });
        const ammoMount = new MountedEquipment({
            owner: ammoOwner,
            id: 'lrm-ammo',
            name: 'LRM 10 Ammo',
            equipment: ammo,
            totalAmmo: 12,
        });
        ownerFixture.inventory.push(weapon, ammoMount);
        const equipmentCatalog = new EquipmentRegistry({ [ammo.internalName]: ammo });
        const dialogsService = jasmine.createSpyObj<HandlerDialogsService>(
            'HandlerDialogsService',
            ['createDialog', 'showError', 'showNoticeHtml'],
        );
        const handlerQueryContext = queryContext(equipmentCatalog);
        const handlerCommandContext = commandContext(equipmentCatalog, dialogsService);
        registry.register(new WeaponAmmoHandler());

        const choice = registry.getChoices(weapon, handlerQueryContext)[0];

        expect(choice).toEqual(jasmine.objectContaining({
            value: 'weapon-ammo-dialog', readOnlySafe: true, disabled: false,
        }));
        await expectAsync(Promise.resolve(registry.handleSelection(weapon, choice, handlerCommandContext))).toBeResolvedTo(true);
        expect(dialogsService.createDialog).toHaveBeenCalledWith(jasmine.any(Function), jasmine.objectContaining({
            data: jasmine.objectContaining({ readOnly: true, initialTab: 'ammo' }),
        }));
    });

    it('opens read-only C3 configuration but ignores an updated dialog result', async () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const setNetwork = jasmine.createSpy('setNetwork');
        const force = { setNetwork } as never;
        const entry = new MountedEquipment({
            owner: {
                force,
                readOnly: () => true,
                canPerformEquipmentAction: (_entry: MountedEquipment, action: EquipmentAction) => action === 'configure-network',
                canEditEquipmentState: () => false,
            } as never,
            id: 'read-only-c3',
            name: 'C3 Master',
            equipment: { flags: new Set(['ANY_C3']) } as Equipment,
        });
        const equipmentCatalog = new EquipmentRegistry({});
        const dialogsService = jasmine.createSpyObj<HandlerDialogsService>(
            'HandlerDialogsService',
            ['createDialog', 'showError', 'showNoticeHtml'],
        );
        dialogsService.createDialog.and.returnValue({
            closed: of({ updated: true, networks: [{ id: 'forged-result' }] }),
        } as never);
        const handlerQueryContext = queryContext(equipmentCatalog);
        const handlerCommandContext = commandContext(equipmentCatalog, dialogsService);
        registry.register(new C3Handler());

        const choice = registry.getChoices(entry, handlerQueryContext)[0];

        expect(choice).toEqual(jasmine.objectContaining({
            action: 'configure-network', readOnlySafe: true, disabled: false,
        }));
        await expectAsync(Promise.resolve(registry.handleSelection(entry, choice, handlerCommandContext))).toBeResolvedTo(true);
        expect(dialogsService.createDialog).toHaveBeenCalledWith(jasmine.any(Function), jasmine.objectContaining({
            data: jasmine.objectContaining({ readOnly: true }),
        }));
        expect(setNetwork).not.toHaveBeenCalled();
    });

    it('routes C3 configuration through the configure-network action policy', async () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const canPerformEquipmentAction = jasmine.createSpy('canPerformEquipmentAction')
            .and.callFake((_entry: MountedEquipment, action: EquipmentAction) => action === 'configure-network');
        const entry = new MountedEquipment({
            owner: {
                canPerformEquipmentAction,
                canEditEquipmentState: () => false,
                readOnly: () => false,
            } as never,
            id: 'c3-master',
            name: 'C3 Master',
            equipment: { flags: new Set(['ANY_C3']) } as Equipment,
        });
        const handler = new C3Handler();
        const selection = spyOn(handler, 'handleSelection').and.resolveTo(true);
        registry.register(handler);

        const choice = registry.getChoices(entry, queryContext())[0];

        expect(choice).toEqual(jasmine.objectContaining({ action: 'configure-network', disabled: false }));
        expect(canPerformEquipmentAction).toHaveBeenCalledOnceWith(entry, 'configure-network');
        canPerformEquipmentAction.calls.reset();

        await expectAsync(Promise.resolve(registry.handleSelection(entry, choice, commandContext()))).toBeResolvedTo(true);
        expect(canPerformEquipmentAction).toHaveBeenCalledOnceWith(entry, 'configure-network');
        expect(selection).toHaveBeenCalledOnceWith(entry, choice, jasmine.any(Object));
    });

    it('routes MASC disable and enable state edits through the production registry', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const entry = mascEntry();
        registry.register(new MascHandler());

        const disableChoice = registry.getChoices(entry, queryContext()).at(-1)!;

        expect(disableChoice).toEqual(jasmine.objectContaining({ stateEdit: 'disable', disabled: false }));
        expect(registry.handleSelection(entry, disableChoice, commandContext())).toBeTrue();
        expect(entry.owner.getEquipmentStatus(entry)).toBe('disabled');
        expect(entry.owner.canPerformEquipmentAction(entry, 'change-mode')).toBeFalse();

        const enableChoice = registry.getChoices(entry, queryContext()).at(-1)!;

        expect(enableChoice).toEqual(jasmine.objectContaining({ stateEdit: 'enable', disabled: false }));
        expect(registry.handleSelection(entry, enableChoice, commandContext())).toBeTrue();
        expect(entry.owner.getEquipmentStatus(entry)).toBe('available');
    });

    it('composes structured damage by priority without mutating the input', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new DamageHandler('late', 10, 1));
        registry.register(new DamageHandler('early', 1, 10));
        const input = { values: [5] as const, maximum: 10, unit: 'shot' as const };

        const result = registry.applyInventoryControlDamageEffects(
            atmEntry(), input, {} as never, queryContext(),
        );

        expect(result).toEqual({ values: [16], maximum: 21, unit: 'shot' });
        expect(input).toEqual({ values: [5], maximum: 10, unit: 'shot' });
        expect(registry.getAllHandlers().map(handler => handler.id)).toEqual(['late', 'early']);
    });

    it('composes aerospace attack-value effects through inventory-control rules', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new AerospaceAttackValueHandler('late', 1, 1));
        registry.register(new AerospaceAttackValueHandler('early', 2, 10));
        const input = [4, 3, 2, 1] as const;

        const result = registry.inventoryControlRules(queryContext())
            .applyAerospaceAttackValueEffects!(atmEntry(), input);

        expect(result).toEqual([7, 6, 5, 4]);
        expect(input).toEqual([4, 3, 2, 1]);
    });

    it('aggregates the TW Apollo bonus for a linked MRM launcher', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new ApolloHandler());
        const apollo = new MountedEquipment({
            owner: owner(TW_GAME_RULES),
            id: 'apollo',
            name: 'Apollo',
            equipment: { flags: new Set(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']) } as Equipment
        });
        const mrm = new MountedEquipment({
            owner: owner(TW_GAME_RULES),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({
                id: 'MRM10', name: 'MRM 10', type: 'weapon',
                flags: ['F_MRM'],
                stats: { toHitModifier: 0 },
                weapon: { ammoType: 'MRM', rackSize: 10, ranges: [3, 8, 15, 22] }
            }),
            linkedWith: [apollo]
        });

        const adjustments = registry.getToHitAdjustments(mrm, queryContext());
        expect(adjustments).toEqual([{
            kind: 'add', label: 'Apollo', modifier: -1, weakened: false
        }]);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm, adjustments }).value).toBe(0);
    });

    it('reports a damaged TW Apollo bonus as weakened', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new ApolloHandler());
        const apollo = new MountedEquipment({
            owner: owner(TW_GAME_RULES, false),
            id: 'apollo',
            name: 'Apollo',
            equipment: { flags: new Set(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']) } as Equipment
        });
        const mrm = new MountedEquipment({
            owner: owner(TW_GAME_RULES),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({
                id: 'MRM10', name: 'MRM 10', type: 'weapon',
                flags: ['F_MRM'],
                weapon: { ammoType: 'MRM', rackSize: 10, ranges: [3, 8, 15, 22] }
            }),
            linkedWith: [apollo]
        });

        const adjustments = registry.getToHitAdjustments(mrm, queryContext());
        expect(adjustments).toEqual([{
            kind: 'add', label: 'Apollo Destroyed', modifier: 0, weakened: true
        }]);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm, adjustments }).weakened).toBeTrue();
    });
});
