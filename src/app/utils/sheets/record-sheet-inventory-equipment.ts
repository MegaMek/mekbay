// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from '../../models/equipment.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { isCargoEquipment } from '../../models/support-equipment.model';
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

/** Inventory names share construction sizes and MML's mixed-tech disambiguation. */
export function recordSheetInventoryMountName(entity: BaseEntity, mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    let name = mount.displayName();
    if (isCargoEquipment(equipment) && mount.size !== undefined) {
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
