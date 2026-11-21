// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { normalizeMulId } from '../utils/mul-id';
import { parseForceGeneratorAvailability } from '../types/force-generator-availability';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import { MekEntity, MekWithArmsEntity } from '../entities/mek/mek-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import {
  MountedArmor,
  MountedEngine,
  MountedStructure,
  STANDARD_STRUCTURE_EQUIPMENT,
  getStructureByName,
} from '../components';
import { ArmorEquipment, MiscEquipment } from '../../equipment.model';
import {
  ArmorType,
  EntityFluff,
  EntityMountedEquipment,
  EntityQuirk,
  EntityTechBase,
  EntityWeaponQuirk,
  FactionCode,
  LocationArmor,
  MekLocation,
  MekSystemType,
  MotiveType,
  MountId,
  factionFromAbbr,
  areMekSplitLocationsAdjacent,
  getMekSplitPrimaryLocation,
  locationArmor,
  requireArmorEquipment,
} from '../types';
import { applyMtfFluffField, isMtfLocationHeader } from './entity-fluff-parser';
import { EquipmentRegistry } from '../../equipment-lookup';
import { isTargetingComputerEquipment } from '../utils/targeting-computer';
import { ParseContext } from './parse-context';
import {
  decodeMtfArmor,
  decodeMtfCockpitType,
  decodeMtfEngine,
  decodeMtfFullHeadEjectionSystem,
  decodeMtfGyroType,
  decodeMtfHeatSinks,
  decodeMtfRiscHeatSinkOverrideKit,
  decodeMtfStructure,
  resolveMtfArmorEquipment,
  mtfCriticalSectionOrder,
  mtfListedWeapons,
  splitMtfMountTag,
} from './mtf-codec';
import { decodeMotiveType } from './motive-type-codec';
import { installedMaterialSlotName } from './material-slot-name';
import { asUnitUuid } from '../../../services/unit-catalog/unit-catalog.types';
import { weaponQuirkAddress } from '../utils/weapon-quirks';

// ============================================================================
// Location normalization - raw MTF strings → canonical location IDs
// ============================================================================

const BIPED_LOCATION_MAP: Record<string, MekLocation> = {
  'Left Arm:': 'LA',
  'Right Arm:': 'RA',
  'Left Torso:': 'LT',
  'Right Torso:': 'RT',
  'Center Torso:': 'CT',
  'Head:': 'HD',
  'Left Leg:': 'LL',
  'Right Leg:': 'RL',
  'Center Leg:': 'CL',
};

const QUAD_LOCATION_MAP: Record<string, MekLocation> = {
  'Front Left Leg:': 'FLL',
  'Front Right Leg:': 'FRL',
  'Left Torso:': 'LT',
  'Right Torso:': 'RT',
  'Center Torso:': 'CT',
  'Head:': 'HD',
  'Rear Left Leg:': 'RLL',
  'Rear Right Leg:': 'RRL',
};

const STRUCTURE_LOCATION_MAP: Record<string, MekLocation> = {
  'la structure': 'LA',
  'fll structure': 'FLL',
  'ra structure': 'RA',
  'frl structure': 'FRL',
  'lt structure': 'LT',
  'rt structure': 'RT',
  'ct structure': 'CT',
  'hd structure': 'HD',
  'll structure': 'LL',
  'rll structure': 'RLL',
  'rl structure': 'RL',
  'rrl structure': 'RRL',
  'cl structure': 'CL',
};

/** Raw MTF-only FrankenMek location fields collected before entity construction. */
interface MtfFrankenMekLocationData {
  tonnage?: number;
  structureName?: string;
  donor?: string;
  donorType?: string;
}

/**
 * Armor label → { canonical location, face }.
 * This is the single ingress normalization point - the rest of the code
 * uses canonical IDs and ArmorFace only.
 */
const ARMOR_LABEL_MAP: Record<string, { loc: string; face: 'front' | 'rear' }> = {
  'la armor': { loc: 'LA', face: 'front' },
  'ra armor': { loc: 'RA', face: 'front' },
  'lt armor': { loc: 'LT', face: 'front' },
  'rt armor': { loc: 'RT', face: 'front' },
  'ct armor': { loc: 'CT', face: 'front' },
  'hd armor': { loc: 'HD', face: 'front' },
  'll armor': { loc: 'LL', face: 'front' },
  'rl armor': { loc: 'RL', face: 'front' },
  'cl armor': { loc: 'CL', face: 'front' },
  'fll armor': { loc: 'FLL', face: 'front' },
  'frl armor': { loc: 'FRL', face: 'front' },
  'rll armor': { loc: 'RLL', face: 'front' },
  'rrl armor': { loc: 'RRL', face: 'front' },
  // Rear armor
  'rtl armor': { loc: 'LT', face: 'rear' },
  'rtr armor': { loc: 'RT', face: 'rear' },
  'rtc armor': { loc: 'CT', face: 'rear' },
};

// ============================================================================
// Known system slot names
// ============================================================================

const SYSTEM_NAMES: Record<string, MekSystemType> = {
  Shoulder: 'Shoulder',
  'Upper Arm Actuator': 'Upper Arm Actuator',
  'Lower Arm Actuator': 'Lower Arm Actuator',
  'Hand Actuator': 'Hand Actuator',
  Hip: 'Hip',
  'Upper Leg Actuator': 'Upper Leg Actuator',
  'Lower Leg Actuator': 'Lower Leg Actuator',
  'Foot Actuator': 'Foot Actuator',
  'Life Support': 'Life Support',
  Sensors: 'Sensors',
  Cockpit: 'Cockpit',
  Gyro: 'Gyro',
  'Landing Gear': 'Landing Gear',
  Avionics: 'Avionics',
  'Conversion Gear': 'Conversion Gear',
};

const ENGINE_SLOT_NAMES = [
  'Fusion Engine',
  'XL Engine',
  'XXL Engine',
  'Light Engine',
  'Compact Engine',
  'No Engine',
  // Large engine variants (rating > 400)
  'Large Fusion Engine',
  'Large XL Engine',
  'Large XXL Engine',
  'Large Light Engine',
  'Large Compact Engine',
  // Full MTF names (robustness - some files may use the full label)
  'XL Fusion Engine',
  'XXL Fusion Engine',
  'Light Fusion Engine',
  'Compact Fusion Engine',
  'Large XL Fusion Engine',
  'Large XXL Fusion Engine',
  'Large Light Fusion Engine',
  'Large Compact Fusion Engine',
];

// ============================================================================
// Public API
// ============================================================================

export const MTF_SOURCE_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxLines: 100_000,
  maxLineLength: 2 * 1024 * 1024,
  maxEquipmentEntries: 4_096,
});

export class MtfSourceLimitError extends Error {
  readonly code = 'NATIVE_SOURCE_LIMIT' as const;

  constructor(
    readonly limit: keyof typeof MTF_SOURCE_LIMITS,
    actual: number,
    maximum: number,
  ) {
    super(`MTF ${limit} exceeded: ${actual} > ${maximum}`);
    this.name = 'MtfSourceLimitError';
  }
}

/** Bounded syntax decode shared by mutable diagnostics and immutable publication. */
function decodeMtfSource(content: string, ctx: ParseContext): DecodedMtfSource {
  const byteLength = new TextEncoder().encode(content).byteLength;
  assertMtfLimit('maxBytes', byteLength);
  const lines = content.split(/\r\n|\n|\r/u);
  assertMtfLimit('maxLines', lines.length);
  for (const line of lines) assertMtfLimit('maxLineLength', line.length);
  const header = parseHeader(lines, ctx);
  const equipmentEntries =
    header.nocritEquipment.length +
    [...header.locationSlots.values()].reduce((total, slots) => total + slots.length, 0);
  assertMtfLimit('maxEquipmentEntries', equipmentEntries);
  return header;
}

/**
 * Parse an MTF file into a MekEntity.
 *
 * Equipment mounts are the single canonical model.  Crit-slot positions are
 * stored as `placements` on each mount - the entity's `criticalSlotGrid`
 * computed derives the full grid from these placements + system template.
 */
export function parseMtf(content: string, ctx: ParseContext): MekEntity {
  const header = decodeMtfSource(content, ctx);
  const entity = createMekEntity(header.config, ctx.equipmentRegistry);

  // ── Identity & tech ──
  if (header.uuid) entity.uuid.set(asUnitUuid(header.uuid));
  if (header.refitFromUUID) entity.refitFromUUID.set(asUnitUuid(header.refitFromUUID));
  entity.chassis.set(header.chassis);
  entity.model.set(header.model);
  entity.mulId.set(header.mulId);
  entity.year.set(header.era);
  entity.originalBuildYear.set(header.originalEra === header.era ? -1 : header.originalEra);
  entity.source.set(header.source.map((source) => ctx.resolveSourcebook(source)));
  entity.published.set(header.published.map((source) => ctx.resolveSourcebook(source)));
  entity.rulesLevel.set(header.rulesLevel);
  entity.role.set(header.role);
  entity.forceGeneratorAvailability.set(
    parseForceGeneratorAvailability(header.availability, (message) => ctx.warn('availability', message)),
  );
  entity.missionRoles.set(header.missionRoles);
  entity.omni.set(header.isOmni);
  entity.techBase.set(header.techBase);
  entity.mixedTech.set(header.mixedTech);
  if (header.clanName) entity.clanName.set(header.clanName);

  // ── Physical properties ──
  entity.setTonnage(header.mass);

  const hsInfo = header.heatSinks ? decodeMtfHeatSinks(header.heatSinks) : decodeMtfHeatSinks('10 Single');

  // ── Engine + Heat Sinks → MountedEngine ──
  {
    const engineInfo = header.engine
      ? decodeMtfEngine(header.engine)
      : { rating: 0, type: 'Fusion' as const, techBase: 'IS' as const };

    entity.configureEngine(
      new MountedEngine({
        type: engineInfo.type,
        rating: engineInfo.rating,
        techBase: engineInfo.techBase,
      }),
    );
    const heatSinkEquipment = ctx.resolveEquipment(hsInfo.equipmentId, 'heat sinks');
    if (heatSinkEquipment instanceof MiscEquipment) {
      entity.heatSinkEquipment.set(heatSinkEquipment);
    }
  }

  const structureInfo = decodeMtfStructure(header.structure);
  const structureTechBase = structureInfo.techBase ?? entity.techBase();
  const structure = getStructureByName(structureInfo.name, structureTechBase, ctx.equipmentRegistry);
  if (!structure) {
    ctx.error('Structure', `Invalid structure ${structureTechBase} ${structureInfo.name}`);
  }
  const resolvedGlobalStructure =
    structure ??
    getStructureByName('Standard', entity.techBase(), ctx.equipmentRegistry) ??
    STANDARD_STRUCTURE_EQUIPMENT;
  // MegaMek ignores bare tonnage lines when the global marker is Hybrid.
  const donorLine = (location: MekLocation) => {
    const data = header.frankenMekLocations.get(location);
    return structureInfo.hybrid && !data?.structureName ? undefined : data;
  };
  const defaultStructureTonnage = header.isFrankenMek
    ? Math.max(10, donorLine('CT')?.tonnage ?? Math.ceil(header.mass))
    : header.mass;
  const globalStructure = new MountedStructure({
    tonnage: defaultStructureTonnage,
    structure: resolvedGlobalStructure,
    techBase: structureInfo.techBase ?? resolvedGlobalStructure.techBase,
  });
  entity.setUniformStructure(globalStructure);
  if (header.isFrankenMek) {
    entity.enableHybridStructure();
    for (const rawLocation of entity.locationOrder) {
      const location = rawLocation as MekLocation;
      const parsed = donorLine(location);
      const loadoutTonnage = Math.max(10, parsed?.tonnage ?? defaultStructureTonnage);
      let mounted = globalStructure;
      if (parsed?.structureName) {
        const localInfo = decodeMtfStructure(parsed.structureName);
        const localTechBase = localInfo.techBase ?? entity.techBase();
        const localStructure = getStructureByName(localInfo.name, localTechBase, ctx.equipmentRegistry);
        if (!localStructure) {
          ctx.error(`${location} Structure`, `Invalid structure ${localTechBase} ${localInfo.name}`);
        }
        mounted = new MountedStructure({
          tonnage: loadoutTonnage,
          structure: localStructure ?? resolvedGlobalStructure,
          techBase: localInfo.techBase ?? localStructure?.techBase ?? globalStructure.techBase,
        });
      }
      entity.setStructureAt(location, mounted.withTonnage(loadoutTonnage));
    }
    if (entity.hasHybridStructure()) {
      for (const [location, parsed] of header.frankenMekLocations) {
        if (parsed.donor) {
          entity.setStructureDonor(location, {
            name: parsed.donor,
            unitType: parsed.donorType ?? null,
          });
        }
      }
    }
  }

  if (header.gyro) entity.gyroType.set(decodeMtfGyroType(header.gyro));
  if (header.cockpit) entity.cockpitType.set(decodeMtfCockpitType(header.cockpit));
  entity.hasFullHeadEjectionSystem.set(decodeMtfFullHeadEjectionSystem(header.ejection));
  entity.hasRiscHeatSinkOverrideKit.set(decodeMtfRiscHeatSinkOverrideKit(header.heatSinkKit));

  entity.originalWalkMP.set(header.walkMP);

  // ── Armor (structured { front, rear }) ──
  {
    let armorType: ArmorType = 'STANDARD';
    let armorTechBase: EntityTechBase = 'IS';
    let armorEquipment: ArmorEquipment = requireArmorEquipment('STANDARD', false, ctx.equipmentRegistry);

    if (header.armorType) {
      const armorInfo = decodeMtfArmor(header.armorType);
      // MegaMek's MtfFile gives an undesignated armor line the unit's tech base.
      armorTechBase = armorInfo.techBase ?? entity.techBase();
      if (armorInfo.patchwork) {
        armorType = 'PATCHWORK';
      } else {
        const eq = resolveMtfArmorEquipment(armorInfo.type, armorTechBase === 'Clan', ctx.equipmentRegistry);
        if (eq) {
          armorType = eq.armorType as ArmorType;
          armorEquipment = eq;
        } else {
          ctx.error('Armor', `Invalid armor ${armorTechBase} ${armorInfo.type}`);
        }
      }
    }

    entity.setUniformArmor(
      new MountedArmor({
        techBase: armorTechBase,
        armor: armorEquipment,
      }),
    );

    if (armorType === 'PATCHWORK') entity.enablePatchworkArmor();
    // The native layout marker and effective per-location materials are independent facts.
    if (armorType === 'PATCHWORK' && header.patchworkTypes.size > 0) {
      for (const [label, typeStr] of header.patchworkTypes) {
        const mapping = ARMOR_LABEL_MAP[label.toLowerCase()];
        if (mapping) {
          const isClan = /(?:clan|\(clan\))/i.test(typeStr);
          const locationArmor = resolveMtfArmorEquipment(typeStr, isClan, ctx.equipmentRegistry);
          if (!locationArmor) {
            ctx.error(`${mapping.loc} Armor`, `Invalid armor ${isClan ? 'Clan' : 'IS'} ${typeStr}`);
          }
          entity.setArmorAt(
            mapping.loc,
            new MountedArmor({
              armor: locationArmor ?? requireArmorEquipment('STANDARD', isClan, ctx.equipmentRegistry),
              techBase: isClan ? 'Clan' : 'IS',
            }),
          );
        }
      }
    }
    // Native files often name an IndustrialMek's Heavy Industrial armor "Standard".
    if (entity.isIndustrial()) entity.useChassisStandardArmor();
  }

  const armorMap = new Map<string, LocationArmor>();
  for (const [label, value] of header.armorValues) {
    const mapping = ARMOR_LABEL_MAP[label.toLowerCase()];
    if (!mapping) continue;
    const prev = armorMap.get(mapping.loc) ?? locationArmor(0);
    armorMap.set(mapping.loc, { ...prev, [mapping.face]: value });
  }
  entity.armorValues.set(armorMap);

  // ── Faction ──
  if (header.faction !== 'None') entity.faction.set(header.faction);

  // ── Clan CASE opt-out ──
  if (header.clanCaseOptOut) {
    const optOutLocs = new Set<string>();
    for (const loc of header.clanCaseOptOut.split(',')) {
      const trimmed = loc.trim();
      if (trimmed) optOutLocs.add(trimmed);
    }
    if (optOutLocs.size > 0) entity.setClanCaseOptOutLocations(optOutLocs);
  }

  // ── Quirks ──
  entity.quirks.set(header.quirks);

  // ── Critical slots → equipment with placements ──
  const locationMap = mtfLocationMap(header.config);
  const mountedEquipment: EntityMountedEquipment[] = [];

  // Track multi-crit equipment: key "equipName@locCode" → mountId
  const multiCritMap = new Map<string, string>();

  // Track armored system slots: "LOC:INDEX" keys
  const armoredSystemSlots = new Set<string>();

  // Tagged rows ("type#N") form their own mounts; untagged rows never join them.
  const taggedMounts = new Map<string, MountId>();
  const taggedIds = new Set<MountId>();
  // Components already warned about rows that disagree on armor.
  const partlyArmored = new Set<MountId>();
  const typeKey = (name: string) => ctx.equipmentRegistry.findForTechBase(name, entity.techBase())?.id ?? name;
  // As in MtfFile, only equipment that splits over critical slots reads tags; other rows load as untagged.
  const readsTag = (name: string) => {
    const equipment = ctx.equipmentRegistry.findForTechBase(name, entity.techBase());
    return equipment?.canSplit() === true && !equipment.isSpreadable;
  };

  // Sections are read in MTF order whatever order the file lists them in, since split weapons claim rows in read order.
  const sectionOrder = mtfCriticalSectionOrder(entity);
  const sections = [...header.locationSlots].map(([locHeader, fileLines]) => [locationMap[locHeader], fileLines] as const)
    .sort(([left], [right]) => sectionOrder.indexOf(left) - sectionOrder.indexOf(right));
  for (const [locCode, fileLines] of sections) {
    if (!locCode) continue;
    const slotLines = mtfLocationRows(entity, locCode, fileLines, armoredSystemSlots);

    for (let slotIdx = 0; slotIdx < slotLines.length; slotIdx++) {
      const raw = slotLines[slotIdx];
      if (raw === '-Empty-') continue;

      const parsedSlots = decodeMtfCriticalSlotLine(raw);
      for (const [memberIndex, listed] of parsedSlots.entries()) {
        // System slots are skipped - they're derived from configuration,
        // but we still capture the ARMORED flag for round-trip fidelity.
        if (decodeMtfSystemSlot(listed.name)) {
          if (listed.armored) armoredSystemSlots.add(`${locCode}:${slotIdx}`);
          continue;
        }
        const parsed = { ...listed, name: installedMaterialSlotName(entity, locCode, listed.name, ctx) };
        if (parsed.malformedTag) {
          ctx.warn('crits', `"${raw}" has an unreadable mount tag "${parsed.malformedTag}"; the row loads without it.`, 'MTF_MOUNT_TAG');
        }

        const tagKey = parsed.tag === undefined || !readsTag(parsed.name) ? undefined : `${typeKey(parsed.name)}#${parsed.tag}`;
        const isTagged = tagKey !== undefined;
        const taggedId = tagKey && taggedMounts.get(tagKey);
        const taggedIndex = taggedId ? mountedEquipment.findIndex((m) => m.mountId === taggedId) : -1;
        if (taggedIndex >= 0) {
          const tagged = mountedEquipment[taggedIndex];
          const primaryLocation = tagged.location === locCode ? locCode : getMekSplitPrimaryLocation(tagged.location, locCode);
          mountedEquipment[taggedIndex] = armorWholeComponent(
            tagged.withAddedPlacement({ location: locCode, slotIndex: slotIdx }, primaryLocation), parsed.armored, ctx, partlyArmored);
          continue;
        }

        // The pair position distinguishes two same-named mounts sharing a
        // superheavy slot while still merging their later critical entries.
        const dedupKey = `${parsed.name}@${locCode}@${memberIndex}`;
        const existingId = parsed.isSplit || isTagged ? undefined : multiCritMap.get(dedupKey);

        let addedToExisting = false;
        if (existingId) {
          const mountIndex = mountedEquipment.findIndex((m) => m.mountId === existingId);
          if (mountIndex >= 0) {
            const mount = mountedEquipment[mountIndex];
            // Resolve expected crit count via entity context
            const criticalSlots = numericCriticalSlotRequirement(mount, entity);
            const lastPlacement = mount.placements?.[mount.placements.length - 1];
            const isConsecutive = lastPlacement?.location === locCode && lastPlacement.slotIndex === slotIdx - 1;
            if (mount.placedCriticalSlotCount < criticalSlots && isConsecutive) {
              mountedEquipment[mountIndex] = armorWholeComponent(mount.withAddedPlacement({ location: locCode, slotIndex: slotIdx }), parsed.armored, ctx, partlyArmored);
              addedToExisting = true;
            }
          }
        }

        // MegaMek loads targeting computers like spreadable equipment even
        // though the equipment definition itself is not spreadable: one mount
        // per targeting-computer type owns every critical across all locations.
        if (!addedToExisting && !isTagged) {
          const targetingComputerIndex = mountedEquipment.findIndex(
            (mount) => mount.equipmentId === parsed.name && isTargetingComputerEquipment(mount.equipment)
              && !taggedIds.has(mount.mountId),
          );
          if (targetingComputerIndex >= 0) {
            const targetingComputer = mountedEquipment[targetingComputerIndex];
            mountedEquipment[targetingComputerIndex] = armorWholeComponent(targetingComputer.withAddedPlacement({
              location: locCode,
              slotIndex: slotIdx,
            }), parsed.armored, ctx, partlyArmored);
            addedToExisting = true;
          }
        }

        // Spreadable equipment: items like Ferro-Fibrous, Endo Steel, and
        // Fuel Cell Power Generator have crits spread across multiple
        // (possibly non-adjacent) locations.  All crits merge into one mount
        // as long as it hasn't reached its expected crit count yet.
        if (!addedToExisting && !isTagged) {
          const existingSpreadableIndex = mountedEquipment.findIndex((m) => {
            if (m.equipmentId !== parsed.name || taggedIds.has(m.mountId)) return false;
            const eq = m.equipment;
            if (!eq?.isSpreadable) return false;
            if (eq.type === 'structure' || eq.type === 'armor') return true;
            const expectedCrits = numericCriticalSlotRequirement(m, entity);
            return m.placedCriticalSlotCount < expectedCrits;
          });
          if (existingSpreadableIndex >= 0) {
            const existingSpreadable = mountedEquipment[existingSpreadableIndex];
            mountedEquipment[existingSpreadableIndex] = armorWholeComponent(existingSpreadable.withAddedPlacement({
              location: locCode,
              slotIndex: slotIdx,
            }), parsed.armored, ctx, partlyArmored);
            addedToExisting = true;
          }
        }

        // Cross-location split: weapons with 8+ crit slots and explicitly
        // splittable miscellaneous equipment may span adjacent locations.
        if (!addedToExisting && !isTagged) {
          const incompleteIndex = mountedEquipment.findIndex((m) => {
            if (m.equipmentId !== parsed.name || taggedIds.has(m.mountId)) return false;
            if (!m.equipment?.canSplit()) return false;
            const criticalSlots = numericCriticalSlotRequirement(m, entity);
            return (
              m.placedCriticalSlotCount < criticalSlots &&
              m.location !== locCode &&
              areMekSplitLocationsAdjacent(m.location, locCode)
            );
          });
          if (incompleteIndex >= 0) {
            const incomplete = mountedEquipment[incompleteIndex];
            // Primary location is the more restrictive one (torso > arm)
            const primaryLocation = getMekSplitPrimaryLocation(incomplete.location, locCode);
            const updated = armorWholeComponent(incomplete.withAddedPlacement({ location: locCode, slotIndex: slotIdx }, primaryLocation), parsed.armored, ctx, partlyArmored);
            mountedEquipment[incompleteIndex] = updated;
            // Update multiCritMap so further crits in the new primary location
            // can find this mount (e.g. AC/20 split RT+CT: after merging the
            // first CT crit the location becomes CT, subsequent CT crits must
            // still de-duplicate to the same mount).
            multiCritMap.set(`${updated.equipmentId}@${updated.location}@${memberIndex}`, updated.mountId);
            addedToExisting = true;
          }
        }

        if (!addedToExisting) {
          // New mount
          const resolved = ctx.resolveEquipment(parsed.name, locCode, entity.techBase());
          // MTF uses `(R)` for both rear-mounted equipment and a rear-facing
          // vehicular grenade launcher. The resolved equipment family is the
          // only unambiguous discriminator used by MegaMek's native grammar.
          const rearMarkerIsVglFacing =
            parsed.rearMounted && parsed.facing === undefined && resolved?.hasFlag('F_VGL') === true;

          const mount = entity.addEquipment({
            equipmentId: parsed.name,
            equipment: resolved ?? undefined,
            allocation: {
              kind: 'location',
              location: locCode,
              placements: [{ location: locCode, slotIndex: slotIdx }],
            },
            rearMounted: rearMarkerIsVglFacing ? false : parsed.rearMounted,
            turretMounted: parsed.turretMounted,
            omniPodMounted: parsed.omniPod,
            armored: parsed.armored,
            facing: rearMarkerIsVglFacing ? 3 : parsed.facing,
            size: parsed.variableSize,
          });

          mountedEquipment.push(mount);
          if (tagKey) {
            taggedMounts.set(tagKey, mount.mountId);
            taggedIds.add(mount.mountId);
          } else {
            multiCritMap.set(dedupKey, mount.mountId);
          }
        }
      }
    }
  }

  // Rows are grouped in MTF section order, but the mounts keep the file order and IDs that reading the sections as listed
  // gives, so saved state still finds its weapon in a file that lists its sections in another order.
  const fileSection = new Map<string, number>([...header.locationSlots.keys()].map((locHeader, index) => [locationMap[locHeader], index]));
  const firstFileRow = (mount: EntityMountedEquipment) => Math.min(...(mount.placements ?? [])
    .map((placement) => (fileSection.get(placement.location) ?? 0) * 100 + placement.slotIndex));
  const createdIds = mountedEquipment.map((mount) => mount.mountId);
  const inFileOrder = mountedEquipment.map((mount, created) => ({ mount, created, row: firstFileRow(mount) }))
    .sort((left, right) => left.row - right.row || left.created - right.created)
    .map(({ mount }, index) => mount.mountId === createdIds[index] ? mount : mount.clone({ mountId: createdIds[index] }));
  mountedEquipment.splice(0, mountedEquipment.length, ...inFileOrder);

  entity.setEquipment(mountedEquipment);
  // The file's structure rows are its donor design's distribution (CO p. 213).
  entity.retainLoadedStructureRows();
  // MtfFile finds a weapon quirk's weapon in whatever mount fills its slot once the rows are packed, which may be any of
  // the weapon's slots; address the quirk by that weapon.
  const locationByLabel = new Map(entity.locationOrder.map(code => [entity.componentLocationLabel(code), code]));
  entity.weaponQuirks.set(header.weaponQuirks.map(entry => {
    const location = locationByLabel.get(entry.location);
    const mount = location && mountedEquipment.find(candidate =>
      candidate.placements?.some(placement => placement.location === location && placement.slotIndex === entry.slot));
    return mount ? { ...entry, ...weaponQuirkAddress(entity, mount), weaponName: entry.weaponName } : entry;
  }));
  if (armoredSystemSlots.size > 0) entity.armoredSystemSlots.set(armoredSystemSlots);

  // ── Nocrit equipment ──
  for (const nocrit of header.nocritEquipment) {
    const resolved = ctx.resolveEquipment(nocrit.name, 'nocrit');
    entity.addEquipment({
      equipmentId: nocrit.name,
      equipment: resolved ?? undefined,
      allocation: { kind: 'location', location: nocrit.location },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
  }
  // Rows are read at the chassis slot scale, so a donor of another class can merge or split its weapons.
  const inferredWeapons = mtfListedWeapons(entity).length;
  if (header.listedWeapons !== undefined && header.listedWeapons !== inferredWeapons) {
    ctx.warn('weapons', `The Weapons list names ${header.listedWeapons} weapons, but the critical slots hold ${inferredWeapons}.`,
      'MTF_WEAPON_COUNT_MISMATCH');
  }
  entity.initializeParsedHeatSinkMounts(hsInfo.count, header.baseChassisHeatSinks);

  // ── Actuators (biped / tripod) ──
  if (entity instanceof MekWithArmsEntity) {
    // Determine actuator presence from the raw MTF slot data
    const laSlots = header.locationSlots.get('Left Arm:') ?? [];
    const raSlots = header.locationSlots.get('Right Arm:') ?? [];
    entity.hasLowerArmActuator.set({
      left: laSlots.some((s) => s.startsWith('Lower Arm Actuator')),
      right: raSlots.some((s) => s.startsWith('Lower Arm Actuator')),
    });
    entity.hasHandActuator.set({
      left: laSlots.some((s) => s.startsWith('Hand Actuator')),
      right: raSlots.some((s) => s.startsWith('Hand Actuator')),
    });
  }

  // ── Fluff & BV ──
  entity.fluff.set(header.fluff);
  entity.fluffImageEncoded.set(header.fluffImage);
  entity.iconEncoded.set(header.icon);
  entity.iconPath.set(header.iconPath);
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

function assertMtfLimit(limit: keyof typeof MTF_SOURCE_LIMITS, actual: number): void {
  const maximum = MTF_SOURCE_LIMITS[limit];
  if (actual > maximum) throw new MtfSourceLimitError(limit, actual, maximum);
}

// ============================================================================
// Header parsing (internal)
// ============================================================================

interface DecodedMtfSource {
  uuid: string;
  refitFromUUID: string;
  chassis: string;
  model: string;
  mulId: number | null;
  config: string;
  techBase: EntityTechBase;
  mixedTech: boolean;
  techBaseRaw: string;
  era: number;
  originalEra: number;
  source: string[];
  published: string[];
  rulesLevel: number;
  role: string;
  availability: string[];
  missionRoles: string;
  isOmni: boolean;
  isFrankenMek: boolean;
  mass: number;
  engine: string;
  structure: string;
  gyro: string;
  cockpit: string;
  ejection: string;
  heatSinkKit: string;
  heatSinks: string;
  baseChassisHeatSinks: number;
  walkMP: number;
  jumpMP: number; // unused, we calculate it based on equipment
  armorType: string;
  armorValues: Map<string, number>;
  patchworkTypes: Map<string, string>;
  quirks: EntityQuirk[];
  weaponQuirks: EntityWeaponQuirk[];
  locationSlots: Map<string, string[]>;
  nocritEquipment: { name: string; location: string }[];
  weaponsList: string[];
  /** The `Weapons:` count, when the file states one. */
  listedWeapons?: number;
  faction: FactionCode;
  clanCaseOptOut: string;
  fluff: EntityFluff;
  fluffImage: string;
  icon: string;
  iconPath: string;
  manualBV: number;
  generator?: string;
  clanName: string;
  lamType: string;
  motiveType: MotiveType;
  rawHeatSinks: string;
  frankenMekLocations: Map<MekLocation, MtfFrankenMekLocationData>;
}

function parseHeader(lines: string[], ctx: ParseContext): DecodedMtfSource {
  const h: DecodedMtfSource = {
    uuid: '',
    refitFromUUID: '',
    chassis: '',
    model: '',
    mulId: null,
    config: 'Biped',
    techBase: 'IS',
    mixedTech: false,
    techBaseRaw: 'IS',
    era: 3025,
    originalEra: -1,
    source: [],
    published: [],
    rulesLevel: 2,
    role: '',
    availability: [],
    missionRoles: '',
    isOmni: false,
    isFrankenMek: false,
    mass: 0,
    engine: '',
    structure: 'Standard',
    gyro: '',
    cockpit: '',
    ejection: '',
    heatSinkKit: '',
    heatSinks: '',
    baseChassisHeatSinks: -1,
    walkMP: 0,
    jumpMP: 0,
    armorType: 'Standard',
    armorValues: new Map(),
    patchworkTypes: new Map(),
    quirks: [],
    weaponQuirks: [],
    locationSlots: new Map(),
    nocritEquipment: [],
    weaponsList: [],
    faction: 'None',
    clanCaseOptOut: '',
    fluff: {},
    fluffImage: '',
    icon: '',
    iconPath: '',
    manualBV: 0,
    generator: undefined,
    clanName: '',
    lamType: '',
    motiveType: 'None' as MotiveType,
    rawHeatSinks: '',
    frankenMekLocations: new Map(),
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
    if (isMtfLocationHeader(line)) {
      if (currentLocHeader) h.locationSlots.set(currentLocHeader, currentLocSlots);
      currentLocHeader = line;
      currentLocSlots = [];
      continue;
    }

    // Inside location section
    if (currentLocHeader) {
      const location = (currentLocHeader in QUAD_LOCATION_MAP ? QUAD_LOCATION_MAP : BIPED_LOCATION_MAP)[
        currentLocHeader
      ];
      const lowerLine = line.toLowerCase();
      if (lowerLine.startsWith('donor:')) {
        updateFrankenMekLocation(h.frankenMekLocations, location, {
          donor: line.substring(line.indexOf(':') + 1).trim(),
        });
        continue;
      }
      if (lowerLine.startsWith('donor type:')) {
        updateFrankenMekLocation(h.frankenMekLocations, location, {
          donorType: line.substring(line.indexOf(':') + 1).trim(),
        });
        continue;
      }
      currentLocSlots.push(line);
      continue;
    }

    if (inWeaponsSection) {
      h.weaponsList.push(line);
      continue;
    }

    // Key:value lines
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();

    switch (key) {
      case 'uuid':
        h.uuid = value;
        break;
      case 'refitfromuuid':
        h.refitFromUUID = value;
        break;
      case 'generator':
        h.generator = value;
        break;
      case 'version':
        // MegaMek reads and ignores the version line (MtfFile.MTF_VERSION).
        break;
      case 'chassis':
        h.chassis = value;
        break;
      case 'model':
        h.model = value;
        break;
      case 'mul id':
        h.mulId = normalizeMulId(value);
        break;
      case 'config': {
        const lowerValue = value.toLowerCase();
        h.config = value;
        h.isOmni = lowerValue.includes('omnimek');
        h.isFrankenMek = lowerValue.includes('frankenmek');
        break;
      }
      case 'techbase': {
        const lowerValue = value.toLowerCase();
        h.techBaseRaw = value;
        h.mixedTech = lowerValue.startsWith('mixed');
        if (lowerValue.includes('clan')) h.techBase = 'Clan';
        else h.techBase = 'IS';
        break;
      }
      case 'era':
        h.era = parseMtfInteger(value, 'era', ctx, 3025);
        break;
      case 'original era':
        h.originalEra = parseMtfInteger(value, 'original era', ctx, -1);
        break;
      case 'source':
        h.source = parseMetadataList(value);
        break;
      case 'published':
        h.published = parseMetadataList(value);
        break;
      case 'rules level':
        h.rulesLevel = parseMtfInteger(value, 'rules level', ctx, 2);
        break;
      case 'role':
        h.role = value;
        break;
      case 'availability':
        h.availability.push(value);
        break;
      case 'missionroles':
        h.missionRoles = value;
        break;
      case 'mass':
        h.mass = parseMtfInteger(value, 'mass', ctx, 0);
        break;
      case 'engine':
        h.engine = value;
        break;
      case 'structure':
        h.structure = value;
        break;
      case 'myomer':
        // Derived from the installed myomer system, as MegaMek writes it (Mek.getMtf).
        break;
      case 'gyro':
        h.gyro = value;
        break;
      case 'cockpit':
        h.cockpit = value;
        break;
      case 'ejection':
        h.ejection = value;
        break;
      case 'heat sink kit':
        h.heatSinkKit = value;
        break;
      case 'heat sinks':
        h.heatSinks = value;
        h.rawHeatSinks = value;
        break;
      case 'base chassis heat sinks':
        h.baseChassisHeatSinks = parseMtfInteger(value, 'base chassis heat sinks', ctx, -1);
        break;
      case 'walk mp':
        h.walkMP = parseMtfInteger(value, 'walk mp', ctx, 0);
        break;
      case 'jump mp':
        h.jumpMP = parseMtfInteger(value, 'jump mp', ctx, 0);
        break;
      case 'armor':
        h.armorType = value;
        break;
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
      case 'la armor':
      case 'ra armor':
      case 'lt armor':
      case 'rt armor':
      case 'ct armor':
      case 'hd armor':
      case 'll armor':
      case 'rl armor':
      case 'cl armor':
      case 'fll armor':
      case 'frl armor':
      case 'rll armor':
      case 'rrl armor':
      case 'rtl armor':
      case 'rtr armor':
      case 'rtc armor': {
        const lastColon = value.lastIndexOf(':');
        if (lastColon > 0) {
          // Patchwork: "Reactive(Inner Sphere):26"
          const armorTypePart = value.substring(0, lastColon).trim();
          const numPart = value.substring(lastColon + 1).trim();
          const parsed = parseMtfInteger(numPart, key, ctx, NaN);
          if (!Number.isNaN(parsed)) {
            h.armorValues.set(key, parsed);
            h.patchworkTypes.set(key, armorTypePart);
            break;
          }
        }
        // Non-patchwork: plain number
        h.armorValues.set(key, parseMtfInteger(value, key, ctx, 0));
        break;
      }

      // Quirks
      case 'quirk': {
        h.quirks.push(ctx.resolveQuirk(value, 'quirk'));
        break;
      }
      case 'weaponquirk': {
        const parts = value.split(':');
        if (parts.length >= 4) {
          const slot = parseMtfInteger(parts[2], 'weaponquirk', ctx, NaN);
          if (Number.isNaN(slot)) break;
          h.weaponQuirks.push({
            name: parts[0],
            location: parts[1],
            slot,
            weaponName: parts[3],
          });
        }
        break;
      }

      case 'bv':
        h.manualBV = parseMtfInteger(value, 'bv', ctx, 0);
        break;
      case 'weapons':
        inWeaponsSection = true;
        if (/^\d+$/u.test(value)) h.listedWeapons = Number(value);
        break;
      case 'clanname':
        h.clanName = value;
        break;
      case 'lam':
        h.lamType = value;
        break;
      case 'motive':
        h.motiveType = decodeMotiveType(value);
        break;
      case 'faction':
        h.faction = factionFromAbbr(value);
        break;
      case 'fluffimage':
        h.fluffImage = value;
        break;
      case 'icon':
        h.icon = value;
        break;
      case 'iconpath':
        h.iconPath = value;
        break;
      case 'clancaseoptedoutlocs':
        h.clanCaseOptOut = value;
        break;
      default: {
        if (applyMtfFluffField(h.fluff, key, value)) break;
        const structureLocation = STRUCTURE_LOCATION_MAP[key];
        if (structureLocation) {
          const lastColon = value.lastIndexOf(':');
          const hasStructureName = lastColon > 0;
          const tonnageText = hasStructureName ? value.substring(lastColon + 1).trim() : value;
          const update: Partial<MtfFrankenMekLocationData> = {};
          if (tonnageText === '') {
            break;
          }
          const tonnage = Number(tonnageText);
          if (
            /^[+-]?\d+$/.test(tonnageText) &&
            Number.isInteger(tonnage) &&
            tonnage >= -2_147_483_648 &&
            tonnage <= 2_147_483_647
          ) {
            update.tonnage = tonnage;
          } else {
            ctx.error(`${structureLocation} structure`, `Invalid structure tonnage "${tonnageText}"`);
          }
          if (hasStructureName) update.structureName = value.substring(0, lastColon).trim();
          updateFrankenMekLocation(h.frankenMekLocations, structureLocation, update);
          break;
        }
        // Re-saving drops a field the parser does not know; say so instead of losing it silently.
        ctx.warn(key, `Unknown field "${key}" is not kept`);
        break;
      }
    }
  }

  if (currentLocHeader) h.locationSlots.set(currentLocHeader, currentLocSlots);
  return h;
}

function parseMtfInteger(value: string, field: string, ctx: ParseContext, fallback: number): number {
  if (!/^[+-]?\d+$/u.test(value)) {
    ctx.error(field, `Invalid integer "${value}"`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < -2_147_483_648 || parsed > 2_147_483_647) {
    ctx.error(field, `Integer out of range "${value}"`);
    return fallback;
  }
  return parsed;
}

function updateFrankenMekLocation(
  locations: Map<MekLocation, MtfFrankenMekLocationData>,
  location: MekLocation,
  update: Partial<MtfFrankenMekLocationData>,
): void {
  locations.set(location, { ...locations.get(location), ...update });
}

// ============================================================================
// Crit slot line parsing
// ============================================================================

interface DecodedMtfCriticalSlot {
  name: string;
  omniPod: boolean;
  armored: boolean;
  rearMounted: boolean;
  turretMounted: boolean;
  isSplit: boolean;
  facing?: number;
  variableSize?: number;
  /** `#N`: every row of this equipment type with the same N belongs to one mount. */
  tag?: number;
  /** A `#` suffix that is not a valid tag; the row loads as if it had none. */
  malformedTag?: string;
}

function decodeMtfCriticalSlotLine(raw: string): DecodedMtfCriticalSlot[] {
  const slots = raw.split('|').map(parseMountedCritSlot);
  const armored = slots.some((slot) => slot.armored);
  const omniPod = slots.some((slot) => slot.omniPod);
  // Superheavy sharing applies to the physical slot.  Both canonical mounts
  // carry that state so cost, BV, and serialization cannot observe a half-slot.
  return slots.map((slot) => ({ ...slot, armored, omniPod }));
}

function parseMountedCritSlot(raw: string): DecodedMtfCriticalSlot {
  // The mount tag follows every modifier: `Autocannon/20 (R)#2`.
  const { text, tag, malformed: malformedTag } = splitMtfMountTag(raw);
  let name = text;
  let omniPod = false,
    armored = false,
    rearMounted = false;
  let turretMounted = false,
    isSplit = false;
  let facing: number | undefined;
  let variableSize: number | undefined;

  // Parenthesised suffixes
  const suffixRe = /\s*\((omnipod|armored|r|t|split|fl|fr|f|rl|rr)\)/gi;
  let match;
  while ((match = suffixRe.exec(name)) !== null) {
    switch (match[1].toLowerCase()) {
      case 'omnipod':
        omniPod = true;
        break;
      case 'armored':
        armored = true;
        break;
      case 'r':
        rearMounted = true;
        break;
      case 't':
        turretMounted = true;
        break;
      case 'split':
        isSplit = true;
        break;
      case 'fl':
        facing = 0;
        break;
      case 'fr':
        facing = 1;
        break;
      case 'f':
        facing = 2;
        break;
      case 'rl':
        facing = 4;
        break;
      case 'rr':
        facing = 5;
        break;
    }
  }
  name = name.replace(suffixRe, '').trim();

  // Variable size :SIZE:N
  const sizeMatch = name.match(/:SIZE:([0-9.]+)$/);
  if (sizeMatch) {
    variableSize = parseFloat(sizeMatch[1]);
    name = name.substring(0, name.indexOf(':SIZE:'));
  }

  return { name, omniPod, armored, rearMounted, turretMounted, isSplit, facing, variableSize, tag, malformedTag };
}

function isEngineSlot(name: string): boolean {
  const lower = name.toLowerCase();
  return ENGINE_SLOT_NAMES.some((e) => lower.startsWith(e.toLowerCase())) || lower === 'engine';
}

/** MtfFile matches system rows whatever their case (`isRelocatedSystemCritEntry`). */
const SYSTEM_NAMES_BY_LOWER_CASE = new Map(Object.entries(SYSTEM_NAMES).map(([name, system]) => [name.toLowerCase(), system]));

function decodeMtfSystemSlot(name: string): MekSystemType | undefined {
  return SYSTEM_NAMES_BY_LOWER_CASE.get(name.toLowerCase()) ?? (isEngineSlot(name) ? 'Engine' : undefined);
}

/** The systems MegaMek's MtfFile places itself, whatever rows the file gives them (`isRelocatedSystemSlot`). */
const PLACED_SYSTEMS: ReadonlySet<MekSystemType> = new Set(['Engine', 'Gyro', 'Cockpit', 'Life Support', 'Sensors']);

/**
 * A location's rows as MegaMek's MtfFile reads them (`remapCritDataAroundSystemSlots`): the engine, gyro, cockpit,
 * sensors and life support take their own slots, and every other row fills the remaining slots in file order, so an
 * empty row between them closes up. An armored row of a placed system armors that system's slots in the location.
 */
function mtfLocationRows(entity: MekEntity, location: MekLocation, lines: readonly string[], armored: Set<string>): string[] {
  const placedSystem = (line: string) => decodeMtfCriticalSlotLine(line)
    .map(member => ({ system: decodeMtfSystemSlot(member.name), armored: member.armored }))
    .find(member => member.system && PLACED_SYSTEMS.has(member.system));
  const systems = entity.getSystemSlotsForLocation(location);
  // MegaMek armors every slot of a placed system in the location when any of its rows is armored.
  const armoredSystems = new Set(lines.flatMap(line => { const member = placedSystem(line); return member?.armored ? [member.system!] : []; }));
  systems.forEach((slot, index) => {
    if (slot.type === 'system' && armoredSystems.has(slot.systemType)) armored.add(`${location}:${index}`);
  });
  const capacity = Math.max(lines.length, entity.criticalSlotCapacity(location));
  const open = Array.from({ length: capacity }, (_, index) => index)
    .filter(index => { const slot = systems[index]; return slot?.type !== 'system' || !PLACED_SYSTEMS.has(slot.systemType); });
  const kept = lines.flatMap((line, index) => line !== '-Empty-' && !placedSystem(line) ? [index] : []);
  if (kept.length > open.length) return [...lines];
  const rows: string[] = Array.from({ length: capacity }, () => '-Empty-');
  kept.forEach((fileRow, index) => { rows[open[index]] = lines[fileRow]; });
  return rows;
}

/**
 * Component armor covers the whole component (TO:AUE p. 95): rows that disagree armor all of it, with one warning per
 * component in `partlyArmored`.
 */
function armorWholeComponent(mount: EntityMountedEquipment, rowArmored: boolean, ctx: ParseContext,
  partlyArmored: Set<MountId>): EntityMountedEquipment {
  if (rowArmored === mount.armored) return mount;
  if (!partlyArmored.has(mount.mountId)) {
    partlyArmored.add(mount.mountId);
    ctx.warn('crits', `Only some critical slots of ${mount.equipment?.name ?? mount.equipmentId} are armored; the whole component is armored.`,
      'MTF_PARTIAL_COMPONENT_ARMOR');
  }
  return mount.armored ? mount : mount.clone({ armored: true });
}

function mtfLocationMap(config: string): Readonly<Record<string, MekLocation>> {
  return config.toLowerCase().includes('quad') ? QUAD_LOCATION_MAP : BIPED_LOCATION_MAP;
}

// ============================================================================
// Helpers
// ============================================================================

function createMekEntity(config: string, equipmentRegistry: EquipmentRegistry): MekEntity {
  const lower = config.toLowerCase();
  if (lower.includes('lam')) return new LamEntity(equipmentRegistry);
  if (lower.includes('quadvee')) return new QuadVeeEntity(equipmentRegistry);
  if (lower.includes('quad')) return new QuadMekEntity(equipmentRegistry);
  if (lower.includes('tripod')) return new TripodMekEntity(equipmentRegistry);
  return new BipedMekEntity(equipmentRegistry);
}

function parseMetadataList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function numericCriticalSlotRequirement(mount: EntityMountedEquipment, entity: MekEntity): number {
  return mount.getNumCriticalSlots(entity) ?? Infinity;
}
