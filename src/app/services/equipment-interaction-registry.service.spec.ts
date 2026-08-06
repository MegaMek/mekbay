import type { PickerChoice } from '../components/picker/picker.interface';
import { ApolloHandler } from '../equipment-handlers/apollo.handler';
import { AtmHandler } from '../equipment-handlers/atm.handler';
import { InventoryModeHandler, INVENTORY_MODE_HANDLER_ID } from '../equipment-handlers/inventory-mode.handler';
import { type Equipment, WeaponEquipment } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { EquipmentInteractionHandler, EquipmentInteractionRegistryService, type HandlerContext } from './equipment-interaction-registry.service';
import type { Force } from '../models/force.model';

function svgEntry(html: string): SVGElement {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as SVGElement;
}

function owner(gameRules?: CBTGameRules): never {
    return {
        gameRules,
        getUnit: () => createEmptyUnit(),
        isEquipmentActionUnavailable: () => false,
        rules: { computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 }) },
    } as never;
}

function atmEntry(): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
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

function context(): HandlerContext {
    return {
        dataService: {
            getEquipmentRegistry: () => new EquipmentRegistry({}),
        },
        dialogsService: {},
        toastService: {}
    } as unknown as HandlerContext;
}

class ExtraDropdownHandler extends EquipmentInteractionHandler {
    readonly id = 'extra-dropdown-handler';

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [{ label: 'Extra', value: 'one', displayType: 'dropdown', choices: [{ label: 'One', value: 'one' }] }];
    }

    handleSelection(_equipment: MountedEquipment, _value: PickerChoice, _context: HandlerContext): boolean {
        return true;
    }
}

class SelectionHandler extends EquipmentInteractionHandler {
    readonly id = 'selection-handler';

    getChoices(_equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        return [{ label: 'Select', value: 'select' }];
    }

    handleSelection(_equipment: MountedEquipment, _value: PickerChoice, _context: HandlerContext): boolean {
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

describe('EquipmentInteractionRegistryService', () => {
    it('keeps SVG-owned mode choices with specialized ammo handlers present', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new InventoryModeHandler());
        registry.register(new AtmHandler());
        registry.register(new ExtraDropdownHandler());

        const handlers = registry.getHandlers(atmEntry()).map(handler => handler.id);

        expect(handlers).toContain('atm-handler');
        expect(handlers).toContain('extra-dropdown-handler');
        expect(handlers).toContain(INVENTORY_MODE_HANDLER_ID);

        const choices = registry.getChoices(atmEntry(), context());
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

        const choice = registry.getChoices(entry, context())[0];

        expect(registry.handleSelection(entry, choice, context())).toBeTrue();
    });

    it('dispatches force runtime changes generically to interested handlers', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const handler = new ForceRuntimeHandler();
        const force = {} as Force;
        const handlerContext = context();
        registry.register(handler);

        registry.onForceRuntimeChanged(force, handlerContext);

        expect(handler.onForceRuntimeChanged).toHaveBeenCalledOnceWith(force, handlerContext);
    });

    it('disables and rejects equipment actions when the owning unit cannot operate', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        const handler = new SelectionHandler();
        const selection = spyOn(handler, 'handleSelection').and.callThrough();
        const entry = atmEntry();
        entry.owner.isEquipmentActionUnavailable = () => true;
        registry.register(handler);

        const choice = registry.getChoices(entry, context())[0];

        expect(choice.disabled).toBeTrue();
        expect(registry.handleSelection(entry, choice, context())).toBeFalse();
        expect(selection).not.toHaveBeenCalled();
    });

    it('composes structured damage by priority without mutating the input', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new DamageHandler('late', 10, 1));
        registry.register(new DamageHandler('early', 1, 10));
        const input = { values: [5] as const, maximum: 10, unit: 'shot' as const };

        const result = registry.applyInventoryControlDamageEffects(
            atmEntry(), input, {} as never, context(),
        );

        expect(result).toEqual({ values: [16], maximum: 21, unit: 'shot' });
        expect(input).toEqual({ values: [5], maximum: 10, unit: 'shot' });
        expect(registry.getAllHandlers().map(handler => handler.id)).toEqual(['late', 'early']);
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
                stats: { toHitModifier: 1 },
                weapon: { ammoType: 'MRM', rackSize: 10, ranges: [3, 8, 15, 22] }
            }),
            linkedWith: [apollo]
        });

        const adjustments = registry.getToHitAdjustments(mrm, context());
        expect(adjustments).toEqual([{
            kind: 'add', value: -1,
            breakdown: [{ label: 'Apollo', modifier: -1 }]
        }]);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm, adjustments }).value).toBe(0);
    });

    it('reports a damaged TW Apollo bonus as weakened', () => {
        const registry = new EquipmentInteractionRegistryService().getRegistry();
        registry.register(new ApolloHandler());
        const apollo = new MountedEquipment({
            owner: owner(TW_GAME_RULES),
            id: 'apollo',
            name: 'Apollo',
            equipment: { flags: new Set(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']) } as Equipment
        });
        apollo.owner = {
            ...apollo.owner,
            rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === apollo, isDisabled: false, hitMod: 0 }) }
        } as never;
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

        const adjustments = registry.getToHitAdjustments(mrm, context());
        expect(adjustments).toEqual([{
            kind: 'add', value: 0,
            breakdown: [{ label: 'Apollo Destroyed', modifier: 0, weakened: true }]
        }]);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm, adjustments }).weakened).toBeTrue();
    });
});
