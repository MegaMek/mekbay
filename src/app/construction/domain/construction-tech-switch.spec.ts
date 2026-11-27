// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, StructureEquipment, WeaponEquipment } from '../../models/equipment.model';
import { MountedArmor, MountedStructure, STANDARD_ARMOR_EQUIPMENT, STANDARD_STRUCTURE_EQUIPMENT } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { constructionMaterialMessages } from './construction-material-rules';
import { setConstructionArmorMaterial, setConstructionStructure, validateConstruction } from './construction-rules';

describe('construction technology transitions', () => {
    const tech = { level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
    const armor = (base: 'IS' | 'Clan') => new ArmorEquipment({ type: 'armor', id: `${base} Ferro-Fibrous`, name: 'Ferro-Fibrous',
        // The production catalog marks IS Ferro-Fibrous All despite its distinct Clan variant.
        tech: { ...tech, base: base === 'IS' ? 'All' : base }, flags: ['F_MEK_EQUIPMENT', 'F_TANK_EQUIPMENT', 'F_FERRO_FIBROUS'],
        stats: { criticalSlots: base === 'IS' ? 14 : 7, spreadable: true },
        armor: { type: 'FERRO_FIBROUS', patchworkSlotsMekSV: base === 'IS' ? 2 : 1 } });
    const structure = (base: 'IS' | 'Clan') => new StructureEquipment({ type: 'structure', id: `${base} Endo Steel`, name: 'Endo Steel',
        tech: { ...tech, base }, flags: ['F_ENDO_STEEL'], structure: { typeId: 2 },
        stats: { criticalSlots: base === 'IS' ? 14 : 7, spreadable: true } });
    const isArmor = armor('IS'), clanArmor = armor('Clan'), isStructure = structure('IS'), clanStructure = structure('Clan');
    const unmatched = new ArmorEquipment({ type: 'armor', id: 'IS Light Ferro-Fibrous', name: 'Light Ferro-Fibrous',
        tech: { ...tech, base: 'IS' }, flags: ['F_MEK_EQUIPMENT'], armor: { type: 'LIGHT_FERRO' } });
    const unmatchedStructure = new StructureEquipment({ type: 'structure', id: 'IS Composite', name: 'Composite',
        tech: { ...tech, base: 'IS' }, flags: ['F_COMPOSITE'], structure: { typeId: 4 } });
    const laser = new WeaponEquipment({ type: 'weapon', id: 'Test IS Laser', name: 'Laser', tech: { ...tech, base: 'IS' },
        flags: ['F_MEK_WEAPON'], stats: { criticalSlots: 1 } });
    const registry = createTestEquipmentRegistry(Object.fromEntries([STANDARD_ARMOR_EQUIPMENT, STANDARD_STRUCTURE_EQUIPMENT,
        isArmor, clanArmor, isStructure, clanStructure, unmatched, unmatchedStructure, laser].map(item => [item.id, item])));
    const switchBase = (entity: ReturnType<typeof createConstructionEntity>, base: 'IS' | 'Clan') =>
        getConstructionFields(entity).find(field => field.id === 'techBase')!.set(base);

    it('converts both ways and reconciles material reservations without moving installed weapons', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.year.set(3151);
        const weapon = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 4 }] } });
        setConstructionArmorMaterial(entity, isArmor);
        setConstructionStructure(entity, isStructure);
        for (const [base, expectedArmor, expectedStructure, count] of [
            ['Clan', clanArmor, clanStructure, 7], ['IS', isArmor, isStructure, 14],
        ] as const) {
            switchBase(entity, base);
            expect(entity.uniformArmor()?.armor).toBe(expectedArmor);
            expect(entity.uniformStructureMaterial()?.structure).toBe(expectedStructure);
            expect(entity.equipment().find(mount => mount.equipmentId === expectedArmor.id)?.placements?.length).toBe(count);
            expect(entity.equipment().find(mount => mount.equipmentId === expectedStructure.id)?.placements?.length).toBe(count);
            expect(entity.equipment().find(mount => mount.mountId === weapon.mountId)).toBe(weapon);
            expect(validateConstruction(entity).messages.some(issue => issue.code === 'MATERIAL_CRITICALS')).toBeFalse();
        }
    });

    it('retains patchwork and hybrid layouts when their converted materials become identical', () => {
        const entity = createConstructionEntity('Biped', registry) as MekEntity;
        entity.mixedTech.set(true);
        entity.setUniformArmor(new MountedArmor({ armor: isArmor }));
        entity.setArmorAt('RA', new MountedArmor({ armor: clanArmor }));
        entity.setUniformStructure(new MountedStructure({ structure: isStructure, tonnage: 50 }));
        entity.setStructureAt('RA', new MountedStructure({ structure: clanStructure, tonnage: 55 }));
        switchBase(entity, 'Clan');
        expect(entity.hasPatchworkArmor()).toBeTrue();
        expect(entity.hasHybridStructure()).toBeTrue();
        expect(entity.structureAt('RA').tonnage).toBe(55);
        expect([...entity.armorByLocation().values()].every(mounted => mounted.armor === clanArmor)).toBeTrue();
        expect([...entity.structureByLocation().values()].every(mounted => mounted.structure === clanStructure)).toBeTrue();
        switchBase(entity, 'IS');
        expect(entity.armorAt('RA').armor).toBe(isArmor);
        expect(entity.structureAt('RA').structure).toBe(isStructure);
        expect(entity.hasHybridStructure()).toBeTrue();
    });

    it('keeps unavailable counterparts selected and reports their tech mismatch until mixed technology is enabled', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.setUniformArmor(new MountedArmor({ armor: unmatched }));
        entity.setUniformStructure(new MountedStructure({ structure: unmatchedStructure, tonnage: 50 }));
        switchBase(entity, 'Clan');
        expect(entity.uniformArmor()?.armor).toBe(unmatched);
        expect(entity.uniformStructureMaterial()?.structure).toBe(unmatchedStructure);
        for (const material of [unmatched, unmatchedStructure]) {
            expect(constructionMaterialMessages(entity, material).some(issue => issue.code === 'MATERIAL_TECH_BASE')).toBeTrue();
        }
        entity.mixedTech.set(true);
        expect(constructionMaterialMessages(entity, unmatched).some(issue => issue.code === 'MATERIAL_TECH_BASE')).toBeFalse();
    });

    it('rebases shared structure and armor without treating All technology as incompatible', () => {
        const entity = createConstructionEntity('Biped', registry);
        switchBase(entity, 'Clan');
        expect(entity.structureAt('RT').structure).toBe(STANDARD_STRUCTURE_EQUIPMENT);
        expect(entity.structureAt('RT').techBase).toBe('Clan');
        expect(entity.supportsAutomaticClanCaseAt('RT')).toBeTrue();
        expect(entity.armorAt('RT').armor).toBe(STANDARD_ARMOR_EQUIPMENT);
        expect(constructionMaterialMessages(entity, STANDARD_ARMOR_EQUIPMENT).length).toBe(0);
        switchBase(entity, 'IS');
        expect(entity.supportsAutomaticClanCaseAt('RT')).toBeFalse();
    });

    it('converts vehicle armor while preserving its authored rating', () => {
        const entity = createConstructionEntity('Tank', registry);
        entity.setUniformArmor(new MountedArmor({ armor: isArmor, techRating: 'F' }));
        switchBase(entity, 'Clan');
        expect(entity.uniformArmor()?.armor).toBe(clanArmor);
        expect(entity.uniformArmor()?.techRating).toBe('F');
    });

    it('selects the distinct Clan Ferro-Fibrous variant from the production catalog', async () => {
        const catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
        const entity = createConstructionEntity('Biped', catalog);
        setConstructionArmorMaterial(entity, catalog.equipment['IS Ferro-Fibrous'] as ArmorEquipment);
        setConstructionStructure(entity, catalog.equipment['IS Endo Steel'] as StructureEquipment);
        switchBase(entity, 'Clan');
        expect(entity.uniformArmor()?.armor.id).toBe('Clan Ferro-Fibrous');
        expect(entity.uniformStructureMaterial()?.structure.id).toBe('Clan Endo Steel');
        expect(entity.equipment().find(mount => mount.equipmentId === 'Clan Ferro-Fibrous')?.placements?.length).toBe(7);
        switchBase(entity, 'IS');
        expect(entity.uniformArmor()?.armor.id).toBe('IS Ferro-Fibrous');
        expect(entity.equipment().find(mount => mount.equipmentId === 'IS Ferro-Fibrous')?.placements?.length).toBe(14);
    });
});
