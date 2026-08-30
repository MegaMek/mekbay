// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isApolloEquipment } from '../../apollo-mode.model';
import { isArtemisEquipment } from '../../artemis-equipment.model';
import { isBattleArmorVtolEquipment } from '../../battle-armor-equipment.model';
import { isCaseEquipment } from '../../case-equipment.model';
import { isChassisSystemEquipment } from '../../chassis-equipment.model';
import { isExternalStoresHardpointEquipment } from '../../aerospace-support-equipment.model';
import { MiscEquipment } from '../../equipment.model';
import {
  isJumpJetEquipment,
  isMechanicalJumpBoosterEquipment,
  isUmuEquipment,
} from '../../jump-equipment.model';
import { isAtacOrDtacEquipment } from '../../large-craft-equipment.model';
import { isLaserInsulatorEquipment } from '../../laser-insulator.model';
import { isPpcCapacitorEquipment } from '../../ppc-capacitor.model';
import { isRiscLaserPulseModule } from '../../risc-laser-mode.model';
import { supportVariableSizeLabel } from '../../support-equipment.model';
import { isSponsonTurretEquipment } from '../../turret-equipment.model';
import { isHarJelEquipment, isMassEquipment } from '../../utility-equipment.model';
import { isVariableSizeEquipment } from '../../variable-size-equipment.model';
import { isFireControlEquipment } from './fire-control';

const VARIABLE_SIZE_NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

/** Mirrors the record-sheet equipment filter used for DropShip and JumpShip feature labels. */
export function isPrintableLargeCraftMisc(equipment: MiscEquipment): boolean {
  return !isApolloEquipment(equipment)
    && !isPpcCapacitorEquipment(equipment)
    && !isRiscLaserPulseModule(equipment)
    && !isLaserInsulatorEquipment(equipment)
    && !isCaseEquipment(equipment)
    && !isChassisSystemEquipment(equipment)
    && !isFireControlEquipment(equipment)
    && !isArtemisEquipment(equipment)
    && !isSponsonTurretEquipment(equipment)
    && !isHarJelEquipment(equipment)
    && !isMassEquipment(equipment)
    && !isExternalStoresHardpointEquipment(equipment)
    && !isJumpJetEquipment(equipment)
    && !isUmuEquipment(equipment)
    && !isBattleArmorVtolEquipment(equipment)
    && !equipment.isHeatSink;
}

/** Formats the mount-sensitive short name exported as a large-craft feature. */
export function largeCraftMiscFeatureName(equipment: MiscEquipment, size: number): string {
  const name = equipment.shortName;
  if (!isVariableSizeEquipment(equipment)) return name;
  if (isMechanicalJumpBoosterEquipment(equipment)) return `${name} (${Math.trunc(size)} MP)`;
  const supportLabel = supportVariableSizeLabel(equipment, size);
  if (supportLabel !== null) return supportLabel;
  if (isAtacOrDtacEquipment(equipment)) {
    return `${name} (${Math.trunc(size)} ${size > 1 ? 'drones' : 'drone'})`;
  }
  return `${name}: ${VARIABLE_SIZE_NUMBER_FORMAT.format(size)}t`;
}
