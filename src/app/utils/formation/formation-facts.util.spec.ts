// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestInfantryEntity } from '../../models/entity/testing/test-entities';
import { WeaponEquipment } from '../../models/equipment.model';
import { compileFormationUnitFacts } from './formation-facts.util';

describe('formation unit facts', () => {
    it('sees a loaded platoon\'s TAG and platoon-level weapon damage', () => {
        const rifle = new WeaponEquipment({ id: 'Rifle', name: 'Rifle', type: 'weapon',
            flags: ['F_INFANTRY'], infantry: { damage: 0.8, range: 1 } });
        const tag = new WeaponEquipment({ id: 'InfantryTAG', name: 'TAG', type: 'weapon',
            flags: ['F_INFANTRY', 'F_TAG'], infantry: { damage: 0, range: 3 } });
        if (!rifle.isInfantryWeapon() || !tag.isInfantryWeapon()) throw new Error('Expected infantry weapons');
        const platoon = new TestInfantryEntity();
        platoon.squadSize.set(7);
        platoon.squadCount.set(4);
        platoon.setPlatoonWeapon('primary', rifle);
        platoon.setPlatoonWeapon('secondary', tag);
        platoon.secondaryCount.set(2);

        const facts = compileFormationUnitFacts({ force: { faction: () => null }, getFormationEntity: () => platoon });

        expect(facts.cbtHasTag).toBeTrue();
        // 20 riflemen at the 0.6 primary cap; the TAG deals no damage.
        expect(facts.cbtWeapons.map(weapon => weapon.maximumDamage)).toEqual([12, 0]);
    });
});
