// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../base-entity';
import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { INFANTRY_TRANSPORT_WEIGHTS, type InfantryTransportType, type StandardTransportBayType } from '../types';
import { isDroneOperatingSystemEquipment } from '../../drone-operating-system.model';
import { supportEquipmentCrewContribution } from '../../support-equipment.model';
import { sensorEquipmentCrewContribution } from '../../sensor-equipment.model';
import { aerospaceSupportCrewContribution } from '../../aerospace-support-equipment.model';

// TM errata v8, p. 239: bay capacity is independent of a formation's faction and squad size.
const INFANTRY_PERSONNEL: Readonly<Record<InfantryTransportType, number>> = {
  Foot: 30, Jump: 30, Motorized: 30, Mechanized: 7,
};
const BAY_PERSONNEL_PER_CAPACITY: Partial<Record<StandardTransportBayType, number>> = {
  mek: 2, protomek: 6, 'light-vehicle': 5, 'heavy-vehicle': 8, 'super-heavy-vehicle': 15,
};

/** Compute.getSmallCraftJumpshipGunnerNeeds: each mass driver needs ten gunners. */
export function calculateSpacecraftRequiredGunners(entity: BaseEntity): number {
  if (entity.equipment().some(mount => isDroneOperatingSystemEquipment(mount.equipment))) return 0;
  let capital = 0, standard = 0;
  for (const mount of entity.equipment()) {
    const eq = mount.equipment;
    if (!(eq instanceof WeaponEquipment) || eq.isInternalRepresentation) continue;
    if (eq.ranges[2] <= 1 && eq.ammoType !== 'MML') continue;
    if (eq.hasFlag('F_MASS_DRIVER')) capital += 10;
    else if (eq.capital || eq.ammoType === 'SCREEN_LAUNCHER') capital++;
    else standard++;
  }
  return capital + Math.ceil(standard / 6);
}

/** Bay personnel travel in the bay and are excluded from vessel quarters demand. */
export function calculateTransportBayPersonnel(entity: BaseEntity): number {
  return entity.transporters().reduce((total, transporter) => {
    if (transporter.kind !== 'bay') return total;
    const config = transporter.configuration;
    switch (config.type) {
      case 'fighter': return total + (config.arts ? 0 : Math.trunc(transporter.capacity) * 2);
      case 'small-craft': return total + (config.arts ? 0 : Math.trunc(transporter.capacity) * 5);
      case 'battle-armor': return total + Math.trunc(transporter.capacity) * 6;
      case 'infantry': return total + Math.trunc(transporter.capacity / INFANTRY_TRANSPORT_WEIGHTS[config.infantryType]) * INFANTRY_PERSONNEL[config.infantryType];
      case 'protomek': return total + Math.ceil(transporter.capacity) * 6;
      default: return total + Math.trunc(transporter.capacity) * (BAY_PERSONNEL_PER_CAPACITY[config.type as StandardTransportBayType] ?? 0);
    }
  }, 0);
}

export function calculateSpacecraftEquipmentCrew(entity: BaseEntity): number {
  return entity.equipment().reduce((total, mount) => mount.equipment instanceof MiscEquipment
    ? total + supportEquipmentCrewContribution(entity, mount) + aerospaceSupportCrewContribution(mount.equipment) + sensorEquipmentCrewContribution(mount.equipment) : total, 0);
}
