// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  findIntrinsicAmmoForWeapon,
  type Equipment,
  WeaponEquipment,
} from '../models/equipment.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { isIndustrialStructureEquipment } from '../models/construction-equipment.model';

export interface UnitRulesRefApplicability {
  readonly isMek: boolean;
  readonly isIndustrialMek: boolean;
}

/**
 * Build every inclusion-minimal sourcebook combination that covers at least
 * one reference for each referenced component. Mirrors MegaMek's
 * UnitRulesRefUtil.createMinimalCombinations.
 */
export function createMinimalUnitRulesRefCombinations(
  componentRulesRefs: readonly (readonly string[] | null | undefined)[],
  applicability: UnitRulesRefApplicability,
): string[][] {
  let combinations: string[][] = [[]];
  let foundReference = false;

  for (const componentBooks of componentRulesRefs) {
    const referencedBooks = [...new Set(componentBooks?.filter(book => book.length > 0) ?? [])];
    if (referencedBooks.length === 0) continue;
    foundReference = true;

    const applicableBooks = referencedBooks.filter(book => isBookApplicable(book, applicability));
    if (applicableBooks.length === 0) return [];

    const nextCombinations: string[][] = [];
    for (const combination of combinations) {
      if (applicableBooks.some(book => combination.includes(book))) {
        addIfMinimal(nextCombinations, combination);
        continue;
      }
      for (const book of applicableBooks) {
        addIfMinimal(nextCombinations, [...combination, book]);
      }
    }
    combinations = nextCombinations;
  }

  if (!foundReference) return [];
  return combinations.sort((left, right) => left.length - right.length);
}

/** Collect the catalog-only mutable-family inputs used by UnitMetadataBuilder. */
export function buildUnitRulesRefs(entity: BaseEntity): string[][] {
  const registry = entity.getEquipmentRegistry();
  const componentRulesRefs: readonly string[][] = [
    ...[...entity.armorByLocation().values()].map(mounted => rulesRefBooks(mounted.armor)),
    ...[...entity.structureByLocation().values()].map(mounted => rulesRefBooks(mounted.structure)),
    ...entity.equipment().flatMap(mounted => {
      const equipment = mounted.equipment;
      if (!(equipment instanceof WeaponEquipment)) return [rulesRefBooks(equipment)];
      const intrinsicAmmo = findIntrinsicAmmoForWeapon(equipment, registry);
      return [
        rulesRefBooks(equipment),
        ...(intrinsicAmmo ? [rulesRefBooks(intrinsicAmmo)] : []),
      ];
    }),
    ...(entity instanceof InfantryEntity
      ? [rulesRefBooks(entity.primaryWeapon()), rulesRefBooks(entity.secondaryWeapon())]
      : []),
  ];
  return createMinimalUnitRulesRefCombinations(componentRulesRefs, {
    isMek: entity.entityType === 'Mek',
    isIndustrialMek: entity.entityType === 'Mek'
      && [...entity.structureByLocation().values()]
        .some(mounted => isIndustrialStructureEquipment(mounted.structure)),
  });
}

function rulesRefBooks(equipment: Equipment | null | undefined): string[] {
  return [...new Set(equipment?.rulesRefs.map(reference => reference.book) ?? [])];
}

function isBookApplicable(book: string, applicability: UnitRulesRefApplicability): boolean {
  if (book === 'Core') return applicability.isMek && !applicability.isIndustrialMek;
  if (book === 'BMM') return applicability.isMek;
  return true;
}

function addIfMinimal(combinations: string[][], candidate: readonly string[]): void {
  if (combinations.some(existing => includesAll(candidate, existing))) return;
  for (let index = combinations.length - 1; index >= 0; index -= 1) {
    if (includesAll(combinations[index], candidate)) combinations.splice(index, 1);
  }
  combinations.push([...candidate]);
}

function includesAll(values: readonly string[], required: readonly string[]): boolean {
  return required.every(value => values.includes(value));
}
