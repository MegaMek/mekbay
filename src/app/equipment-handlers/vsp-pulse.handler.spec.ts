import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { VspPulseHandler } from './vsp-pulse.handler';

function owner() {
    return {
        rules: { computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: false, hitMod: 0 }) }
    } as never;
}

function weapon(flags: string[] = ['F_VSP']): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: 'vsp-laser',
        name: 'Medium VSP Laser',
        equipment: new WeaponEquipment({
            id: 'vsp-laser',
            name: 'Medium VSP Laser',
            type: 'weapon',
            flags,
            weapon: { ammoType: 'NA', heat: 7 }
        })
    });
}

describe('VspPulseHandler', () => {
    const handler = new VspPulseHandler();
    const context = {} as HandlerContext;

    it('applies VSP pulse hit modifiers by selected range', () => {
        const entry = weapon();

        expect(handler.getInventoryControlBaseHitModifier(entry, context, 'short')).toBe(-3);
        expect(handler.getInventoryControlBaseHitModifier(entry, context, 'medium')).toBe(-2);
        expect(handler.getInventoryControlBaseHitModifier(entry, context, 'long')).toBe(-1);
    });

    it('does not apply a modifier without a supported range or weapon entry', () => {
        expect(handler.getInventoryControlBaseHitModifier(weapon(), context, 'extreme')).toBeNull();
        expect(handler.getInventoryControlBaseHitModifier(weapon(), context, null)).toBeNull();
        expect(handler.getInventoryControlBaseHitModifier(new MountedEquipment({
            owner: owner(),
            id: 'misc',
            name: 'Misc',
            equipment: new MiscEquipment({ id: 'misc', name: 'Misc', type: 'misc', flags: ['F_VSP'] })
        }), context, 'short')).toBeNull();
    });

    it('has no picker controls for passive VSP behavior', () => {
        const entry = weapon();

        expect(handler.getChoices(entry, context)).toEqual([]);
        expect(handler.handleSelection(entry, { label: 'Mode', value: 'ignored' }, context)).toBeFalse();
    });
});
