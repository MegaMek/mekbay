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
import {
  getAmmoCategory,
  InfantryWeaponEquipment,
  MiscEquipment,
  WeaponEquipment,
} from '../../../equipment.model';
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
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import {
  getConventionalInfantryConstructionTech,
  getInfantryMotiveTech,
  getInfantrySpecializationTech,
} from '../../components';

// ============================================================================
// InfantryEntity - conventional infantry platoons
// ============================================================================

export class InfantryEntity extends InfantryBaseEntity {
  override readonly entityType: EntityType = 'Infantry';

  override unitSubtype(): UnitSubtype {
    const infantryMotive = this.motiveType() === 'Beast'
      ? this.mount()?.movementMode
      : this.motiveType();
    const qualifier = infantryMotive && MECHANIZED_INFANTRY_MOTIVE_TYPES.has(infantryMotive) ? 'Mechanized '
      : this.motiveType() === 'Motorized' ? 'Motorized '
      : '';
    return this.withOmniSubtype(`${qualifier}Conventional Infantry`);
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    const hasFieldEquipment = this.equipment().some(
      mount => mount.allocation.kind === 'location' && mount.allocation.location === 'Field Guns',
    );
    const sources: TechRatingSource[] = [
      getConventionalInfantryConstructionTech(
        this.motiveType(),
        hasFieldEquipment,
        this.effectiveEncumberingArmor(),
      ),
      getInfantryMotiveTech(this.motiveType()),
      ...getInfantrySpecializationTech(this.specializations()),
    ];
    // MegaMek represents the platoon's primary/secondary pair as one
    // InfantryWeaponMounted and composes tech from its range weapon.
    const rangeWeapon = this.rangeWeapon();
    if (rangeWeapon) sources.push(rangeWeapon.tech);
    return sources;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  readonly primaryWeapon = signal<InfantryWeaponEquipment | null>(null);
  readonly secondaryWeapon = signal<InfantryWeaponEquipment | null>(null);
  readonly secondaryCount = signal<number>(0);
  readonly rangeWeapon = computed<InfantryWeaponEquipment | null>(() => {
    const secondaryWeapon = this.secondaryWeapon();
    return this.secondaryCount() > 1 && secondaryWeapon
      ? secondaryWeapon
      : this.primaryWeapon();
  });
  readonly armorDivisor = signal<number>(1);
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

  /** The installed armor kit is derived from the canonical equipment list. */
  readonly armorKit = computed<MiscEquipment | null>(() => {
    for (const mount of this.equipment()) {
      const equipment = mount.equipment;
      if (equipment instanceof MiscEquipment && equipment.isArmorKit) return equipment;
    }
    return null;
  });
  readonly effectiveEncumberingArmor = computed(() => {
    const armorKit = this.armorKit();
    return armorKit ? armorKit.hasFlag('S_ENCUMBERING') : this.encumberingArmor();
  });
  readonly effectiveSpaceSuit = computed(() => {
    const armorKit = this.armorKit();
    return armorKit ? armorKit.hasFlag('S_SPACE_SUIT') : this.spaceSuit();
  });
  readonly effectiveDEST = computed(() => {
    const armorKit = this.armorKit();
    return armorKit ? armorKit.hasFlag('S_DEST') : this.hasDEST();
  });
  readonly effectiveSneakCamo = computed(() => {
    const armorKit = this.armorKit();
    return armorKit ? armorKit.hasFlag('S_SNEAK_CAMO') : this.sneakCamo();
  });
  readonly effectiveSneakIR = computed(() => {
    const armorKit = this.armorKit();
    return armorKit ? armorKit.hasFlag('S_SNEAK_IR') : this.sneakIR();
  });
  readonly effectiveSneakECM = computed(() => {
    const armorKit = this.armorKit();
    return armorKit ? armorKit.hasFlag('S_SNEAK_ECM') : this.sneakECM();
  });

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

  protected override computeTonnage(): number {
    return getInfantryTonnage(this);
  }

  override computeWalkMP(_options: MovementCalculationOptions): number {
    const mount = this.mount();
    if (mount) {
      return mount.movementMode === 'Leg' ? mount.movementPoints : mount.secondaryGroundMP;
    }

    let walkMP = this.originalWalkMP();
    if (this.effectiveEncumberingArmor()) walkMP = Math.max(walkMP - 1, 1);
    if (this.hasSupportWeaponPenalty() && this.motiveType() !== 'Tracked' && this.motiveType() !== 'Jump') {
      walkMP = Math.max(walkMP - 1, 0);
    }
    if (this.hasFieldArtillery()) walkMP = Math.min(walkMP, 1);
    return walkMP;
  }

  override computeJumpMP(_options: MovementCalculationOptions): number {
    const mount = this.mount();
    if (mount) return mount.movementMode === 'VTOL' ? mount.movementPoints : 0;
    if (this.motiveType() === 'UMU' || this.motiveType() === 'Submarine') return 0;

    let jumpMP = this.motiveType() === 'Jump'
      ? 3
      : this.motiveType() === 'VTOL' ? (this.isMicrolite() ? 6 : 5) : 0;
    if (this.hasSupportWeaponPenalty()) jumpMP = Math.max(jumpMP - 1, 0);
    else if (this.motiveType() === 'VTOL' && this.secondaryCount() > 0) jumpMP = Math.max(jumpMP - 1, 0);
    return jumpMP;
  }

  private hasSupportWeaponPenalty(): boolean {
    return this.secondaryCount() > 1
      && !this.augmentations().some(augmentation => augmentation === 'tsm_implant' || augmentation === 'dermal_armor')
      && !this.specializations().has('tag-troops')
      && !!this.secondaryWeapon()?.hasFlag('F_INF_SUPPORT');
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

    if (!this.primaryWeapon()) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_NO_PRIMARY_WEAPON',
        message: 'Infantry must have a primary infantry weapon',
      });
    }
    if (!Number.isInteger(this.secondaryCount()) || this.secondaryCount() < 0) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_INVALID_SECONDARY_COUNT',
        message: 'Infantry secondary weapon count must be a non-negative integer',
      });
    } else if (this.secondaryCount() > 0 && !this.secondaryWeapon()) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_NO_SECONDARY_WEAPON',
        message: 'Infantry with secondary weapons must specify a secondary infantry weapon',
      });
    }

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

const MECHANIZED_INFANTRY_MOTIVE_TYPES = new Set(['Tracked', 'Wheeled', 'Hover', 'VTOL', 'Submarine']);
