// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity, MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { type EntityValidationMessage, type TechAdvancement } from '../../models/entity/types';
import { isImprovedJumpJetEquipment } from '../../models/jump-equipment.model';
import { constructionEngineTechnology, constructionTechnologyEligibility, constructionTechnologyYearLabel } from './construction-technology-rules';
import { constructionCockpitApplies, constructionEngineApplies, constructionGyroApplies,
    constructionGyroTechnology, constructionFullHeadEjectionApplies, constructionOmniWeaponRemovesArmActuators } from './construction-system-rules';
import { constructionEquipmentChassisMessages } from './construction-family-rules';

/** Construction combinations from TestMek.hasIllegalEquipmentCombinations and TestEntity. */
export function constructionAdvancedMekMessages(entity: BaseEntity): EntityValidationMessage[] {
    if (!(entity instanceof MekEntity)) return [];
    const messages: EntityValidationMessage[] = [];
    const add = (code: string, message: string, location?: string, category: EntityValidationMessage['category'] = 'equipment') =>
        messages.push({ severity: 'error', category, code, message, location });
    const mounts = entity.equipment();
    const selectedSink = entity.heatSinkEquipment();
    if (selectedSink && !mounts.some(mount => mount.equipmentId === selectedSink.id)) {
        messages.push(...constructionEquipmentChassisMessages(entity, selectedSink));
    }
    const has = (...flags: EquipmentFlag[]) => mounts.some(mount => mount.equipment?.hasAnyFlag(flags));
    const misc = mounts.filter(mount => mount.equipment instanceof MiscEquipment);
    const advancedMyomer = entity.myomerType() !== 'Standard' || has('F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM');
    if (entity.isSuperHeavy() && advancedMyomer) add('MEK_SUPERHEAVY_MYOMER', 'Superheavy Meks cannot use advanced myomers.');
    if (entity.isIndustrial() && ['Triple Strength', 'Super-Cooled'].includes(entity.myomerType())) add('MEK_INDUSTRIAL_MYOMER_TYPE', 'IndustrialMeks may use standard or industrial triple-strength myomers.');
    if (!entity.isIndustrial() && entity.myomerType() === 'Industrial Triple Strength') add('MEK_BATTLE_MYOMER_TYPE', 'Industrial triple-strength myomers require an IndustrialMek.');
    const aes = misc.filter(mount => mount.equipment!.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM'));
    if (aes.length) {
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
    if (has('F_VOID_SIG')) {
        if (!has('F_ECM')) add('MEK_VOID_ECM', 'Void-signature systems require an ECM suite.');
    }

    const repairs = misc.filter(mount => mount.equipment!.hasAnyFlag(['F_HARJEL_II', 'F_HARJEL_III']));
    if (repairs.length) {
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
    const quad = entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee';
    for (const location of entity.locationOrder) {
        const local = misc.filter(mount => mount.location === location);
        if (local.filter(mount => mount.equipment!.hasFlag('F_SHIELD')).length > 1) add('MEK_SHIELD_LOCATION', 'Only one shield is permitted per location.', location);
        if (['LT', 'RT'].includes(location) && local.filter(mount => mount.equipment!.hasFlag('F_SHOULDER_TURRET')).length > 1) add('MEK_SHOULDER_TURRET_LOCATION', 'Only one shoulder turret is permitted per side torso.', location);
    }
    if (entity instanceof MekWithArmsEntity) {
        for (const [location, side] of [['LA', 'left'], ['RA', 'right']] as const) {
            if (entity.hasHandActuator()[side] && !entity.hasLowerArmActuator()[side]) add('MEK_HAND_REQUIRES_LOWER_ARM', 'Hand actuators require a lower arm actuator.', location);
            if (entity.omni() && (entity.hasHandActuator()[side] || entity.hasLowerArmActuator()[side])
                && entity.getEquipmentAtLocation(location).some(mount => mount.equipment && constructionOmniWeaponRemovesArmActuators(mount.equipment)))
                add('MEK_OMNI_ARM_ACTUATORS', 'Omni arm-mounted Gauss rifles, autocannons and PPCs require removal of the hand and lower arm actuators.', location);
        }
        const replacementLocations = new Map<string, number>();
        for (const mount of misc) {
            if (mount.allocation.kind !== 'location') continue;
            const equipment = mount.equipment as MiscEquipment;
            const club = equipment.hasFlag('F_CLUB');
            const replacesHand = equipment.hasAnyFlag(['F_SALVAGE_ARM', 'F_HAND_WEAPON']) || club && equipment.hasAnyFlag([
                'S_CHAINSAW', 'S_BACKHOE', 'S_DUAL_SAW', 'S_MINING_DRILL', 'S_ROCK_CUTTER', 'S_SPOT_WELDER', 'S_WRECKING_BALL', 'S_FLAIL']);
            const replacesLowerArm = club && equipment.hasFlag('S_PILE_DRIVER');
            const requiresHand = club && equipment.hasAnyFlag(['S_CHAIN_WHIP', 'S_HATCHET', 'S_MACE', 'S_SWORD', 'S_VIBRO_SMALL', 'S_VIBRO_MEDIUM', 'S_VIBRO_LARGE']);
            const requiresLowerArm = replacesHand || club && equipment.hasAnyFlag(['S_LANCE', 'S_RETRACTABLE_BLADE']);
            const side = mount.location === 'LA' ? 'left' : mount.location === 'RA' ? 'right' : null;
            const hand = side !== null && entity.hasHandActuator()[side];
            const lowerArm = side !== null && entity.hasLowerArmActuator()[side];
            // Match TestMek's ordered checks: replacement first, then prerequisites.
            if (replacesHand && hand) add('MEK_TOOL_REPLACES_HAND', `${equipment.name} requires removal of the hand actuator.`, mount.location);
            else if (replacesLowerArm && lowerArm) add('MEK_TOOL_REPLACES_LOWER_ARM', `${equipment.name} requires removal of the lower arm actuator.`, mount.location);
            else if (requiresHand && !hand) add('MEK_TOOL_REQUIRES_HAND', `${equipment.name} requires a hand actuator.`, mount.location);
            else if (requiresLowerArm && !lowerArm) add('MEK_TOOL_REQUIRES_LOWER_ARM', `${equipment.name} requires a lower arm actuator.`, mount.location);
            if (replacesHand) replacementLocations.set(mount.location, (replacementLocations.get(mount.location) ?? 0) + 1);
        }
        for (const [location, count] of replacementLocations) if (count > 1) add('MEK_HAND_REPLACEMENT_LIMIT', 'Only one item replacing the hand actuator is permitted per arm.', location);
    }
    if (entity.hasFullHeadEjectionSystem() && !constructionFullHeadEjectionApplies(entity)) add('MEK_HEAD_EJECTION_COCKPIT', 'Full-head ejection cannot be combined with a torso cockpit or command console.');
    if (has('F_REMOTE_DRONE_COMMAND_CONSOLE') && entity.cockpitType() === 'Command Console') add('MEK_DRONE_COCKPIT', 'A remote drone command console cannot be combined with a cockpit command console.');
    if (entity.isIndustrial() && cockpit.isIndustrial && anyC3) add('MEK_INDUSTRIAL_C3', 'IndustrialMeks require advanced fire control to mount C3 equipment.');
    for (const mount of mounts) {
        const equipment = mount.equipment;
        if (equipment) messages.push(...constructionEquipmentChassisMessages(entity, equipment, mount));
        if (equipment instanceof MiscEquipment) {
            if (equipment.hasFlag('F_LIGHT_FLUID_SUCTION_SYSTEM') && !entity.isIndustrial()) add('MEK_FLUID_SUCTION', 'Light fluid suction systems require an IndustrialMek.', mount.location);
            if (equipment.hasFlag('F_HEAD_TURRET') && !cockpit.hasTorsoSlots) add('MEK_HEAD_TURRET_COCKPIT', 'Head turrets require a torso-mounted cockpit.', mount.location);
            if (!quad && equipment.hasAnyFlag(['F_CHAIN_DRAPE_APRON', 'F_CHAIN_DRAPE_PONCHO']) && entity.cockpitType() === 'Torso-Mounted') add('MEK_CHAIN_DRAPE_CONFIGURATION', 'Meks with torso-mounted cockpits can use only cape chain drapes.', mount.location);
            if (equipment.hasFlag('F_RAM_PLATE')) {
                for (const torso of ['CT', 'LT', 'RT']) {
                    if (!entity.structureByLocation().get(torso)?.structure.hasFlag('F_REINFORCED')) add('MEK_RAM_PLATE_STRUCTURE', 'Ram plates require reinforced structure in every torso location.', torso, 'structure');
                    if (mount.placements?.filter(placement => placement.location === torso).length !== 1) add('MEK_RAM_PLATE_DISTRIBUTION', 'Ram plates require one critical slot in every torso location.', torso);
                }
            }
            if (entity.isIndustrial()) {
                if (cockpit.isIndustrial && equipment.hasAnyFlag(['F_TARGETING_COMPUTER', 'F_ARTEMIS', 'F_ARTEMIS_PROTO', 'F_ARTEMIS_V', 'F_BAP'])) add('MEK_INDUSTRIAL_FIRE_CONTROL', `${equipment.name} requires advanced fire control on an IndustrialMek.`, mount.location);
            }
        }
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
        if (!constructionCockpitApplies(entity, entity.cockpitType())) add('LAM_COCKPIT', 'LAMs require a standard or small cockpit.', undefined, 'structure');
        if (!constructionGyroApplies(entity, entity.gyroType())) add('LAM_GYRO', 'LAMs require a standard, compact or heavy-duty gyro.', undefined, 'structure');
        if (!constructionEngineApplies(entity, entity.mountedEngine().type(), entity.mountedEngine().techBase)) add('LAM_ENGINE', 'LAMs require a standard or compact fusion engine.', undefined, 'engine');
        if (misc.filter(mount => mount.equipment!.hasFlag('F_BOMB_BAY')).length > 20) add('LAM_BOMB_BAYS', 'LAMs can mount at most twenty bomb bays.');
        if (entity instanceof MekWithArmsEntity && (!entity.hasLowerArmActuator().left || !entity.hasLowerArmActuator().right)) add('LAM_ARM_ACTUATORS', 'LAMs require lower arm actuators in both arms.');
        for (const mount of mounts) {
            const equipment = mount.equipment;
            if (!equipment) continue;
            if (new Set(mount.placements?.map(placement => placement.location) ?? []).size > 1) add('LAM_SPLIT_EQUIPMENT', 'LAM equipment must fit entirely in one location.', mount.location);
            if (equipment.hasAnyFlag(['F_ARTILLERY', 'F_CLUB', 'F_SHIELD'])) add('LAM_EQUIPMENT', `${equipment.name} cannot be fitted to a LAM.`, mount.location);
        }
    }

    if (entity.hasHybridStructure()) {
        if (entity.frankenMekPilotingModifier() > 0) messages.push({
            severity: 'warning', category: 'structure', code: 'FRANKEN_MISMATCHED_LEGS',
            message: `Mismatched donor legs apply +${entity.frankenMekPilotingModifier()} to Piloting Skill Rolls.`,
        });
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
        if (!constructionEngineApplies(entity, entity.mountedEngine().type(), entity.mountedEngine().techBase)) add('PRIMITIVE_ENGINE', 'Primitive Meks cannot use XL, XXL, light, compact or large engines.', undefined, 'engine');
        if (advancedMyomer) add('PRIMITIVE_MYOMER', 'Primitive Meks cannot use advanced myomers.');
    }

    if (entity.chassisConfig !== 'LAM' && !constructionCockpitApplies(entity, entity.cockpitType())) add('MEK_COCKPIT_CONFIGURATION', 'This cockpit is incompatible with the Mek chassis.', undefined, 'structure');
    if (entity.chassisConfig !== 'LAM' && !entity.isIndustrial() && !cockpit.isPrimitive
        && !constructionEngineApplies(entity, entity.mountedEngine().type(), entity.mountedEngine().techBase)) add('MEK_ENGINE_CONFIGURATION', 'This engine is incompatible with the Mek chassis or construction rules.', undefined, 'engine');
    const technologies: { name: string; tech: TechAdvancement; base?: 'IS' | 'Clan' }[] = [
        { name: 'Cockpit', tech: cockpit.tech }, { name: 'Gyro', tech: constructionGyroTechnology(entity, entity.gyroType()) },
    ];
    if (entity.mountedEngine().installed) technologies.push({ name: 'Engine', tech: constructionEngineTechnology(entity, entity.mountedEngine().type(), entity.mountedEngine().techBase), base: entity.mountedEngine().techBase });
    for (const { name, tech, base } of technologies) {
        const technology = constructionTechnologyEligibility(entity, tech, base);
        if (!technology.techBase) add('MEK_SYSTEM_TECH_BASE', `${name} requires mixed technology.`, undefined, 'tech');
        if (!technology.available) add('MEK_SYSTEM_TECH_DATE', `${name} technology is unavailable in ${constructionTechnologyYearLabel(entity)}.`, undefined, 'tech');
        if (!technology.rulesLevel) add('MEK_SYSTEM_TECH_LEVEL', `${name} exceeds the selected rules level in ${constructionTechnologyYearLabel(entity)}.`, undefined, 'tech');
    }
    return messages;
}
