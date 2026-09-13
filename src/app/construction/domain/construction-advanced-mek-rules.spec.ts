// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ArmorEquipment, MiscEquipment, StructureEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { MountedArmor, MountedEngine, MountedStructure } from '../../models/entity/components';
import { MekEntity, MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createConstructionEntity, type ConstructionUnitKind } from './construction-factory';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';
import { validateConstruction } from './construction-rules';

function mek(kind: ConstructionUnitKind = 'Biped'): MekEntity {
    return createConstructionEntity(kind, createTestEquipmentRegistry()) as MekEntity;
}
function equipment(entity: MekEntity, flags: EquipmentFlag[], location = 'RT') {
    const item = new MiscEquipment({ id: flags.join(' '), name: flags.join(' '), type: 'misc', flags });
    return addTestEquipment(entity, item, { location });
}
function codes(entity: MekEntity): string[] { return validateConstruction(entity).messages.map(message => message.code); }

describe('advanced Mek construction combinations', () => {
    it('requires advanced industrial fire control for guidance while permitting a supercharger', () => {
        const entity = mek();
        const industrial = new StructureEquipment({ id: 'Industrial Structure', name: 'Industrial', type: 'structure', flags: ['F_INDUSTRIAL_STRUCTURE'], structure: { typeId: 1 } });
        entity.setUniformStructure(new MountedStructure({ structure: industrial, techBase: 'IS', tonnage: 50 }));
        entity.cockpitType.set('Industrial');
        equipment(entity, ['F_ARTEMIS']);
        equipment(entity, ['F_MASC', 'S_SUPERCHARGER']);
        expect(codes(entity)).toContain('MEK_INDUSTRIAL_FIRE_CONTROL');
        expect(codes(entity)).not.toContain('MEK_INDUSTRIAL_MYOMER');
        entity.cockpitType.set('Standard');
        expect(codes(entity)).not.toContain('MEK_INDUSTRIAL_FIRE_CONTROL');
        equipment(entity, ['F_MASC']);
        equipment(entity, ['F_JUMP_JET', 'S_IMPROVED']);
        expect(codes(entity)).toContain('MEK_INDUSTRIAL_MYOMER');
        expect(codes(entity)).toContain('MEK_INDUSTRIAL_JUMP_TYPE');
    });

    it('rejects industrial-only equipment on BattleMeks and prohibited superheavy systems', () => {
        const entity = mek();
        equipment(entity, ['F_LIGHT_FLUID_SUCTION_SYSTEM']);
        equipment(entity, ['F_ENVIRONMENTAL_SEALING']);
        expect(codes(entity)).toContain('MEK_FLUID_SUCTION');
        expect(codes(entity)).toContain('MEK_INDUSTRIAL_ONLY_EQUIPMENT');
        entity.setTonnage(105);
        equipment(entity, ['F_MASC', 'S_SUPERCHARGER']);
        equipment(entity, ['F_MODULAR_ARMOR']);
        expect(codes(entity).filter(code => code === 'MEK_SUPERHEAVY_EQUIPMENT').length).toBe(2);
    });

    it('requires ram plates to use a quad with reinforced structure and one critical in every torso', () => {
        const entity = mek('Quad');
        const plate = equipment(entity, ['F_RAM_PLATE'], 'CT');
        expect(codes(entity)).not.toContain('MEK_RAM_PLATE_CHASSIS');
        expect(codes(entity)).toContain('MEK_RAM_PLATE_STRUCTURE');
        expect(codes(entity)).toContain('MEK_RAM_PLATE_DISTRIBUTION');
        const reinforced = new StructureEquipment({ id: 'Reinforced Structure', name: 'Reinforced', type: 'structure', flags: ['F_REINFORCED'], structure: { typeId: 4 } });
        for (const location of ['CT', 'LT', 'RT']) entity.setStructureAt(location, new MountedStructure({ structure: reinforced, techBase: 'IS', tonnage: 50 }));
        entity.moveEquipment(plate, 'CT', ['CT', 'LT', 'RT'].map(location => ({ location, slotIndex: 10 })));
        expect(codes(entity)).not.toContain('MEK_RAM_PLATE_STRUCTURE');
        expect(codes(entity)).not.toContain('MEK_RAM_PLATE_DISTRIBUTION');
        const biped = mek();
        equipment(biped, ['F_RAM_PLATE'], 'CT');
        expect(codes(biped)).toContain('MEK_RAM_PLATE_CHASSIS');
    });

    it('checks turret chassis/cockpit compatibility and one shoulder turret per side torso', () => {
        const entity = mek();
        equipment(entity, ['F_HEAD_TURRET'], 'CT');
        equipment(entity, ['F_QUAD_TURRET'], 'RT');
        expect(codes(entity)).toContain('MEK_HEAD_TURRET_COCKPIT');
        expect(codes(entity)).toContain('MEK_QUAD_TURRET_CHASSIS');
        entity.cockpitType.set('Torso-Mounted');
        expect(codes(entity)).not.toContain('MEK_HEAD_TURRET_COCKPIT');
        equipment(entity, ['F_SHOULDER_TURRET'], 'LT');
        equipment(entity, ['F_SHOULDER_TURRET'], 'RT');
        expect(codes(entity)).not.toContain('MEK_SHOULDER_TURRET_LOCATION');
        equipment(entity, ['F_SHOULDER_TURRET'], 'LT');
        expect(codes(entity)).toContain('MEK_SHOULDER_TURRET_LOCATION');
        const quad = mek('QuadVee');
        equipment(quad, ['F_SHOULDER_TURRET'], 'RT');
        expect(codes(quad)).toContain('MEK_QUAD_SHOULDER_TURRET');
    });

    it('allows cape chain drapes but rejects aprons/ponchos on quads and torso cockpits', () => {
        const entity = mek('Quad');
        const cape = equipment(entity, ['F_CHAIN_DRAPE_CAPE'], 'RT');
        expect(codes(entity)).not.toContain('MEK_CHAIN_DRAPE_CONFIGURATION');
        entity.removeEquipment(cape);
        equipment(entity, ['F_CHAIN_DRAPE_APRON'], 'RT');
        expect(codes(entity)).toContain('MEK_CHAIN_DRAPE_CONFIGURATION');
        const biped = mek();
        equipment(biped, ['F_CHAIN_DRAPE_PONCHO'], 'RT');
        expect(codes(biped)).not.toContain('MEK_CHAIN_DRAPE_CONFIGURATION');
        biped.cockpitType.set('Torso-Mounted');
        expect(codes(biped)).toContain('MEK_CHAIN_DRAPE_CONFIGURATION');
    });

    it('checks interface cockpit armoring specifically and its cramped cockpit quirk', () => {
        const entity = mek();
        entity.cockpitType.set('Interface');
        entity.armoredSystemSlots.set(new Set(['CT:0']));
        expect(codes(entity)).not.toContain('MEK_INTERFACE_ARMOR');
        const head = entity.criticalSlotGrid().get('HD')!;
        const index = head.findIndex(slot => slot.type === 'system' && slot.systemType === 'Cockpit');
        expect(index).toBeGreaterThanOrEqual(0);
        entity.armoredSystemSlots.set(new Set([`HD:${index}`]));
        entity.quirks.set([{ quirk: { key: 'cramped_cockpit', name: 'Cramped Cockpit', description: '', type: 'negative' } }]);
        expect(codes(entity)).toContain('MEK_INTERFACE_ARMOR');
        expect(codes(entity)).toContain('MEK_INTERFACE_CRAMPED');
    });

    it('requires a chainsaw to replace the hand while retaining the lower arm', () => {
        const entity = mek() as MekWithArmsEntity;
        equipment(entity, ['F_CLUB', 'S_CHAINSAW'], 'RA');
        expect(codes(entity)).toContain('MEK_TOOL_REPLACES_HAND');
        entity.hasHandActuator.set({ left: true, right: false });
        expect(codes(entity)).not.toContain('MEK_TOOL_REPLACES_HAND');
        entity.hasLowerArmActuator.set({ left: true, right: false });
        expect(codes(entity)).toContain('MEK_TOOL_REQUIRES_LOWER_ARM');
    });

    it('distinguishes hand-held weapons, lance prerequisites and pile-driver replacements', () => {
        const entity = mek() as MekWithArmsEntity;
        entity.hasHandActuator.set({ left: false, right: false });
        const hatchet = equipment(entity, ['F_CLUB', 'S_HATCHET'], 'LA');
        expect(codes(entity)).toContain('MEK_TOOL_REQUIRES_HAND');
        entity.removeEquipment(hatchet);
        const lance = equipment(entity, ['F_CLUB', 'S_LANCE'], 'LA');
        expect(codes(entity)).not.toContain('MEK_TOOL_REQUIRES_HAND');
        entity.hasLowerArmActuator.set({ left: false, right: true });
        expect(codes(entity)).toContain('MEK_TOOL_REQUIRES_LOWER_ARM');
        entity.removeEquipment(lance);
        equipment(entity, ['F_CLUB', 'S_PILE_DRIVER'], 'RA');
        expect(codes(entity)).toContain('MEK_TOOL_REPLACES_LOWER_ARM');
        entity.hasLowerArmActuator.set({ left: false, right: false });
        expect(codes(entity)).not.toContain('MEK_TOOL_REPLACES_LOWER_ARM');
    });

    it('rejects two hand replacements in one arm and exempts quad torso tools', () => {
        const entity = mek() as MekWithArmsEntity;
        entity.hasHandActuator.set({ left: false, right: false });
        equipment(entity, ['F_SALVAGE_ARM'], 'RA');
        equipment(entity, ['F_HAND_WEAPON'], 'RA');
        expect(codes(entity)).toContain('MEK_HAND_REPLACEMENT_LIMIT');
        const quad = mek('Quad');
        equipment(quad, ['F_CLUB', 'S_CHAINSAW'], 'RT');
        expect(codes(quad).filter(code => code.startsWith('MEK_TOOL_'))).toEqual([]);
    });

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
