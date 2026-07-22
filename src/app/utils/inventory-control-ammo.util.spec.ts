import { AmmoEquipment } from '../models/equipment.model';
import { resolveInventoryControlSelectedAmmoOption, type InventoryControlAmmoOption } from './inventory-control.util';

describe('inventory-control ammo selection', () => {
    it('uses stable source order when no choice is persisted', () => {
        const first = option('standard:first', 'Standard', 1);
        const second = option('standard:second', 'Standard', 10);

        expect(resolveInventoryControlSelectedAmmoOption([first, second])).toBe(first);
    });

    it('fails over to a usable bin of the same munition', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const sameMunition = option('standard:second', 'Standard', 2);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption(
            [depleted, otherMunition, sameMunition],
            depleted.id
        )).toBe(sameMunition);
    });

    it('keeps an explicit depleted munition when no same-munition bin is usable', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption([depleted, otherMunition], depleted.id)).toBe(depleted);
    });

    it('keeps the only option even when destroyed', () => {
        const destroyed = { ...option('standard:first', 'Standard', 0), destroyed: true, disabled: true };

        expect(resolveInventoryControlSelectedAmmoOption([destroyed], destroyed.id)).toBe(destroyed);
    });
});

function option(id: string, internalName: string, remaining: number): InventoryControlAmmoOption {
    return {
        id,
        label: internalName,
        ammo: new AmmoEquipment({
            id: internalName,
            name: internalName,
            type: 'ammo',
            ammo: { type: 'AC', shots: 10 }
        }),
        remaining,
        total: 10,
        destroyed: false,
        disabled: false
    };
}
