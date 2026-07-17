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

import { Signal, computed, signal } from '@angular/core';
import { BaseEntity, MovementCalculationOptions } from '../../base-entity';
import {
  EntityType,
  EntityValidationMessage,
  IntrinsicWeapon,
  MotiveType,
  PROTO_LOCATIONS,
  PROTO_LOCATIONS_WITH_MAIN_GUN,
  PROTOMEK_WEIGHT_LIMITS,
  resolveWeightClass,
  WeightClass,
} from '../../types';

// ============================================================================
// ProtoMekEntity - ProtoMech units (2-15 tons)
// ============================================================================

export class ProtoMekEntity extends BaseEntity {
  override readonly entityType: EntityType = 'ProtoMek';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  override motiveType = signal<MotiveType>('Biped');
  interfaceCockpit = signal<boolean>(false);
  isGlider = signal<boolean>(false);
  isQuad = signal<boolean>(false);
  hasMainGun = signal<boolean>(false);

  readonly installedJumpJetMP = computed(() => this.equipment().filter(
    mount => mount.equipment?.hasFlag('F_JUMP_JET'),
  ).length);
  readonly installedUmuMP = computed(() => this.equipment().filter(
    mount => mount.equipment?.hasFlag('F_UMU'),
  ).length);
  readonly umuMP = computed(() => this.installedUmuMP());

  override computeJumpMP(options: MovementCalculationOptions): number {
    const partialWingBonus = !options.ignoreWeather && this.equipment().some(
      mount => mount.equipment?.hasFlag('F_PARTIAL_WING'),
    ) ? 2 : 0;
    return this.installedJumpJetMP() + partialWingBonus;
  }

  override computeRunMP(options: MovementCalculationOptions): number {
    const walkMP = this.computeWalkMP(options);
    return (
    !options.ignoreMyomerBooster
      && this.equipment().some(mount => mount.equipment?.hasFlag('F_MASC'))
      ? walkMP * 2
      : Math.ceil(walkMP * 1.5)
    );
  }

  protected override computeMaximumArmorPoints(): number {
    const maxArmorByTonnage = [15, 17, 22, 24, 33, 35, 40, 42, 51, 53, 58, 60, 65, 67];
    const weightIndex = Math.max(0, Math.floor(this.tonnage()) - 2);
    const base = maxArmorByTonnage[Math.min(weightIndex, maxArmorByTonnage.length - 1)];
    return base + (this.hasMainGun() ? (this.tonnage() > 9 ? 6 : 3) : 0);
  }

  calculatedEngineRating = computed(() => {
    let moveFactor = Math.ceil(this.walkMP() * 1.5);
    if (this.isQuad() || this.isGlider()) moveFactor -= 2;

    let rating = Math.max(1, Math.min(400, Math.trunc(moveFactor * this.tonnage())));
    if (rating > 40) rating = Math.ceil(rating / 5) * 5;
    return rating;
  });

  protected override computeIntrinsicWeapons(): readonly IntrinsicWeapon[] {
    const tonnage = this.tonnage();
    let damage = tonnage <= 5 ? 1 : tonnage <= 9 ? 2 : 3;
    if (this.isGlider()) damage = Math.max(1, damage - 1);

    const meleeEquipment = this.equipment()
      .filter(mount => mount.equipment?.hasFlag('F_PROTOMEK_MELEE'))
      .map(mount => mount.equipment);
    if (meleeEquipment.some(equipment => equipment?.hasFlag('S_PROTO_QMS'))) {
      damage += 2 * Math.ceil(tonnage / 5);
    } else if (meleeEquipment.length > 0) {
      damage += Math.ceil(tonnage / 5);
    }

    return [{
      source: 'intrinsic',
      id: 'intrinsic:frenzy',
      kind: 'frenzy',
      name: 'Frenzy',
      locations: [],
      category: 'physical',
      heat: 0,
      damage: { kind: 'physical-fixed', primary: { damage } },
      hitModifiers: ['variable'],
      minimumRange: 0,
      ranges: [],
      optional: false,
    }];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    return this.hasMainGun()
      ? PROTO_LOCATIONS_WITH_MAIN_GUN
      : PROTO_LOCATIONS;
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...this.locationOrder, 'Body']);
  }

  override hasRearArmor(loc: string): boolean {
    return loc === 'Torso';
  }

  protected override computeWeightClass(): WeightClass {
    return resolveWeightClass(this.tonnage(), PROTOMEK_WEIGHT_LIMITS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeExpectedEngineRating(): number | null {
    return this.calculatedEngineRating();
  }

  protected override computeStructureValues(tonnage: number): Map<string, number> {
    const weight = Math.trunc(tonnage);
    const head = weight <= 5 ? 1 : weight <= 9 ? 2 : weight <= 13 ? 3 : 4;
    const leg = this.computeLegStructure(weight);
    const values = new Map<string, number>();
    values.set('Head', head);
    values.set('Torso', weight);
    if (!this.isQuad()) {
      values.set('Left Arm', head);
      values.set('Right Arm', head);
    }
    values.set('Legs', leg);
    if (this.hasMainGun()) values.set('Main Gun', weight > 9 ? 2 : 1);
    return values;
  }

  private computeLegStructure(weight: number): number {
    if (this.isQuad()) {
      if (weight <= 3) return 4;
      if (weight <= 5) return 5;
      if (weight <= 7) return 8;
      if (weight <= 9) return 9;
      if (weight <= 11) return 12;
      if (weight <= 13) return 13;
      return 14;
    }
    if (weight <= 3) return 2;
    if (weight <= 5) return 3;
    if (weight <= 7) return 4;
    if (weight <= 9) return 5;
    if (weight <= 11) return 6;
    if (weight <= 13) return 7;
    return 8;
  }

  protected override computeMaxArmor(
    structureValues: Map<string, number>,
  ): Map<string, number> {
    const maxArmor = new Map<string, number>();
    for (const [loc, isVal] of structureValues) {
      // Torso can have front + rear (max = IS x 2 total)
      maxArmor.set(loc, loc === 'Torso' ? isVal * 2 : isVal * 2);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.tonnage() < 2 || this.tonnage() > 15) {
      msgs.push({
        severity: 'error', category: 'weight', code: 'PROTO_TONNAGE',
        message: `ProtoMek tonnage ${this.tonnage()} is out of range (2-15)`,
      });
    }

    if (this.walkMP() <= 0) {
      msgs.push({
        severity: 'warning', category: 'movement', code: 'PROTO_NO_WALK',
        message: 'ProtoMek has no walk MP',
      });
    }

    return msgs;
  });
}
