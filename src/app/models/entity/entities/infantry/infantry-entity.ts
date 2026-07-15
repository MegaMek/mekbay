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
import { Equipment, getAmmoCategory, WeaponEquipment } from '../../../equipment.model';
import {
  EntityType,
  EntityValidationMessage,
  InfantryMount,
  InfantrySpecialization,
  MotiveType,
  WeightClass,
} from '../../types';
import { MovementCalculationOptions } from '../../base-entity';
import { InfantryBaseEntity } from './infantry-base-entity';
import { getInfantryTonnage } from '../../utils/infantry-tonnage';

// ============================================================================
// InfantryEntity - conventional infantry platoons
// ============================================================================

export class InfantryEntity extends InfantryBaseEntity {
  override readonly entityType: EntityType = 'Infantry';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  squadSize = signal<number>(0);
  squadCount = signal<number>(0);
  primaryWeapon = signal<string>('');
  secondaryWeapon = signal<string>('');
  secondaryWeaponEquipment = signal<Equipment | null>(null);
  secondaryCount = signal<number>(0);
  armorDivisor = signal<number>(1);
  armorKit = signal<string>('');
  override motiveType = signal<MotiveType>('Leg');

  // Infantry motive modifiers - these flag VTOL/SCUBA sub-variants
  isMicrolite = signal<boolean>(false);
  isMotorizedScuba = signal<boolean>(false);

  // Beast mount data (only set when motiveType === 'Beast')
  mount = signal<InfantryMount | null>(null);

  // Infantry-specific armor / stealth booleans
  encumberingArmor = signal<boolean>(false);
  spaceSuit = signal<boolean>(false);
  hasDEST = signal<boolean>(false);
  sneakCamo = signal<boolean>(false);
  sneakIR = signal<boolean>(false);
  sneakECM = signal<boolean>(false);

  // Manei Domini augmentations (pilot option names)
  augmentations = signal<string[]>([]);

  // Prosthetic Enhancement (Enhanced Limbs) - IO p.84
  prostheticEnhancement1 = signal<string>('');
  prostheticEnhancement1Count = signal<number>(0);
  prostheticEnhancement2 = signal<string>('');
  prostheticEnhancement2Count = signal<number>(0);
  extraneousPair1 = signal<string>('');
  extraneousPair2 = signal<string>('');

  specializations = signal<Set<InfantrySpecialization>>(new Set());
  originalJumpMP = signal<number>(0);

  protected override computeTonnage(): number {
    return getInfantryTonnage(this);
  }

  protected override computeWalkMP(_options: MovementCalculationOptions): number {
    const mount = this.mount();
    if (mount) {
      return mount.movementMode === 'Leg' ? mount.movementPoints : mount.secondaryGroundMP;
    }

    let walkMP = this.originalWalkMP();
    if (this.encumberingArmor()) walkMP = Math.max(walkMP - 1, 1);
    if (this.hasSupportWeaponPenalty() && this.motiveType() !== 'Tracked' && this.motiveType() !== 'Jump') {
      walkMP = Math.max(walkMP - 1, 0);
    }
    if (this.hasFieldArtillery()) walkMP = Math.min(walkMP, 1);
    return walkMP;
  }

  protected override computeJumpMP(_options: MovementCalculationOptions): number {
    const mount = this.mount();
    if (mount) return mount.movementMode === 'VTOL' ? mount.movementPoints : 0;
    if (this.motiveType() === 'UMU' || this.motiveType() === 'Submarine') return 0;

    let jumpMP = this.originalJumpMP();
    if (this.hasSupportWeaponPenalty()) jumpMP = Math.max(jumpMP - 1, 0);
    else if (this.motiveType() === 'VTOL' && this.secondaryCount() > 0) jumpMP = Math.max(jumpMP - 1, 0);
    return jumpMP;
  }

  private hasSupportWeaponPenalty(): boolean {
    return this.secondaryCount() > 1
      && !this.augmentations().some(augmentation => augmentation === 'tsm_implant' || augmentation === 'dermal_armor')
      && !this.specializations().has('tag-troops')
      && !!this.secondaryWeaponEquipment()?.hasFlag('F_INF_SUPPORT');
  }

  private hasFieldArtillery(): boolean {
    return this.equipment().some(mount =>
      mount.location === 'Field Guns'
      && mount.equipment instanceof WeaponEquipment
      && getAmmoCategory(mount.equipment.ammoType) === 'Artillery'
    );
  }

  hasAntiMekGear(): boolean {
    return this.equipment().some(mounted => mounted.equipment?.hasFlag('F_ANTI_MEK_GEAR'));
  }

  /**
   * Overrides base-entity to handle compound infantry motive strings:
   *   - Beast-mounted: `"Beast:Tariq"` or `"Beast:Custom:csv..."`
   *   - VTOL + microlite flag: `"Microlite"` (else `"Microcopter"`)
   *   - UMU + motorized flag: `"Motorized SCUBA"` (else `"SCUBA"`)
   *   - Everything else: the canonical MotiveType string
   */
  override getMotiveTypeAsString(): string | null {
    const motive = this.motiveType();
    const mountData = this.mount();

    // Beast-mounted infantry
    if (motive === 'Beast' && mountData) {
      if (mountData.custom) {
        const fields = [
          mountData.name, mountData.size, mountData.weight, mountData.movementPoints,
          mountData.movementMode, mountData.burstDamage, mountData.vehicleDamage,
          mountData.damageDivisor, mountData.maxWaterDepth, mountData.secondaryGroundMP,
          mountData.uwEndurance,
        ];
        return `Beast:Custom:${fields.join(',')}`;
      }
      return `Beast:${mountData.name}`;
    }

    // VTOL sub-variants (Microcopter / Microlite)
    if (motive === 'VTOL') {
      return this.isMicrolite() ? 'Microlite' : 'Microcopter';
    }

    // UMU sub-variants (SCUBA / Motorized SCUBA)
    if (motive === 'UMU') {
      return this.isMotorizedScuba() ? 'Motorized SCUBA' : 'SCUBA';
    }

    return motive;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    return ['Infantry'];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set(['Infantry', 'Field Guns']);
  }

  protected override computeWeightClass(): WeightClass {
    return 'Light';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    const values = new Map<string, number>();
    values.set('Infantry', this.squadSize() * this.squadCount());
    return values;
  }

  protected override computeMaxArmor(
    _structureValues: Map<string, number>,
  ): Map<string, number> {
    return new Map(); // Infantry armor is handled differently
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.squadSize() <= 0) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_NO_SQUAD_SIZE',
        message: 'Infantry squad size must be greater than 0',
      });
    }
    if (this.squadCount() <= 0) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_NO_SQUAD_COUNT',
        message: 'Infantry must have at least one squad',
      });
    }

    return msgs;
  });
}
