// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Signal, signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import { EquipmentRegistry } from '../../../equipment-lookup';
import type { MovementCalculationOptions, UnitSubtype, UnitType } from '../../types';
import type { IntrinsicWeapon, IntrinsicWeaponKind } from '../../types/weapon';

export abstract class InfantryBaseEntity extends BaseEntity {
  constructor(equipmentRegistry: EquipmentRegistry) {
    super(equipmentRegistry);
    this.clearArmorMaterial();
  }

  override unitType(): UnitType {
    return 'Infantry';
  }

  abstract override unitSubtype(): UnitSubtype;
  abstract readonly canMakeAntiMekAttacks: Signal<boolean>;
  readonly squadSize = signal<number>(1);
  readonly squadCount = signal<number>(1);

  override computeRunMP(options: MovementCalculationOptions): number {
    return this.computeWalkMP(options);
  }

  /** Whether the unit's construction lets it attack a 'Mech's legs; play decides whether enough troopers remain. */
  canMakeLegAttacks(): boolean {
    return this.canMakeAntiMekAttacks();
  }

  /** Whether the unit's construction lets it swarm. */
  canMakeSwarmAttacks(): boolean {
    return this.canMakeAntiMekAttacks();
  }

  /** The anti-'Mech attacks the unit may declare (TW pp. 220-223); a swarming unit may also end its swarm. */
  protected override computeIntrinsicWeapons(): readonly IntrinsicWeapon[] {
    const attack = (kind: IntrinsicWeaponKind, name: string): IntrinsicWeapon => Object.freeze({
      source: 'intrinsic' as const,
      id: `intrinsic:${kind}`,
      kind,
      name,
      locations: Object.freeze([]),
      damage: Object.freeze({ kind: 'none' as const }),
      hitModifierAdjustment: 0,
    });
    return Object.freeze([
      ...(this.equipment().some(mount => mount.equipment?.hasFlag('F_VIBROCLAW'))
        ? [attack('vibro-claw', 'Vibro-Claw Attack')] : []),
      ...(this.canMakeLegAttacks() ? [attack('leg-attack', 'Leg Attack')] : []),
      ...(this.canMakeSwarmAttacks() ? [attack('swarm', 'Swarm Attack'), attack('end-swarm', 'End Swarm')] : []),
    ]);
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  protected override computeExpectedEngineRating(): number | null {
    return null;
  }
}
