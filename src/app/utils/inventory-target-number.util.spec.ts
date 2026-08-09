// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules, type HitModifier, type ToHitModifierBreakdownEntry, type ToHitResolution } from '../models/rules/game-rules';
import type { InventoryTargetNumberInput } from './inventory-target-number.util';
import { inventoryTargetNumberBreakdown, inventoryTargetNumberState, inventoryTargetRangeSelection } from './inventory-target-number.util';

function toHitResolution(
    value: HitModifier = 0,
    modifierBreakdown: readonly ToHitModifierBreakdownEntry[] = []
): ToHitResolution {
    return {
        profile: typeof value === 'number' ? [value] : [],
        value,
        changed: false,
        weakened: modifierBreakdown.some(entry => entry.weakened === true),
        modifierBreakdown,
    };
}

function artilleryInput(distance: number, gameRules: CBTGameRules = CORE_2026_GAME_RULES): InventoryTargetNumberInput {
    const owner = {} as never;
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
        hitResolution: toHitResolution(),
        gameRules,
    };
}

function aeroInput(
    distance: number,
    maxRangeBracket: WeaponEquipment['maxRangeBracket'] = 'extreme',
    targetUnitType: 'aero' | 'mek-biped' = 'aero',
    capital = false
): InventoryTargetNumberInput {
    const owner = {
        getUnit: () => ({ type: 'Aero' }),
    } as never;
    const equipment = new WeaponEquipment({
        id: 'AeroWeapon',
        name: 'Aero Weapon',
        type: 'weapon',
        weapon: {
            ammoType: 'NA',
            ranges: [7, 14, 21, 28],
            av: [8, 8, 8, 8],
            maxRangeBracket,
            capital
        }
    });
    const entry = new MountedEquipment({ owner, id: 'aero-weapon', name: 'Aero Weapon', equipment });

    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '6', medium: '12', long: '20' },
        target: { id: 'A', letter: 'A', name: 'Target', color: '#000', unitType: targetUnitType, distance, tnModifier: 0 },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
    };
}

function c3LaserInput(actualDistance: number, c3Distance: number, allowExtremeRange = false): InventoryTargetNumberInput {
    const owner = {} as never;
    const equipment = new WeaponEquipment({
        id: 'ERLargeLaser',
        name: 'ER Large Laser',
        type: 'weapon',
        weapon: { ammoType: 'NA', ranges: [7, 14, 19, 25] },
    });
    const entry = new MountedEquipment({ owner, id: 'er-large-laser', name: equipment.internalName, equipment });
    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '7', medium: '14', long: '19' },
        extremeRange: 25,
        target: { id: 'A', letter: 'A', name: 'Target', color: '#000', distance: actualDistance, c3Distance, useC3: true, tnModifier: 0 },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
        c3DegradationSource: 'unit',
        allowExtremeRange,
        gameRules: CORE_2026_GAME_RULES,
    };
}

describe('inventory target number rules profiles', () => {
    it('adds +1 ECM when C3 improves long range to medium', () => {
        const state = inventoryTargetNumberState(c3LaserInput(15, 12));

        expect(state.rangeSelection?.range).toBe('medium');
        expect(state.breakdown?.total).toBe(7);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM', value: '+1', weakened: true }));
    });

    it('adds +1 ECM when C3 improves medium range to short', () => {
        const state = inventoryTargetNumberState(c3LaserInput(10, 7));

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.breakdown?.total).toBe(5);
    });

    it('adds +2 ECM when C3 improves long range to short', () => {
        const state = inventoryTargetNumberState(c3LaserInput(15, 7));

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.breakdown?.total).toBe(6);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM', value: '+2', weakened: true }));
    });

    it('does not add ECM without a C3 bracket improvement', () => {
        const sameBracket = inventoryTargetNumberState(c3LaserInput(13, 10));
        const c3DisabledInput = c3LaserInput(15, 12);
        c3DisabledInput.target = { ...c3DisabledInput.target!, useC3: false };
        const c3Disabled = inventoryTargetNumberState(c3DisabledInput);

        expect(sameBracket.breakdown?.total).toBe(6);
        expect(sameBracket.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
        expect(c3Disabled.breakdown?.total).toBe(8);
        expect(c3Disabled.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
    });

    it('does not apply C3 to an indirect-fire target', () => {
        const input = c3LaserInput(15, 7);
        input.target = {
            ...input.target!,
            tnCalculator: { indirectFire: true }
        };

        const state = inventoryTargetNumberState(input);

        expect(state.rangeSelection?.range).toBe('long');
        expect(state.rangeSelection?.c3Distance).toBeNull();
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
    });

    it('keeps ground attacks beyond Long illegal when Extreme range is disabled', () => {
        const input = c3LaserInput(20, 20);

        const selection = inventoryTargetRangeSelection(input);

        expect(selection).toEqual(jasmine.objectContaining({
            range: 'extreme',
            outOfRange: true,
            outOfLongRange: true,
            outOfExtremeRange: false
        }));
        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('allows ground Extreme attacks through the exact Extreme boundary when enabled', () => {
        const firstExtreme = c3LaserInput(20, 20, true);
        const exactExtreme = c3LaserInput(25, 25, true);
        const beyondExtreme = c3LaserInput(26, 26, true);

        expect(inventoryTargetRangeSelection(firstExtreme)).toEqual(jasmine.objectContaining({ range: 'extreme', outOfRange: false }));
        expect(inventoryTargetNumberState(firstExtreme).text).toBe('10');
        expect(inventoryTargetRangeSelection(exactExtreme)).toEqual(jasmine.objectContaining({ range: 'extreme', outOfRange: false }));
        expect(inventoryTargetNumberState(exactExtreme).text).toBe('10');
        expect(inventoryTargetRangeSelection(beyondExtreme)).toEqual(jasmine.objectContaining({
            range: 'extreme', outOfRange: true, outOfExtremeRange: true
        }));
        expect(inventoryTargetNumberState(beyondExtreme).text).toBe('X');
    });

    it('counts out-of-range to Long as one increment when Extreme range is disabled', () => {
        const input = c3LaserInput(20, 19);
        const breakdown = inventoryTargetNumberBreakdown(input);

        expect(breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM', value: '+1' }));
    });

    it('counts out-of-range to Medium as two increments when Extreme range is disabled', () => {
        const input = c3LaserInput(20, 14);

        expect(inventoryTargetNumberBreakdown(input)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+2' }));
    });

    it('counts out-of-range to Extreme as one and out-of-range to Long as two when Extreme is enabled', () => {
        const toExtreme = c3LaserInput(26, 25, true);
        const toLong = c3LaserInput(26, 19, true);

        expect(inventoryTargetNumberBreakdown(toExtreme)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+1' }));
        expect(inventoryTargetNumberBreakdown(toLong)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+2' }));
    });

    it('uses one bracket beyond the closest C3 unit for legal Extreme attacks', () => {
        const cases: ReadonlyArray<{
            c3Distance: number;
            range: 'medium' | 'long' | 'extreme';
            modifier: string | null;
        }> = [
            { c3Distance: 19, range: 'extreme', modifier: null },
            { c3Distance: 14, range: 'long', modifier: '+1' },
            { c3Distance: 7, range: 'medium', modifier: '+2' }
        ] as const;

        for (const testCase of cases) {
            const state = inventoryTargetNumberState(c3LaserInput(25, testCase.c3Distance, true));
            expect(state.rangeSelection?.range).withContext(`C3 distance ${testCase.c3Distance}`)
                .toBe(testCase.range);
            if (testCase.modifier === null) {
                expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
            } else {
                expect(state.breakdown?.lines).withContext(`C3 distance ${testCase.c3Distance}`)
                    .toContain(jasmine.objectContaining({ label: 'ECM', value: testCase.modifier }));
            }
        }
    });

    it('does not shift the C3 bracket for non-Extreme attacks', () => {
        const state = inventoryTargetNumberState(c3LaserInput(19, 7, true));

        expect(state.rangeSelection?.range).toBe('short');
    });

    it('does not let C3 make a beyond-Extreme ground attack legal', () => {
        const state = inventoryTargetNumberState(c3LaserInput(26, 7, true));

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.rangeSelection?.outOfRange).toBeTrue();
        expect(state.text).toBe('X');
    });

    it('does not synthesize an Extreme bracket for a sparse ground range profile', () => {
        const input = c3LaserInput(10, 10, true);
        input.display = { min: '—', short: '5', medium: '—', long: '—' };

        expect(inventoryTargetRangeSelection(input)).toEqual(jasmine.objectContaining({
            maximumRange: 'short',
            outOfRange: true
        }));
        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('selects standard-scale Aero-to-Aero brackets at MegaMek boundaries', () => {
        const cases = [
            { distance: 6, range: 'short' },
            { distance: 7, range: 'medium' },
            { distance: 12, range: 'medium' },
            { distance: 13, range: 'long' },
            { distance: 20, range: 'long' },
            { distance: 21, range: 'extreme' },
            { distance: 25, range: 'extreme' },
        ] as const;

        for (const testCase of cases) {
            const selection = inventoryTargetRangeSelection(aeroInput(testCase.distance));
            expect(selection?.range).withContext(`distance ${testCase.distance}`).toBe(testCase.range);
            expect(selection?.outOfRange).withContext(`distance ${testCase.distance}`).toBeFalse();
        }
        expect(inventoryTargetRangeSelection(aeroInput(26))?.outOfRange).toBeTrue();
    });

    it('rejects Aero brackets beyond the weapon maximum range bracket', () => {
        expect(inventoryTargetRangeSelection(aeroInput(7, 'short'))?.outOfRange).toBeTrue();
        expect(inventoryTargetRangeSelection(aeroInput(13, 'medium'))?.outOfRange).toBeTrue();
        expect(inventoryTargetRangeSelection(aeroInput(21, 'long'))?.outOfRange).toBeTrue();
        expect(inventoryTargetRangeSelection(aeroInput(21, 'extreme'))?.outOfRange).toBeFalse();
    });

    it('uses the short bracket for Aero-to-Ground attacks regardless of entered distance', () => {
        const selection = inventoryTargetRangeSelection(aeroInput(20, 'short', 'mek-biped'));

        expect(selection).toEqual(jasmine.objectContaining({
            range: 'short',
            outOfRange: false,
            minimumRangeModifier: 0
        }));
    });

    it('uses capital aerospace range boundaries for capital weapons', () => {
        expect(inventoryTargetRangeSelection(aeroInput(12, 'extreme', 'aero', true))?.range).toBe('short');
        expect(inventoryTargetRangeSelection(aeroInput(13, 'extreme', 'aero', true))?.range).toBe('medium');
        expect(inventoryTargetRangeSelection(aeroInput(41, 'extreme', 'aero', true))?.range).toBe('extreme');
        expect(inventoryTargetRangeSelection(aeroInput(51, 'extreme', 'aero', true))?.outOfRange).toBeTrue();
    });

    it('uses C3 only for the Aero to-hit bracket, not weapon range legality', () => {
        const input = aeroInput(18, 'long');
        input.target = { ...input.target!, useC3: true, c3Distance: 5 };
        const selection = inventoryTargetRangeSelection(input);

        expect(selection?.range).toBe('short');
        expect(selection?.outOfRange).toBeFalse();

        const outOfRangeInput = aeroInput(21, 'long');
        outOfRangeInput.target = { ...outOfRangeInput.target!, useC3: true, c3Distance: 5 };
        expect(inventoryTargetRangeSelection(outOfRangeInput)?.outOfRange).toBeTrue();
    });

    it('counts Aero out-of-range to Long as two C3 bracket improvements', () => {
        const input = aeroInput(26, 'extreme');
        input.target = { ...input.target!, useC3: true, c3Distance: 20 };
        input.gameRules = CORE_2026_GAME_RULES;
        input.c3DegradationSource = 'unit';

        expect(inventoryTargetNumberBreakdown(input)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+2' }));
    });

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
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitResolution: toHitResolution('Vs') }).text).toBe('Vs');
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitResolution: toHitResolution('*') }).text).toBe('*');
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitResolution: toHitResolution(null) }).text).toBe('');
    });

    it('keeps targets beyond long range out of range before resolving hit state', () => {
        expect(inventoryTargetNumberState({ ...artilleryInput(31), hitResolution: toHitResolution('Vs') }).text).toBe('X');
    });

    it('renders identified hit modifiers as separate lines', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(-2, [
                { label: 'ER Medium Laser', modifier: -1 },
                { label: 'Targeting Computer', modifier: -1 }
            ])
        });

        expect(state.breakdown?.total).toBe(2);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ER Medium Laser', value: '-1' }));
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Targeting Computer', value: '-1' }));
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'Hit Modifier' }));
    });

    it('retains a concise weakened destruction detail without changing the total', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(0, [{ label: 'Targeting Computer Destroyed', modifier: 0, weakened: true }])
        });

        expect(state.breakdown?.total).toBe(4);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({
            label: 'Targeting Computer Destroyed', value: '+0', weakened: true
        }));
    });

    it('keeps the structured breakdown authoritative instead of synthesizing a generic label', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(2, [{ label: 'Damaged Fire Control', modifier: 1, weakened: true }])
        });

        expect(state.breakdown?.total).toBe(5);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Damaged Fire Control', value: '+1' }));
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'Hit Modifier' }));
    });

    it('orders regular terms before weakened terms and heat last', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(2, [
                { label: 'Damaged Fire Control', modifier: 1, weakened: true },
                { label: 'Targeting Computer', modifier: -1 },
                { label: 'Heat - Fire Modifier', modifier: 2, weakened: true, kind: 'heat' }
            ])
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
