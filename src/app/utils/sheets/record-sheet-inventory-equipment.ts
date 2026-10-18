// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from '../../models/equipment.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { isCargoEquipment, supportEquipmentKind } from '../../models/support-equipment.model';
import { isApolloEquipment } from '../../models/apollo-mode.model';
import { isArtemisEquipment } from '../../models/artemis-equipment.model';
import { isExternalStoresHardpointEquipment } from '../../models/aerospace-support-equipment.model';
import { isCaseEquipment } from '../../models/case-equipment.model';
import { isChassisSystemEquipment } from '../../models/chassis-equipment.model';
import { isMascEquipment } from '../../models/escalating-equipment.model';
import { isLaserInsulatorEquipment } from '../../models/laser-insulator.model';
import { isPpcCapacitorEquipment } from '../../models/ppc-capacitor.model';
import { isRiscLaserPulseModule } from '../../models/risc-laser-mode.model';
import { isSponsonTurretEquipment } from '../../models/turret-equipment.model';
import { isHarJelEquipment, isMassEquipment } from '../../models/utility-equipment.model';
import { isFireControlEquipment } from '../../models/entity/utils/fire-control';
import { isTalonEquipment } from '../../models/entity/utils/physical-weapon';
import { isBapEquipment } from '../../models/bap-equipment.model';
import { isNovaC3Equipment } from '../../models/c3-network.model';
import { isAngelEcmEquipment, isEcmEquipment, isSingleHexEcmEquipment } from '../../models/ecm-mode.model';
import { isEquipmentForPlatform } from '../../models/equipment-platform.model';
import { isHeatSinkEquipment } from '../../models/heat-equipment.model';
import { isJumpJetEquipment } from '../../models/jump-equipment.model';
import { isCoolantPodEquipment } from '../../models/runtime/component-coolant-pod';
import { sensorEquipmentKind } from '../../models/sensor-equipment.model';

/** Equipment represented elsewhere on a record sheet rather than as an inventory row. */
export function isRecordSheetInventorySupport(
    equipment: Equipment | null | undefined,
): boolean {
    return isCaseEquipment(equipment)
        || isArtemisEquipment(equipment)
        || isApolloEquipment(equipment)
        || isPpcCapacitorEquipment(equipment)
        || isHarJelEquipment(equipment)
        || isMassEquipment(equipment)
        || isChassisSystemEquipment(equipment)
        || isSponsonTurretEquipment(equipment)
        || isExternalStoresHardpointEquipment(equipment)
        || isFireControlEquipment(equipment)
        || isRiscLaserPulseModule(equipment)
        || isLaserInsulatorEquipment(equipment)
        || isTalonEquipment(equipment ?? undefined);
}

export function isMekRecordSheetInventorySupport(
    equipment: Equipment | null | undefined,
): boolean {
    return isRecordSheetInventorySupport(equipment) || isMascEquipment(equipment);
}

/**
 * The non-weapon equipment a Mek inventory lists, for the generated sheet and its binding alike. Coolant pods are
 * catalogued as ammunition but print as equipment, as MegaMekLab does.
 */
export function isPrintableMekInventoryEquipment(
    equipment: Equipment | null | undefined,
    locationCodes: readonly string[],
    quadVee: boolean,
): boolean {
    if (!equipment || !equipment.hittable) return false;
    if (locationCodes.length === 0 || locationCodes.some(code => code === 'Engine' || code === 'Unallocated')) return false;
    if (isCoolantPodEquipment(equipment)) return true;
    if (equipment.type !== 'misc' || isHeatSinkEquipment(equipment) || isJumpJetEquipment(equipment)) return false;
    if (quadVee && equipment.hasFlag('F_TRACKS')) return false;
    return !isMekRecordSheetInventorySupport(equipment);
}

/** The damage column of a non-weapon inventory row: its special codes, physical damage, or [E] for equipment. */
export function recordSheetEquipmentDamage(mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    if (!equipment) return '—';
    if (equipment.hasFlag('F_AP_POD')) return '[PB,OS,AI]';
    if (isCoolantPodEquipment(equipment)) return '[PE,OS,X]';
    const physicalDamage = mount.getPhysicalWeaponDamage();
    return physicalDamage === undefined ? '[E]' : String(physicalDamage.value);
}

/** The long-range column MegaMekLab prints for electronic warfare equipment: its effect radius in hexes. */
export function recordSheetElectronicWarfareRange(equipment: Equipment): number | undefined {
    const sensorKind = sensorEquipmentKind(equipment);
    if (!isEcmEquipment(equipment) && !isBapEquipment(equipment)) return undefined;
    if (isAngelEcmEquipment(equipment) && isEquipmentForPlatform(equipment, 'battle-armor')) return 2;
    if (sensorKind === 'electronic-warfare'
        || sensorKind === 'watchdog'
        || isNovaC3Equipment(equipment)) return 3;
    if (isSingleHexEcmEquipment(equipment)) return 0;
    if (isEcmEquipment(equipment)) return 6;
    if (sensorKind === 'bloodhound') return 8;
    if (/light active probe/iu.test(equipment.id)) return 3;
    if (/improved active probe/iu.test(equipment.id)) return 2;
    return equipment.techBase === 'Clan' ? 5 : 4;
}

/** Inventory names share construction sizes and MML's mixed-tech disambiguation. */
export function recordSheetInventoryMountName(entity: BaseEntity, mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    let name = mount.displayName();
    const supportKind = supportEquipmentKind(equipment);
    if ((isCargoEquipment(equipment) || supportKind === 'communications' || supportKind === 'power-generator')
        && mount.size !== undefined) {
        const size = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(mount.size);
        name = insertInventoryNameSuffix(name, `(${size} ${mount.size === 1 ? 'ton' : 'tons'})`);
    }
    if (!equipment || !entity.mixedTech() || equipment.techBase === 'All') return name;
    const ambiguous = Object.values(entity.getEquipmentRegistry().equipment).some(candidate =>
        candidate !== equipment && candidate.name === equipment.name && candidate.techBase !== equipment.techBase);
    if (!ambiguous) return name;
    return insertInventoryNameSuffix(name, equipment.techBase === 'Clan' ? '(C)' : '(IS)');
}

function insertInventoryNameSuffix(name: string, suffix: string): string {
    const modifierIndex = name.indexOf(' (');
    return modifierIndex < 0 ? `${name} ${suffix}`
        : `${name.slice(0, modifierIndex)} ${suffix}${name.slice(modifierIndex)}`;
}
