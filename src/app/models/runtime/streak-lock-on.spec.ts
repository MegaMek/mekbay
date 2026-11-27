// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import { applyMekWeaponFirePlanV2, planMekWeaponFireV2 } from './mek-weapon-fire-v2';
import { createDirectFlamerRuntimeFixture, createDirectStreakRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('Streak lock-on', () => {
    it('fires a missed lock without ammo or heat, but counts it as fired (TW p. 138)', () => {
        const f = createDirectStreakRuntimeFixture();
        const streak = f.equipmentComponent('Test Streak SRM 2').id;
        const ammo = f.equipmentComponent('Test Streak SRM 2 Ammo').id;
        const fire = (noLock: boolean) => planMekWeaponFireV2(f.entity, f.index, f.instance.ruleset(), f.instance.query(), [{
            weaponId: streak, ammoSourceId: ammo, expectedMunitionKey: 'Test Streak SRM 2 Ammo',
            ...(noLock ? { noLock: true as const } : {}),
        }]);

        const locked = fire(false);
        expect(locked.accepted && locked.plan.heat).toBe(2);
        expect(locked.accepted && locked.plan.ammoSpends.length).toBe(1);

        const missed = fire(true);
        if (!missed.accepted) throw new Error('A missed lock still fires');
        expect(missed.plan.heat).toBe(0);
        expect(missed.plan.ammoSpends).toEqual([]);
        const after = applyMekWeaponFirePlanV2(f.instance.snapshot(), missed.plan);
        expect(after.turn.firedWeapons).toEqual([streak]);
        expect(after.ammo.get(ammo)?.shotsSpent ?? 0).toBe(0);
    });

    it('lets only a weapon that locks on miss its lock', () => {
        const f = createDirectFlamerRuntimeFixture();
        const flamer: ComponentId = f.equipmentComponent('Test Flamer').id;
        const plan = planMekWeaponFireV2(f.entity, f.index, f.instance.ruleset(), f.instance.query(), [
            { weaponId: flamer, noLock: true },
        ]);
        expect(plan.accepted).toBeFalse();
    });
});
