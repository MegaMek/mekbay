// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import { alphaStrikeHeatCapacity } from './heat-adjustment';
import {
  isEmergencyCoolantSystemEquipment,
  isRadicalHeatSinkEquipment,
} from '../../../../escalating-equipment.model';
import { isPartialWingEquipment } from '../../../../jump-equipment.model';

/** Adds Alpha Strike conversion-only capacity bonuses to a family-provided base capacity. */
export function alphaStrikeHeatCapacityForEntity(entity: BaseEntity, baseCapacity: number): number {
  const equipment = entity.equipment();
  return alphaStrikeHeatCapacity({
    baseCapacity: Math.max(0, baseCapacity),
    coolantPodCount: equipment.filter(mount => mount.equipment instanceof AmmoEquipment
      && mount.equipment.ammoType === 'COOLANT_POD').length,
    partialWing: equipment.some(mount => isPartialWingEquipment(mount.equipment)),
    radicalHeatSink: equipment.some(mount => isRadicalHeatSinkEquipment(mount.equipment)),
    emergencyCoolantSystem: equipment.some(mount =>
      isEmergencyCoolantSystemEquipment(mount.equipment)),
  });
}
