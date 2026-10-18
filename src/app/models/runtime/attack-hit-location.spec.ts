// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { TestQuadMekEntity, TestTripodMekEntity } from '../entity/testing/test-entities';
import type { CBTForceMember } from '../force-member.model';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { readAttackHitLocation } from './attack-hit-location';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('readAttackHitLocation', () => {
    const mek = { entity: createDirectMekRuntimeFixture().entity } as unknown as CBTForceMember;

    it('reads the roll on the struck Mek\'s table, marking rear torso hits', () => {
        expect(readAttackHitLocation(mek, 'front', [3, 3], 1)).toEqual(jasmine.objectContaining({
            kind: 'mek', location: 'RT', label: 'Right Torso', rear: false,
        }));
        expect(readAttackHitLocation(mek, 'rear', [3, 4], 1)?.label).toBe('Center Torso (rear)');
    });

    it('sends leg hits on a Mek in partial cover into the cover', () => {
        // Front table, 5: right leg.
        expect(readAttackHitLocation(mek, 'front', [2, 3], 1)).toEqual(jasmine.objectContaining({ kind: 'mek', location: 'RL' }));
        expect(readAttackHitLocation(mek, 'front', [2, 3], 1, true)).toEqual({ kind: 'miss', label: 'Cover' });
        expect(readAttackHitLocation(mek, 'front', [3, 3], 1, true)).toEqual(jasmine.objectContaining({ location: 'RT' }));
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
