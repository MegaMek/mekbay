// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity, ProtoMekEntity, VehicleEntity } from '../../models/entity/entities';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import type { EntityValidationMessage } from '../../models/entity/types';
import { isArtemisCompatibleWeapon, isArtemisEquipment } from '../../models/artemis-equipment.model';
import { isWeaponEnhancement } from '../../models/entity/utils/equipment-link-rules';
import { isCaseEquipment } from '../../models/case-equipment.model';

/** Shared construction combinations from TestEntity.hasIllegalEquipmentCombinations. */
export function constructionEquipmentMessages(entity: BaseEntity): EntityValidationMessage[] {
    const messages: EntityValidationMessage[] = [];
    const add = (code: string, message: string, location?: string, category: EntityValidationMessage['category'] = 'equipment') =>
        messages.push({ severity: 'error', category, code, message, location });
    const mounts = entity.equipment();
    const misc = mounts.filter(mount => mount.equipment instanceof MiscEquipment);
    const weapons = mounts.filter(mount => mount.equipment instanceof WeaponEquipment);
    const count = (...flags: EquipmentFlag[]) => misc.filter(mount => mount.equipment!.hasAnyFlag(flags)).length;
    const has = (...flags: EquipmentFlag[]) => count(...flags) > 0;
    const engine = entity.mountedEngine();

    if (entity instanceof MekEntity) {
        const caseLocations = new Set(misc
            .filter(mount => mount.allocation.kind === 'location' && isCaseEquipment(mount.equipment))
            .map(mount => mount.location));
        const explosiveLocations = new Set(mounts
            .filter(mount => !isCaseEquipment(mount.equipment) && entity.isMountedEquipmentExplosive(mount))
            .flatMap(mount => [mount.location, ...mount.getOccupiedLocations()]));
        for (const location of caseLocations) if (entity.validLocations.has(location) && !explosiveLocations.has(location)) {
            messages.push({ severity: 'warning', category: 'equipment', code: 'CASE_WITHOUT_EXPLOSIVES', location,
                message: 'CASE is installed with no explosives in this location. Consider removing it.' });
        }
    }

    if (has('F_NOVA') && (!engine.installed || !engine.isFusion)) add('NOVA_ENGINE', 'Nova CEWS requires a fusion engine.', undefined, 'engine');
    if (entity instanceof ProtoMekEntity && has('F_LIGHT_FLUID_SUCTION_SYSTEM')) add('PROTO_FLUID_SUCTION', 'ProtoMeks cannot mount light fluid suction systems.');
    if (!(entity instanceof MekEntity)) {
        if (has('F_HARJEL_II', 'F_HARJEL_III')) add('HARJEL_PLATFORM', 'HarJel II and III repair systems require a Mek.');
        if (has('F_VOID_SIG') && !has('F_ECM')) add('VOID_ECM', 'Void-signature systems require an ECM suite.');
        if ([...entity.armorByLocation().values()].some(material => ['STEALTH', 'STEALTH_VEHICLE'].includes(material.armor.armorType)) && !has('F_ECM')) add('STEALTH_ECM', 'Stealth armor requires an ECM suite.');
    }
    if (has('F_FUEL') && (!engine.installed || !['ICE', 'Fuel Cell'].includes(engine.type()))) add('FUEL_TANK_ENGINE', 'External fuel tanks require ICE or fuel-cell engines.', undefined, 'engine');
    // Large craft use integral fusion drives rather than a rated mounted engine.
    if (entity.entityType !== 'BuildingEntity' && entity.entityType !== 'MobileStructure' && !entity.isLargeCraft() && (!engine.installed || !(engine.isFusion || engine.isFission))) {
        for (const mount of weapons) {
            const weapon = mount.equipment as WeaponEquipment;
            const standardFlamer = weapon.hasFlag('F_FLAMER') && weapon.ammoType === 'NA' && !weapon.hasFlag('F_BA_WEAPON');
            if (['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(weapon.ammoType) || standardFlamer || weapon.hasFlag('F_HYPER')) add('WEAPON_ENGINE', `${weapon.name} requires a fusion or fission engine.`, mount.location, 'engine');
        }
    }

    const physical = new Map<string, number>();
    const bridges = new Map<string, number>();
    const modularArmor = new Map<string, number>();
    for (const mount of misc) {
        const equipment = mount.equipment!;
        if (equipment.hasFlag('F_COMMUNICATIONS')) {
            const tons = mount.size ?? mount.getTonnage(entity) ?? 0;
            if (!Number.isInteger(tons) || tons < 1 || tons > 15) add('COMMUNICATIONS_SIZE', 'Additional communications must total 1–15 whole tons.', mount.location);
        }
        const allocated = mount.allocation.kind === 'location';
        // Vehicle/ProtoMek Body is native location zero and absent from the armor order.
        const positiveLocation = allocated && (entity instanceof VehicleEntity || entity instanceof ProtoMekEntity
            ? mount.location !== 'Body' : entity.locationOrder.indexOf(mount.location) > 0);
        if (!equipment.hasFlag('F_LIFT_HOIST')) {
            if (positiveLocation && equipment.hasAnyFlag(['F_CLUB', 'F_BULLDOZER', 'F_HAND_WEAPON'])) physical.set(mount.location, (physical.get(mount.location) ?? 0) + 1);
            else if (allocated && equipment.hasAnyFlag(['F_LIGHT_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_HEAVY_BRIDGE_LAYER'])) bridges.set(mount.location, (bridges.get(mount.location) ?? 0) + 1);
        }
        if (allocated && equipment.hasFlag('F_MODULAR_ARMOR')) {
            const key = `${mount.location}|${mount.rearMounted}`;
            modularArmor.set(key, (modularArmor.get(key) ?? 0) + 1);
        }
        if (isWeaponEnhancement(mount) && !isArtemisEquipment(equipment) && !equipment.hasFlag('F_APOLLO')) {
            const target = entity.getLinkedMount(mount);
            if (!target || !entity.canLinkEquipment(mount, target)) add('WEAPON_ENHANCEMENT_LINK', `${equipment.name} requires a compatible weapon in the same location.`, mount.location);
        }
    }
    for (const [location, count] of physical) if (count > 1) add('PHYSICAL_TOOL_LOCATION', 'Physical weapons and tools cannot share this location.', location);
    for (const [location, count] of bridges) if (count > 1) add('BRIDGE_LAYER_LOCATION', 'Only one bridge layer is permitted per location.', location);
    for (const [key, count] of modularArmor) if (count > 1) {
        const [location, rear] = key.split('|');
        add('MODULAR_ARMOR_LOCATION', `Only one modular armor mount is permitted on the ${rear === 'true' ? 'rear' : 'front'} of this location.`, location);
    }
    for (const mount of mounts) if (mount.omniPodMounted) {
        if (!entity.omni()) add('OMNI_POD_CHASSIS', `${mount.equipment?.name ?? mount.equipmentId} is pod mounted on a non-Omni unit.`, mount.location);
        else if (mount.equipment?.omniFixedOnly) add('OMNI_FIXED_EQUIPMENT', `${mount.equipment.name} must be fixed equipment.`, mount.location);
    }
    if (!entity.omni() && entity.transporters().some(transporter => transporter.omni)) add('OMNI_POD_TRANSPORT', 'Pod-mounted transport requires an Omni unit.');

    const artemis = misc.filter(mount => isArtemisEquipment(mount.equipment));
    for (const [name, sources, compatible] of [
        ['Artemis', artemis, weapons.filter(mount => isArtemisCompatibleWeapon(mount.equipment))],
        ['Apollo', misc.filter(mount => mount.equipment!.hasFlag('F_APOLLO')), weapons.filter(mount => (mount.equipment as WeaponEquipment).ammoType === 'MRM')],
    ] as const) {
        if (!sources.length) continue;
        if (sources.length !== compatible.length) add(`${name.toUpperCase()}_COVERAGE`, `There must be one ${name} system for every compatible weapon.`);
        else if (compatible.some(weapon => {
            const source = entity.getLinkingMount(weapon);
            return !source || !sources.includes(source) || !entity.canLinkEquipment(source, weapon);
        })) add(`${name.toUpperCase()}_LINK`, `${name} must be linked to each compatible weapon in the same location.`);
    }
    return messages;
}
