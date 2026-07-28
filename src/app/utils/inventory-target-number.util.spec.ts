import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import type { InventoryTargetNumberInput } from './inventory-target-number.util';
import { inventoryTargetNumberState } from './inventory-target-number.util';

function artilleryInput(distance: number, gameRules: CBTGameRules = CORE_2026_GAME_RULES): InventoryTargetNumberInput {
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
        gameRules,
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
        expect(inventoryTargetNumberState(artilleryInput(7, TW_GAME_RULES)).text).toBe('X');
        expect(inventoryTargetNumberState(artilleryInput(15, TW_GAME_RULES)).text).toBe('6');
    });

    it('preserves typed nonnumeric hit outcomes', () => {
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitModifier: 'Vs' }).text).toBe('Vs');
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitModifier: '*' }).text).toBe('*');
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitModifier: null }).text).toBe('');
    });

    it('keeps targets beyond long range out of range before resolving hit state', () => {
        expect(inventoryTargetNumberState({ ...artilleryInput(31), hitModifier: 'Vs' }).text).toBe('X');
    });

    it('renders identified hit modifiers as separate lines', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitModifier: -2,
            hitModifierBreakdown: [
                { label: 'ER Medium Laser', modifier: -1 },
                { label: 'Targeting Computer', modifier: -1 }
            ]
        });

        expect(state.breakdown?.total).toBe(2);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ER Medium Laser', value: '-1' }));
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Targeting Computer', value: '-1' }));
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'Hit Modifier' }));
    });

    it('retains a concise negative destruction detail without changing the total', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitModifier: 0,
            hitModifierBreakdown: [{ label: 'Targeting Computer Destroyed', modifier: 0, negative: true }]
        });

        expect(state.breakdown?.total).toBe(4);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({
            label: 'Targeting Computer Destroyed', value: '+0', negative: true
        }));
    });

    it('falls back to the generic label when source totals are incomplete', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitModifier: 2,
            hitModifierBreakdown: [{ label: 'Incomplete', modifier: 1 }]
        });

        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Hit Modifier', value: '+2' }));
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'Incomplete' }));
    });

    it('orders regular terms before negative terms and heat last', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitModifier: 0,
            hitModifierBreakdown: [
                { label: 'Damaged Fire Control', modifier: 1, negative: true },
                { label: 'Targeting Computer', modifier: -1 }
            ],
            heatFireModifier: 2
        });

        expect(state.breakdown?.lines.map(line => line.label ?? (line.isBreak ? 'BREAK' : ''))).toEqual([
            'Gunnery',
            'Range (Short)',
            'Targeting Computer',
            'Damaged Fire Control',
            'Heat - Fire Modifier',
            'BREAK',
            'Total'
        ]);
    });
});
