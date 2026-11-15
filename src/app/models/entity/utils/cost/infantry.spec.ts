// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment, type InfantryWeaponEquipment } from '../../../equipment.model';
import type { EquipmentFlag } from '../../../equipment-flags.type';
import { TestInfantryEntity } from '../../testing/test-entities';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { calculateInfantryCostReport } from './infantry';

function infantryWeapon(id: string, cost: number, flags: EquipmentFlag[] = []): InfantryWeaponEquipment {
    const weapon = new WeaponEquipment({
        id, name: id, type: 'weapon', stats: { cost }, flags: ['F_INFANTRY', ...flags],
        weapon: { ammoType: 'INFANTRY' }, infantry: { damage: 0.5, range: 1 },
    });
    if (!weapon.isInfantryWeapon()) throw new Error(`${id} is not an infantry weapon`);
    return weapon;
}

describe('conventional infantry cost', () => {
    it('prices a disposable weapon per trooper like the primary weapon, before the platoon multiplier', () => {
        const rifle = infantryWeapon('Auto-Rifle', 100);
        const law = infantryWeapon('Rocket Launcher (LAW)', 400, ['F_INF_DISPOSABLE']);
        const platoon = (disposable: boolean) => {
            const entity = new TestInfantryEntity(createTestEquipmentRegistry({ [rifle.id]: rifle, [law.id]: law }));
            entity.squadSize.set(7);
            entity.squadCount.set(4);
            entity.motiveType.set('Motorized');
            entity.setPlatoonWeapon('primary', rifle);
            if (disposable) entity.setPlatoonWeapon('disposable', law);
            return calculateInfantryCostReport(entity).total;
        };

        // 28 motorized troopers, each with a LAW: 28 x 2,000 x sqrt(400) x 1.6 = 1,792,000.
        expect(platoon(true) - platoon(false)).toBeCloseTo(1_792_000, 6);
    });
});
