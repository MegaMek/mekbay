// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import { asComponentId } from '../entity/entity-identifiers';
import { TestBipedMekEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from '../entity/types';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { mekAmmoCapacity, mekAmmoLoadout, mekAmmoLoadouts } from './mek-ammo';
import { buildMekRuntimeIndex } from './mek-runtime-index';

describe('Mek ammo loadout queries', () => {
    const standard = new AmmoEquipment({
        id: 'Standard AC ammo', name: 'Standard', type: 'ammo',
        ammo: { type: 'AC', rackSize: 10, shots: 10 },
    });
    const precision = new AmmoEquipment({
        id: 'Precision AC ammo', name: 'Precision', type: 'ammo',
        ammo: { type: 'AC', rackSize: 10, shots: 5, baseAmmo: standard.id, munitionType: ['M_PRECISION'] },
    });
    const caseless = new AmmoEquipment({
        id: 'Caseless AC ammo', name: 'Caseless', type: 'ammo',
        ammo: { type: 'AC', rackSize: 10, shots: 20, munitionType: ['M_CASELESS'] },
    });
    const weapon = new WeaponEquipment({
        id: 'One-shot AC', name: 'One-shot AC', type: 'weapon', flags: ['F_ONE_SHOT'],
        weapon: { ammoType: 'AC', rackSize: 10 },
    });

    function fixture() {
        const registry = createTestEquipmentRegistry(Object.fromEntries(
            [standard, precision, caseless, weapon].map(equipment => [equipment.id, equipment]),
        ));
        const entity = new TestBipedMekEntity(registry);
        entity.setEquipment([standard, weapon].map((equipment, index) => new EntityMountedEquipment({
            mountId: `ammo:${index}`, equipment, equipmentId: equipment.id,
            allocation: { kind: 'location', location: 'LT' }, shotsCount: 20,
            rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
        })));
        return { registry, entity, index: buildMekRuntimeIndex(entity) };
    }

    it('reads an installed bin capacity without enumerating alternative ammunition', () => {
        const { registry, entity, index } = fixture();
        const alternatives = spyOn(registry, 'getAmmoForAmmo').and.throwError('Do not build the ammo menu');
        expect(mekAmmoCapacity(entity, index, asComponentId('ammo:0'), CORE_2026_RULESET)).toBe(20);
        expect(mekAmmoLoadout(entity, index, asComponentId('ammo:0'), CORE_2026_RULESET, standard.id)?.equipment)
            .toBe(standard);
        expect(alternatives).not.toHaveBeenCalled();
    });

    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        it(`preserves the options list, selected capacities and invalid-ammo rejection under ${ruleset}`, () => {
            const { entity, index } = fixture();
            for (const id of [asComponentId('ammo:0'), asComponentId('ammo:1')]) {
                const options = mekAmmoLoadouts(entity, index, id, ruleset);
                expect(options.map(option => option.munitionKey)).toEqual([precision.id, standard.id]);
                for (const option of options) {
                    expect(mekAmmoLoadout(entity, index, id, ruleset, option.munitionKey)).toEqual(option);
                }
                expect(mekAmmoLoadout(entity, index, id, ruleset, caseless.id)).toBeNull();
                expect(mekAmmoLoadout(entity, index, id, ruleset, 'missing')).toBeNull();
            }
            expect(mekAmmoCapacity(entity, index, asComponentId('ammo:0'), ruleset, precision.id))
                .toBe(ruleset === CORE_2026_RULESET ? 12 : 10);
            expect(mekAmmoCapacity(entity, index, asComponentId('ammo:1'), ruleset, precision.id)).toBe(1);
        });
    }
});
