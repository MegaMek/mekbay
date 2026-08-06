// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Signal, signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import { EquipmentRegistry } from '../../../equipment-lookup';
import type { MovementCalculationOptions, UnitSubtype, UnitType } from '../../types';

export abstract class InfantryBaseEntity extends BaseEntity {
  constructor(equipmentRegistry: EquipmentRegistry) {
    super(equipmentRegistry);
    this.clearArmorMaterial();
  }

  override unitType(): UnitType {
    return 'Infantry';
  }

  abstract override unitSubtype(): UnitSubtype;
  abstract readonly canAntiMech: Signal<boolean>;
  readonly squadSize = signal<number>(1);
  readonly squadCount = signal<number>(1);

  override computeRunMP(options: MovementCalculationOptions): number {
    return this.computeWalkMP(options);
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  protected override computeExpectedEngineRating(): number | null {
    return null;
  }
}
