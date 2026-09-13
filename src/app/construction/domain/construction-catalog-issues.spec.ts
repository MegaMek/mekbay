// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { MountedEngine } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { createConstructionEntity } from './construction-factory';
import { constructionEquipmentApplies, equipmentPlacementIssues, validateConstruction } from './construction-rules';
import { constructionMaterialMessages } from './construction-material-rules';

const registry = createTestEquipmentRegistry();

describe('catalog construction issue regressions', () => {
    it('uses each engine family\'s free heat sinks as the Mek minimum', () => {
        const entity = createConstructionEntity('Biped', registry) as MekEntity;
        const sink = new MiscEquipment({ id: 'Heat Sink', name: 'Heat Sink', type: 'misc',
            flags: ['F_HEAT_SINK'], stats: { tonnage: 1, criticalSlots: 1 } });
        for (const [type, minimum] of [['ICE', 0], ['Fuel Cell', 1], ['Fission', 5], ['Fusion', 10]] as const) {
            entity.configureEngine(new MountedEngine({ type, rating: 200, techBase: 'IS' }));
            entity.configureHeatSinks(sink, minimum);
            expect(entity.validationResult().messages.some(issue => issue.code === 'HEAT_SINKS_BELOW_MIN'))
                .withContext(type).toBeFalse();
            if (minimum > 0) {
                entity.configureHeatSinks(sink, minimum - 1);
                expect(entity.validationResult().messages.some(issue => issue.code === 'HEAT_SINKS_BELOW_MIN'))
                    .withContext(type).toBeTrue();
            }
        }
    });

    it('accepts infantry anti-Mek gear and all vehicular autocannon field guns', () => {
        const infantry = createConstructionEntity('Infantry', registry);
        const antiMek = new MiscEquipment({ id: 'AntiMekGear', name: 'Anti-Mek Gear', type: 'misc', flags: ['F_ANTI_MEK_GEAR'] });
        expect(constructionEquipmentApplies(infantry, antiMek)).toBeTrue();
        expect(constructionEquipmentApplies(createConstructionEntity('Biped', registry), antiMek)).toBeFalse();
        for (const ammoType of ['LAC', 'PAC', 'HYPER_VELOCITY', 'AC_ROTARY', 'AC_IMP'] as const) {
            const weapon = new WeaponEquipment({ id: ammoType, name: ammoType, type: 'weapon',
                flags: ['F_BALLISTIC'], weapon: { ammoType } });
            expect(constructionEquipmentApplies(infantry, weapon)).withContext(ammoType).toBeTrue();
        }
        const laser = new WeaponEquipment({ id: 'laser', name: 'laser', type: 'weapon', flags: ['F_ENERGY'] });
        expect(constructionEquipmentApplies(infantry, laser)).toBeFalse();
        const extinguisher = new WeaponEquipment({ id: 'Fire Extinguisher', name: 'Fire Extinguisher', type: 'weapon',
            flags: ['F_EXTINGUISHER'], tech: { base: 'All', level: 'Standard', advancement: { is: { common: '2300' }, clan: { common: '2300' } } } });
        expect(constructionEquipmentApplies(infantry, extinguisher)).toBeTrue();
        expect(equipmentPlacementIssues(infantry, extinguisher, 'Infantry')).toEqual([]);
    });

    it('uses the building\'s per-location armor limits for its total limit', () => {
        const building = createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;
        building.buildingClass.set(3);
        building.constructionFactor.set(100);
        const location = building.locationOrder[0];
        building.armorValues.set(new Map([[location, { front: 100, rear: 0 }]]));
        expect(building.maximumArmorPoints()).toBe(building.totalMaxArmor());
        expect(validateConstruction(building).messages.some(issue => issue.code === 'ARMOR_TOTAL_EXCEEDED')).toBeFalse();
        building.armorValues.set(new Map([[location, { front: 101, rear: 0 }]]));
        expect(validateConstruction(building).messages.some(issue => issue.code === 'ARMOR_TOTAL_EXCEEDED')).toBeTrue();
    });

    it('does not apply BattleMek armor dates to building protection', () => {
        const building = createConstructionEntity('BuildingEntity', registry);
        building.year.set(2300);
        expect(constructionMaterialMessages(building, building.uniformArmor()!.armor)).toEqual([]);
        const mek = createConstructionEntity('Biped', registry);
        mek.year.set(2300);
        expect(constructionMaterialMessages(mek, mek.uniformArmor()!.armor).some(issue => issue.code === 'MATERIAL_TECH_UNAVAILABLE')).toBeTrue();
    });

    it('allows handheld armor within the weapon\'s mass budget', () => {
        const handheld = createConstructionEntity('HandheldWeapon', registry);
        handheld.setTonnage(5);
        handheld.armorValues.set(new Map([['Gun', { front: 16, rear: 0 }]]));
        expect(handheld.maximumArmorPoints()).toBe(80);
        expect(handheld.validationResult().messages.filter(issue => issue.category === 'armor')).toEqual([]);
        expect(validateConstruction(handheld).messages.some(issue => issue.code === 'ARMOR_TOTAL_EXCEEDED')).toBeFalse();
        handheld.armorValues.set(new Map([['Gun', { front: 81, rear: 0 }]]));
        expect(handheld.validationResult().messages.some(issue => issue.code === 'ARMOR_EXCEEDS_MAX')).toBeTrue();
    });
});
