// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILDING_ORIGIN, buildingLocationName, buildingConnectedComponents, type BuildingHex } from '../../types/building';
import { computed, signal, type Signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import type {
  EntityValidationMessage,
  UnitSubtype,
  UnitType,
  WeightClass,
} from '../../types';

/** Entity source of truth for MegaMek's building BLKs. */
export class StaticEmplacementEntity extends BaseEntity {
  override readonly entityType = 'BuildingEntity' as const;
  readonly equipmentLocations = computed<readonly string[]>(() =>
    this.coordinates().flatMap(hex => Array.from({ length: this.height() ?? 1 }, (_, floor) => buildingLocationName(hex, floor))));
  readonly buildingClass = signal<number | undefined>(undefined);
  readonly buildingType = signal<number | undefined>(undefined);
  readonly constructionFactor = signal<number | undefined>(undefined);
  readonly height = signal<number | undefined>(undefined);
  readonly coordinates = signal<readonly BuildingHex[]>([BUILDING_ORIGIN]);

  override unitType(): UnitType {
    return 'Building';
  }

  override unitSubtype(): UnitSubtype {
    return 'Building';
  }

  get locationOrder(): readonly string[] {
    return this.equipmentLocations();
  }

  get validLocations(): ReadonlySet<string> {
    return new Set(this.equipmentLocations());
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  protected override computeExpectedEngineRating(): number | null {
    return null;
  }

  protected override computeWeightClass(): WeightClass {
    return 'Medium';
  }

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    const constructionFactor = this.constructionFactor();
    if (constructionFactor === undefined || this.locationOrder.length === 0) return new Map();
    return new Map(this.locationOrder.map(location => [location, constructionFactor]));
  }

  protected override computeMaxArmor(structureValues: Map<string, number>): Map<string, number> {
    return new Map([...structureValues].map(([location, value]) => [location, value * 2]));
  }

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const messages: EntityValidationMessage[] = [];
    if (buildingConnectedComponents(this.coordinates()).length > 1) messages.push({ severity: 'warning', message: 'The building footprint contains disconnected sections.', category: 'structure', code: 'BUILDING_DISCONNECTED' });
    return messages;
  });
}
