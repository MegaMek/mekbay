// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from '../../models/equipment.model';
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
