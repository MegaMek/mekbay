// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { MiscEquipment } from '../../../equipment.model';
import {
  DropShipCollarType,
  EntityFeature,
  DROPSHIP_WEIGHT_LIMITS,
  EntityType,
  resolveWeightClass,
  SMALL_CRAFT_ARMOR_LOCATIONS,
  SMALL_CRAFT_EQUIP_LOCATIONS,
  WeightClass,
} from '../../types';
import { SmallCraftEntity } from './small-craft-entity';
import type { TechRatingSource } from '../../types';
import { getDropshipConstructionTech } from '../../components';
import { isLaserInsulatorEquipment } from '../../../laser-insulator.model';
import { isApolloEquipment } from '../../../apollo-mode.model';
import { isRiscLaserPulseModule } from '../../../risc-laser-mode.model';
import { isPpcCapacitorEquipment } from '../../../ppc-capacitor.model';
import {
  isJumpJetEquipment,
  isMechanicalJumpBoosterEquipment,
  isUmuEquipment,
} from '../../../jump-equipment.model';
import { isCaseEquipment } from '../../../case-equipment.model';
import { isChassisSystemEquipment } from '../../../chassis-equipment.model';
import { isFireControlEquipment } from '../../utils/fire-control';
import { isArtemisEquipment } from '../../../artemis-equipment.model';
import { isAtacOrDtacEquipment } from '../../../large-craft-equipment.model';
import { supportVariableSizeLabel } from '../../../support-equipment.model';
import { isSponsonTurretEquipment } from '../../../turret-equipment.model';
import { isHarJelEquipment, isMassEquipment } from '../../../utility-equipment.model';
import { isExternalStoresHardpointEquipment } from '../../../aerospace-support-equipment.model';
import { isBattleArmorVtolEquipment } from '../../../battle-armor-equipment.model';
import { isVariableSizeEquipment } from '../../../variable-size-equipment.model';

const VARIABLE_SIZE_NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

/**
 * DropShip entity (200+ tons, up to 100,000 tons).
 *
 * Extends SmallCraft - shares crew, design type, fuel, structural integrity.
 * Uses 6-location armor layout (Nose/LF/RF/LBS/RBS/Aft) but the same
 * equipment locations as SmallCraft (Nose/Left Side/Right Side/Aft/Hull).
 */
export class DropShipEntity extends SmallCraftEntity {
  override readonly entityType: EntityType = 'DropShip';

  protected override unitSubtypeKind(): 'DropShip' {
    return 'DropShip';
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getDropshipConstructionTech(this.uniformArmor()?.type === 'PRIMITIVE_AERO')];
  }

  protected override supportsWeaponBays(): boolean {
    return true;
  }

  protected override computeEntityFeatures(): readonly EntityFeature[] {
    const features = new Set<EntityFeature>(this.computeAeroFeatures());
    for (const mount of this.equipment()) {
      const equipment = mount.equipment;
      if (!(equipment instanceof MiscEquipment) || !isPrintableDropShipMisc(equipment)) continue;
      features.add(variableSizeShortName(equipment, mount.size ?? 1));
    }
    for (const feature of this.computeTransportFeatures()) features.add(feature);
    return [...features];
  }

  // ── DropShip-specific signals ──
  collarType = signal<DropShipCollarType>('Unspecified');
  kfBoomAttached = signal<boolean>(false);

  protected override computeWeightClass(): WeightClass {
    return resolveWeightClass(this.tonnage(), DROPSHIP_WEIGHT_LIMITS);
  }

  // ── Location overrides ──

  override get locationOrder(): readonly string[] {
    return SMALL_CRAFT_ARMOR_LOCATIONS;
  }

  override get equipLocations(): readonly string[] {
    return [...SMALL_CRAFT_EQUIP_LOCATIONS];
  }

  override get validLocations(): ReadonlySet<string> {
    // Union of armor locations and equipment locations
    return new Set([...SMALL_CRAFT_ARMOR_LOCATIONS, ...SMALL_CRAFT_EQUIP_LOCATIONS]);
  }
}

function isPrintableDropShipMisc(equipment: MiscEquipment): boolean {
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

function variableSizeShortName(equipment: MiscEquipment, size: number): string {
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
