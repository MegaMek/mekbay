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

import { APP_VERSION_STRING } from '../../../build-meta';
import { MekEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import {
  CriticalSlotView,
  EntityMountedEquipment,
  EntityTechBase,
  MEK_SLOTS_PER_LOCATION,
  STRUCTURE_TYPE_DISPLAY_NAME,
} from '../types';
import { WeaponEquipment } from '../../equipment.model';

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
  { label: 'LA armor', loc: 'LA', face: 'front' },
  { label: 'RA armor', loc: 'RA', face: 'front' },
  { label: 'LT armor', loc: 'LT', face: 'front' },
  { label: 'RT armor', loc: 'RT', face: 'front' },
  { label: 'CT armor', loc: 'CT', face: 'front' },
  { label: 'HD armor', loc: 'HD', face: 'front' },
  { label: 'LL armor', loc: 'LL', face: 'front' },
  { label: 'RL armor', loc: 'RL', face: 'front' },
  { label: 'RTL armor', loc: 'LT', face: 'rear' },
  { label: 'RTR armor', loc: 'RT', face: 'rear' },
  { label: 'RTC armor', loc: 'CT', face: 'rear' },
];

const ARMOR_ORDER_QUAD: ArmorOutputEntry[] = [
  { label: 'FLL armor', loc: 'FLL', face: 'front' },
  { label: 'FRL armor', loc: 'FRL', face: 'front' },
  { label: 'LT armor', loc: 'LT', face: 'front' },
  { label: 'RT armor', loc: 'RT', face: 'front' },
  { label: 'CT armor', loc: 'CT', face: 'front' },
  { label: 'HD armor', loc: 'HD', face: 'front' },
  { label: 'RLL armor', loc: 'RLL', face: 'front' },
  { label: 'RRL armor', loc: 'RRL', face: 'front' },
  { label: 'RTL armor', loc: 'LT', face: 'rear' },
  { label: 'RTR armor', loc: 'RT', face: 'rear' },
  { label: 'RTC armor', loc: 'CT', face: 'rear' },
];

const ARMOR_ORDER_TRIPOD: ArmorOutputEntry[] = [
  { label: 'LA armor', loc: 'LA', face: 'front' },
  { label: 'RA armor', loc: 'RA', face: 'front' },
  { label: 'LT armor', loc: 'LT', face: 'front' },
  { label: 'RT armor', loc: 'RT', face: 'front' },
  { label: 'CT armor', loc: 'CT', face: 'front' },
  { label: 'HD armor', loc: 'HD', face: 'front' },
  { label: 'LL armor', loc: 'LL', face: 'front' },
  { label: 'RL armor', loc: 'RL', face: 'front' },
  { label: 'CL armor', loc: 'CL', face: 'front' },
  { label: 'RTL armor', loc: 'LT', face: 'rear' },
  { label: 'RTR armor', loc: 'RT', face: 'rear' },
  { label: 'RTC armor', loc: 'CT', face: 'rear' },
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
  writeQuirks(entity, lines);
  writePhysical(entity, lines);
  writeMovement(entity, lines);
  writeArmor(entity, lines, isQuad, isTripod);
  writeWeapons(entity, lines);
  writeCriticals(entity, lines, mountMap, isQuad, isTripod);
  writeFluff(entity, lines);

  return lines.join('\n');
}

// ============================================================================
// Section writers (internal)
// ============================================================================

function writeIdentity(entity: MekEntity, lines: string[]): void {
  lines.push(`generator:MekBay ${APP_VERSION_STRING}`);
  lines.push(`chassis:${entity.chassis()}`);
  if (entity.clanName()) lines.push(`clanname:${entity.clanName()}`);
  lines.push(`model:${entity.model()}`);
  if (entity.mulId() >= 0) lines.push(`mul id:${entity.mulId()}`);
  lines.push('');
}

function writeConfig(entity: MekEntity, lines: string[]): void {
  lines.push(`Config:${getConfigString(entity)}`);
  lines.push(`techbase:${formatTechBase(entity)}`);
  lines.push(`era:${entity.year()}`);
  if (entity.source()) lines.push(`source:${entity.source()}`);
  lines.push(`rules level:${entity.rulesLevel()}`);
  if (entity.role()) lines.push(`role:${entity.role()}`);
  lines.push('');
}

function writePhysical(entity: MekEntity, lines: string[]): void {
  lines.push(`mass:${entity.tonnage()}`);
  lines.push(`engine:${formatEngineLine(entity)}`);
  lines.push(`structure:${getStructureString(entity)}`);
  lines.push(`myomer:${entity.myomerType()}`);

  if (entity instanceof LamEntity && entity.lamType()) {
    lines.push(`lam:${entity.lamType()}`);
  }
  if (entity instanceof QuadVeeEntity && entity.motiveType()) {
    lines.push(`motive:${entity.motiveType()}`);
  }

  if (entity.cockpitType() !== 'Standard') lines.push(`cockpit:${entity.cockpitType()}`);
  if (entity.gyroType() !== 'Standard') lines.push(`gyro:${entity.gyroType()}`);
  if (entity.ejectionType()) lines.push(`ejection:${entity.ejectionType()}`);
  if (entity.heatSinkKit()) lines.push(`heat sink kit:${entity.heatSinkKit()}`);
  lines.push('');
}

function writeMovement(entity: MekEntity, lines: string[]): void {
  const me = entity.mountedEngine();
  lines.push(`heat sinks:${me.totalHeatSinks} ${me.rawHeatSinkLabel}`);
  if (me.baseChassisHeatSinks >= 0) {
    lines.push(`base chassis heat sinks:${me.baseChassisHeatSinks}`);
  }
  // Nocrit: misc equipment with 0 crit slots, excluding CASE, armor, and structure
  // (matches MegaMek's Mek.getMtf() nocrit logic)
  const nocritMounts = entity.equipment().filter(m => {
    const eq = m.equipment;
    if (!eq) return false;
    if (eq.type !== 'misc') return false;
    if (eq.stats.criticalSlots !== 0) return false;
    if (eq.hasFlag('F_CASE')) return false;
    if (eq.hasFlag('F_ARMOR')) return false;
    if (eq.hasFlag('F_STRUCTURE')) return false;
    return true;
  });
  for (const m of nocritMounts) {
    lines.push(`nocrit:${m.equipmentId}:${m.location}`);
  }
  lines.push(`walk mp:${entity.walkMP()}`);
  const jumpVal = entity.declaredJumpMP() >= 0 ? entity.declaredJumpMP() : entity.jumpMP();
  lines.push(`jump mp:${jumpVal}`);
  lines.push('');
}

function writeArmor(
  entity: MekEntity, lines: string[],
  isQuad: boolean, isTripod: boolean,
): void {
  const armorType = entity.armorType();
  const armorTb = entity.armorTechBase();
  const armorDisplayName = entity.armorEquipment()?.name ?? 'Standard';
  if (armorType === 'PATCHWORK') {
    lines.push('armor:Patchwork');
  } else {
    lines.push(`armor:${armorDisplayName}(${formatTechBaseLabel(armorTb)})`);
  }

  const order = isTripod ? ARMOR_ORDER_TRIPOD : isQuad ? ARMOR_ORDER_QUAD : ARMOR_ORDER_BIPED;
  const armorMap = entity.armorValues();
  const patchTypes = armorType === 'PATCHWORK' ? entity.armorTypes() : undefined;
  for (const entry of order) {
    const la = armorMap.get(entry.loc);
    const value = la ? la[entry.face] : 0;
    // For patchwork armor, front-facing entries include per-location armor type
    if (patchTypes && entry.face === 'front') {
      const locType = patchTypes.get(entry.loc) ?? 'Standard(IS/Clan)';
      lines.push(`${entry.label}:${locType}:${value}`);
    } else {
      lines.push(`${entry.label}:${value}`);
    }
  }
  lines.push('');
}

/**
 * Location order for sorting weapons — matches MegaMek's descending location-
 * index order (LOC_LLEG=7 first … LOC_HEAD=0 last).
 */
const WEAPON_LOC_ORDER: Record<string, number> = {
  CL: 0, LL: 1, RL: 2, LA: 3, RA: 4, LT: 5, RT: 6, CT: 7, HD: 8,
  RLL: 1, RRL: 2, FLL: 3, FRL: 4,
};

function writeWeapons(entity: MekEntity, lines: string[]): void {
  const mounts = entity.equipment().filter(m => m.location !== 'None' && m.equipment instanceof WeaponEquipment);

  // Sort by first crit-slot appearance: location order, then slot index
  mounts.sort((a, b) => {
    const aFirst = a.placements?.[0];
    const bFirst = b.placements?.[0];
    const aLoc = aFirst?.location ?? a.location;
    const bLoc = bFirst?.location ?? b.location;
    const locDiff = (WEAPON_LOC_ORDER[aLoc] ?? 99) - (WEAPON_LOC_ORDER[bLoc] ?? 99);
    if (locDiff !== 0) return locDiff;
    return (aFirst?.slotIndex ?? 0) - (bFirst?.slotIndex ?? 0);
  });

  lines.push(`Weapons:${mounts.length}`);
  for (const m of mounts) {
    // mount.location is the primary location (torso for split weapons)
    const locName = LOC_DISPLAY_NAMES[m.location] ?? m.location;
    const displayName = m.equipment?.name ?? m.equipmentId;
    lines.push(`${displayName}, ${locName}`);
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

    for (let i = 0; i < MEK_SLOTS_PER_LOCATION; i++) {
      const slot = slots[i];
      if (!slot || slot.type === 'empty') {
        lines.push('-Empty-');
      } else if (slot.type === 'system') {
        const name = slot.systemType === 'Engine' ? 'Fusion Engine' : slot.systemType!;
        lines.push(slot.armored ? `${name} (ARMORED)` : name);
      } else {
        // Equipment — look up mount for name and modifiers
        lines.push(formatEquipmentSlot(slot, mountMap));
      }
    }
    lines.push('');
  }
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
  if (fluff.notes) lines.push(`notes:${fluff.notes}`);

  // Interleave systemmanufacturer and systemmodel per system key
  // MegaMek iterates System enum: CHASSIS, ENGINE, ARMOR, JUMP_JET, COMMUNICATIONS, TARGETING
  if (fluff.systemManufacturers || fluff.systemModels) {
    const mfr = fluff.systemManufacturers ?? {};
    const mdl = fluff.systemModels ?? {};
    const SYSTEM_ORDER = ['CHASSIS', 'ENGINE', 'ARMOR', 'JUMP_JET', 'COMMUNICATIONS', 'TARGETING'];
    for (const key of SYSTEM_ORDER) {
      if (mfr[key]) lines.push(`systemmanufacturer:${key}:${mfr[key]}`);
      if (mdl[key]) lines.push(`systemmode:${key}:${mdl[key]}`);
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
  if (mount.turretMounted) name += ' (T)';
  // For split slots with secondEquipmentId, (OMNIPOD) goes on the second part
  if (slot.omniPod && !mount.secondEquipmentId) name += ' (OMNIPOD)';
  if (mount.facing !== undefined) name += ` (${facingLabel(mount.facing)})`;
  if (mount.size !== undefined) {
    // Preserve decimal point: MegaMek writes SIZE:1.0, SIZE:2.0 etc.
    const sizeStr = Number.isInteger(mount.size) ? `${mount.size}.0` : `${mount.size}`;
    name += `:SIZE:${sizeStr}`;
  }
  // ARMORED goes after SIZE (MegaMek: "name:SIZE:1.0 (ARMORED)")
  if (slot.armored) name += ' (ARMORED)';
  if (mount.secondEquipmentId) {
    let second = mount.secondEquipmentId;
    if (slot.omniPod) second += ' (OMNIPOD)';
    name += `|${second}`;
  }
  return name;
}

function getConfigString(entity: MekEntity): string {
  let base: string;
  if (entity instanceof LamEntity) base = 'LAM';
  else if (entity instanceof QuadVeeEntity) base = 'QuadVee';
  else if (entity instanceof QuadMekEntity) base = 'Quad';
  else if (entity instanceof TripodMekEntity) base = 'Tripod';
  else base = 'Biped';
  if (entity.omni()) base += ' OmniMek';
  return base;
}

function formatTechBase(entity: MekEntity): string {
  const tb = entity.techBase();
  if (tb === 'Mixed') {
    // Reconstruct the full mixed chassis string from the tech level
    const tl = entity.techLevel();
    if (tl.includes('Clan Chassis')) return 'Mixed (Clan Chassis)';
    return 'Mixed (IS Chassis)';
  }
  return tb === 'Clan' ? 'Clan' : 'Inner Sphere';
}

function formatTechBaseLabel(tb: EntityTechBase): string {
  return tb === 'Clan' ? 'Clan' : tb === 'Mixed' ? 'Mixed' : 'Inner Sphere';
}

/**
 * Format the full MTF engine line value.
 *
 * Conventions observed in MegaMek Suite 0.50.12 output:
 * - Pure IS:  `<rating> <Type> Engine`           (no tech marker)
 * - Pure Clan: `<rating> <Type> (Clan) Engine`   (`(Clan)` between type and Engine)
 * - Mixed IS Chassis + IS engine: `<rating> <Type> Engine(IS)`
 * - Mixed + Clan engine: `<rating> <Type> (Clan) Engine`
 */
function formatEngineLine(entity: MekEntity): string {
  const rating = entity.engineRating();
  const typeName = getEngineTypePrefix(entity.engineType());
  const isClanEngine = entity.clanEngine();
  const isMixed = entity.mixedTech();
  const large = rating > 400 ? 'Large ' : '';

  if (isClanEngine) {
    return `${rating} ${large}${typeName} (Clan) Engine`;
  } else if (isMixed) {
    return `${rating} ${large}${typeName} Engine(IS)`;
  } else {
    return `${rating} ${large}${typeName} Engine`;
  }
}

function getEngineTypePrefix(engineType: string): string {
  switch (engineType) {
    case 'XL':        return 'XL';
    case 'XXL':       return 'XXL';
    case 'Light':     return 'Light';
    case 'Compact':   return 'Compact';
    case 'ICE':       return 'ICE';
    case 'Fuel Cell': return 'Fuel Cell';
    case 'Fission':   return 'Fission';
    default:          return 'Fusion';
  }
}

function getStructureString(entity: MekEntity): string {
  // Prefer the raw parsed string for perfect round-trip fidelity
  const raw = entity.rawStructure();
  if (raw) return raw;

  // Fallback: compute from structured fields
  const type = STRUCTURE_TYPE_DISPLAY_NAME[entity.structureType()] ?? 'Standard';
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
