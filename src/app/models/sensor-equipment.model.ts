// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';
import { isBapEquipment } from './bap-equipment.model';
import { isEcmEquipment } from './ecm-mode.model';

export type SensorEquipmentKind =
  | 'bloodhound'
  | 'electronic-warfare'
  | 'hires-imager'
  | 'hyperspectral-imager'
  | 'infrared-imager'
  | 'large-communications-scanner'
  | 'lookdown-radar'
  | 'recon-camera'
  | 'sensor-dispenser'
  | 'small-communications-scanner'
  | 'watchdog';

export function sensorEquipmentKind(
  equipment: Equipment | null | undefined,
): SensorEquipmentKind | null {
  if (equipment?.hasFlag('F_BLOODHOUND') === true) return 'bloodhound';
  if (equipment?.hasFlag('F_EW_EQUIPMENT') === true) return 'electronic-warfare';
  if (equipment?.hasFlag('F_HIRES_IMAGER') === true) return 'hires-imager';
  if (equipment?.hasFlag('F_HYPERSPECTRAL_IMAGER') === true) return 'hyperspectral-imager';
  if (equipment?.hasFlag('F_INFRARED_IMAGER') === true) return 'infrared-imager';
  if (equipment?.hasFlag('F_LARGE_COMM_SCANNER_SUITE') === true) {
    return 'large-communications-scanner';
  }
  if (equipment?.hasFlag('F_LOOKDOWN_RADAR') === true) return 'lookdown-radar';
  if (equipment?.hasFlag('F_RECON_CAMERA') === true) return 'recon-camera';
  if (equipment?.hasFlag('F_SENSOR_DISPENSER') === true) return 'sensor-dispenser';
  if (equipment?.hasFlag('F_SMALL_COMM_SCANNER_SUITE') === true) {
    return 'small-communications-scanner';
  }
  if (equipment?.hasFlag('F_WATCHDOG') === true) return 'watchdog';
  return null;
}

export interface SensorAlphaStrikeFacts {
  readonly abilities: readonly string[];
  readonly remoteSensorDispenser?: number;
}

export function sensorAlphaStrikeFacts(
  equipment: Equipment | null | undefined,
): SensorAlphaStrikeFacts {
  const kind = sensorEquipmentKind(equipment);
  if (kind === 'electronic-warfare') return Object.freeze({ abilities: Object.freeze(['ECM', 'LPRB']) });
  if (kind === 'watchdog') return Object.freeze({ abilities: Object.freeze(['LPRB', 'ECM', 'WAT']) });
  if (kind === 'bloodhound') return Object.freeze({ abilities: Object.freeze(['BH']) });
  if (kind === 'sensor-dispenser') {
    return Object.freeze({ abilities: Object.freeze(['RCN']), remoteSensorDispenser: 1 });
  }
  if (isReconSensorKind(kind)) return Object.freeze({ abilities: Object.freeze(['RCN']) });
  return Object.freeze({ abilities: Object.freeze([]) });
}

export function sensorEquipmentCrewContribution(equipment: Equipment | null | undefined): number {
  const kind = sensorEquipmentKind(equipment);
  if (kind === 'small-communications-scanner') return 6;
  if (kind === 'large-communications-scanner') return 12;
  return 0;
}

export function usesLargeCraftSensorSlot(equipment: Equipment | null | undefined): boolean {
  return isReconSensorKind(sensorEquipmentKind(equipment));
}

export function usesSmallCraftSensorSlot(equipment: Equipment | null | undefined): boolean {
  const kind = sensorEquipmentKind(equipment);
  return usesLargeCraftSensorSlot(equipment)
    || kind === 'watchdog'
    || kind === 'electronic-warfare'
    || kind === 'sensor-dispenser'
    || isBapEquipment(equipment)
    || isEcmEquipment(equipment);
}

export function isWatchdogEquipment(equipment: Equipment | null | undefined): boolean {
  return sensorEquipmentKind(equipment) === 'watchdog';
}

function isReconSensorKind(kind: SensorEquipmentKind | null): boolean {
  return kind === 'hires-imager'
    || kind === 'hyperspectral-imager'
    || kind === 'infrared-imager'
    || kind === 'lookdown-radar'
    || kind === 'recon-camera';
}
