// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  findIntrinsicAmmoForWeapon,
  type Equipment,
  WeaponEquipment,
} from '../models/equipment.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { isIndustrialStructureEquipment } from '../models/construction-equipment.model';
import { naturalCompare } from './sort.util';

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

/** One unit component and the sourcebooks that carry its rules. */
export interface UnitRulesRefComponent {
  readonly name: string;
  readonly books: readonly string[];
}

/** Collect the catalog-only mutable-family inputs used by UnitMetadataBuilder. */
export function collectUnitRulesRefComponents(entity: BaseEntity): UnitRulesRefComponent[] {
  const registry = entity.getEquipmentRegistry();
  return [
    ...[...entity.armorByLocation().values()].map(mounted => rulesRefComponent(mounted.armor)),
    ...[...entity.structureByLocation().values()].map(mounted => rulesRefComponent(mounted.structure)),
    ...entity.equipment().flatMap(mounted => {
      const equipment = mounted.equipment;
      if (!(equipment instanceof WeaponEquipment)) return [rulesRefComponent(equipment)];
      const intrinsicAmmo = findIntrinsicAmmoForWeapon(equipment, registry);
      return [
        rulesRefComponent(equipment),
        ...(intrinsicAmmo ? [rulesRefComponent(intrinsicAmmo)] : []),
      ];
    }),
  ];
}

export function buildUnitRulesRefs(entity: BaseEntity): string[][] {
  return createMinimalUnitRulesRefCombinations(
    collectUnitRulesRefComponents(entity).map(component => component.books),
    {
      isMek: entity.entityType === 'Mek',
      isIndustrialMek: entity.entityType === 'Mek'
        && [...entity.structureByLocation().values()]
          .some(mounted => isIndustrialStructureEquipment(mounted.structure)),
    },
  );
}

/** A component that needs a book unless one of the interchangeable companion books is picked. */
export interface UnitRulesRefRequirer {
  readonly name: string;
  readonly unless: readonly string[];
}

/**
 * Components that make `book` necessary beside its companion books: they
 * reference it, and some pick of one book per companion choice leaves them
 * otherwise uncovered. Unconditional requirers come first.
 */
export function unitRulesRefRequirers(
  components: readonly UnitRulesRefComponent[],
  book: string,
  companionChoices: readonly (readonly string[])[],
): UnitRulesRefRequirer[] {
  const requirers = new Map<string, UnitRulesRefRequirer>();
  for (const component of components) {
    if (!component.books.includes(book)
      || !companionChoices.every(choice => choice.some(companion => !component.books.includes(companion)))) continue;
    const unless = companionChoices.flat().filter(companion => component.books.includes(companion));
    requirers.set(`${component.name}\0${unless.join('/')}`, { name: component.name, unless });
  }
  return [...requirers.values()].sort((left, right) =>
    Number(left.unless.length > 0) - Number(right.unless.length > 0) || naturalCompare(left.name, right.name));
}

function rulesRefComponent(equipment: Equipment | null | undefined): UnitRulesRefComponent {
  return {
    name: equipment?.name ?? '',
    books: [...new Set(equipment?.rulesRefs.map(reference => reference.book) ?? [])],
  };
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
