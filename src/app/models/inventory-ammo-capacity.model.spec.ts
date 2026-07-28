import {
    distributeInventoryAmmoTotal,
    resolveInventoryOriginalAmmoTotal,
} from './inventory-ammo-capacity.model';
import type { UnitComponent } from './units.model';

function components(component: Partial<UnitComponent>): UnitComponent[] {
    return [{ id: 'ammo', n: 'Ammo', t: 'X', p: 0, l: 'RT', q: 1, q2: 0, os: 0, ...component }];
}

describe('inventory ammo capacity', () => {
    it('distributes remainders deterministically to the first bins', () => {
        expect(distributeInventoryAmmoTotal(25, 2, 0)).toBe(13);
        expect(distributeInventoryAmmoTotal(25, 2, 1)).toBe(12);
        expect(distributeInventoryAmmoTotal(24, 2, 0)).toBe(12);
        expect(distributeInventoryAmmoTotal(10, 0, 0)).toBe(10);
    });

    it('uses component aggregate ammunition before definition and stored fallbacks', () => {
        const input = {
            components: components({ q: 2, q2: 25 }),
            maximumShotsPerBin: 20,
            storedTotalAmmo: 5,
        };

        expect(resolveInventoryOriginalAmmoTotal({ ...input, entryId: 'Ammo#0.0' })).toBe(13);
        expect(resolveInventoryOriginalAmmoTotal({ ...input, entryId: 'Ammo#0.1' })).toBe(12);
        expect(resolveInventoryOriginalAmmoTotal({ ...input, entryId: 'Ammo#0' })).toBe(25);
    });

    it('falls back to definition capacity, stored total, and zero', () => {
        expect(resolveInventoryOriginalAmmoTotal({
            entryId: 'Ammo#0.0', components: components({ q: 2, q2: 0 }), maximumShotsPerBin: 10,
        })).toBe(10);
        expect(resolveInventoryOriginalAmmoTotal({
            entryId: 'malformed', components: [], maximumShotsPerBin: 0, storedTotalAmmo: 7,
        })).toBe(7);
        expect(resolveInventoryOriginalAmmoTotal({
            entryId: 'malformed', components: [], maximumShotsPerBin: 0,
        })).toBe(0);
    });
});
