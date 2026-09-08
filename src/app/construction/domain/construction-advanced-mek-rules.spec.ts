// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ArmorEquipment, MiscEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { MountedArmor, MountedEngine, MountedStructure } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createConstructionEntity, type ConstructionUnitKind } from './construction-factory';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';

function mek(kind: ConstructionUnitKind = 'Biped'): MekEntity {
    return createConstructionEntity(kind, createTestEquipmentRegistry()) as MekEntity;
}
function equipment(entity: MekEntity, flags: EquipmentFlag[], location = 'RT') {
    const item = new MiscEquipment({ id: flags.join(' '), name: flags.join(' '), type: 'misc', flags });
    return addTestEquipment(entity, item, { location });
}
function codes(entity: MekEntity): string[] { return constructionAdvancedMekMessages(entity).map(message => message.code); }

describe('advanced Mek construction combinations', () => {
    it('distinguishes a supercharger from MASC in AES and myomer restrictions', () => {
        const entity = mek();
        equipment(entity, ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 'RA');
        const charger = equipment(entity, ['F_MASC', 'S_SUPERCHARGER']);
        expect(codes(entity)).not.toContain('MEK_AES_MASC');
        entity.removeEquipment(charger);
        equipment(entity, ['F_MASC']);
        expect(codes(entity)).toContain('MEK_AES_MASC');
        entity.myomerType.set('Triple Strength');
        expect(codes(entity)).toContain('MEK_MASC_MYOMER');
        expect(codes(entity)).toContain('MEK_AES_MYOMER');
    });

    it('requires AES in every leg and rejects duplicate AES in one limb', () => {
        const entity = mek('Tripod');
        equipment(entity, ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 'LL');
        equipment(entity, ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 'RL');
        expect(codes(entity)).toContain('MEK_AES_ALL_LEGS');
        equipment(entity, ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 'CL');
        expect(codes(entity)).not.toContain('MEK_AES_ALL_LEGS');
        equipment(entity, ['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 'CL');
        expect(codes(entity)).toContain('MEK_AES_DUPLICATE');
    });

    it('allows Nova with null signature but forbids it with void signature', () => {
        const entity = mek();
        equipment(entity, ['F_NOVA', 'F_ECM']);
        const signature = equipment(entity, ['F_NULL_SIG']);
        expect(codes(entity)).not.toContain('MEK_NULL_C3');
        entity.removeEquipment(signature);
        equipment(entity, ['F_VOID_SIG']);
        expect(codes(entity)).toContain('MEK_VOID_C3');
        expect(codes(entity)).not.toContain('MEK_VOID_ECM');
    });

    it('requires ECM for void signature and forbids simultaneous signature systems', () => {
        const entity = mek();
        equipment(entity, ['F_VOID_SIG']);
        equipment(entity, ['F_NULL_SIG']);
        expect(codes(entity)).toContain('MEK_VOID_ECM');
        expect(codes(entity)).toContain('MEK_NULL_VOID');
    });

    it('validates HarJel by the armor in the repaired location', () => {
        const entity = mek();
        equipment(entity, ['F_HARJEL_II'], 'RT');
        const hardened = new ArmorEquipment({ id: 'Hardened Armor', name: 'Hardened Armor', type: 'armor', armor: { type: 'HARDENED' } });
        entity.setArmorAt('LT', new MountedArmor({ armor: hardened, techBase: 'IS' }));
        expect(codes(entity)).not.toContain('MEK_HARJEL_ARMOR');
        entity.setArmorAt('RT', new MountedArmor({ armor: hardened, techBase: 'IS' }));
        expect(codes(entity)).toContain('MEK_HARJEL_ARMOR');
        equipment(entity, ['F_HARJEL_III'], 'RT');
        expect(codes(entity)).toContain('MEK_HARJEL_GENERATION');
        expect(codes(entity)).toContain('MEK_HARJEL_DUPLICATE');
    });

    it('rejects LAM Omni, weight, cockpit, engine and physical weapon combinations', () => {
        const entity = mek('LAM');
        entity.omni.set(true);
        entity.setTonnage(60);
        entity.cockpitType.set('Torso-Mounted');
        entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 240, techBase: 'IS' }));
        equipment(entity, ['F_CLUB']);
        expect(codes(entity)).toEqual(jasmine.arrayContaining(['LAM_OMNI', 'LAM_TONNAGE', 'LAM_COCKPIT', 'LAM_ENGINE', 'LAM_EQUIPMENT']));
    });

    it('rejects undersized FrankenMek leg donors and superheavy limbs on ordinary torsos', () => {
        const entity = mek();
        const material = entity.structureByLocation().get('CT')!;
        entity.setStructureAt('LL', new MountedStructure({ structure: material.structure, techBase: 'IS', tonnage: 45 }));
        entity.setStructureAt('RA', new MountedStructure({ structure: material.structure, techBase: 'IS', tonnage: 105 }));
        expect(codes(entity)).toContain('FRANKEN_LEG_DONOR');
        expect(codes(entity)).toContain('FRANKEN_SUPERHEAVY_DONOR');
        entity.omni.set(true);
        expect(codes(entity)).toContain('FRANKEN_OMNI');
    });

    it('checks cockpit availability at the selected design year', () => {
        const entity = mek();
        entity.cockpitType.set('Small');
        entity.year.set(3000);
        expect(constructionAdvancedMekMessages(entity)).toContain(jasmine.objectContaining({ code: 'MEK_SYSTEM_TECH_DATE', message: 'Cockpit technology is unavailable in 3000.' }));
        entity.year.set(3151);
        expect(constructionAdvancedMekMessages(entity).filter(message => message.code === 'MEK_SYSTEM_TECH_DATE')).toEqual([]);
    });

    it('requires mixed technology for an explicitly Clan engine on an IS chassis', () => {
        const entity = mek();
        entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 200, techBase: 'Clan' }));
        expect(codes(entity)).toContain('MEK_SYSTEM_TECH_BASE');
        entity.mixedTech.set(true);
        expect(codes(entity)).not.toContain('MEK_SYSTEM_TECH_BASE');
    });
});
