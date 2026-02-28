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

import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import { MekEntity, MekWithArmsEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import { createEngine, createMountedEngine, createMountedArmor, createPatchworkArmor } from '../components';
import { ArmorEquipment, WeaponEquipment } from '../../equipment.model';
import {
  ArmorType,
  EntityFluff,
  EntityMountedEquipment,
  EntityQuirk,
  EntityTechBase,
  EntityWeaponQuirk,
  HeatSinkType,
  LocationArmor,
  MekSystemType,
  MotiveType,
  MountPlacement,
  locationArmor,
  normalizeSystemManufacturerKey,
  parseMotiveType,
  resolveArmorByName,
  parseStructureType,
  StructureType,
} from '../types';
import { parseMtfArmor } from '../utils/armor-type-parser';
import { parseMtfEngine } from '../utils/engine-type-parser';
import { generateMountId, resetMountIdCounter } from '../utils/signal-helpers';
import { ParseContext } from './parse-context';

// ============================================================================
// Location normalization - raw MTF strings → canonical location IDs
// ============================================================================

const BIPED_LOCATION_MAP: Record<string, string> = {
  'Left Arm:':       'LA',
  'Right Arm:':      'RA',
  'Left Torso:':     'LT',
  'Right Torso:':    'RT',
  'Center Torso:':   'CT',
  'Head:':           'HD',
  'Left Leg:':       'LL',
  'Right Leg:':      'RL',
  'Center Leg:':     'CL',
};

const QUAD_LOCATION_MAP: Record<string, string> = {
  'Front Left Leg:':  'FLL',
  'Front Right Leg:': 'FRL',
  'Left Torso:':      'LT',
  'Right Torso:':     'RT',
  'Center Torso:':    'CT',
  'Head:':            'HD',
  'Rear Left Leg:':   'RLL',
  'Rear Right Leg:':  'RRL',
};

/**
 * Armor label → { canonical location, face }.
 * This is the single ingress normalization point - the rest of the code
 * uses canonical IDs and ArmorFace only.
 */
const ARMOR_LABEL_MAP: Record<string, { loc: string; face: 'front' | 'rear' }> = {
  'la armor':  { loc: 'LA',  face: 'front' },
  'ra armor':  { loc: 'RA',  face: 'front' },
  'lt armor':  { loc: 'LT',  face: 'front' },
  'rt armor':  { loc: 'RT',  face: 'front' },
  'ct armor':  { loc: 'CT',  face: 'front' },
  'hd armor':  { loc: 'HD',  face: 'front' },
  'll armor':  { loc: 'LL',  face: 'front' },
  'rl armor':  { loc: 'RL',  face: 'front' },
  'cl armor':  { loc: 'CL',  face: 'front' },
  'fll armor': { loc: 'FLL', face: 'front' },
  'frl armor': { loc: 'FRL', face: 'front' },
  'rll armor': { loc: 'RLL', face: 'front' },
  'rrl armor': { loc: 'RRL', face: 'front' },
  // Rear armor
  'rtl armor': { loc: 'LT',  face: 'rear' },
  'rtr armor': { loc: 'RT',  face: 'rear' },
  'rtc armor': { loc: 'CT',  face: 'rear' },
};

// ============================================================================
// Known system slot names
// ============================================================================

const SYSTEM_NAMES: Record<string, MekSystemType> = {
  'Shoulder':              'Shoulder',
  'Upper Arm Actuator':    'Upper Arm Actuator',
  'Lower Arm Actuator':    'Lower Arm Actuator',
  'Hand Actuator':         'Hand Actuator',
  'Hip':                   'Hip',
  'Upper Leg Actuator':    'Upper Leg Actuator',
  'Lower Leg Actuator':    'Lower Leg Actuator',
  'Foot Actuator':         'Foot Actuator',
  'Life Support':          'Life Support',
  'Sensors':               'Sensors',
  'Cockpit':               'Cockpit',
  'Gyro':                  'Gyro',
  'Landing Gear':          'Landing Gear',
  'Avionics':              'Avionics',
};

const ENGINE_SLOT_NAMES = [
  'Fusion Engine', 'XL Engine', 'XXL Engine', 'Light Engine',
  'Compact Engine', 'No Engine',
  // Large engine variants (rating > 400)
  'Large Fusion Engine', 'Large XL Engine', 'Large XXL Engine',
  'Large Light Engine', 'Large Compact Engine',
  // Full MTF names (robustness - some files may use the full label)
  'XL Fusion Engine', 'XXL Fusion Engine', 'Light Fusion Engine',
  'Compact Fusion Engine',
  'Large XL Fusion Engine', 'Large XXL Fusion Engine',
  'Large Light Fusion Engine', 'Large Compact Fusion Engine',
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse an MTF file into a MekEntity.
 *
 * Equipment mounts are the single canonical model.  Crit-slot positions are
 * stored as `placements` on each mount - the entity's `criticalSlotGrid`
 * computed derives the full grid from these placements + system template.
 */
export function parseMtf(content: string, ctx: ParseContext): MekEntity {
  resetMountIdCounter();
  const lines = content.split(/\r?\n/);
  const header = parseHeader(lines);
  const entity = createMekEntity(header.config);

  // ── Identity & tech ──
  entity.chassis.set(header.chassis);
  entity.model.set(header.model);
  entity.mulId.set(header.mulId);
  entity.year.set(header.era);
  entity.source.set(header.source);
  entity.rulesLevel.set(header.rulesLevel);
  entity.role.set(header.role);
  entity.omni.set(header.isOmni);

  entity.techBase.set(header.techBase);
  entity.techLevel.set(header.techBaseRaw);
  if (header.techBaseRaw.toLowerCase().includes('mixed')) {
    entity.mixedTech.set(true);
    entity.techBase.set('Mixed');
  }
  if (header.clanName) entity.clanName.set(header.clanName);

  // ── Physical properties ──
  entity.tonnage.set(header.mass);

  // ── Engine + Heat Sinks → MountedEngine ──
  {
    const engineInfo = header.engine
      ? parseMtfEngine(header.engine)
      : { rating: 0, type: 'Fusion' as const, clanTech: false };
    const isSuperHeavy = header.mass > 100;
    const engine = createEngine(engineInfo.type, engineInfo.rating, engineInfo.clanTech, isSuperHeavy);

    const hsInfo = header.heatSinks
      ? parseHeatSinkLine(header.heatSinks)
      : { count: 10, type: 'Single' as HeatSinkType, typeLabel: 'Single' };

    entity.mountedEngine.set(createMountedEngine(engine, {
      heatSinkType: hsInfo.type,
      totalHeatSinks: hsInfo.count,
      rawHeatSinkLabel: hsInfo.typeLabel,
      baseChassisHeatSinks: header.baseChassisHeatSinks,
    }));
  }

  entity.structureType.set(cleanStructureType(header.structure));
  entity.rawStructure.set(header.structure);
  entity.myomerType.set(header.myomer || 'Standard');

  if (header.gyro) entity.gyroType.set(header.gyro);
  if (header.cockpit) entity.cockpitType.set(header.cockpit);
  if (header.ejection) entity.ejectionType.set(header.ejection);
  if (header.heatSinkKit) entity.heatSinkKit.set(header.heatSinkKit);

  entity.walkMP.set(header.walkMP);
  if (header.jumpMP >= 0) entity.declaredJumpMP.set(header.jumpMP);

  // ── Armor (structured { front, rear }) ──
  {
    let armorType: ArmorType = 'STANDARD';
    let armorTechBase: EntityTechBase = 'Inner Sphere';
    let armorEquipment: ArmorEquipment | null = null;

    if (header.armorType) {
      const armorInfo = parseMtfArmor(header.armorType);
      if (armorInfo.clanTech) armorTechBase = 'Clan';
      if (armorInfo.patchwork) {
        armorType = 'PATCHWORK';
      } else {
        const eq = resolveArmorByName(armorInfo.type, armorInfo.clanTech, ctx.equipmentDb);
        if (eq) {
          armorType = eq.armorType as ArmorType;
          armorEquipment = eq;
        }
      }
    }

    // Patchwork per-location types
    let patchwork = null;
    if (header.patchworkTypes.size > 0) {
      const types = new Map<string, string>();
      for (const [label, typeStr] of header.patchworkTypes) {
        const mapping = ARMOR_LABEL_MAP[label.toLowerCase()];
        if (mapping) types.set(mapping.loc, typeStr);
      }
      patchwork = createPatchworkArmor({ types });
    }

    entity.mountedArmor.set(createMountedArmor({
      type: armorType,
      techBase: armorTechBase,
      armor: armorEquipment,
      patchwork,
    }));
  }

  const armorMap = new Map<string, LocationArmor>();
  for (const [label, value] of header.armorValues) {
    const mapping = ARMOR_LABEL_MAP[label.toLowerCase()];
    if (!mapping) continue;
    const prev = armorMap.get(mapping.loc) ?? locationArmor(0);
    armorMap.set(mapping.loc, { ...prev, [mapping.face]: value });
  }
  entity.armorValues.set(armorMap);

  // ── Quirks ──
  entity.quirks.set(header.quirks);
  entity.weaponQuirks.set(header.weaponQuirks);

  // ── Critical slots → equipment with placements ──
  const isQuad = entity instanceof QuadMekEntity;
  const locationMap = isQuad ? QUAD_LOCATION_MAP : BIPED_LOCATION_MAP;
  const mountedEquipment: EntityMountedEquipment[] = [];

  // Superheavy meks halve equipment crit slots (rounded up)
  const isSH = entity.isSuperHeavy();

  // Track multi-crit equipment: key "equipName@locCode" → mountId
  const multiCritMap = new Map<string, string>();

  // Track armored system slots: "LOC:INDEX" keys
  const armoredSystemSlots = new Set<string>();

  for (const [locHeader, slotLines] of header.locationSlots) {
    const locCode = locationMap[locHeader];
    if (!locCode) continue;

    for (let slotIdx = 0; slotIdx < slotLines.length; slotIdx++) {
      const raw = slotLines[slotIdx];
      if (raw === '-Empty-') continue;

      const parsed = parseCritSlotLine(raw);

      // System slots are skipped - they're derived from configuration,
      // but we still capture the ARMORED flag for round-trip fidelity.
      if (SYSTEM_NAMES[parsed.name] || isEngineSlot(parsed.name)) {
        if (parsed.armored) armoredSystemSlots.add(`${locCode}:${slotIdx}`);
        continue;
      }

      // Equipment slot - find existing multi-crit mount or create new one
      const dedupKey = `${parsed.name}@${locCode}`;
      const existingId = parsed.isSplit ? undefined : multiCritMap.get(dedupKey);

      let addedToExisting = false;
      if (existingId) {
        const mount = mountedEquipment.find(m => m.mountId === existingId);
        if (mount) {
          const baseCrits = mount.equipment?.critSlots ?? Infinity;
          const expectedCrits = isSH ? Math.ceil(baseCrits / 2) : baseCrits;
          const lastPlacement = mount.placements?.[mount.placements.length - 1];
          const isConsecutive = lastPlacement?.location === locCode && lastPlacement.slotIndex === slotIdx - 1;
          if ((mount.criticalSlots ?? 0) < expectedCrits && isConsecutive) {
            mount.placements = [...(mount.placements ?? []), { location: locCode, slotIndex: slotIdx }];
            mount.criticalSlots = (mount.criticalSlots ?? 1) + 1;
            addedToExisting = true;
          }
        }
      }

      // Cross-location split: weapons with 8+ crit slots may be split between
      // two adjacent locations (e.g. AC/20: 8 crits in LA + 2 in LT).
      // Only applies to weapons - spreadable misc equipment (TSM, Stealth,
      // Partial Wing, etc.) gets separate mounts per location.
      if (!addedToExisting) {
        const incomplete = mountedEquipment.find(m => {
          if (m.equipmentId !== parsed.name) return false;
          if (!(m.equipment instanceof WeaponEquipment) || !m.equipment.canSplit()) return false;
          const baseCrits = m.equipment.critSlots;
          const effectiveCrits = isSH ? Math.ceil(baseCrits / 2) : baseCrits;
          return (m.criticalSlots ?? 0) < effectiveCrits
            && m.location !== locCode
            && areLocationsAdjacent(m.location, locCode);
        });
        if (incomplete) {
          incomplete.placements = [...(incomplete.placements ?? []), { location: locCode, slotIndex: slotIdx }];
          incomplete.criticalSlots = (incomplete.criticalSlots ?? 1) + 1;
          incomplete.isSplit = true;
          // Primary location is the more restrictive one (torso > arm)
          incomplete.location = getSplitPrimaryLocation(incomplete.location, locCode);
          // Update multiCritMap so further crits in the new primary location
          // can find this mount (e.g. AC/20 split RT+CT: after merging the
          // first CT crit the location becomes CT, subsequent CT crits must
          // still de-duplicate to the same mount).
          multiCritMap.set(`${incomplete.equipmentId}@${incomplete.location}`, incomplete.mountId);
          addedToExisting = true;
        }
      }

      if (!addedToExisting) {
        // New mount
        const mountId = generateMountId();
        const resolved = ctx.resolveEquipment(parsed.name, locCode);

        const mount: EntityMountedEquipment = {
          mountId,
          equipmentId: parsed.name,
          equipment: resolved ?? undefined,
          location: locCode,
          placements: [{ location: locCode, slotIndex: slotIdx }],
          criticalSlots: 1,
          rearMounted: parsed.rearMounted,
          turretMounted: parsed.turretMounted,
          omniPodMounted: parsed.omniPod,
          armored: parsed.armored,
          isSplit: parsed.isSplit || undefined,
          facing: parsed.facing,
          size: parsed.variableSize,
          secondEquipmentId: parsed.secondEquipmentName,
          secondEquipment: parsed.secondEquipmentName
            ? ctx.resolveEquipment(parsed.secondEquipmentName, locCode) ?? undefined
            : undefined,
        };

        mountedEquipment.push(mount);
        multiCritMap.set(dedupKey, mountId);
      }
    }
  }

  entity.equipment.set(mountedEquipment);
  if (armoredSystemSlots.size > 0) entity.armoredSystemSlots.set(armoredSystemSlots);

  // ── Nocrit equipment ──
  for (const nocrit of header.nocritEquipment) {
    const resolved = ctx.resolveEquipment(nocrit.name, 'nocrit');
    entity.addEquipment({
      mountId: generateMountId(),
      equipmentId: nocrit.name,
      equipment: resolved ?? undefined,
      location: nocrit.location,
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
  }

  // ── Actuators (biped / tripod) ──
  if (entity instanceof MekWithArmsEntity) {
    // Determine actuator presence from the raw MTF slot data
    const laSlots = header.locationSlots.get('Left Arm:') ?? [];
    const raSlots = header.locationSlots.get('Right Arm:') ?? [];
    entity.hasLowerArmActuator.set({
      left: laSlots.some(s => s.startsWith('Lower Arm Actuator')),
      right: raSlots.some(s => s.startsWith('Lower Arm Actuator')),
    });
    entity.hasHandActuator.set({
      left: laSlots.some(s => s.startsWith('Hand Actuator')),
      right: raSlots.some(s => s.startsWith('Hand Actuator')),
    });
  }

  // ── Fluff & BV ──
  entity.fluff.set(header.fluff);
  if (header.manualBV > 0) entity.manualBV.set(header.manualBV);
  if (header.generator) entity.generator = header.generator;

  // ── LAM / QuadVee specific fields ──
  if (header.lamType && entity instanceof LamEntity) {
    entity.lamType.set(header.lamType);
  }
  if (header.motiveType !== 'None' && entity instanceof QuadVeeEntity) {
    entity.motiveType.set(header.motiveType);
  }

  return entity;
}

// ============================================================================
// Header parsing (internal)
// ============================================================================

interface MtfHeader {
  chassis: string;
  model: string;
  mulId: number;
  config: string;
  techBase: EntityTechBase;
  techBaseRaw: string;
  era: number;
  source: string;
  rulesLevel: number;
  role: string;
  isOmni: boolean;
  mass: number;
  engine: string;
  structure: string;
  myomer: string;
  gyro: string;
  cockpit: string;
  ejection: string;
  heatSinkKit: string;
  heatSinks: string;
  baseChassisHeatSinks: number;
  walkMP: number;
  jumpMP: number;
  armorType: string;
  armorValues: Map<string, number>;
  patchworkTypes: Map<string, string>;
  quirks: EntityQuirk[];
  weaponQuirks: EntityWeaponQuirk[];
  locationSlots: Map<string, string[]>;
  nocritEquipment: { name: string; location: string }[];
  weaponsList: string[];
  fluff: EntityFluff;
  manualBV: number;
  generator?: string;
  clanName: string;
  lamType: string;
  motiveType: MotiveType;
  rawHeatSinks: string;
}

function parseHeader(lines: string[]): MtfHeader {
  const h: MtfHeader = {
    chassis: '', model: '', mulId: -1, config: 'Biped',
    techBase: 'Inner Sphere', techBaseRaw: 'Inner Sphere',
    era: 3025, source: '', rulesLevel: 2, role: '', isOmni: false,
    mass: 0, engine: '', structure: 'Standard', myomer: 'Standard',
    gyro: '', cockpit: '', ejection: '', heatSinkKit: '',
    heatSinks: '', baseChassisHeatSinks: -1, walkMP: 0, jumpMP: 0,
    armorType: 'Standard', armorValues: new Map(), patchworkTypes: new Map(),
    quirks: [], weaponQuirks: [],
    locationSlots: new Map(), nocritEquipment: [], weaponsList: [],
    fluff: {}, manualBV: 0, generator: undefined,
    clanName: '', lamType: '', motiveType: 'None' as MotiveType, rawHeatSinks: '',
  };

  let currentLocHeader: string | null = null;
  let currentLocSlots: string[] = [];
  let inWeaponsSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') {
      // Blank lines terminate the current location section
      if (currentLocHeader) {
        h.locationSlots.set(currentLocHeader, currentLocSlots);
        currentLocHeader = null;
        currentLocSlots = [];
      }
      if (inWeaponsSection) inWeaponsSection = false;
      continue;
    }

    // Location header
    if (KNOWN_LOC_HEADERS.has(line)) {
      if (currentLocHeader) h.locationSlots.set(currentLocHeader, currentLocSlots);
      currentLocHeader = line;
      currentLocSlots = [];
      continue;
    }

    // Inside location section
    if (currentLocHeader) {
      if (line.includes(':') && !line.startsWith('-') && !line.startsWith('IS ') &&
          !line.startsWith('CL') && !line.startsWith('Clan ') && !isSlotLine(line)) {
        h.locationSlots.set(currentLocHeader, currentLocSlots);
        currentLocHeader = null;
        currentLocSlots = [];
      } else {
        currentLocSlots.push(line);
        continue;
      }
    }

    if (inWeaponsSection) { h.weaponsList.push(line); continue; }

    // Key:value lines
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();

    switch (key) {
      case 'generator': h.generator = value; break;
      case 'chassis':   h.chassis = value; break;
      case 'model':     h.model = value; break;
      case 'mul id':    h.mulId = parseInt(value, 10) || -1; break;
      case 'config':    h.config = value; h.isOmni = value.toLowerCase().includes('omnimek'); break;
      case 'techbase':
        h.techBaseRaw = value;
        if (value.toLowerCase().includes('clan'))       h.techBase = 'Clan';
        else if (value.toLowerCase().includes('mixed')) h.techBase = 'Mixed';
        else                                            h.techBase = 'Inner Sphere';
        break;
      case 'era':                     h.era = parseInt(value, 10) || 3025; break;
      case 'source':                  h.source = value; break;
      case 'rules level':            h.rulesLevel = parseInt(value, 10) || 2; break;
      case 'role':                    h.role = value; break;
      case 'mass':                    h.mass = parseInt(value, 10) || 0; break;
      case 'engine':                  h.engine = value; break;
      case 'structure':               h.structure = value; break;
      case 'myomer':                  h.myomer = value; break;
      case 'gyro':                    h.gyro = value; break;
      case 'cockpit':                 h.cockpit = value; break;
      case 'ejection':                h.ejection = value; break;
      case 'heat sink kit':          h.heatSinkKit = value; break;
      case 'heat sinks':             h.heatSinks = value; h.rawHeatSinks = value; break;
      case 'base chassis heat sinks': h.baseChassisHeatSinks = parseInt(value, 10) || -1; break;
      case 'walk mp':                h.walkMP = parseInt(value, 10) || 0; break;
      case 'jump mp':                h.jumpMP = parseInt(value, 10) || 0; break;
      case 'armor':                   h.armorType = value; break;
      case 'nocrit': {
        // Format: "EquipmentName:LocationAbbr" (e.g. "SmartRoboticControlSystem:None")
        const ncLastColon = value.lastIndexOf(':');
        if (ncLastColon > 0) {
          h.nocritEquipment.push({
            name: value.substring(0, ncLastColon).trim(),
            location: value.substring(ncLastColon + 1).trim(),
          });
        } else {
          h.nocritEquipment.push({ name: value, location: 'None' });
        }
        break;
      }

      // Armor values - handle patchwork format "ArmorType(TechBase):number"
      case 'la armor': case 'ra armor': case 'lt armor': case 'rt armor':
      case 'ct armor': case 'hd armor': case 'll armor': case 'rl armor':
      case 'cl armor': case 'fll armor': case 'frl armor':
      case 'rll armor': case 'rrl armor':
      case 'rtl armor': case 'rtr armor': case 'rtc armor': {
        const lastColon = value.lastIndexOf(':');
        if (lastColon > 0) {
          // Patchwork: "Reactive(Inner Sphere):26"
          const armorTypePart = value.substring(0, lastColon).trim();
          const numPart = value.substring(lastColon + 1).trim();
          const parsed = parseInt(numPart, 10);
          if (!isNaN(parsed)) {
            h.armorValues.set(key, parsed);
            h.patchworkTypes.set(key, armorTypePart);
            break;
          }
        }
        // Non-patchwork: plain number
        h.armorValues.set(key, parseInt(value, 10) || 0);
        break;
      }

      // Quirks
      case 'quirk':       h.quirks.push({ name: value }); break;
      case 'weaponquirk': {
        const parts = value.split(':');
        if (parts.length >= 4) {
          h.weaponQuirks.push({
            name: parts[0], location: parts[1],
            slot: parseInt(parts[2], 10), weaponName: parts[3],
          });
        }
        break;
      }

      // Fluff
      case 'overview':      h.fluff.overview = value; break;
      case 'capabilities':  h.fluff.capabilities = value; break;
      case 'deployment':    h.fluff.deployment = value; break;
      case 'history':       h.fluff.history = value; break;
      case 'manufacturer':  h.fluff.manufacturer = value; break;
      case 'primaryfactory': h.fluff.primaryFactory = value; break;
      case 'notes':         h.fluff.notes = value; break;
      case 'systemmanufacturer': {
        const i = value.indexOf(':');
        if (i > 0) {
          if (!h.fluff.systemManufacturers) h.fluff.systemManufacturers = {};
          const rawKey = value.substring(0, i);
          h.fluff.systemManufacturers[normalizeSystemManufacturerKey(rawKey) ?? rawKey] = value.substring(i + 1);
        }
        break;
      }
      case 'systemmode': {
        const i = value.indexOf(':');
        if (i > 0) {
          if (!h.fluff.systemModels) h.fluff.systemModels = {};
          const rawKey = value.substring(0, i);
          h.fluff.systemModels[normalizeSystemManufacturerKey(rawKey) ?? rawKey] = value.substring(i + 1);
        }
        break;
      }
      case 'bv':      h.manualBV = parseInt(value, 10) || 0; break;
      case 'weapons':  inWeaponsSection = true; break;
      case 'clanname': h.clanName = value; break;
      case 'lam':      h.lamType = value; break;
      case 'motive':   h.motiveType = parseMotiveType(value); break;
      default: break;
    }
  }

  if (currentLocHeader) h.locationSlots.set(currentLocHeader, currentLocSlots);
  return h;
}

// ============================================================================
// Crit slot line parsing
// ============================================================================

interface ParsedCritLine {
  name: string;
  omniPod: boolean;
  armored: boolean;
  rearMounted: boolean;
  turretMounted: boolean;
  isSplit: boolean;
  facing?: number;
  variableSize?: number;
  secondEquipmentName?: string;
}

function parseCritSlotLine(raw: string): ParsedCritLine {
  let name = raw;
  let omniPod = false, armored = false, rearMounted = false;
  let turretMounted = false, isSplit = false;
  let facing: number | undefined;
  let variableSize: number | undefined;
  let secondEquipmentName: string | undefined;

  // Parenthesised suffixes
  const suffixRe = /\s*\((omnipod|armored|r|t|split|fl|fr|rl|rr)\)/gi;
  let match;
  while ((match = suffixRe.exec(name)) !== null) {
    switch (match[1].toLowerCase()) {
      case 'omnipod': omniPod = true; break;
      case 'armored': armored = true; break;
      case 'r':       rearMounted = true; break;
      case 't':       turretMounted = true; break;
      case 'split':   isSplit = true; break;
      case 'fl':      facing = 0; break;
      case 'fr':      facing = 1; break;
      case 'rl':      facing = 4; break;
      case 'rr':      facing = 5; break;
    }
  }
  name = name.replace(suffixRe, '').trim();

  // Variable size :SIZE:N
  const sizeMatch = name.match(/:SIZE:([0-9.]+)$/);
  if (sizeMatch) {
    variableSize = parseFloat(sizeMatch[1]);
    name = name.substring(0, name.indexOf(':SIZE:'));
  }

  // Combined slot name1|name2
  if (name.includes('|')) {
    const parts = name.split('|');
    name = parts[0];
    secondEquipmentName = parts[1];
  }

  return { name, omniPod, armored, rearMounted, turretMounted, isSplit, facing, variableSize, secondEquipmentName };
}

function isEngineSlot(name: string): boolean {
  return ENGINE_SLOT_NAMES.some(e => name.startsWith(e)) || name === 'Engine';
}

// ============================================================================
// Helpers
// ============================================================================

const KNOWN_LOC_HEADERS = new Set([
  'Left Arm:', 'Right Arm:', 'Left Torso:', 'Right Torso:', 'Center Torso:',
  'Head:', 'Left Leg:', 'Right Leg:', 'Center Leg:',
  'Front Left Leg:', 'Front Right Leg:', 'Rear Left Leg:', 'Rear Right Leg:',
]);

function isSlotLine(line: string): boolean {
  if (line === '-Empty-') return true;
  if (SYSTEM_NAMES[line]) return true;
  if (ENGINE_SLOT_NAMES.some(e => line.startsWith(e))) return true;
  return true; // inside a location section, treat everything as a slot line
}

function createMekEntity(config: string): MekEntity {
  const lower = config.toLowerCase();
  if (lower.includes('lam'))     return new LamEntity();
  if (lower.includes('quadvee')) return new QuadVeeEntity();
  if (lower.includes('quad'))    return new QuadMekEntity();
  if (lower.includes('tripod'))  return new TripodMekEntity();
  return new BipedMekEntity();
}

function parseHeatSinkLine(hsLine: string): { count: number; type: HeatSinkType; typeLabel: string } {
  const parts = hsLine.split(/\s+/);
  const parsed = parseInt(parts[0], 10);
  const count = Number.isNaN(parsed) ? 10 : parsed;
  // The type label is everything after the leading count number
  const typeLabel = parts.slice(1).join(' ') || 'Single';
  const lower = hsLine.toLowerCase();
  let type: HeatSinkType = 'Single';
  if (lower.includes('double'))  type = 'Double';
  else if (lower.includes('compact')) type = 'Compact';
  else if (lower.includes('laser'))   type = 'Laser';
  return { count, type, typeLabel };
}

function cleanStructureType(raw: string): StructureType {
  const displayName = raw.replace(/^IS\s+/i, '').replace(/^Clan\s+/i, '').trim() || 'Standard';
  return parseStructureType(displayName);
}

/**
 * For split weapons (spanning two adjacent locations), determine which
 * location is the primary one.  Per TechManual rules, the weapon receives
 * the more restrictive firing arc - that's always the torso side.
 * LT > LA, RT > RA, CT > LT/RT.
 */
const TORSO_LOCATIONS = new Set(['CT', 'LT', 'RT']);

/** Adjacent location pairs for split weapons (not including legs). */
const ADJACENT_LOCATIONS = new Map<string, Set<string>>([
  ['LA', new Set(['LT'])],
  ['LT', new Set(['LA', 'CT'])],
  ['RA', new Set(['RT'])],
  ['RT', new Set(['RA', 'CT'])],
  ['CT', new Set(['LT', 'RT'])],
]);

function areLocationsAdjacent(a: string, b: string): boolean {
  return ADJACENT_LOCATIONS.get(a)?.has(b) ?? false;
}

function getSplitPrimaryLocation(locA: string, locB: string): string {
  // Prefer the torso location as primary
  if (TORSO_LOCATIONS.has(locB) && !TORSO_LOCATIONS.has(locA)) return locB;
  if (TORSO_LOCATIONS.has(locA) && !TORSO_LOCATIONS.has(locB)) return locA;
  // Both torsos (CT↔LT or CT↔RT) - CT is more restrictive
  if (locA === 'CT') return locA;
  if (locB === 'CT') return locB;
  // Fallback: keep first
  return locA;
}
