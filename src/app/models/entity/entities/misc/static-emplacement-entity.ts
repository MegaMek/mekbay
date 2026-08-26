// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal, type Signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import { GUN_EMPLACEMENT_WEIGHT_LIMITS, resolveWeightClass } from '../../types';
import type {
  EntityType,
  EntityValidationMessage,
  UnitSubtype,
  UnitType,
  WeightClass,
} from '../../types';

export type StaticEmplacementKind = 'GunEmplacement' | 'BuildingEntity';

/** Entity source of truth for MegaMek's static BLK families. */
export class StaticEmplacementEntity extends BaseEntity {
  override readonly entityType: EntityType;
  readonly equipmentLocations = signal<readonly string[]>([]);
  readonly buildingClass = signal<number | undefined>(undefined);
  readonly buildingType = signal<number | undefined>(undefined);
  readonly constructionFactor = signal<number | undefined>(undefined);
  readonly height = signal<number | undefined>(undefined);
  readonly coordinates = signal<readonly string[]>([]);
  readonly turret = signal(false);

  constructor(
    readonly staticKind: StaticEmplacementKind,
    equipmentRegistry: ConstructorParameters<typeof BaseEntity>[0],
  ) {
    super(equipmentRegistry);
    this.entityType = staticKind;
  }

  override unitType(): UnitType {
    return this.staticKind === 'GunEmplacement' ? 'Gun Emplacement' : 'Building';
  }

  override unitSubtype(): UnitSubtype {
    return this.staticKind === 'GunEmplacement' ? 'Gun Emplacement' : 'Building';
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
    return this.staticKind === 'GunEmplacement'
      ? resolveWeightClass(this.tonnage(), GUN_EMPLACEMENT_WEIGHT_LIMITS)
      : 'Medium';
  }

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    const constructionFactor = this.constructionFactor();
    if (constructionFactor === undefined || this.locationOrder.length === 0) return new Map();
    return new Map(this.locationOrder.map(location => [location, constructionFactor]));
  }

  protected override computeMaxArmor(structureValues: Map<string, number>): Map<string, number> {
    return new Map([...structureValues].map(([location, value]) => [location, value * 2]));
  }

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => []);
}
