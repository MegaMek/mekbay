// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { BattleArmorEntity, InfantryEntity } from '../../models/entity/entities';
import type { EntityMountedEquipment, EntityValidationMessage } from '../../models/entity/types';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { AmmoEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../models/equipment.model';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';

const PAIRED_MANIPULATORS = new Set(['BABasicManipulatorMineClearance', 'BABattleClawMagnets', 'BAHeavyBattleClawMagnets', 'BACargoLifter']);
const BEAST_LIMITS = {
    Large: { squad: 10, squads: 5, troops: 21, secondary: 0 },
    'Very Large': { squad: 2, squads: 7, troops: 14, secondary: 2 },
    Monstrous: { squad: 4, squads: 2, troops: 8, secondary: 3 },
} as const;

/** Construction predicates from TestBattleArmor and TestInfantry; runtime damage is irrelevant. */
export function constructionInfantryBaMessages(entity: BaseEntity): EntityValidationMessage[] {
    if (entity instanceof BattleArmorEntity) return battleArmorMessages(entity);
    if (entity instanceof InfantryEntity) return infantryMessages(entity);
    return [];
}

function infantryMessages(entity: InfantryEntity): EntityValidationMessage[] {
    const messages: EntityValidationMessage[] = [];
    const add = (code: string, message: string) => messages.push({ code, message, category: 'general', severity: 'error' });
    const mode = entity.motiveType();
    const specs = entity.specializations();
    const augments = new Set(entity.augmentations());
    const engineer = [...specs].some(spec => spec.endsWith('-engineers'));
    const mountain = specs.has('mountain-troops');
    const mount = entity.mount();
    const beast = mount ? BEAST_LIMITS[mount.size] : undefined;
    const motorScuba = mode === 'UMU' && entity.isMotorizedScuba();
    const microlite = mode === 'VTOL' && entity.isMicrolite();
    const mechanized = ['Tracked', 'Wheeled', 'Hover', 'VTOL', 'Submarine'].includes(mode);
    const squadLimits: Partial<Record<typeof mode, number>> = { Hover: 5, Submarine: 5, Wheeled: 6, Tracked: 7, UMU: motorScuba ? 6 : 10, VTOL: microlite ? 2 : 4 };
    const squad = beast?.squad ?? squadLimits[mode] ?? 10;
    let squads = beast?.squads ?? (mechanized ? 4 : mode === 'UMU' ? motorScuba ? 2 : 4 : 5);
    if (!beast) {
        if (engineer || mountain) squads = Math.min(squads, 2);
        if (specs.has('paratroops')) squads = Math.min(squads, 3);
        if (specs.has('marines')) squads = Math.min(squads, 4);
    }
    const troopLimits: Partial<Record<typeof mode, number>> = { Hover: 20, Submarine: 20, Wheeled: 24, Tracked: 28, UMU: motorScuba ? 12 : 30, VTOL: squad * 4 };
    let troops = beast?.troops ?? troopLimits[mode] ?? 30;
    if (engineer || mountain) troops = Math.min(troops, 20);
    let secondary = beast?.secondary ?? (mode === 'VTOL' ? microlite ? 0 : 1 : mode === 'UMU' ? motorScuba ? 2 : 1 : 2);
    if (engineer) secondary = 0;
    if (mountain || specs.has('paramedics')) secondary = 1;
    const crewReduction = Number(augments.has('dermal_armor')) + Number(augments.has('tsm_implant'));
    secondary += crewReduction;
    if (entity.squadSize() > squad) add('INFANTRY_MOTIVE_SQUAD_SIZE', `This infantry configuration permits at most ${squad} troopers per squad.`);
    if (entity.squadCount() > squads) add('INFANTRY_MOTIVE_SQUAD_COUNT', `This infantry configuration permits at most ${squads} squads.`);
    // The native entity already reports the universal thirty-trooper ceiling.
    if (troops < 30 && entity.squadSize() * entity.squadCount() > troops) add('INFANTRY_MOTIVE_STRENGTH', `This infantry configuration permits at most ${troops} troopers.`);
    if (entity.secondaryCount() > secondary) add('INFANTRY_SECONDARY_LIMIT', `This infantry configuration permits at most ${secondary} secondary weapons per squad.`);
    const weapon = entity.secondaryWeapon();
    if (weapon) {
        const crew = Math.max(1, (beast ? Math.ceil(weapon.infantry.crew / 2) : weapon.infantry.crew) - crewReduction);
        if (crew * entity.secondaryCount() > entity.squadSize()) add('INFANTRY_SECONDARY_CREW', `Secondary weapons require ${crew * entity.secondaryCount()} crew per squad.`);
    }
    if (mechanized && entity.equipment().some(m => m.equipment?.hasFlag('F_ANTI_MEK_GEAR'))) add('INFANTRY_MECHANIZED_ANTI_MEK', 'Mechanized infantry cannot carry anti-Mek gear.');
    if (entity.equipment().filter(m => m.equipment?.hasFlag('F_ARMOR_KIT')).length > 1) add('INFANTRY_ARMOR_KIT_LIMIT', 'Infantry can carry only one armor kit.');
    if (augments.has('dermal_armor') && augments.has('dermal_camo_armor')) add('INFANTRY_DERMAL_CONFLICT', 'Dermal armor and dermal camouflage armor cannot be combined.');
    const glider = augments.has('pl_glider'), flight = augments.has('pl_flight');
    if (glider && flight) add('INFANTRY_WING_CONFLICT', 'Glider wings and powered-flight wings cannot be combined.');
    if ((glider || flight) && (mechanized || mode === 'Motorized' || mount)) add('INFANTRY_WING_MOTIVE', 'Prosthetic wings cannot be used by motorized, mechanized or beast-mounted infantry.');
    if ((glider || flight) && entity.extraneousPair2()) add('INFANTRY_WING_LIMBS', 'Infantry with prosthetic wings may have only one pair of extraneous limbs.');
    return messages;
}

function battleArmorMessages(entity: BattleArmorEntity): EntityValidationMessage[] {
    const messages: EntityValidationMessage[] = [];
    const add = (code: string, message: string, location?: string, category: EntityValidationMessage['category'] = 'equipment') =>
        messages.push({ code, message, location, category, severity: 'error' });
    const all = entity.equipment();
    const has = (flag: EquipmentFlag) => all.some(m => m.equipment?.hasFlag(flag));
    const quad = entity.chassisType().toLowerCase() === 'quad';
    const jump = entity.motiveType() === 'Jump' && entity.propulsionMP() > 0;
    const myomer = has('F_MASC');
    const armor = entity.uniformArmor()?.armor.armorType;
    if (has('F_DETACHABLE_WEAPON_PACK') && entity.originalWalkMP() < 2) add('BA_DWP_MOVEMENT', 'Detachable weapon packs require at least two base walk MP.', undefined, 'movement');
    if (has('F_JUMP_BOOSTER') && !jump) add('BA_BOOSTER_PROPULSION', 'Jump boosters require jump propulsion with at least one MP.', undefined, 'movement');
    if (has('F_PARTIAL_WING') && !has('F_MECHANICAL_JUMP_BOOSTER') && !jump) add('BA_WING_PROPULSION', 'Partial wings require jump propulsion or mechanical jump boosters.', undefined, 'movement');
    if (has('F_PARTIAL_WING') && has('F_JUMP_BOOSTER')) add('BA_WING_BOOSTER_CONFLICT', 'Partial wings and jump boosters cannot be combined.');
    if (myomer && has('F_MECHANICAL_JUMP_BOOSTER')) add('BA_MYOMER_MECHANICAL_CONFLICT', 'Myomer boosters and mechanical jump boosters cannot be combined.');
    if (myomer && armor && (armor === 'BA_MIMETIC' || armor.startsWith('BA_STEALTH'))) add('BA_MYOMER_ARMOR_CONFLICT', 'Myomer boosters cannot be combined with mimetic or stealth armor.');
    if (has('F_MAGNETIC_CLAMP') && (quad || entity.weightClass() === 'Assault' || entity.motiveType() === 'UMU')) add('BA_MAGNETIC_CLAMP_CHASSIS', 'Magnetic clamps cannot be used by quad, assault or underwater-propelled battle armor.');
    if (has('F_DETACHABLE_WEAPON_PACK') && ['Ultra Light', 'Light'].includes(entity.weightClass())) add('BA_DWP_WEIGHT_CLASS', 'Detachable weapon packs require medium or heavier battle armor.');
    if (has('F_MODULAR_WEAPON_MOUNT') && quad) add('BA_QUAD_MODULAR_MOUNT', 'Quad battle armor cannot use standard modular weapon mounts.');
    if (has('F_BATTLEMEK_NIU') && entity.weightClass() !== 'Ultra Light') add('BA_NIU_WEIGHT_CLASS', 'BattleMek neural interfaces require ultra-light powered armor.');
    const supportWeapons = all.filter(m => m.isSSWM && m.equipment instanceof WeaponEquipment);
    if (supportWeapons.length > 1) add('BA_SQUAD_SUPPORT_LIMIT', 'Only one squad support weapon is permitted.');
    if (supportWeapons.length && quad) add('BA_QUAD_SQUAD_SUPPORT', 'Quad battle armor cannot use squad support weapons.');
    for (const m of all) {
        const eq = m.equipment;
        if (!eq) continue;
        const parent = entity.getLinkingMount(m);
        if (eq instanceof AmmoEquipment) {
            const limit = eq.ammoType === 'BA_TUBE' ? 8 : 4;
            if ((m.getAmmoShots() ?? 0) > limit) add('BA_AMMO_SHOTS_LIMIT', `Battle armor permits at most ${limit} shots per ammunition slot.`, m.location);
            if (m.isSSWM && (!supportWeapons.length || !supportWeapons.some(w => ammoMatchesWeapon(w.equipment as WeaponEquipment, eq)))) add('BA_SQUAD_SUPPORT_AMMO', 'Squad support ammunition must match the squad support weapon.', m.location);
        }
        if (m.isDWP && !(eq instanceof AmmoEquipment) && !parent?.equipment?.hasFlag('F_DETACHABLE_WEAPON_PACK')) add('BA_DWP_ATTACHMENT', 'Detachable-pack equipment must be linked from its weapon pack.', m.location);
        if (m.isDWP && eq instanceof AmmoEquipment && !all.some(w => w.isDWP && w.location === m.location && w.equipment instanceof WeaponEquipment && ammoMatchesWeapon(w.equipment, eq))) add('BA_DWP_AMMO_ATTACHMENT', 'Detachable-pack ammunition requires a matching weapon in a detachable pack.', m.location);
        if (eq.hasFlag('F_DETACHABLE_WEAPON_PACK')) {
            if (!(entity.getLinkedMount(m)?.equipment instanceof WeaponEquipment)) add('BA_DWP_WEAPON_REQUIRED', 'A detachable weapon pack must carry a weapon.', m.location);
            if (parent) add('BA_DWP_NESTED', 'A detachable weapon pack cannot be mounted on other equipment.', m.location);
        }
        if (['F_JUMP_BOOSTER', 'F_PARTIAL_WING', 'F_PARAFOIL'].some(flag => eq.hasFlag(flag as EquipmentFlag)) && (m.baMountLocation ?? 'Body') !== 'Body') add('BA_BODY_ENHANCEMENT', `${eq.name} must be mounted on the suit body.`, m.location);
        if (eq instanceof WeaponEquipment && eq.isInfantryWeapon()) {
            const glove = parent?.equipment?.hasFlag('F_ARMORED_GLOVE');
            const ap = parent?.equipment?.hasFlag('F_AP_MOUNT');
            if (!glove && !ap) add('BA_AP_ATTACHMENT', 'An infantry weapon must be linked from an anti-personnel mount or armored glove.', m.location);
            if (eq.hasFlag('F_INF_POINT_BLANK')) add('BA_AP_MELEE', 'Battle armor cannot mount infantry melee weapons.', m.location);
            if (eq.hasFlag('F_INF_SUPPORT') && ((!glove && ap) || (glove && eq.infantry.crew > 1))) add('BA_AP_SUPPORT_WEAPON', 'Support weapons require an armored glove and a crew requirement of one.', m.location);
            if (eq.hasFlag('F_INF_DISPOSABLE') && !(ap && !glove)) {
                const relevant = suitMounts(entity, m.location === 'Squad' ? 1 : Number(m.location.replace('Trooper ', '')));
                if (!glove || relevant.filter(item => item.equipment?.hasFlag('F_ARMORED_GLOVE')).length < 2) add('BA_DISPOSABLE_ATTACHMENT', 'Disposable weapons require a dedicated anti-personnel mount or two armored gloves.', m.location);
            }
        }
    }
    for (let trooper = 1; trooper <= entity.trooperCount(); trooper++) {
        const mounts = suitMounts(entity, trooper);
        const location = `Trooper ${trooper}`;
        for (const flag of ['F_PARTIAL_WING', 'F_MAGNETIC_CLAMP', 'F_PARAFOIL', 'F_MECHANICAL_JUMP_BOOSTER', 'F_MASC'] as const) {
            const installed = mounts.filter(m => m.equipment?.hasFlag(flag));
            // Native BA myomer boosters can be represented once per spreadable critical slot.
            const maximum = flag === 'F_MASC' && installed[0]?.equipment ? Math.max(1, getNumCriticalSlots(entity, installed[0].equipment) ?? 1) : 1;
            if (installed.length > maximum) add('BA_DUPLICATE_ENHANCEMENT', `Only one ${flag.slice(2).toLowerCase().replaceAll('_', ' ')} is permitted on a suit.`, location);
        }
        const manipulators = mounts.filter(m => m.equipment?.hasFlag('F_BA_MANIPULATOR'));
        const arms = ['LA', 'RA'].map(arm => manipulators.filter(m => m.baMountLocation === arm));
        if (arms.some(arm => arm.length > 1)) add('BA_MANIPULATOR_COUNT', 'Each arm can have only one manipulator.', location);
        if (manipulators.some(m => PAIRED_MANIPULATORS.has(m.equipmentId))) {
            if (!arms[0][0] || !arms[1][0] || arms[0][0].equipmentId !== arms[1][0].equipmentId) add('BA_MANIPULATOR_PAIR', 'Paired manipulators require matching equipment on both arms.', location);
            const adapters = ['LA', 'RA'].map(arm => mounts.some(m => m.baMountLocation === arm && m.equipment?.hasFlag('F_BA_MEA')));
            if (adapters[0] !== adapters[1]) add('BA_MANIPULATOR_ADAPTER_PAIR', 'Paired manipulators require modular equipment adapters on both arms or neither arm.', location);
        }
        if (mounts.filter(m => m.equipment?.hasFlag('F_ARMORED_GLOVE') && entity.getLinkedMount(m)?.equipment instanceof WeaponEquipment).length > 1) add('BA_GLOVE_WEAPON_LIMIT', 'Armored gloves may carry only one additional infantry weapon per suit.', location);
        for (const part of ['LA', 'RA', 'Body']) {
            const group = mounts.filter(m => (m.baMountLocation ?? 'Body') === part || (quad && part === 'Body' && m.baMountLocation === 'Turret'));
            const antiMek = group.some(m => m.equipment instanceof WeaponEquipment && !m.equipment.isInfantryWeapon());
            const limit = part === 'Body' ? quad ? 4 : 2 : antiMek ? 1 : 2;
            if (group.filter(m => m.equipment?.hasFlag('F_AP_MOUNT')).length > limit) add('BA_AP_MOUNT_LIMIT', `${part} permits at most ${limit} anti-personnel mounts.`, location);
        }
    }
    return messages;
}

function suitMounts(entity: BattleArmorEntity, trooper: number): EntityMountedEquipment[] {
    return entity.equipment().filter(m => m.location === 'Squad' || m.location === `Trooper ${trooper}`);
}
