import { WeaponEquipment, type AmmoType } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from '../models/rules/unit-type-rules';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { isEquipmentDisabledByFailure } from './disabled-equipment.handler';
import { UACJammingHandler } from './uacjamming.handler';

function owner() {
    return {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        rules: { computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: isEquipmentDisabledByFailure(entry), hitMod: 0 }) }
    } as never;
}

function weapon(ammoType: AmmoType): WeaponEquipment {
    return new WeaponEquipment({
        id: ammoType,
        name: ammoType,
        type: 'weapon',
        flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
        weapon: { ammoType }
    });
}

function entry(ammoType: AmmoType, states = new Map<string, string>()): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: ammoType,
        name: ammoType,
        equipment: weapon(ammoType),
        states
    });
}

describe('UACJammingHandler', () => {
    const handler = new UACJammingHandler();
    const context = {
        toastService: { showToast: jasmine.createSpy('showToast') }
    } as never as HandlerContext;

    beforeEach(() => {
        context.toastService.showToast = jasmine.createSpy('showToast');
    });

    it('applies to ultra and rotary autocannons', () => {
        expect(handler.applicableTo(entry('AC_ULTRA'))).toBeTrue();
        expect(handler.applicableTo(entry('AC_ULTRA_THB'))).toBeTrue();
        expect(handler.applicableTo(entry('AC_ROTARY'))).toBeTrue();
        expect(handler.applicableTo(entry('AC'))).toBeFalse();
    });

    it('toggles the shared disabled state with jam labels', () => {
        const mounted = entry('AC_ULTRA');

        expect(handler.getChoices(mounted, context)[0]).toEqual(jasmine.objectContaining({
            label: 'Jammed',
            shortLabel: 'Jam',
            active: false,
            value: ENTRY_DISABLED_STATE_VALUE
        }));

        handler.handleSelection(mounted, handler.getChoices(mounted, context)[0], context);

        expect(mounted.states.get(ENTRY_DISABLED_STATE_KEY)).toBe(ENTRY_DISABLED_STATE_VALUE);
        expect(mounted.states.has('state')).toBeFalse();
        expect(mounted.owner.setInventoryEntry).toHaveBeenCalledWith(mounted);
        expect(handler.getChoices(mounted, context)[0]).toEqual(jasmine.objectContaining({
            label: 'Jammed',
            shortLabel: 'Unjam',
            active: true,
        }));

        handler.handleSelection(mounted, handler.getChoices(mounted, context)[0], context);

        expect(mounted.states.has(ENTRY_DISABLED_STATE_KEY)).toBeFalse();
    });
});