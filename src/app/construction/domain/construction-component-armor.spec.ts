// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { constructionComponentArmorIssue, constructionComponentArmorMessages } from './construction-component-armor';
import { createConstructionEntity } from './construction-factory';
import { validateConstruction } from './construction-rules';

describe('component armor construction rules', () => {
    let registry: EquipmentRegistry;
    beforeAll(async () => { registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json()); });
    const mek = () => createConstructionEntity('Biped', registry) as MekEntity;

    for (const id of ['IS Endo Steel', 'IS Stealth', 'IS Ferro-Fibrous', 'IS Reactive', 'ISCASE', 'ISCASEII', 'CLCASE', 'Triple Strength Myomer']) {
        it(`rejects component armor on ${id} using the catalog's critical-hit eligibility`, () => {
            const entity = mek();
            const mount = addTestEquipment(entity, registry.equipment[id], { location: 'LT', armored: true });
            expect(constructionComponentArmorIssue(entity, mount)?.code).toBe('ARMORED_UNHITTABLE_COMPONENT');
            expect(validateConstruction(entity).messages).toContain(jasmine.objectContaining({
                code: 'ARMORED_UNHITTABLE_COMPONENT', severity: 'error', location: 'LT',
            }));
        });
    }

    for (const id of ['ISGaussRifle', 'Coolant Pod', 'ISDoubleHeatSink', 'ISPartialWing']) {
        it(`permits hittable ${id}, including explosive equipment and spreadable systems`, () => {
            const entity = mek();
            const mount = addTestEquipment(entity, registry.equipment[id], { location: 'LT', armored: true });
            expect(constructionComponentArmorIssue(entity, mount)).toBeNull();
            expect(constructionComponentArmorMessages(entity)).toEqual([]);
        });
    }

    it('flags armored ammo loaded from a native draft, even when the bin is empty', () => {
        const entity = mek();
        const ammo = registry.equipment['IS Ammo AC/5'];
        expect(ammo).toBeDefined();
        addTestEquipment(entity, ammo, { shotsCount: 0, armored: true,
            allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] } });
        const loaded = parseEntity(encodeNativeEntity(entity), 'armored-ammo.mtf', registry).entity;
        const mount = loaded.equipment().find(item => item.equipment?.id === ammo.id)!;
        expect(mount.armored).toBeTrue();
        expect(constructionComponentArmorIssue(loaded, mount)?.code).toBe('ARMORED_AMMUNITION');
        expect(validateConstruction(loaded).messages.some(issue => issue.code === 'ARMORED_AMMUNITION')).toBeTrue();
    });

    it('armors integral heat sinks through the engine instead of a separate mount', () => {
        const entity = mek();
        const sink = addTestEquipment(entity, registry.equipment['ISDoubleHeatSink'], { allocation: { kind: 'engine' }, armored: true });
        expect(constructionComponentArmorIssue(entity, sink)?.code).toBe('ARMORED_INTEGRAL_COMPONENT');
        expect(constructionComponentArmorIssue(entity, 'Engine')).toBeNull();
        expect(constructionComponentArmorMessages(entity).map(issue => issue.code)).toEqual(['ARMORED_INTEGRAL_COMPONENT']);
    });

    it('rejects all superheavy component armor with one chassis error', () => {
        const entity = mek();
        entity.setTonnage(105);
        const gun = addTestEquipment(entity, registry.equipment['ISGaussRifle'], { location: 'LT', armored: true });
        entity.armoredSystemSlots.set(new Set(['CT:0', 'CT:1']));
        expect(constructionComponentArmorIssue(entity, gun)?.code).toBe('SUPERHEAVY_ARMORED_COMPONENT');
        expect(constructionComponentArmorIssue(entity, 'Engine')?.code).toBe('SUPERHEAVY_ARMORED_COMPONENT');
        expect(validateConstruction(entity).messages.filter(issue => issue.code === 'SUPERHEAVY_ARMORED_COMPONENT').length).toBe(1);
    });

    it('rejects an Interface Cockpit while leaving its other hittable systems eligible', () => {
        const entity = mek();
        entity.cockpitType.set('Interface');
        expect(constructionComponentArmorIssue(entity, 'Cockpit')?.code).toBe('MEK_INTERFACE_ARMOR');
        for (const system of ['Sensors', 'Life Support', 'Engine', 'Gyro', 'Hand Actuator'] as const) {
            expect(constructionComponentArmorIssue(entity, system)).toBeNull();
        }
        const head = entity.criticalSlotGrid().get('HD')!;
        const cockpit = head.findIndex(slot => slot.type === 'system' && slot.systemType === 'Cockpit');
        entity.armoredSystemSlots.set(new Set([`HD:${cockpit}`]));
        expect(validateConstruction(entity).messages.filter(issue => issue.code === 'MEK_INTERFACE_ARMOR').length).toBe(1);
    });

    it('restricts component armor to Meks', () => {
        const entity = createConstructionEntity('Tank', registry);
        const mount = addTestEquipment(entity, registry.equipment['ISGaussRifle'], { location: 'Front', armored: true });
        expect(constructionComponentArmorIssue(entity, mount)?.code).toBe('ARMORED_COMPONENT_CHASSIS');
        expect(validateConstruction(entity).messages.some(issue => issue.code === 'ARMORED_COMPONENT_CHASSIS')).toBeTrue();
    });
});
