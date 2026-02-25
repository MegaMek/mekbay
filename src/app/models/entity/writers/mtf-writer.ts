/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { MekEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import {
  CriticalSlotView,
  EntityMountedEquipment,
  EntityTechBase,
} from '../types';

// ============================================================================
// Location → MTF display names & ordering
// ============================================================================

const LOC_DISPLAY_NAMES: Record<string, string> = {
  HD: 'Head', CT: 'Center Torso', LT: 'Left Torso', RT: 'Right Torso',
  LA: 'Left Arm', RA: 'Right Arm', LL: 'Left Leg', RL: 'Right Leg',
  FLL: 'Front Left Leg', FRL: 'Front Right Leg',
  RLL: 'Rear Left Leg', RRL: 'Rear Right Leg',
  CL: 'Center Leg',
};

/** MTF crit-section output order: biped */
const CRIT_ORDER_BIPED = ['LA', 'RA', 'LT', 'RT', 'CT', 'HD', 'LL', 'RL'];
/** MTF crit-section output order: quad */
const CRIT_ORDER_QUAD = ['FLL', 'FRL', 'LT', 'RT', 'CT', 'HD', 'RLL', 'RRL'];
/** MTF crit-section output order: tripod */
const CRIT_ORDER_TRIPOD = ['LA', 'RA', 'LT', 'RT', 'CT', 'HD', 'LL', 'RL', 'CL'];

// ============================================================================
// Armor output order
// ============================================================================

interface ArmorOutputEntry { label: string; loc: string; face: 'front' | 'rear' }

const ARMOR_ORDER_BIPED: ArmorOutputEntry[] = [
  { label: 'LA Armor', loc: 'LA', face: 'front' },
  { label: 'RA Armor', loc: 'RA', face: 'front' },
  { label: 'LT Armor', loc: 'LT', face: 'front' },
  { label: 'RT Armor', loc: 'RT', face: 'front' },
  { label: 'CT Armor', loc: 'CT', face: 'front' },
  { label: 'HD Armor', loc: 'HD', face: 'front' },
  { label: 'LL Armor', loc: 'LL', face: 'front' },
  { label: 'RL Armor', loc: 'RL', face: 'front' },
  { label: 'RTL Armor', loc: 'LT', face: 'rear' },
  { label: 'RTR Armor', loc: 'RT', face: 'rear' },
  { label: 'RTC Armor', loc: 'CT', face: 'rear' },
];

const ARMOR_ORDER_QUAD: ArmorOutputEntry[] = [
  { label: 'FLL Armor', loc: 'FLL', face: 'front' },
  { label: 'FRL Armor', loc: 'FRL', face: 'front' },
  { label: 'LT Armor', loc: 'LT', face: 'front' },
  { label: 'RT Armor', loc: 'RT', face: 'front' },
  { label: 'CT Armor', loc: 'CT', face: 'front' },
  { label: 'HD Armor', loc: 'HD', face: 'front' },
  { label: 'RLL Armor', loc: 'RLL', face: 'front' },
  { label: 'RRL Armor', loc: 'RRL', face: 'front' },
  { label: 'RTL Armor', loc: 'LT', face: 'rear' },
  { label: 'RTR Armor', loc: 'RT', face: 'rear' },
  { label: 'RTC Armor', loc: 'CT', face: 'rear' },
];

const ARMOR_ORDER_TRIPOD: ArmorOutputEntry[] = [
  { label: 'LA Armor', loc: 'LA', face: 'front' },
  { label: 'RA Armor', loc: 'RA', face: 'front' },
  { label: 'LT Armor', loc: 'LT', face: 'front' },
  { label: 'RT Armor', loc: 'RT', face: 'front' },
  { label: 'CT Armor', loc: 'CT', face: 'front' },
  { label: 'HD Armor', loc: 'HD', face: 'front' },
  { label: 'LL Armor', loc: 'LL', face: 'front' },
  { label: 'RL Armor', loc: 'RL', face: 'front' },
  { label: 'CL Armor', loc: 'CL', face: 'front' },
  { label: 'RTL Armor', loc: 'LT', face: 'rear' },
  { label: 'RTR Armor', loc: 'RT', face: 'rear' },
  { label: 'RTC Armor', loc: 'CT', face: 'rear' },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a MekEntity to MTF format.
 *
 * Reads the derived `criticalSlotGrid` computed to output critical slots,
 * and the structured `armorValues` (LocationArmor) for armor output.
 */
export function writeMtf(entity: MekEntity): string {
  const lines: string[] = [];
  const isQuad = entity instanceof QuadMekEntity;
  const isTripod = entity instanceof TripodMekEntity;

  // Build a mount lookup for crit slot output
  const mountMap = new Map<string, EntityMountedEquipment>();
  for (const m of entity.equipment()) {
    mountMap.set(m.mountId, m);
  }

  writeIdentity(entity, lines);
  writeConfig(entity, lines);
  writePhysical(entity, lines);
  writeMovement(entity, lines);
  writeArmor(entity, lines, isQuad, isTripod);
  writeWeapons(entity, lines);
  writeCriticals(entity, lines, mountMap, isQuad, isTripod);
  writeQuirks(entity, lines);
  writeFluff(entity, lines);

  return lines.join('\n');
}

// ============================================================================
// Section writers (internal)
// ============================================================================

function writeIdentity(entity: MekEntity, lines: string[]): void {
  lines.push(`chassis:${entity.chassis()}`);
  lines.push(`model:${entity.model()}`);
  if (entity.mulId() >= 0) lines.push(`mul id:${entity.mulId()}`);
  lines.push('');
}

function writeConfig(entity: MekEntity, lines: string[]): void {
  lines.push(`Config:${getConfigString(entity)}`);
  lines.push(`TechBase:${formatTechBase(entity.techBase())}`);
  lines.push(`Era:${entity.year()}`);
  if (entity.source()) lines.push(`Source:${entity.source()}`);
  lines.push(`Rules Level:${entity.rulesLevel()}`);
  if (entity.role()) lines.push(`role:${entity.role()}`);
  lines.push('');
}

function writePhysical(entity: MekEntity, lines: string[]): void {
  lines.push(`Mass:${entity.tonnage()}`);
  lines.push(`Engine:${entity.engineRating()} ${getEngineMtfName(entity.engineType())}(${tbMarker(entity.techBase())})`);
  lines.push(`Structure:${getStructureString(entity)}`);
  lines.push(`Myomer:${entity.myomerType()}`);

  if (entity.gyroType() !== 'Standard') lines.push(`Gyro:${entity.gyroType()}`);
  if (entity.cockpitType() !== 'Standard') lines.push(`Cockpit:${entity.cockpitType()}`);
  if (entity.ejectionType()) lines.push(`Ejection:${entity.ejectionType()}`);
  if (entity.heatSinkKit()) lines.push(`Heat Sink Kit:${entity.heatSinkKit()}`);
  lines.push('');
}

function writeMovement(entity: MekEntity, lines: string[]): void {
  const hsType = entity.heatSinkType();
  const hsCount = entity.heatSinkCount();
  lines.push(`Heat Sinks:${hsCount} ${hsType}`);
  if (entity.baseChassisHeatSinks() >= 0) {
    lines.push(`Base Chassis Heat Sinks:${entity.baseChassisHeatSinks()}`);
  }
  lines.push(`Walk MP:${entity.walkMP()}`);
  lines.push(`Run MP:${entity.runMP()}`);
  lines.push(`Jump MP:${entity.jumpMP()}`);
  lines.push('');
}

function writeArmor(
  entity: MekEntity, lines: string[],
  isQuad: boolean, isTripod: boolean,
): void {
  const armorType = entity.armorType();
  const armorTb = entity.armorTechBase();
  if (armorTb === 'Inner Sphere' && armorType === 'Standard') {
    lines.push('Armor:Standard Armor');
  } else {
    lines.push(`Armor:${armorType}(${formatTechBase(armorTb)})`);
  }

  const order = isTripod ? ARMOR_ORDER_TRIPOD : isQuad ? ARMOR_ORDER_QUAD : ARMOR_ORDER_BIPED;
  const armorMap = entity.armorValues();
  for (const entry of order) {
    const la = armorMap.get(entry.loc);
    const value = la ? la[entry.face] : 0;
    lines.push(`${entry.label}:${value}`);
  }
  lines.push('');
}

function writeWeapons(entity: MekEntity, lines: string[]): void {
  const mounts = entity.equipment().filter(m => m.location !== 'None');
  lines.push(`Weapons:${mounts.length}`);
  for (const m of mounts) {
    const locName = LOC_DISPLAY_NAMES[m.location] ?? m.location;
    lines.push(`1 ${m.equipmentId}, ${locName}`);
  }
  lines.push('');
}

function writeCriticals(
  entity: MekEntity, lines: string[],
  mountMap: Map<string, EntityMountedEquipment>,
  isQuad: boolean, isTripod: boolean,
): void {
  const critOrder = isTripod ? CRIT_ORDER_TRIPOD : isQuad ? CRIT_ORDER_QUAD : CRIT_ORDER_BIPED;
  const grid = entity.criticalSlotGrid();

  for (const loc of critOrder) {
    const header = LOC_DISPLAY_NAMES[loc];
    if (!header) continue;
    lines.push(`${header}:`);

    const slots = grid.get(loc) ?? [];
    const slotsPerLoc = entity.slotsPerLocation();

    for (let i = 0; i < slotsPerLoc; i++) {
      const slot = slots[i];
      if (!slot || slot.type === 'empty') {
        lines.push('-Empty-');
      } else if (slot.type === 'system') {
        lines.push(slot.systemType === 'Engine' ? 'Fusion Engine' : slot.systemType!);
      } else {
        // Equipment — look up mount for name and modifiers
        lines.push(formatEquipmentSlot(slot, mountMap));
      }
    }
    lines.push('');
  }

  // Nocrit equipment (location: 'None')
  const nocritMounts = entity.equipment().filter(m => m.location === 'None');
  for (const m of nocritMounts) {
    lines.push(`nocrit:${m.equipmentId}`);
  }
  if (nocritMounts.length > 0) lines.push('');
}

function writeQuirks(entity: MekEntity, lines: string[]): void {
  for (const q of entity.quirks()) {
    lines.push(`quirk:${q.name}`);
  }
  for (const wq of entity.weaponQuirks()) {
    lines.push(`weaponquirk:${wq.name}:${wq.location}:${wq.slot}:${wq.weaponName}`);
  }
  if (entity.quirks().length > 0 || entity.weaponQuirks().length > 0) {
    lines.push('');
  }
}

function writeFluff(entity: MekEntity, lines: string[]): void {
  const fluff = entity.fluff();
  if (fluff.overview) lines.push(`overview:${fluff.overview}`);
  if (fluff.capabilities) lines.push(`capabilities:${fluff.capabilities}`);
  if (fluff.deployment) lines.push(`deployment:${fluff.deployment}`);
  if (fluff.history) lines.push(`history:${fluff.history}`);
  if (fluff.manufacturer) lines.push(`manufacturer:${fluff.manufacturer}`);
  if (fluff.primaryFactory) lines.push(`primaryfactory:${fluff.primaryFactory}`);
  if (fluff.systemManufacturers) {
    for (const [k, v] of Object.entries(fluff.systemManufacturers)) {
      lines.push(`systemmanufacturer:${k}:${v}`);
    }
  }
  if (fluff.systemModels) {
    for (const [k, v] of Object.entries(fluff.systemModels)) {
      lines.push(`systemmodel:${k}:${v}`);
    }
  }
  if (entity.manualBV() > 0) lines.push(`bv:${entity.manualBV()}`);
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatEquipmentSlot(
  slot: CriticalSlotView,
  mountMap: Map<string, EntityMountedEquipment>,
): string {
  const mount = slot.mountId ? mountMap.get(slot.mountId) : undefined;
  if (!mount) return '-Empty-';

  let name = mount.equipmentId;
  if (mount.rearMounted) name += ' (R)';
  if (slot.omniPod) name += ' (OMNIPOD)';
  if (slot.armored) name += ' (ARMORED)';
  if (mount.isSplit) name += ' (SPLIT)';
  if (mount.facing !== undefined) name += ` (${facingLabel(mount.facing)})`;
  if (mount.size !== undefined) name += `:SIZE:${mount.size}`;
  if (mount.secondEquipmentId) name += `|${mount.secondEquipmentId}`;
  return name;
}

function getConfigString(entity: MekEntity): string {
  let base: string;
  if (entity instanceof LamEntity) base = 'LAM';
  else if (entity instanceof QuadVeeEntity) base = 'QuadVee';
  else if (entity instanceof QuadMekEntity) base = 'Quad';
  else if (entity instanceof TripodMekEntity) base = 'Tripod';
  else base = 'Biped';
  if (entity.omni()) base += ' Omnimech';
  return base;
}

function formatTechBase(tb: EntityTechBase): string {
  return tb === 'Clan' ? 'Clan' : tb === 'Mixed' ? 'Mixed' : 'Inner Sphere';
}

function tbMarker(tb: EntityTechBase): string {
  return tb === 'Clan' ? 'Clan' : 'IS';
}

function getEngineMtfName(engineType: string): string {
  switch (engineType) {
    case 'XL': return 'XL Fusion Engine';
    case 'XXL': return 'XXL Fusion Engine';
    case 'Light': return 'Light Fusion Engine';
    case 'Compact': return 'Compact Fusion Engine';
    case 'ICE': return 'I.C.E.';
    case 'Fuel Cell': return 'Fuel Cell Engine';
    case 'Fission': return 'Fission Engine';
    default: return 'Fusion Engine';
  }
}

function getStructureString(entity: MekEntity): string {
  const type = entity.structureType();
  if (type === 'Standard') return 'Standard';
  const prefix = entity.techBase() === 'Clan' ? 'Clan ' : 'IS ';
  return `${prefix}${type}`;
}

function facingLabel(facing: number): string {
  switch (facing) {
    case 0: return 'FL';
    case 1: return 'FR';
    case 2: return 'F';
    case 3: return 'R';
    case 4: return 'RL';
    case 5: return 'RR';
    default: return '';
  }
}
