import type { PickerChoice } from '../components/picker/picker.interface';
import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { EquipmentInteractionRegistry, type HandlerContext } from '../services/equipment-interaction-registry.service';
import { resolveInventoryControlDamageText } from '../utils/inventory-control-damage.util';
import {
    PPC_CAPACITOR_CHARGING_STATE,
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_FIRED_STATE_KEY,
    PPC_CAPACITOR_STATE_KEY,
    PpcCapacitorHandler
} from './ppc-capacitor.handler';

function setup(destroyed = false) {
    const owner = {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        rules: {
            computeEntryState: (entry: MountedEquipment) => ({
                isDamaged: entry.committedDestroyed(),
                isDisabled: false,
                hitMod: 0
            })
        }
    } as unknown as CBTForceUnit;
    const capacitor = new MountedEquipment({
        owner,
        id: 'capacitor',
        name: 'PPC Capacitor',
        destroyed,
        equipment: new MiscEquipment({
            id: 'PPC Capacitor',
            name: 'PPC Capacitor',
            type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR']
        })
    });
    const weapon = new MountedWeapon({
        owner,
        id: 'ppc',
        name: 'Light PPC',
        equipment: new WeaponEquipment({
            id: 'Light PPC',
            name: 'Light PPC',
            type: 'weapon',
            flags: ['F_PPC', 'F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { damage: 5 }
        }),
        linkedWith: [capacitor]
    });
    return { owner, weapon, capacitor };
}

const context = {
    toastService: { showToast: jasmine.createSpy('showToast') }
} as unknown as HandlerContext;

describe('PpcCapacitorHandler', () => {
    const handler = new PpcCapacitorHandler();

    it('adds five to typed point damage while charged', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        const damage = resolveInventoryControlDamageText(weapon, {
            selectedRange: null,
            selectedAmmo: null
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, context)
        });

        expect(damage).toBe('10 [DE]');
    });

    it('leaves damage unchanged when discharged or unavailable', () => {
        const discharged = setup();
        expect(resolveInventoryControlDamageText(discharged.weapon, {
            selectedRange: null,
            selectedAmmo: null
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, context)
        })).toBe('5 [DE]');

        const unavailable = setup(true);
        unavailable.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        expect(resolveInventoryControlDamageText(unavailable.weapon, {
            selectedRange: null,
            selectedAmmo: null
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, context)
        })).toBe('5 [DE]');
    });

    it('adds X to the parent PPC weapon types only while its capacitor is charged and usable', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        const baseTypes = new Set(['DE'] as const);
        const charged = setup();
        charged.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        expect(Array.from(registry.applyWeaponTypes(charged.weapon, baseTypes, context))).toEqual(['DE', 'X']);
        expect(Array.from(baseTypes)).toEqual(['DE']);

        const discharged = setup();
        expect(registry.applyWeaponTypes(discharged.weapon, baseTypes, context)).toBe(baseTypes);

        const unavailable = setup(true);
        unavailable.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        expect(registry.applyWeaponTypes(unavailable.weapon, baseTypes, context)).toBe(baseTypes);
    });

    it('adds five firing heat and exposes replaceable passive heat while charged', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        expect(handler.applyInventoryControlHeatEffects(weapon, { value: 5, weakened: false }, context))
            .toEqual({ value: 10, weakened: false });
        expect(handler.getInventoryHeatSources(weapon, {} as never)).toEqual([{
            id: 'ppc-capacitor:ppc',
            label: 'PPC Capacitor',
            value: 5,
            replacedByFiringEntryId: 'ppc'
        }]);
    });

    it('charges for one turn, blocks firing, and becomes charged at end turn', () => {
        const { weapon, capacitor } = setup();

        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, context);

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGING_STATE);
        expect(handler.isInventoryControlSelectable(weapon, context)).toBeFalse();
        expect(handler.getInventoryHeatSources(weapon, {} as never)[0]).toEqual(jasmine.objectContaining({ value: 5 }));
        expect(handler.applyInventoryControlHeatEffects(weapon, { value: 5, weakened: false }, context))
            .toEqual({ value: 5, weakened: false });

        handler.onEndTurn(weapon, context);

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(handler.isInventoryControlSelectable(weapon, context)).toBeNull();
    });

    it('discharges and marks the capacitor fired after firing', () => {
        const { weapon, capacitor, owner } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        handler.afterInventoryControlFire(weapon, context);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(capacitor.states.get(PPC_CAPACITOR_FIRED_STATE_KEY)).toBe('1');
        expect(owner.setInventoryEntry).toHaveBeenCalledWith(capacitor);
    });

    it('rejects charging after the linked PPC fired this turn', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_FIRED_STATE_KEY, '1');

        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, context);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(context.toastService.showToast).toHaveBeenCalledWith(
            'A fired PPC cannot charge its capacitor this turn.',
            'error'
        );
    });
});
