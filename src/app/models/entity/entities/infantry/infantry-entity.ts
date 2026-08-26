// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Signal, computed, signal } from '@angular/core';
import {
  getAmmoCategory,
  InfantryWeaponEquipment,
  MiscEquipment,
  WeaponEquipment,
} from '../../../equipment.model';
import {
  type UnitSubtype,
  type EntityDamageLocation,
  type MovementCalculationOptions,
  type TechRatingSource,
  EntityType,
  EntityValidationMessage,
  InfantryMount,
  InfantrySpecialization,
  locationArmor,
  MotiveType,
  WeightClass,
} from '../../types';
import {
  infantryArmorKitProfile,
  isAntiMekGearEquipment,
} from '../../../infantry-equipment.model';
import { InfantryBaseEntity } from './infantry-base-entity';
import { getInfantryTonnage } from '../../utils/infantry-tonnage';
import {
  getConventionalInfantryConstructionTech,
  getInfantryMotiveTech,
  getInfantrySpecializationTech,
} from '../../components';

// ============================================================================
// InfantryEntity - conventional infantry platoons
// ============================================================================

export class InfantryEntity extends InfantryBaseEntity {
  override componentLocationOrder(): readonly string[] {
    return ['Infantry', 'Field Guns'];
  }

  override componentLocationLabel(location: string): string {
    return ({ Infantry: 'TPRS', 'Field Guns': 'FGUN' })[location] ?? super.componentLocationLabel(location);
  }
  override readonly entityType: EntityType = 'Infantry';

  override unitSubtype(): UnitSubtype {
    const qualifier = this.motiveType() !== 'Beast'
      && MECHANIZED_INFANTRY_MOTIVE_TYPES.has(this.motiveType()) ? 'Mechanized '
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
    return infantryArmorKitProfile(armorKit)?.encumbering ?? this.encumberingArmor();
  });
  readonly effectiveSpaceSuit = computed(() => {
    const armorKit = this.armorKit();
    return infantryArmorKitProfile(armorKit)?.spaceSuit ?? this.spaceSuit();
  });
  readonly effectiveDEST = computed(() => {
    const armorKit = this.armorKit();
    return infantryArmorKitProfile(armorKit)?.dest ?? this.hasDEST();
  });
  readonly effectiveSneakCamo = computed(() => {
    const armorKit = this.armorKit();
    return infantryArmorKitProfile(armorKit)?.sneakCamo ?? this.sneakCamo();
  });
  readonly effectiveSneakIR = computed(() => {
    const armorKit = this.armorKit();
    return infantryArmorKitProfile(armorKit)?.sneakIr ?? this.sneakIR();
  });
  readonly effectiveSneakECM = computed(() => {
    const armorKit = this.armorKit();
    return infantryArmorKitProfile(armorKit)?.sneakEcm ?? this.sneakECM();
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

    let jumpMP = this.augmentations().includes('pl_flight') ? 2 : this.motiveType() === 'Jump'
      ? 3
      : this.motiveType() === 'VTOL' ? (this.isMicrolite() ? 6 : 5) : 0;
    if (this.hasSupportWeaponPenalty()) jumpMP = Math.max(jumpMP - 1, 0);
    else if (this.motiveType() === 'VTOL' && this.secondaryCount() > 0) jumpMP = Math.max(jumpMP - 1, 0);
    return jumpMP;
  }

  /** Conventional infantry store underwater movement in the motive configuration, not UMU mounts. */
  override readonly umuMP = computed(() => {
    const mount = this.mount();
    if (mount?.movementMode === 'Submarine') return mount.movementPoints;
    if (this.motiveType() === 'UMU') return this.isMotorizedScuba() ? 2 : 1;
    if (this.motiveType() !== 'Submarine') return 0;
    return 3;
  });

  private hasSupportWeaponPenalty(): boolean {
    return this.secondaryCount() > 1
      && !this.augmentations().some(augmentation => augmentation === 'tsm_implant' || augmentation === 'dermal_armor')
      && !this.specializations().has('tag-troops')
      && !!this.secondaryWeapon()?.hasWeaponTrait('infantry-support');
  }

  private hasFieldArtillery(): boolean {
    return this.equipment().some(mount =>
      mount.location === 'Field Guns'
      && mount.equipment instanceof WeaponEquipment
      && getAmmoCategory(mount.equipment.ammoType) === 'Artillery'
    );
  }

  override readonly canAntiMech = computed(() =>
    this.equipment().some(mounted => isAntiMekGearEquipment(mounted.equipment)),
  );

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

  override damageLocations(): readonly EntityDamageLocation[] {
    return [{
      code: 'Infantry',
      internalPoints: this.structureValues().get('Infantry') ?? 0,
      armor: locationArmor(0),
      soldierPips: true,
    }];
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
