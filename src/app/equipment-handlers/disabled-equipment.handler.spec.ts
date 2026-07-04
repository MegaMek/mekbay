import type { Equipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import { ENTRY_DISABLED_STATE_KEY } from '../models/rules/unit-type-rules';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { DisabledEquipmentHandler, isEquipmentDisabledByFailure } from './disabled-equipment.handler';

function owner() {
    return {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        rules: { computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: isEquipmentDisabledByFailure(entry), hitMod: 0 }) }
    } as never;
}

function entry(flags: string[], states = new Map<string, string>(), destroyed = false): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: flags.join('-') || 'entry',
        name: 'Entry',
        equipment: { name: 'Entry', flags: new Set(flags) } as Equipment,
        states,
        destroyed
    });
}

describe('DisabledEquipmentHandler', () => {
    const handler = new DisabledEquipmentHandler();
    const context = {
        toastService: { showToast: jasmine.createSpy('showToast') }
    } as never as HandlerContext;

    beforeEach(() => {
        context.toastService.showToast = jasmine.createSpy('showToast');
    });

    it('applies to equipment with any disableable failure flag', () => {
        expect(handler.applicableTo(entry(['F_RADICAL_HEATSINK']))).toBeTrue();
        expect(handler.applicableTo(entry(['F_OTHER', 'F_RADICAL_HEATSINK']))).toBeTrue();
        expect(handler.applicableTo(entry(['F_OTHER']))).toBeFalse();
    });

    it('is transparent unless disabled is true', () => {
        expect(isEquipmentDisabledByFailure(entry(['F_RADICAL_HEATSINK']))).toBeFalse();
        expect(isEquipmentDisabledByFailure(entry(['F_RADICAL_HEATSINK'], new Map([[ENTRY_DISABLED_STATE_KEY, 'false']])))).toBeFalse();
        expect(isEquipmentDisabledByFailure(entry(['F_RADICAL_HEATSINK'], new Map([[ENTRY_DISABLED_STATE_KEY, 'true']])))).toBeTrue();
    });

    it('toggles disabled state and persists the inventory entry', () => {
        const mounted = entry(['F_RADICAL_HEATSINK']);

        handler.handleSelection(mounted, handler.getChoices(mounted, context)[0], context);

        expect(mounted.states.get(ENTRY_DISABLED_STATE_KEY)).toBe('true');
        expect(mounted.owner.setInventoryEntry).toHaveBeenCalledWith(mounted);
        expect(mounted.owner.rules.computeEntryState(mounted).isDisabled).toBeTrue();

        handler.handleSelection(mounted, handler.getChoices(mounted, context)[0], context);

        expect(mounted.states.has(ENTRY_DISABLED_STATE_KEY)).toBeFalse();
        expect(mounted.owner.rules.computeEntryState(mounted).isDisabled).toBeFalse();
    });

    it('keeps the toggle available while the entry is disabled by this handler', () => {
        const mounted = entry(['F_RADICAL_HEATSINK'], new Map([[ENTRY_DISABLED_STATE_KEY, 'true']]));

        expect(handler.getChoices(mounted, context)[0]).toEqual(jasmine.objectContaining({ active: true, disabled: false }));
    });
});