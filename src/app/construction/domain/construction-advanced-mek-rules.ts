// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity, MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { calculateTechLevel, compareTechLevels, isTechnologyAvailable, type ComponentTechLevel, type EntityValidationMessage, type TechAdvancement } from '../../models/entity/types';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';

/** Construction combinations from TestMek.hasIllegalEquipmentCombinations and TestEntity. */
export function constructionAdvancedMekMessages(entity: BaseEntity): EntityValidationMessage[] {
    if (!(entity instanceof MekEntity)) return [];
    const messages: EntityValidationMessage[] = [];
    const add = (code: string, message: string, location?: string, category: EntityValidationMessage['category'] = 'equipment') =>
        messages.push({ severity: 'error', category, code, message, location });
    const mounts = entity.equipment();
    const has = (...flags: EquipmentFlag[]) => mounts.some(mount => mount.equipment?.hasAnyFlag(flags));
    const misc = mounts.filter(mount => mount.equipment instanceof MiscEquipment);
    const masc = misc.some(mount => mount.equipment!.hasFlag('F_MASC') && !mount.equipment!.hasFlag('S_SUPERCHARGER'));
    const advancedMyomer = entity.myomerType() !== 'Standard' || has('F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM');
    const targeting = has('F_TARGETING_COMPUTER');
    const aes = misc.filter(mount => mount.equipment!.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM'));
    // TestMek: MASC excludes superchargers; unlike MASC, a supercharger can coexist with AES/TSM.
    if (masc && advancedMyomer) add('MEK_MASC_MYOMER', 'MASC cannot be combined with advanced myomers.');
    if (aes.length) {
        if (masc) add('MEK_AES_MASC', 'Actuator enhancement systems cannot be combined with MASC.');
        if (targeting) add('MEK_AES_TARGETING', 'Actuator enhancement systems cannot be combined with targeting computers.');
        if (advancedMyomer) add('MEK_AES_MYOMER', 'Actuator enhancement systems cannot be combined with advanced myomers.');
        const locations = new Set(aes.map(mount => mount.location));
        for (const location of locations) if (aes.filter(mount => mount.location === location).length > 1) {
            add('MEK_AES_DUPLICATE', 'Only one actuator enhancement system is permitted per location.', location);
        }
        const legs = entity.locationOrder.filter(location => entity.locationIsLeg(location));
        if (legs.some(location => locations.has(location)) && legs.some(location => !locations.has(location))) {
            add('MEK_AES_ALL_LEGS', 'An actuator enhancement system in one leg requires one in every leg.');
        }
    }
    const myomerKinds = new Set(misc.filter(mount => mount.equipment!.hasAnyFlag(['F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM']))
        .map(mount => mount.equipmentId));
    if (myomerKinds.size > 1) add('MEK_MULTIPLE_MYOMERS', 'A Mek cannot combine different advanced myomer types.');

    const stealth = [...entity.armorByLocation().values()].some(material => material.armor.armorType === 'STEALTH') || has('F_STEALTH');
    const c3 = has('F_C3S', 'F_C3SBS', 'F_C3M', 'F_C3MBS', 'F_C3I');
    const anyC3 = c3 || has('F_NOVA', 'F_NAVAL_C3');
    if (stealth && !has('F_ECM')) add('MEK_STEALTH_ECM', 'Stealth armor requires an ECM suite.');
    if (has('F_NULL_SIG')) {
        if (stealth) add('MEK_NULL_STEALTH', 'Null-signature systems cannot be combined with stealth armor.');
        if (targeting) add('MEK_NULL_TARGETING', 'Null-signature systems cannot be combined with targeting computers.');
        if (has('F_VOID_SIG')) add('MEK_NULL_VOID', 'Null-signature and void-signature systems cannot be combined.');
        // Nova CEWS is explicitly exempt from the null-signature restriction.
        if (c3) add('MEK_NULL_C3', 'Null-signature systems cannot be combined with C3 or C3i.');
    }
    if (has('F_VOID_SIG')) {
        if (!has('F_ECM')) add('MEK_VOID_ECM', 'Void-signature systems require an ECM suite.');
        if (stealth) add('MEK_VOID_STEALTH', 'Void-signature systems cannot be combined with stealth armor.');
        if (targeting) add('MEK_VOID_TARGETING', 'Void-signature systems cannot be combined with targeting computers.');
        if (anyC3) add('MEK_VOID_C3', 'Void-signature systems cannot be combined with C3, C3i or Nova CEWS.');
    }
    if (has('F_CHAMELEON_SHIELD') && (stealth || has('F_VOID_SIG'))) add('MEK_CHAMELEON_SIGNATURE', 'Chameleon shields cannot be combined with stealth armor or void-signature systems.');

    const repairs = misc.filter(mount => mount.equipment!.hasAnyFlag(['F_HARJEL_II', 'F_HARJEL_III']));
    if (repairs.length) {
        if (has('F_HARJEL_II') && has('F_HARJEL_III')) add('MEK_HARJEL_GENERATION', 'HarJel II and HarJel III cannot be combined.');
        if (entity.isIndustrial()) add('MEK_HARJEL_INDUSTRIAL', 'IndustrialMeks cannot mount HarJel II or III repair systems.');
        for (const location of new Set(repairs.map(mount => mount.location))) {
            if (repairs.filter(mount => mount.location === location).length > 1) add('MEK_HARJEL_DUPLICATE', 'Only one HarJel repair system is permitted per location.', location);
            const armor = entity.armorByLocation().get(location)?.armor.armorType;
            if (armor && !['STANDARD', 'FERRO_FIBROUS', 'LIGHT_FERRO', 'HEAVY_FERRO', 'HEAVY_INDUSTRIAL'].includes(armor)) {
                add('MEK_HARJEL_ARMOR', 'HarJel repair systems require standard, ferro-fibrous, light/heavy ferro-fibrous or heavy industrial armor.', location, 'armor');
            }
        }
    }

    const cockpit = entity.mountedCockpit();
    if (entity.hasFullHeadEjectionSystem() && ['Torso-Mounted', 'Command Console'].includes(entity.cockpitType())) add('MEK_HEAD_EJECTION_COCKPIT', 'Full-head ejection cannot be combined with a torso cockpit or command console.');
    if (has('F_REMOTE_DRONE_COMMAND_CONSOLE') && entity.cockpitType() === 'Command Console') add('MEK_DRONE_COCKPIT', 'A remote drone command console cannot be combined with a cockpit command console.');
    if (entity.isIndustrial() && cockpit.isIndustrial && anyC3) add('MEK_INDUSTRIAL_C3', 'IndustrialMeks require advanced fire control to mount C3 equipment.');
    if (entity.isIndustrial() && entity.isSuperHeavy() && entity.mountedEngine().type() !== 'Fusion') add('MEK_SUPERHEAVY_INDUSTRIAL_ENGINE', 'Superheavy IndustrialMeks require a standard or large fusion engine.', undefined, 'engine');
    for (const mount of mounts) {
        const equipment = mount.equipment;
        if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_TASER') && !entity.mountedEngine().isFusion) add('MEK_TASER_ENGINE', 'Mek tasers require a fusion engine.', mount.location, 'engine');
        if (equipment instanceof WeaponEquipment && ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType) && mount.turretMounted) add('MEK_HEAVY_GAUSS_TURRET', 'Heavy Gauss rifles cannot be turret mounted.', mount.location);
        if (equipment?.hasFlag('F_TRACKS')) {
            const wheels = equipment.hasFlag('S_QUADVEE_WHEELS');
            if (wheels && entity.chassisConfig !== 'QuadVee') add('MEK_WHEELS_CHASSIS', 'QuadVee wheels require a QuadVee chassis.', mount.location);
            if (entity.chassisConfig === 'QuadVee' && wheels !== (entity.motiveType() === 'Wheel')) add('QUADVEE_MOTIVE_EQUIPMENT', 'Installed motive equipment must match the QuadVee track/wheel setting.', mount.location);
            for (const leg of entity.locationOrder.filter(location => entity.locationIsLeg(location))) {
                if (mount.placements?.filter(placement => placement.location === leg).length !== 1) add('MEK_TRACKS_DISTRIBUTION', 'Tracks or wheels require one critical slot in every leg.', leg);
            }
        }
    }

    if (entity.chassisConfig === 'LAM') {
        if (entity.omni()) add('LAM_OMNI', 'LAMs cannot be OmniMeks.', undefined, 'structure');
        if (entity.tonnage() > 55) add('LAM_TONNAGE', 'LAMs cannot exceed 55 tons.', undefined, 'weight');
        if ([...entity.structureByLocation().values()].some(material => (getNumCriticalSlots(entity, material.structure) ?? 0) > 0)) add('LAM_STRUCTURE', 'LAMs cannot use structure that requires critical slots.', undefined, 'structure');
        if ([...entity.armorByLocation().values()].some(material => material.armor.armorType === 'HARDENED' || (getNumCriticalSlots(entity, material.armor) ?? 0) > 0)) add('LAM_ARMOR', 'LAMs cannot use hardened armor or armor that requires critical slots.', undefined, 'armor');
        if (cockpit.hasTorsoSlots || cockpit.isPrimitive || cockpit.headLayout.filter(slot => slot === 'Cockpit').length > 1) add('LAM_COCKPIT', 'LAMs require a non-primitive head cockpit occupying one cockpit critical slot.', undefined, 'structure');
        if (!['Standard', 'Compact', 'Heavy Duty'].includes(entity.gyroType())) add('LAM_GYRO', 'LAMs require a standard, compact or heavy-duty gyro.', undefined, 'structure');
        if (!['Fusion', 'Compact'].includes(entity.mountedEngine().type())) add('LAM_ENGINE', 'LAMs require a standard or compact fusion engine.', undefined, 'engine');
        if (misc.filter(mount => mount.equipment!.hasFlag('F_BOMB_BAY')).length > 20) add('LAM_BOMB_BAYS', 'LAMs can mount at most twenty bomb bays.');
        if (entity instanceof MekWithArmsEntity && (!entity.hasLowerArmActuator().left || !entity.hasLowerArmActuator().right)) add('LAM_ARM_ACTUATORS', 'LAMs require lower arm actuators in both arms.');
        for (const mount of mounts) {
            const equipment = mount.equipment;
            if (!equipment) continue;
            if (new Set(mount.placements?.map(placement => placement.location) ?? []).size > 1) add('LAM_SPLIT_EQUIPMENT', 'LAM equipment must fit entirely in one location.', mount.location);
            if (equipment.hasAnyFlag(['F_ARTILLERY', 'F_CLUB', 'F_SHIELD', 'F_MODULAR_ARMOR', 'F_JUMP_BOOSTER', 'F_PARTIAL_WING', 'F_DUMPER', 'F_HEAVY_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_LIGHT_BRIDGE_LAYER', 'S_SUPERCHARGER', 'S_COMBINE'])) add('LAM_EQUIPMENT', `${equipment.name} cannot be fitted to a LAM.`, mount.location);
        }
    }

    if (entity.hasHybridStructure()) {
        if (entity.omni()) add('FRANKEN_OMNI', 'FrankenMeks cannot be OmniMeks.', undefined, 'structure');
        const centerMass = entity.structureByLocation().get('CT')?.tonnage ?? entity.tonnage();
        for (const [location, structure] of entity.structureByLocation()) {
            if (!Number.isInteger(structure.tonnage) || structure.tonnage < 10 || structure.tonnage > 200 || structure.tonnage % 5 !== 0) add('FRANKEN_DONOR_TONNAGE', 'Donor structure must be 10–200 tons in five-ton increments.', location, 'structure');
            if (centerMass <= 100 && structure.tonnage > 100) add('FRANKEN_SUPERHEAVY_DONOR', 'A center torso of 100 tons or less cannot use superheavy donor structure.', location, 'structure');
            if (entity.locationIsLeg(location) && structure.tonnage < centerMass) add('FRANKEN_LEG_DONOR', 'Leg donor tonnage cannot be lower than center-torso donor tonnage.', location, 'structure');
        }
    }
    if (cockpit.isPrimitive) {
        if (entity.omni()) add('PRIMITIVE_OMNI', 'Primitive Meks cannot be OmniMeks.', undefined, 'structure');
        if ([...entity.structureByLocation().values()].some(material => ![0, 1].includes(material.structure.structureTypeId))) add('PRIMITIVE_STRUCTURE', 'Primitive Meks require standard or industrial structure.', undefined, 'structure');
        if (['XL', 'XXL', 'Light', 'Compact'].includes(entity.mountedEngine().type()) || entity.mountedEngine().isLarge) add('PRIMITIVE_ENGINE', 'Primitive Meks cannot use XL, XXL, light, compact or large engines.', undefined, 'engine');
        if (advancedMyomer) add('PRIMITIVE_MYOMER', 'Primitive Meks cannot use advanced myomers.');
        const permitted = entity.isIndustrial() ? ['COMMERCIAL'] : ['PRIMITIVE', 'INDUSTRIAL'];
        if ([...entity.armorByLocation().values()].some(material => !permitted.includes(material.armor.armorType))) add('PRIMITIVE_ARMOR', entity.isIndustrial() ? 'Primitive IndustrialMeks require commercial armor.' : 'Primitive BattleMeks require primitive or industrial armor.', undefined, 'armor');
    }

    const technologies: { name: string; tech: TechAdvancement; base?: 'IS' | 'Clan' }[] = [
        { name: 'Cockpit', tech: cockpit.tech }, { name: 'Gyro', tech: entity.mountedGyro().tech },
    ];
    if (entity.mountedEngine().installed) technologies.push({ name: 'Engine', tech: entity.mountedEngine().getTechAdvancement(), base: entity.mountedEngine().techBase });
    const allowed: ComponentTechLevel = (['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'] as const)[entity.rulesLevel() - 1] ?? 'Unofficial';
    for (const { name, tech, base } of technologies) {
        const bases: ('IS' | 'Clan')[] = base ? [base] : entity.mixedTech() ? tech.techBase === 'All' ? ['IS', 'Clan'] : [tech.techBase] : [entity.techBase()];
        if (!entity.mixedTech() && ((base && base !== entity.techBase()) || (tech.techBase !== 'All' && tech.techBase !== entity.techBase()))) add('MEK_SYSTEM_TECH_BASE', `${name} requires mixed technology.`, undefined, 'tech');
        const contexts = bases.map(techBase => ({ year: entity.year(), techBase, faction: entity.faction() === 'None' ? undefined : entity.faction() }));
        if (!contexts.some(context => isTechnologyAvailable(tech, context))) add('MEK_SYSTEM_TECH_DATE', `${name} technology is unavailable in ${entity.year()}.`, undefined, 'tech');
        if (!contexts.some(context => compareTechLevels(calculateTechLevel(tech, context), allowed) <= 0)) add('MEK_SYSTEM_TECH_LEVEL', `${name} exceeds the selected rules level in ${entity.year()}.`, undefined, 'tech');
    }
    return messages;
}
