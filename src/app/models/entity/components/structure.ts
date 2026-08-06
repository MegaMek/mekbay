// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { StructureEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { approx, EntityTechBase, EquipmentTechBase, type TechRatingSource } from '../types';
import { TechAdvancement } from '../types/tech';

/**
 * Internal Structure system component.
 *
 * Structures are fundamental structural elements of every Mek. Their canonical
 * definitions come from StructureEquipment records in the equipment database.
 */

// ============================================================================
// Installed structure
// ============================================================================

/** Resolved Standard structure used when no equipment registry is available. */
export const STANDARD_STRUCTURE_EQUIPMENT = new StructureEquipment({
  id: 'Standard',
  name: 'Standard',
  type: 'structure',
  aliases: ['Standard Structure', 'IS Standard Structure', 'Clan Standard Structure'],
  tech: { base: 'All' },
  structure: { typeId: 0 },
});

export interface MountedStructureOptions {
  readonly tonnage: number;
  readonly structure: StructureEquipment;
  /** Technology used for this installation when the equipment supports both bases. */
  readonly techBase?: EquipmentTechBase;
}

/** Complete immutable structure installed at one entity location. */
export class MountedStructure {
  readonly tonnage: number;
  readonly structure: StructureEquipment;
  readonly techBase: EquipmentTechBase;

  constructor(options: MountedStructureOptions) {
    if (!Number.isFinite(options.tonnage) || options.tonnage < 0) {
      throw new Error(`Structure tonnage must be a non-negative finite number, got ${options.tonnage}`);
    }
    this.tonnage = options.tonnage;
    this.structure = options.structure;
    this.techBase = options.techBase ?? options.structure.techBase;
    Object.freeze(this);
  }

  /** Complete effective equality: material and donor/chassis tonnage. */
  equals(other: MountedStructure): boolean {
    return this.tonnage === other.tonnage && this.hasSameMaterialAs(other);
  }

  /** Material-only equality used by formats that encode tonnage separately. */
  hasSameMaterialAs(other: MountedStructure): boolean {
    return this.structure.id === other.structure.id
      && this.techBase === other.techBase;
  }

  withTonnage(tonnage: number): MountedStructure {
    return tonnage === this.tonnage ? this : new MountedStructure({
      tonnage,
      structure: this.structure,
      techBase: this.techBase,
    });
  }
}

// ============================================================================
// Resolution
// ============================================================================

interface StructureVariants {
  readonly IS?: StructureEquipment;
  readonly Clan?: StructureEquipment;
  readonly All?: StructureEquipment;
}

interface StructureIndex {
  readonly byTypeId: ReadonlyMap<number, StructureVariants>;
  readonly byName: ReadonlyMap<string, StructureVariants>;
}

/** Built-in standard structure used when a unit file does not declare another type. */
const STANDARD_STRUCTURE_TECH = {
  techBase: 'All',
  rating: 'D',
  availability: ['C', 'C', 'C', 'C'],
  level: 'Introductory',
  dates: { prototype: approx(2430), production: 2439, common: 2505 },
} as const satisfies TechAdvancement;

const structureIndexes = new WeakMap<EquipmentRegistry, StructureIndex>();

function getStructureIndex(
  equipmentRegistry: EquipmentRegistry,
): StructureIndex {
  const cached = structureIndexes.get(equipmentRegistry);
  if (cached) return cached;

  const byTypeId = new Map<number, StructureVariants>();
  const byName = new Map<string, StructureVariants>();
  for (const equipment of Object.values(equipmentRegistry.equipment)) {
    if (!(equipment instanceof StructureEquipment) || equipment.structureTypeId < 0) continue;

    const typeVariants = byTypeId.get(equipment.structureTypeId) ?? {};
    byTypeId.set(equipment.structureTypeId, {
      ...typeVariants,
      [equipment.techBase]: equipment,
    });

    const nameKey = equipment.name.trim().toLowerCase();
    const nameVariants = byName.get(nameKey) ?? {};
    byName.set(nameKey, {
      ...nameVariants,
      [equipment.techBase]: equipment,
    });
  }

  const structureIndex = { byTypeId, byName };
  structureIndexes.set(equipmentRegistry, structureIndex);
  return structureIndex;
}

function selectVariant(
  variants: StructureVariants | undefined,
  techBase: EntityTechBase,
): StructureEquipment | null {
  return variants?.[techBase] ?? variants?.All ?? null;
}

export function getStructureByTypeId(
  typeId: number,
  techBase: EntityTechBase,
  equipmentRegistry: EquipmentRegistry,
): StructureEquipment | null {
  return selectVariant(getStructureIndex(equipmentRegistry).byTypeId.get(typeId), techBase);
}

export function getStructureByName(
  name: string,
  techBase: EntityTechBase,
  equipmentRegistry: EquipmentRegistry,
): StructureEquipment | null {
  const nameKey = name.trim().toLowerCase();
  return selectVariant(getStructureIndex(equipmentRegistry).byName.get(nameKey), techBase);
}

export function getStructureTechAdvancement(
  structure: StructureEquipment,
): TechRatingSource {
  return structure.structureTypeId === 0 ? STANDARD_STRUCTURE_TECH : structure.tech;
}
