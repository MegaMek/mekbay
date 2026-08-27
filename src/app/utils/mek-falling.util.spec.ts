// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { ArmorType } from '../models/entity/types';
import {
    applyMekFallDamage,
    mekFallDamage,
    mekFallDamageGroups,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    twoD6ForTotal,
    twoD6Total,
    type ResolvedMekFallDamageGroup,
} from './mek-falling.util';
import type { MekStructureKind } from './mek-structure-damage.util';

describe('Mek falling rules', () => {
    it('keeps Core facing while selecting rear only on an orientation roll of 1', () => {
        expect(resolveMekFallOrientation('core2026', 1)).toEqual(jasmine.objectContaining({
            facingOffset: 0,
            facingInstruction: 'Keep the current facing',
            hitArc: 'rear',
        }));
        expect(resolveMekFallOrientation('core2026', 6)).toEqual(jasmine.objectContaining({
            facingOffset: 0,
            hitArc: 'front',
        }));
    });

    it('uses the Total Warfare facing-after-fall table', () => {
        expect([1, 2, 3, 4, 5, 6].map(roll => resolveMekFallOrientation('tw', roll)))
            .toEqual([
                jasmine.objectContaining({ facingOffset: 0, hitArc: 'front' }),
                jasmine.objectContaining({ facingOffset: 1, hitArc: 'right' }),
                jasmine.objectContaining({ facingOffset: 2, hitArc: 'right' }),
                jasmine.objectContaining({ facingOffset: 3, hitArc: 'rear' }),
                jasmine.objectContaining({ facingOffset: -2, hitArc: 'left' }),
                jasmine.objectContaining({ facingOffset: -1, hitArc: 'left' }),
            ]);
    });

    it('calculates tonnage and level damage in separate five-point groups', () => {
        expect(mekFallDamage(55, 0)).toBe(6);
        expect(mekFallDamageGroups(mekFallDamage(55, 0))).toEqual([5, 1]);
        expect(mekFallDamage(55, 2)).toBe(18);
        expect(mekFallDamageGroups(18)).toEqual([5, 5, 5, 3]);
    });

    it('derives a 2D6 total from the two persisted dice', () => {
        expect(twoD6Total([1, 6])).toBe(7);
        expect(twoD6ForTotal(7)).toEqual([3, 4]);
        expect(twoD6ForTotal(1)).toBeNull();
        expect(twoD6ForTotal(13)).toBeNull();
    });

    it('uses the selected arc and identifies rear torso armor and table criticals', () => {
        expect(resolveMekFallHitLocation('biped', 'rear', 2)).toEqual(jasmine.objectContaining({
            rawTableResult: 'CT(C)',
            tableLabel: 'CT',
            location: 'CT',
            locationLabel: 'Center Torso',
            rear: true,
            critical: true,
        }));
        expect(resolveMekFallHitLocation('biped', 'left', 3)).toEqual(jasmine.objectContaining({
            location: 'LL',
            locationLabel: 'Left Leg',
            rear: false,
        }));
    });

    it('resolves every quad hit-table abbreviation to a canonical entity location', () => {
        expect([3, 4, 9, 10, 11].map(roll =>
            resolveMekFallHitLocation('quad', 'rear', roll).location,
        )).toEqual(['FRL', 'FRL', 'RLL', 'FLL', 'FLL']);
        expect([3, 4, 5, 6, 10].map(roll =>
            resolveMekFallHitLocation('quad', 'left', roll).location,
        )).toEqual(['RLL', 'FLL', 'FLL', 'RLL', 'FRL']);

        const unresolved = (['front', 'rear', 'left', 'right'] as const).flatMap(arc =>
            Array.from({ length: 11 }, (_unused, index) => index + 2)
                .map(roll => ({ arc, roll, result: resolveMekFallHitLocation('quad', arc, roll) })))
            .filter(entry => entry.result.location === null || entry.result.locationLabel === null)
            .map(entry => `${entry.arc}:${entry.roll}`);

        expect(unresolved).toEqual([]);
    });

    it('resolves the tripod leg subtable with side modifiers', () => {
        const pending = resolveMekFallHitLocation('tripod', 'left', 3);
        expect(pending.location).toBeNull();
        expect(pending.rawTableResult).toBe('Leg (+1)†');
        expect(pending.tableLabel).toBe('Leg (+1)');
        expect(pending.tripodLegModifier).toBe(1);

        expect(resolveMekFallHitLocation('tripod', 'left', 3, 4)).toEqual(jasmine.objectContaining({
            adjustedTripodLegRoll: 5,
            location: 'LL',
        }));
        expect(resolveMekFallHitLocation('tripod', 'right', 3, 3)).toEqual(jasmine.objectContaining({
            adjustedTripodLegRoll: 2,
            location: 'RL',
        }));
        expect(resolveMekFallHitLocation('tripod', 'front', 5, 3)).toEqual(jasmine.objectContaining({
            adjustedTripodLegRoll: 3,
            location: 'CL',
        }));
    });

    it('applies armor, internal damage, and normal inward transfer for each group', () => {
        const harness = createDamageHarness({
            armor: { LA: 1, LT: 10 },
            internal: { LA: 2, LT: 10, CT: 10 },
        });

        const result = applyMekFallDamage(harness.unit, [group('LA', 5)], false);

        expect(harness.armorHits).toEqual(new Map([
            ['LA', 1],
            ['LT', 2],
        ]));
        expect(harness.internalHits).toEqual(new Map([['LA', 2]]));
        expect(result.appliedDamage).toBe(5);
        expect(result.locations.map(entry => entry.location)).toEqual(['LA', 'LT']);
    });

    it('transfers hits from every destroyed quad leg into the correct side torso', () => {
        const cases = [
            { arc: 'rear', roll: 3, location: 'FRL', torso: 'RT' },
            { arc: 'rear', roll: 9, location: 'RLL', torso: 'LT' },
            { arc: 'rear', roll: 10, location: 'FLL', torso: 'LT' },
            { arc: 'rear', roll: 5, location: 'RRL', torso: 'RT' },
        ] as const;

        for (const testCase of cases) {
            const resolved = resolveMekFallHitLocation('quad', testCase.arc, testCase.roll);
            if (resolved.location === null || resolved.locationLabel === null) {
                fail(`Expected ${testCase.arc}:${testCase.roll} to resolve`);
                continue;
            }
            const harness = createDamageHarness({
                armor: { [testCase.location]: 0, [testCase.torso]: 10 },
                internal: { FLL: 5, FRL: 5, RLL: 5, RRL: 5, LT: 10, RT: 10, CT: 10, HD: 3 },
                initialInternalHits: { [testCase.location]: 5 },
            });

            const result = applyMekFallDamage(harness.unit, [{
                ...resolved,
                damage: 5,
                location: resolved.location,
                locationLabel: resolved.locationLabel,
            }], false);

            expect(resolved.location).withContext(`${testCase.arc}:${testCase.roll}`).toBe(testCase.location);
            expect(harness.armorHits.get(testCase.torso)).withContext(testCase.location).toBe(5);
            expect(result.locations.map(entry => entry.location))
                .withContext(testCase.location)
                .toEqual([testCase.location, testCase.torso]);
        }
    });

    it('halves a group that reaches intact Impact-Resistant Armor, rounding down', () => {
        const harness = createDamageHarness({
            armorType: 'IMPACT_RESISTANT',
            armor: { CT: 10 },
            internal: { CT: 10 },
        });

        const result = applyMekFallDamage(harness.unit, [group('CT', 5)], true);

        expect(harness.armorHits.get('CT')).toBe(2);
        expect(result.appliedDamage).toBe(2);
    });

    it('keeps the minimum one point when Impact-Resistant Armor halves a one-point group', () => {
        const harness = createDamageHarness({
            armorType: 'IMPACT_RESISTANT',
            armor: { CT: 10 },
            internal: { CT: 10 },
        });

        const result = applyMekFallDamage(harness.unit, [group('CT', 1)], true);

        expect(harness.armorHits.get('CT')).toBe(1);
        expect(result.appliedDamage).toBe(1);
    });

    it('re-evaluates patchwork armor when damage transfers to another location', () => {
        const harness = createDamageHarness({
            armorTypes: { LA: 'STANDARD', LT: 'IMPACT_RESISTANT' },
            armor: { LA: 1, LT: 10 },
            internal: { LA: 0, LT: 10, CT: 10 },
        });

        const result = applyMekFallDamage(harness.unit, [group('LA', 5)], false);

        expect(harness.armorHits).toEqual(new Map([['LA', 1], ['LT', 2]]));
        expect(result.appliedDamage).toBe(3);
    });

    it('applies Ferro-Lamellor and Reflective Armor using physical non-attack rules', () => {
        const ferro = createDamageHarness({
            armorType: 'FERRO_LAMELLOR', armor: { CT: 10 }, internal: { CT: 10 },
        });
        const reflective = createDamageHarness({
            armorType: 'REFLECTIVE', armor: { CT: 10 }, internal: { CT: 10 },
        });

        expect(applyMekFallDamage(ferro.unit, [group('CT', 5)], false).appliedDamage).toBe(4);
        expect(ferro.armorHits.get('CT')).toBe(4);
        expect(applyMekFallDamage(reflective.unit, [group('CT', 5)], false).appliedDamage).toBe(10);
        expect(reflective.armorHits.get('CT')).toBe(10);
    });

    it('doubles a physical hit even when only one point of Reflective Armor remains', () => {
        const harness = createDamageHarness({
            armorType: 'REFLECTIVE', armor: { CT: 1 }, internal: { CT: 10 },
        });

        const result = applyMekFallDamage(harness.unit, [group('CT', 1)], false);

        expect(harness.armorHits.get('CT')).toBe(1);
        expect(harness.internalHits.get('CT')).toBeUndefined();
        expect(result.appliedDamage).toBe(2);
    });

    it('stores Hardened Armor half-pips as integer armor damage', () => {
        const harness = createDamageHarness({
            armorType: 'HARDENED', armor: { CT: 20 }, internal: { CT: 10 },
        });

        const first = applyMekFallDamage(harness.unit, [group('CT', 1)], false);
        expect(harness.armorHits.get('CT')).toBe(1);
        expect(first.appliedDamage).toBe(0);

        const second = applyMekFallDamage(harness.unit, [group('CT', 1)], false);
        expect(harness.armorHits.get('CT')).toBe(2);
        expect(second.appliedDamage).toBe(1);
    });

    it('transfers only whole incoming damage after Hardened Armor is exhausted', () => {
        const harness = createDamageHarness({
            armorType: 'HARDENED', armor: { CT: 20 }, internal: { CT: 10 },
        });

        applyMekFallDamage(harness.unit, [group('CT', 19)], false);
        const result = applyMekFallDamage(harness.unit, [group('CT', 2)], false);

        expect(harness.armorHits.get('CT')).toBe(20);
        expect(harness.internalHits.get('CT')).toBe(1);
        expect(result.appliedDamage).toBe(2);
    });

    it('destroys odd composite structure without fractional transfer damage', () => {
        const harness = createDamageHarness({
            armor: { LA: 0, LT: 10 },
            internal: { LA: 3, LT: 10, CT: 10 },
            structureKinds: { LA: 'composite' },
        });

        const result = applyMekFallDamage(harness.unit, [group('LA', 2)], false);

        expect(harness.internalHits.get('LA')).toBe(3);
        expect(harness.armorHits.get('LT')).toBeUndefined();
        expect(result.appliedDamage).toBe(3);
        expect(result.locations).toHaveSize(1);
    });

    it('queues a table critical in addition to applying internal damage', () => {
        const harness = createDamageHarness({
            armor: { CT: 0 },
            internal: { CT: 10 },
        });

        applyMekFallDamage(harness.unit, [group('CT', 5, false, true)], false);

        expect(harness.addInternalHits).toHaveBeenCalledOnceWith(
            'CT',
            5,
            false,
            { hardenedArmorApplies: false },
        );
        expect(harness.queueMekCriticalChance).toHaveBeenCalledOnceWith('CT', {
            consolidateImmediately: false,
            hardenedArmorApplies: false,
            throughArmorHitArc: 'front',
        });
    });

    it('retains the hit-table facing for each queued through-armor critical', () => {
        const harness = createDamageHarness({
            armor: { LT: 0, RT: 0, 'CT-rear': 0 },
            internal: { LT: 10, RT: 10, CT: 10 },
        });

        applyMekFallDamage(harness.unit, [
            group('LT', 1, false, true),
            group('RT', 1, false, true),
            group('CT', 1, true, true),
        ], false);

        expect(harness.queueMekCriticalChance.calls.allArgs()).toEqual([
            ['LT', jasmine.objectContaining({ throughArmorHitArc: 'left' })],
            ['RT', jasmine.objectContaining({ throughArmorHitArc: 'right' })],
            ['CT', jasmine.objectContaining({ throughArmorHitArc: 'rear' })],
        ]);
    });

    it('lets remaining Anti-Penetrative Ablation Armor suppress a table critical', () => {
        const harness = createDamageHarness({
            armorType: 'ANTI_PENETRATIVE_ABLATION',
            armor: { CT: 10 },
            internal: { CT: 10 },
        });

        applyMekFallDamage(harness.unit, [group('CT', 5, false, true)], false);

        expect(harness.armorHits.get('CT')).toBe(5);
        expect(harness.queueMekCriticalChance).not.toHaveBeenCalled();
    });
});

function group(location: string, damage: number, rear = false, critical = false): ResolvedMekFallDamageGroup {
    return {
        damage,
        hitLocationRoll: 7,
        rawTableResult: location,
        tableLabel: location,
        location,
        locationLabel: location,
        rear,
        critical,
    };
}

function createDamageHarness(options: {
    armor: Readonly<Record<string, number>>;
    internal: Readonly<Record<string, number>>;
    initialInternalHits?: Readonly<Record<string, number>>;
    armorType?: ArmorType;
    armorTypes?: Readonly<Record<string, ArmorType>>;
    structureKinds?: Readonly<Record<string, MekStructureKind>>;
}): {
    unit: CBTForceUnit;
    armorHits: Map<string, number>;
    internalHits: Map<string, number>;
    addInternalHits: jasmine.Spy;
    queueMekCriticalChance: jasmine.Spy;
} {
    const armorHits = new Map<string, number>();
    const internalHits = new Map<string, number>(Object.entries(options.initialInternalHits ?? {}));
    const armorKey = (location: string, rear = false) => rear ? `${location}-rear` : location;
    const addInternalHits = jasmine.createSpy('addInternalHits').and.callFake((location: string, hits: number) => {
        internalHits.set(location, (internalHits.get(location) ?? 0) + hits);
    });
    const queueMekCriticalChance = jasmine.createSpy('queueMekCriticalChance').and.returnValue(true);
    const unit = {
        locations: { internal: new Map(Object.keys(options.internal).map(location => [location, { loc: location }])) },
        getUnit: () => ({ type: 'Mek', subtype: 'BattleMek' }),
        getArmorTypeAt: (location: string) => options.armorTypes?.[location]
            ?? options.armorType
            ?? 'STANDARD',
        getStructureKindAt: (location: string) => options.structureKinds?.[location] ?? 'standard',
        getArmorPoints: (location: string, rear = false) => options.armor[armorKey(location, rear)] ?? 0,
        getArmorHits: (location: string, rear = false) => armorHits.get(armorKey(location, rear)) ?? 0,
        addArmorHits: (location: string, hits: number, rear = false) => {
            const key = armorKey(location, rear);
            armorHits.set(key, (armorHits.get(key) ?? 0) + hits);
        },
        getInternalPoints: (location: string) => options.internal[location] ?? 0,
        getInternalHits: (location: string) => internalHits.get(location) ?? 0,
        addInternalHits,
        queueMekCriticalChance,
    } as unknown as CBTForceUnit;
    return { unit, armorHits, internalHits, addInternalHits, queueMekCriticalChance };
}
