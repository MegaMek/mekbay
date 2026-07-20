import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import { CORE_2026_RULES_DATA, TW_RULES_DATA } from '../models/rules/cbt-rules-data';
import type { InventoryTargetNumberInput } from './inventory-target-number.util';
import { inventoryTargetNumberState } from './inventory-target-number.util';

function artilleryInput(distance: number, rulesData = CORE_2026_RULES_DATA): InventoryTargetNumberInput {
    const owner = { rules: { computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 }) } } as never;
    const equipment = new WeaponEquipment({
        id: 'ArrowIV',
        name: 'Arrow IV',
        type: 'weapon',
        weapon: { ammoType: 'ARROW_IV', ranges: [10, 20, 30, 40] },
    });
    const selectedAmmo = new AmmoEquipment({
        id: 'ArrowIVAmmo',
        name: 'Arrow IV Ammo',
        type: 'ammo',
        ammo: { type: 'ARROW_IV', shots: 5 },
    });
    const entry = new MountedEquipment({ owner, id: 'arrow', name: 'Arrow IV', equipment });

    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '10', medium: '20', long: '30' },
        selectedAmmo,
        target: { id: 'A', letter: 'A', name: 'Target', color: '#000', distance, tnModifier: 0 },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitModifier: 0,
        rulesData,
    };
}

describe('inventory target number rules profiles', () => {
    it('marks core2026 artillery targets at seven hexes or less out of range', () => {
        expect(inventoryTargetNumberState(artilleryInput(7)).text).toBe('X');
        expect(inventoryTargetNumberState(artilleryInput(8)).text).toBe('8');
    });

    it('uses a flat +4 artillery modifier at every valid range', () => {
        const short = inventoryTargetNumberState(artilleryInput(8));
        const medium = inventoryTargetNumberState(artilleryInput(15));

        expect(short.breakdown?.total).toBe(8);
        expect(medium.breakdown?.total).toBe(8);
        expect(medium.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Artillery', value: '+4' }));
    });

    it('keeps normal range rules for TW artillery', () => {
        expect(inventoryTargetNumberState(artilleryInput(7, TW_RULES_DATA)).text).toBe('X');
        expect(inventoryTargetNumberState(artilleryInput(15, TW_RULES_DATA)).text).toBe('6');
    });
});
