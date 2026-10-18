// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { parseGameEvent } from './game-events.service';

describe('parseGameEvent', () => {
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

    it('rejects attack reports with impossible dice, damage or unbounded rows', () => {
        const badDie = attack();
        badDie.weapons[0].toHit = [7, 1];
        const badDamage = attack();
        badDamage.weapons[0].groups[0].damage = 0;
        const badArc = { ...attack(), arc: 'top' };
        const badType = attack();
        (badType.weapons[1] as { types: string[] }).types = ['LASER'];
        const flood = { ...attack(), weapons: Array.from({ length: 65 }, () => attack().weapons[1]) };

        for (const value of [badDie, badDamage, badArc, badType, flood]) expect(parseGameEvent(value)).toBeNull();
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
