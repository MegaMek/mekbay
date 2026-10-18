// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import { asComponentId } from '../entity/entity-identifiers';
import { TestBipedMekEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { addTestEquipment, addTestEquipmentWithFlags } from '../entity/testing/test-mounted-equipment';
import { EntityMountedEquipment } from '../entity/types';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { entityAmmoSelectionCompatibilityFacts, mekAmmoCapacity, mekAmmoLoadout, mekAmmoLoadouts } from './mek-ammo';
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

describe('Entity guided-ammo compatibility facts', () => {
    const lrm15 = new WeaponEquipment({
        id: 'LRM 15', name: 'LRM 15', type: 'weapon', flags: ['F_ARTEMIS_COMPATIBLE'],
        weapon: { ammoType: 'LRM', rackSize: 15 },
    });
    const artemisAmmo = new AmmoEquipment({
        id: 'LRM 15 Artemis-capable Ammo', name: 'Artemis ammo', type: 'ammo',
        ammo: { type: 'LRM', rackSize: 15, shots: 8, munitionType: ['M_ARTEMIS_CAPABLE'] },
    });

    for (const flag of ['F_ARTEMIS', 'F_ARTEMIS_PROTO', 'F_ARTEMIS_V'] as const) {
        it(`recognizes ${flag} through the installed weapon link`, () => {
            const entity = new TestBipedMekEntity();
            const weapon = addTestEquipment(entity, lrm15, { location: 'LT' });
            const enhancement = addTestEquipmentWithFlags(entity, flag, { location: 'LT' });
            entity.linkEquipment(enhancement, weapon);

            expect(entityAmmoSelectionCompatibilityFacts(entity, [artemisAmmo])).toEqual({
                artemisIV: flag === 'F_ARTEMIS_V' ? [] : [artemisAmmo.internalName],
                artemisV: flag === 'F_ARTEMIS_V' ? [artemisAmmo.internalName] : [],
            });
        });
    }

    it('requires the installed enhancement to be linked to a weapon', () => {
        const entity = new TestBipedMekEntity();
        const weapon = addTestEquipment(entity, lrm15, { location: 'LT' });
        const unsupported = { artemisIV: [], artemisV: [] };

        expect(entityAmmoSelectionCompatibilityFacts(entity, [artemisAmmo])).toEqual(unsupported);
        const enhancement = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'LT' });
        expect(entityAmmoSelectionCompatibilityFacts(entity, [artemisAmmo])).toEqual(unsupported);
        entity.linkEquipment(enhancement, weapon);
        expect(entityAmmoSelectionCompatibilityFacts(entity, [artemisAmmo]).artemisIV)
            .toEqual([artemisAmmo.internalName]);
        entity.unlinkEquipment(enhancement);
        expect(entityAmmoSelectionCompatibilityFacts(entity, [artemisAmmo])).toEqual(unsupported);
    });

    it('requires a matching ammo family and rack size on the linked weapon', () => {
        const entity = new TestBipedMekEntity();
        const weapon = addTestEquipment(entity, lrm15, { location: 'LT' });
        const enhancement = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'LT' });
        entity.linkEquipment(enhancement, weapon);
        const otherRack = new AmmoEquipment({
            id: 'LRM 20 Artemis-capable Ammo', name: 'LRM 20 ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 20, shots: 6, munitionType: ['M_ARTEMIS_CAPABLE'] },
        });
        const otherFamily = new AmmoEquipment({
            id: 'LRT 15 Artemis-capable Ammo', name: 'LRT 15 ammo', type: 'ammo',
            ammo: { type: 'LRM_TORPEDO', rackSize: 15, shots: 8, munitionType: ['M_ARTEMIS_CAPABLE'] },
        });

        expect(entityAmmoSelectionCompatibilityFacts(entity, [otherRack, otherFamily, artemisAmmo])).toEqual({
            artemisIV: [artemisAmmo.internalName], artemisV: [],
        });
    });

    it('does not borrow a matching linked enhancement from another unit', () => {
        const equipped = new TestBipedMekEntity();
        const weapon = addTestEquipment(equipped, lrm15, { location: 'LT' });
        const enhancement = addTestEquipmentWithFlags(equipped, 'F_ARTEMIS', { location: 'LT' });
        equipped.linkEquipment(enhancement, weapon);
        const unequipped = new TestBipedMekEntity();
        addTestEquipment(unequipped, lrm15, { location: 'LT' });

        expect(entityAmmoSelectionCompatibilityFacts(equipped, [artemisAmmo]).artemisIV)
            .toEqual([artemisAmmo.internalName]);
        expect(entityAmmoSelectionCompatibilityFacts(unequipped, [artemisAmmo])).toEqual({
            artemisIV: [], artemisV: [],
        });
    });

    it('reports each ammo option once when multiple linked weapons can use it', () => {
        const entity = new TestBipedMekEntity();
        for (const location of ['LT', 'RT']) {
            const weapon = addTestEquipment(entity, lrm15, { location });
            const enhancement = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location });
            entity.linkEquipment(enhancement, weapon);
        }

        expect(entityAmmoSelectionCompatibilityFacts(entity, [artemisAmmo])).toEqual({
            artemisIV: [artemisAmmo.internalName], artemisV: [],
        });
    });
});
