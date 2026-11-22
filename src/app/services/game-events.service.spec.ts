// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { parseGameEvent } from './game-events.service';

describe('parseGameEvent', () => {
    it('retains a rear-quarter shot, an underwater attacker and individual missile damage in transit', () => {
        const original = attack();
        const packet = { ...original, arc: 'rear-left', attackerUnderwater: true, weapons: [
            { ...original.weapons[0], projectileDamage: 1 },
        ] };
        expect(parseGameEvent(packet)).toEqual(packet as never);
    });

    const attack = () => ({
        kind: 'attack', id: 'a1', fromForce: 'f1', fromUnit: 'u1', attacker: 'Atlas AS7-D', toUnit: 'u2',
        turn: 3, arc: 'rear',
        weapons: [
            { name: 'LRM 15', types: ['M', 'C'], partialCover: true, targetNumber: 8, toHit: [4, 4],
                cluster: { dice: [4, 4], modifier: 0, projectiles: 15, hits: 9 },
                groups: [{ damage: 5, location: [3, 4], aux: 2 }, { damage: 4, location: [6, 6], aux: 1 }] },
            { name: 'Medium Laser', types: ['DE'], targetNumber: 7, toHit: [1, 2], groups: [] },
        ],
    });

    it('accepts a well-formed attack report from another player', () => {
        expect(parseGameEvent(attack())).toEqual(jasmine.objectContaining({ kind: 'attack', arc: 'rear', turn: 3 }));
    });

    it('transports interior protection or exterior collateral and rejects conflicting building contexts', () => {
        const report = (context: object) => ({ ...attack(), weapons: [{ ...attack().weapons[0], ...context }] });
        for (const field of ['infantryBuilding', 'collateralBuilding']) {
            expect(parseGameEvent(report({ [field]: 'hardened' }))).toEqual(jasmine.objectContaining({
                weapons: [jasmine.objectContaining({ [field]: 'hardened' })],
            }));
            expect(parseGameEvent(report({ [field]: 'unknown' }))).toBeNull();
        }
        expect(parseGameEvent(report({ infantryBuilding: 'light', collateralBuilding: 'medium' }))).toBeNull();
    });

    it('accepts a defended Streak salvo without a cluster roll and rejects interception that increases damage', () => {
        const groups = Array.from({ length: 6 }, () => ({ damage: 2, location: [3, 4], aux: 1 }));
        const report = (damage: number[], heat = 0) => ({ ...attack(), weapons: [{
            name: 'Streak SRM 6', types: ['M'], targetNumber: 7, toHit: [4, 4], groups,
            ams: { die: 2, hits: 4, damage, heat },
        }] });
        expect(parseGameEvent(report([2, 2, 2, 2]))).not.toBeNull();
        expect(parseGameEvent(report([3, 2]))).toBeNull();
        expect(parseGameEvent(report([2], 1))).toBeNull();
    });

    it('rejects attack reports with impossible dice, damage or unbounded rows', () => {
        const badDie = attack();
        badDie.weapons[0].toHit = [7, 1];
        const badDamage = attack();
        // A heat-only hit rolls its location with 0 damage; negative damage is impossible.
        badDamage.weapons[0].groups[0].damage = -1;
        const badArc = { ...attack(), arc: 'top' };
        const badType = attack();
        (badType.weapons[1] as { types: string[] }).types = ['LASER'];
        const flood = { ...attack(), weapons: Array.from({ length: 65 }, () => attack().weapons[1]) };

        for (const value of [badDie, badDamage, badArc, badType, flood]) expect(parseGameEvent(value)).toBeNull();
    });

    it('keeps an aimed shot with its roll and leg rerolls, and rejects one that is no single weapon hit', () => {
        const laser = (aim: unknown, extra: object = {}) => ({ ...attack(), weapons: [{
            name: 'Medium Laser', types: ['DE'], targetNumber: 7, toHit: [4, 4],
            groups: [{ damage: 5, location: [3, 4], aux: 2 }], aim, ...extra,
        }] });
        expect(parseGameEvent(laser({ location: 'LA', roll: [3, 4], rerolls: [[1, 2], [6, 6]] }))).toEqual(
            jasmine.objectContaining({ weapons: [jasmine.objectContaining({
                aim: { location: 'LA', roll: [3, 4], rerolls: [[1, 2], [6, 6]] },
            })] }));
        expect(parseGameEvent(laser({ location: 'HD', roll: [4] }))).not.toBeNull();
        for (const bad of [
            laser({ location: 'LA', roll: [7] }),
            laser({ location: 'LA', roll: [1, 2, 3] }),
            laser({ location: '', roll: [4] }),
            laser({ location: 'LA', roll: [4], rerolls: Array.from({ length: 7 }, () => [1, 1]) }),
            laser({ location: 'LA', roll: [4] }, { physical: 'punch', table: 'punch' }),
            laser({ location: 'LA', roll: [4] }, { groups: [{ damage: 2, location: [3, 4], aux: 2 }, { damage: 2, location: [3, 4], aux: 2 }] }),
        ]) expect(parseGameEvent(bad)).toBeNull();
    });

    it("keeps infantry anti-'Mech attacks: a leg attack's critical roll, swarm damage on its own 2D6 table", () => {
        const report = (extra: object) => ({ ...attack(), weapons: [{
            name: 'Leg Attack', types: [], targetNumber: 6, toHit: [4, 4], physical: 'leg-attack', table: 'kick',
            critical: true, groups: [{ damage: 4, location: [3], aux: 2 }], ...extra,
        }] });
        expect(parseGameEvent(report({}))).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ physical: 'leg-attack', table: 'kick', critical: true })],
        }));
        expect(parseGameEvent(report({
            physical: 'swarm-damage', table: 'swarm', groups: [{ damage: 15, location: [3, 4], aux: 1 }],
        }))).not.toBeNull();
        // A swarm that takes hold, and one that ends, carry no damage.
        expect(parseGameEvent(report({ physical: 'swarm', table: undefined, critical: undefined, groups: [] }))).not.toBeNull();
        expect(parseGameEvent(report({ physical: 'end-swarm', table: undefined, critical: undefined, groups: [] }))).not.toBeNull();
        // The swarm table rolls 2D6; a critical flag is true or absent.
        expect(parseGameEvent(report({ table: 'swarm' }))).toBeNull();
        expect(parseGameEvent(report({ critical: false }))).toBeNull();
    });

    it("keeps a rifle's mark, which only a weapon attack carries", () => {
        const rifle = (extra: object) => ({ ...attack(), weapons: [{
            name: 'Heavy Rifle', types: ['DB'], targetNumber: 7, toHit: [4, 4], rifle: true,
            groups: [{ damage: 9, location: [3, 4], aux: 2 }], ...extra,
        }] });
        expect(parseGameEvent(rifle({}))).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ rifle: true })],
        }));
        expect(parseGameEvent(rifle({ rifle: false }))).toBeNull();
        expect(parseGameEvent(rifle({ physical: 'punch', table: 'punch', groups: [{ damage: 9, location: [3], aux: 2 }] })))
            .toBeNull();
    });

    it('keeps the size of an autocannon firing armor-piercing rounds, and nothing else as one', () => {
        const autocannon = (extra: object) => ({ ...attack(), weapons: [{
            name: 'AC/5', types: ['DB'], targetNumber: 7, toHit: [4, 4], ammo: 'armor-piercing',
            groups: [{ damage: 5, location: [3, 4], aux: 2 }], ...extra,
        }] });
        expect(parseGameEvent(autocannon({ rackSize: 5 }))).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ ammo: 'armor-piercing', rackSize: 5 })],
        }));
        expect(parseGameEvent(autocannon({ rackSize: 5, ammo: 'acid' }))).toBeNull();
        expect(parseGameEvent(autocannon({ rackSize: 2.5 }))).toBeNull();
    });

    it('retains tandem-charge ammunition and each floating location roll when a hit report crosses the wire', () => {
        const missile = { name: 'SRM 2', types: ['M'], targetNumber: 7, toHit: [4, 4], ammo: 'tandem-charge',
            groups: [{ damage: 2, location: [3, 4], aux: 2 }, { damage: 2, location: [1, 1], floating: [4, 5], aux: 1 }] };
        expect(parseGameEvent({ ...attack(), weapons: [missile] })).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ ammo: 'tandem-charge', groups: missile.groups })],
        }));
        expect(parseGameEvent({ ...attack(), weapons: [{ ...missile, rackSize: 2 }] })).toBeNull();
        const invalidGroup = { ...missile.groups[1], floating: [4, 7] };
        expect(parseGameEvent({ ...attack(), weapons: [{ ...missile, groups: [invalidGroup] }] })).toBeNull();
    });

    it('keeps a hit that struck the swarming infantry, with its battle armor trooper', () => {
        const report = (swarmStrike: unknown) => ({ ...attack(), weapons: [{
            name: 'Medium Laser (struck while swarming)', types: ['DE'], targetNumber: 7, toHit: [5, 5], swarmStrike,
            groups: [{ damage: 5, location: [3, 4], aux: 2 }],
        }] });
        expect(parseGameEvent(report({ trooper: 3 }))).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ swarmStrike: { trooper: 3 } })],
        }));
        expect(parseGameEvent(report({}))).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ swarmStrike: {} })],
        }));
        for (const bad of [{ trooper: 0 }, { trooper: 7 }, { trooper: 2, location: 'CT' }, true]) {
            expect(parseGameEvent(report(bad))).withContext(JSON.stringify(bad)).toBeNull();
        }
    });

    it('keeps inferno missiles and rejects a malformed inferno flag', () => {
        const inferno = { name: 'SRM 6', types: ['M'], targetNumber: 7, toHit: [4, 4], inferno: true,
            groups: [{ damage: 0, location: [3, 4], aux: 1 }] };
        expect(parseGameEvent({ ...attack(), weapons: [inferno] })).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ inferno: true })],
        }));
        expect(parseGameEvent({ ...attack(), weapons: [{ ...inferno, inferno: false }] })).toBeNull();
    });

    it('accepts a physical attack read on the 1D6 punch table, and no other dice count', () => {
        const kick = { name: 'Kick', types: [], targetNumber: 5, toHit: [4, 4], table: 'kick', physical: 'kick',
            groups: [{ damage: 11, location: [4], aux: 1 }] };
        expect(parseGameEvent({ ...attack(), weapons: [kick] })).toEqual(jasmine.objectContaining({
            weapons: [jasmine.objectContaining({ table: 'kick', physical: 'kick', groups: [{ damage: 11, location: [4], aux: 1 }] })],
        }));
        for (const bad of [
            { ...kick, groups: [{ damage: 11, location: [4, 4], aux: 1 }] },
            { ...kick, table: 'tail' },
            { ...kick, physical: 'headbutt' },
            { ...attack().weapons[1], groups: [{ damage: 5, location: [4], aux: 1 }] },
        ]) expect(parseGameEvent({ ...attack(), weapons: [bad] })).toBeNull();
    });
});
