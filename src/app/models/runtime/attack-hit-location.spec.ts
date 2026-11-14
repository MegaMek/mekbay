// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { TestQuadMekEntity, TestTankEntity, TestTripodMekEntity } from '../entity/testing/test-entities';
import type { NonMekRecordSheetSnapshot } from './non-mek-record-sheet';
import type { CBTForceMember } from '../force-member.model';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { aimedShotLocations, readAttackHitLocation, readInfernoMissiles } from './attack-hit-location';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('readAttackHitLocation', () => {
    const mek = { entity: createDirectMekRuntimeFixture().entity } as unknown as CBTForceMember;

    it('reads the roll on the struck Mek\'s table, marking rear torso hits', () => {
        expect(readAttackHitLocation(mek, 'front', [3, 3], 1)).toEqual(jasmine.objectContaining({
            kind: 'mek', location: 'RT', label: 'Right Torso', rear: false,
        }));
        expect(readAttackHitLocation(mek, 'rear', [3, 4], 1)?.label).toBe('Center Torso (rear)');
    });

    it('reads inferno missile rolls unless the attack resolved them with no hit location', () => {
        const groups = [{ location: [3, 3] as const, aux: 1 }];
        expect(readInfernoMissiles(mek, 'front', [{ inferno: true, groups }])).toEqual([
            jasmine.objectContaining({ location: jasmine.objectContaining({ location: 'RT' }) }),
        ]);
        expect(readInfernoMissiles(mek, 'front', [{ inferno: true, noHitLocation: true, groups }])).toEqual([{ location: null }]);
    });

    it('sends leg hits on a Mek in partial cover into the cover', () => {
        // Front table, 5: right leg.
        expect(readAttackHitLocation(mek, 'front', [2, 3], 1)).toEqual(jasmine.objectContaining({ kind: 'mek', location: 'RL' }));
        expect(readAttackHitLocation(mek, 'front', [2, 3], 1, true)).toEqual({ kind: 'miss', label: 'Cover' });
        expect(readAttackHitLocation(mek, 'front', [3, 3], 1, true)).toEqual(jasmine.objectContaining({ location: 'RT' }));
    });

    it('strikes the location an aimed shot names when its roll says so, and reads the table otherwise', () => {
        // The table roll alone is the right torso.
        const read = (roll: readonly number[], arc: MekHitArc = 'front', location = 'LA') =>
            readAttackHitLocation(mek, arc, [3, 3], 1, false, 'standard', { location, roll });
        // Total Warfare: 6, 7 or 8 on 2D6. Core: 4+ on 1D6.
        expect(read([3, 4])).toEqual(jasmine.objectContaining({ location: 'LA', label: 'Left Arm', throughArmorCritical: false }));
        expect(read([4, 5])).toEqual(jasmine.objectContaining({ location: 'RT' }));
        expect(read([4])).toEqual(jasmine.objectContaining({ location: 'LA' }));
        expect(read([3])).toEqual(jasmine.objectContaining({ location: 'RT' }));
        // From behind, an aimed torso takes the hit on its rear armor.
        expect(read([6], 'rear', 'CT')).toEqual(jasmine.objectContaining({ location: 'CT', rear: true, label: 'Center Torso (rear)' }));
        // A location the unit does not have is read on the table.
        expect(read([6], 'front', 'FLL')).toEqual(jasmine.objectContaining({ location: 'RT' }));
    });

    it('rerolls a leg result of an aimed shot at a Mek in partial cover', () => {
        const read = (rerolls: readonly (readonly [number, number])[]) =>
            readAttackHitLocation(mek, 'front', [2, 3], 1, false, 'standard', { location: 'LA', roll: [1], rerolls });
        // 5 and 9 are the legs; 6 is the right torso.
        expect(read([[4, 5], [3, 3], [1, 1]])).toEqual(jasmine.objectContaining({ location: 'RT', label: 'Right Torso (leg rerolled)' }));
        // Every roll made ahead a leg: the shot strikes the location it named.
        expect(read([[4, 5], [2, 3]])).toEqual(jasmine.objectContaining({ location: 'LA' }));
    });

    it('lets an aimed shot name the vehicle locations its direction can strike, without their table effects', () => {
        const entity = new TestTankEntity();
        entity.hasTurret.set(true);
        const snapshot = { locations: entity.damageLocations().map((location, index) => ({
            ...location, locationId: `location:${index}`, sheetCode: location.sheetCode, previewRemainingInternal: 3,
            armor: [{ face: 'front', previewRemaining: 10 + index }],
        })) } as unknown as NonMekRecordSheetSnapshot;
        const tank = { entity, nonMekRecordSheetSnapshot: () => snapshot } as unknown as CBTForceMember;

        expect(aimedShotLocations(tank, 'front').map(location => location.code).sort()).toEqual(['FR', 'LS', 'RS', 'TU']);
        expect(aimedShotLocations(tank, 'left').map(location => location.code).sort()).toEqual(['FR', 'LS', 'RR', 'TU']);
        expect(aimedShotLocations(tank, 'rear').map(location => location.code).sort()).toEqual(['LS', 'RR', 'RS', 'TU']);
        // Roll 3 on the front table is a front hit with motive damage; the aimed turret hit carries none.
        expect(readAttackHitLocation(tank, 'front', [1, 2], 1, false, 'standard', { location: 'TU', roll: [3, 4] }))
            .toEqual(jasmine.objectContaining({ kind: 'non-mek', label: 'TU', effects: [] }));
        // The far side cannot be named: the shot is read on the table.
        expect(readAttackHitLocation(tank, 'front', [1, 2], 1, false, 'standard', { location: 'RR', roll: [3, 4] }))
            .toEqual(jasmine.objectContaining({ kind: 'non-mek', label: 'FR · motive' }));
    });

    it('reads swarm damage on the Swarm Attacks Hit Location Table, whatever side the attack is recorded from', () => {
        // 4: rear right torso on a biped; rear center torso on a four-legged Mek.
        for (const arc of ['front', 'left'] as const) {
            expect(readAttackHitLocation(mek, arc, [2, 2], 1, false, 'swarm')).toEqual(jasmine.objectContaining({
                location: 'RT', rear: true, label: 'Right Torso (rear)',
            }));
        }
        const quad = { entity: new TestQuadMekEntity() } as unknown as CBTForceMember;
        expect(readAttackHitLocation(quad, 'front', [2, 2], 1, false, 'swarm')).toEqual(jasmine.objectContaining({
            location: 'CT', rear: true,
        }));
    });

    it('reads punch and kick rolls on the 1D6 tables of the ruleset', () => {
        const entity = createDirectMekRuntimeFixture().entity;
        const member = (ruleset: string) => ({ entity, id: 'mek', force: { getUnitSnapshot: () => ({ ruleset }) } }) as unknown as CBTForceMember;
        // Punch from the front, 1: Total Warfare's left arm, Core's right arm.
        expect(readAttackHitLocation(member('total-warfare'), 'front', [1], 1, false, 'punch')?.label).toBe('Left Arm');
        expect(readAttackHitLocation(member('core-2026'), 'front', [1], 1, false, 'punch')?.label).toBe('Right Arm');
        expect(readAttackHitLocation(member('core-2026'), 'rear', [2], 1, false, 'punch')).toEqual(jasmine.objectContaining({
            location: 'RT', rear: true, label: 'Right Torso (rear)',
        }));
        expect(readAttackHitLocation(member('total-warfare'), 'right', [1], 1, false, 'kick')).toEqual(jasmine.objectContaining({
            location: 'RL', rear: false,
        }));
    });

    const memberOf = (entity: BaseEntity, ruleset: string) =>
        ({ entity, id: 'mek', force: { getUnitSnapshot: () => ({ ruleset }) } }) as unknown as CBTForceMember;
    const physicalHit = (entity: BaseEntity, ruleset: string, arc: MekHitArc, roll: number, table: 'punch' | 'kick') => {
        const hit = readAttackHitLocation(memberOf(entity, ruleset), arc, [roll], 1, false, table);
        return hit?.kind === 'mek' ? hit.location : null;
    };

    it('strikes the quad leg locations, with Core mirroring the front/rear punch column', () => {
        const quad = new TestQuadMekEntity();
        // Punch from the front, 1: Total Warfare p.145 left front leg, Core p.239 right front leg.
        expect(readAttackHitLocation(memberOf(quad, 'total-warfare'), 'front', [1], 1, false, 'punch')).toEqual(jasmine.objectContaining({
            location: 'FLL', label: 'Left Front Leg',
        }));
        expect(physicalHit(quad, 'core-2026', 'front', 1, 'punch')).toBe('FRL');
        expect(physicalHit(quad, 'core-2026', 'rear', 5, 'punch')).toBe('RLL');
        expect(physicalHit(quad, 'core-2026', 'front', 4, 'punch')).toBe('LT');
        // Kicks are the same in both books.
        expect(physicalHit(quad, 'core-2026', 'rear', 2, 'kick')).toBe('RRL');
        expect(physicalHit(quad, 'total-warfare', 'left', 6, 'kick')).toBe('RLL');
    });

    it('rolls a tripod kick for the leg it strikes, and punches it on the biped table of its ruleset', () => {
        const tripod = new TestTripodMekEntity();
        // Core Appendix A: 1D6, +1 from the left, -1 from the right; 0-2 right, 3-4 center, 5-7 left leg.
        expect(physicalHit(tripod, 'core-2026', 'front', 2, 'kick')).toBe('RL');
        expect(physicalHit(tripod, 'core-2026', 'left', 2, 'kick')).toBe('CL');
        expect(physicalHit(tripod, 'total-warfare', 'right', 5, 'kick')).toBe('CL');
        expect(physicalHit(tripod, 'total-warfare', 'left', 4, 'kick')).toBe('LL');
        expect(physicalHit(tripod, 'total-warfare', 'front', 1, 'punch')).toBe('LA');
        expect(physicalHit(tripod, 'core-2026', 'front', 1, 'punch')).toBe('RA');
    });
});
