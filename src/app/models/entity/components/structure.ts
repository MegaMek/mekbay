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

import { EquipmentMap, StructureEquipment } from '../../equipment.model';
import { approx, EntityTechBase, type TechRatingSource } from '../types';
import { TechAdvancement } from '../types/tech';

/**
 * Internal Structure system component.
 *
 * Structures are fundamental structural elements of every Mek. Their canonical
 * definitions come from StructureEquipment records in the equipment database.
 */

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

let structureIndexDb: EquipmentMap | null = null;
let structureIndex: StructureIndex | null = null;

function getStructureIndex(
  equipmentDb: EquipmentMap,
): StructureIndex {
  if (structureIndex && structureIndexDb === equipmentDb) return structureIndex;

  const byTypeId = new Map<number, StructureVariants>();
  const byName = new Map<string, StructureVariants>();
  for (const equipment of Object.values(equipmentDb)) {
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

  structureIndexDb = equipmentDb;
  structureIndex = { byTypeId, byName };
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
  equipmentDb: EquipmentMap,
): StructureEquipment | null {
  return selectVariant(getStructureIndex(equipmentDb).byTypeId.get(typeId), techBase);
}

export function getStructureByName(
  name: string,
  techBase: EntityTechBase,
  equipmentDb: EquipmentMap,
): StructureEquipment | null {
  const nameKey = name.trim().toLowerCase();
  return selectVariant(getStructureIndex(equipmentDb).byName.get(nameKey), techBase);
}

export function getStructureTechAdvancement(
  structure: StructureEquipment | null,
): TechRatingSource {
  return !structure || structure.structureTypeId === 0 ? STANDARD_STRUCTURE_TECH : structure.tech;
}
