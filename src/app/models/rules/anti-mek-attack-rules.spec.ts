// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    antiMekTrooperModifier,
    erraticManoeuvresModifier,
    isAntiMekAttack,
    legAttackTarget,
    swarmHitLocation,
    splitSwarmedHits,
    swarmShakeOffDamage,
    swarmTarget,
} from './anti-mek-attack-rules';
import { physicalAttackAlwaysHits, physicalTargetIssue, physicalTargetModifier } from './physical-attack-rules';

describe("anti-'Mech attack rules", () => {
    it('reads the Leg Attacks and Swarm Attacks tables by the troopers still active (TW p. 221)', () => {
        const platoon = (attack: 'leg-attack' | 'swarm') =>
            [30, 22, 21, 16, 15, 10, 9, 5, 4, 1, 0].map(troopers => antiMekTrooperModifier(attack, false, troopers));
        expect(platoon('leg-attack')).toEqual([0, 0, 2, 2, 5, 5, 7, 7, null, null, null]);
        expect(platoon('swarm')).toEqual([2, 2, 5, 5, null, null, null, null, null, null, null]);
        const battleArmor = (attack: 'leg-attack' | 'swarm') =>
            [6, 4, 3, 2, 1, 0].map(troopers => antiMekTrooperModifier(attack, true, troopers));
        expect(battleArmor('leg-attack')).toEqual([0, 0, 2, 5, 7, null]);
        expect(battleArmor('swarm')).toEqual([2, 2, 5, 5, 5, null]);
    });

    it("attacks the legs of a 'Mech, and swarms a 'Mech, a vehicle or a landed VTOL in its hex", () => {
        expect(['mek-biped', 'mek-quad', undefined, 'vehicle', 'protoMek'].map(type => legAttackTarget(type as never)))
            .toEqual([true, true, true, false, false]);
        expect(swarmTarget('vehicle', false)).toBeTrue();
        expect(swarmTarget('vtol-wige', true)).toBeFalse();
        expect(swarmTarget('vtol-wige', false)).toBeTrue();
        expect(swarmTarget('aero', false)).toBeFalse();

        expect(physicalTargetIssue('leg-attack', 'legs-in-hex', { unitType: 'mek-biped', distance: 0 })).toBeNull();
        expect(physicalTargetIssue('leg-attack', 'legs-in-hex', { unitType: 'mek-biped', distance: 1 })).toBe('out-of-range');
        expect(physicalTargetIssue('leg-attack', 'legs-in-hex', { unitType: 'vehicle', distance: 0 })).toBe('invalid');
        // A unit is swarmed by one unit at a time.
        expect(physicalTargetIssue('swarm', 'swarmable-in-hex', { unitType: 'vehicle', distance: 0 })).toBeNull();
        expect(physicalTargetIssue('swarm', 'swarmable-in-hex', {
            unitType: 'mek-biped', distance: 0, tnCalculator: { swarmed: true },
        })).toBe('invalid');
        // Climbing a vehicle is easier.
        expect(physicalTargetModifier('swarm', 'vehicle')).toEqual({ label: 'Vehicle', modifier: -2 });
        expect(physicalTargetModifier('swarm', 'mek-biped')).toBeNull();
        expect(physicalTargetModifier('leg-attack', 'vehicle')).toBeNull();
    });

    it("keeps a swarmed 'Mech from thrashing at the infantry swarming it (TW p. 151)", () => {
        const swarmer = { unitType: 'battle-armor' as const, distance: 0, tnCalculator: { swarming: true } };
        expect(physicalTargetIssue('thrash', 'unswarming-infantry-in-hex', swarmer)).toBe('invalid');
        expect(physicalTargetIssue('thrash', 'unswarming-infantry-in-hex', { unitType: 'infantry', distance: 0 })).toBeNull();
        // A 'Mech that is not swarmed thrashes at any infantry in its hex.
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', swarmer)).toBeNull();
    });

    it('deals swarming infantry shaken off what TW p. 222 gives each way off', () => {
        const ba = { battleArmor: true, umu: false };
        const platoon = { battleArmor: false, umu: false };
        // A jump: 1 point to each trooper per Jump MP; a conventional platoon one 3D6 hit (errata v12.0).
        expect(swarmShakeOffDamage({ kind: 'jump', jumpMp: 4, waterDepth: 0 }, ba)).toEqual({ kind: 'per-trooper', damage: 4 });
        expect(swarmShakeOffDamage({ kind: 'jump', jumpMp: 4, waterDepth: 0 }, platoon)).toEqual({ kind: 'dice', dice: 3 });
        // Erratic manoeuvres: 1 point to each trooper.
        expect(swarmShakeOffDamage({ kind: 'erratic', waterDepth: 0 }, ba)).toEqual({ kind: 'per-trooper', damage: 1 });
        // A fall: one 2D6 hit, whoever swarmed.
        expect(swarmShakeOffDamage({ kind: 'fall', waterDepth: 0 }, ba)).toEqual({ kind: 'dice', dice: 2 });
        // Knocked off into Depth 1+ water, or carried into Depth 2+, infantry without UMU MP is destroyed.
        expect(swarmShakeOffDamage({ kind: 'fall', waterDepth: 1 }, ba)).toEqual({ kind: 'destroyed' });
        expect(swarmShakeOffDamage({ kind: 'deep-water', waterDepth: 2 }, platoon)).toEqual({ kind: 'destroyed' });
        expect(swarmShakeOffDamage({ kind: 'deep-water', waterDepth: 2 }, { battleArmor: true, umu: true })).toBeNull();
        expect(swarmShakeOffDamage({ kind: 'fall', waterDepth: 1 }, { battleArmor: true, umu: true }))
            .toEqual({ kind: 'dice', dice: 2 });
        expect([erraticManoeuvresModifier(false), erraticManoeuvresModifier(true)]).toEqual([4, 2]);
        // A VTOL or WiGE throws battle armor from its Elevation; infantry that jumps or flies lands unharmed.
        expect(swarmShakeOffDamage({ kind: 'erratic', waterDepth: 0, elevation: 3 }, ba)).toEqual({ kind: 'per-trooper', damage: 3 });
        expect(swarmShakeOffDamage({ kind: 'erratic', waterDepth: 0, elevation: 3 }, { ...ba, flies: true }))
            .toEqual({ kind: 'none' });
        expect(swarmShakeOffDamage({ kind: 'erratic', waterDepth: 0, elevation: 0 }, ba)).toEqual({ kind: 'none' });
    });

    it('strikes the swarming infantry with a hit on a torso or vehicle on 5-6, battle armor one trooper at a time', () => {
        const dice = (...values: number[]) => () => values.shift()!;
        const hits = [{ damage: 5, eligible: true }, { damage: 7, eligible: true }, { damage: 4, eligible: false }];
        // A platoon takes the whole hit on 5-6; 1-4 leaves it on the unit, as does a hit that cannot strike it.
        expect(splitSwarmedHits(hits, null, { d6: dice(4, 5), pick: () => 0 })).toEqual([
            { carrier: 5, infantry: 0 }, { carrier: 0, infantry: 7 }, { carrier: 4, infantry: 0 },
        ]);
        // Battle armor: a trooper takes the hit until destroyed, the rest strikes the unit; a destroyed trooper takes no more.
        const troopers = new Map([[1, 0], [2, 6], [3, 3]]);
        expect(splitSwarmedHits(hits, troopers, { d6: dice(6, 6), pick: count => count - 1 })).toEqual([
            { carrier: 2, infantry: 3, trooper: 3 }, { carrier: 1, infantry: 6, trooper: 2 }, { carrier: 4, infantry: 0 },
        ]);
        expect(troopers.get(3)).toBe(3);
    });

    it('rolls no to-hit for swarm damage or for ending the swarm', () => {
        expect(['leg-attack', 'swarm', 'swarm-damage', 'end-swarm'].map(kind => physicalAttackAlwaysHits(kind as never)))
            .toEqual([false, false, true, true]);
        expect(isAntiMekAttack('swarm-damage')).toBeTrue();
        expect(isAntiMekAttack('kick')).toBeFalse();
    });

    it('reads the Swarm Attacks Hit Location Table for bipeds and four-legged Meks (TW p. 222)', () => {
        const read = (quad: boolean) => [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(roll => {
            const hit = swarmHitLocation(quad, roll);
            return hit.location + (hit.rear ? 'r' : '');
        });
        expect(read(false)).toEqual(['HD', 'CTr', 'RTr', 'RT', 'RA', 'CT', 'LA', 'LT', 'LTr', 'CTr', 'HD']);
        expect(read(true)).toEqual(['HD', 'RT', 'CTr', 'RTr', 'RT', 'CT', 'LT', 'LTr', 'CTr', 'LT', 'HD']);
    });
});
