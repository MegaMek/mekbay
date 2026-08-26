// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Signal, computed, signal } from '@angular/core';
import { isMascEquipment } from '../../../escalating-equipment.model';
import {
  isJumpBoosterEquipment,
  isMechanicalJumpBoosterEquipment,
  isPartialWingEquipment,
} from '../../../jump-equipment.model';
import {
  type MovementCalculationOptions,
  type EntityDamageLocation,
  type UnitSubtype,
  EntityType,
  EntityValidationMessage,
  requireArmorEquipment,
  TechRatingSource,
  WeightClass,
  locationArmor,
} from '../../types';
import {
  getBattleArmorConstructionTech,
  MountedArmor,
} from '../../components';
import { InfantryBaseEntity } from './infantry-base-entity';
import { EquipmentRegistry } from '../../../equipment-lookup';
import { isMagneticClampEquipment } from '../../../chassis-equipment.model';
import {
  isArmoredGloveEquipment,
  isBasicManipulatorEquipment,
  isBattleClawEquipment,
} from '../../../battle-armor-equipment.model';

// ============================================================================
// BattleArmorEntity - powered-armor squads (Elemental, etc.)
// ============================================================================

export class BattleArmorEntity extends InfantryBaseEntity {
  override componentLocationOrder(): readonly string[] {
    return ['Squad'];
  }
  override readonly entityType: EntityType = 'BattleArmor';

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('Battle Armor');
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getBattleArmorConstructionTech(this.weightClass(), this.isExoskeleton())];
  }

  constructor(equipmentRegistry: EquipmentRegistry) {
    super(equipmentRegistry);
    this.setUniformArmor(new MountedArmor({
      armor: requireArmorEquipment('BA_STANDARD', false, equipmentRegistry),
      techBase: 'IS',
    }));
    this.squadCount.set(1);
    this.squadSize.set(5);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  readonly trooperCount = this.squadSize;
  declaredWeightClass = signal<WeightClass>('Medium');
  chassisType = signal<string>('Biped');
  propulsionMP = signal<number>(0);
  apMounts = signal<number>(0);
  dwpCapacity = signal<number>(0);
  sswmCapacity = signal<number>(0);
  costKC = signal<number>(0);

  /** Quad BA turret config, e.g. "Modular:3" or "Standard:2" */
  turretConfig = signal<string>('');
  /** Whether this unit is an exoskeleton */
  isExoskeleton = signal<boolean>(false);
  /** Clan exoskeleton compatibility mode that uses the lighter IS chassis table. */
  clanExoWithoutHarJel = signal<boolean>(false);
  /** Squad equipment tag: 'Squad' (modern) or 'Point' (legacy) for BLK round-trip */
  squadEquipmentTag = signal<'Squad' | 'Point'>('Squad');

  readonly baseJumpMP = computed(() => this.motiveType() === 'UMU' ? 0 : this.propulsionMP());
  override readonly umuMP = computed(() => this.motiveType() === 'UMU' ? this.propulsionMP() : 0);
  
  readonly mechanizedCapable = computed(() => {
    if (this.chassisType() === 'Quad') return false;

    const count = (predicate: typeof isArmoredGloveEquipment) =>
      this.equipment().filter(mount => predicate(mount.equipment)).length;
    if (this.equipment().some(mount => isMagneticClampEquipment(mount.equipment))) return true;

    const hasBasicManipulator = count(isBasicManipulatorEquipment) > 0;
    const hasBattleClaw = count(isBattleClawEquipment) > 0;
    switch (this.weightClass()) {
      case 'Ultra Light':
      case 'Light':
        return count(isArmoredGloveEquipment) > 1 || hasBasicManipulator || hasBattleClaw;
      case 'Medium':
      case 'Heavy':
        return hasBasicManipulator || hasBattleClaw;
      case 'Assault':
        return false;
      default:
        return false;
    }
  });

  /** Whether the technical specs indicate that this unit can make Leg Attacks. */
  readonly legAttackCapable = computed(() => this.hasAntiMekManipulators());

  /** Whether the technical specs indicate that this unit can make Swarm Attacks. */
  readonly swarmAttackCapable = computed(() =>
    this.motiveType() !== 'UMU' && this.hasAntiMekManipulators());

  override readonly canAntiMech = computed(() =>
    this.legAttackCapable() || this.swarmAttackCapable(),
  );

  private hasAntiMekManipulators(): boolean {
    if (this.chassisType().toLowerCase().includes('quad')) return false;

    const count = (predicate: typeof isArmoredGloveEquipment) =>
      this.equipment().filter(mount => predicate(mount.equipment)).length;
    const basicManipulators = count(isBasicManipulatorEquipment);
    const battleClaws = count(isBattleClawEquipment);

    switch (this.weightClass()) {
      case 'Ultra Light':
      case 'Light':
        return count(isArmoredGloveEquipment) > 1 || basicManipulators > 1 || battleClaws > 0;
      case 'Medium':
        return basicManipulators > 1 || battleClaws > 0;
      default:
        return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  OVERRIDES - BA uses canonical motive values (no compound infantry strings)
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeWeightClass(): WeightClass {
    return this.declaredWeightClass();
  }

  protected override computeTonnage(): number {
    return this.trooperCount();
  }

  /** BA writes plain MotiveType (VTOL, UMU, etc.) - no infantry compound logic. */
  override getMotiveTypeAsString(): string | null {
    const m = this.motiveType();
    return m === 'None' ? null : m;
  }

  override computeWalkMP(options: MovementCalculationOptions): number {
    const equipment = this.equipment();
    const weightClass = this.weightClass();
    let walkMP = this.originalWalkMP();
    const hasMyomerBooster = equipment.some(mount => isMascEquipment(mount.equipment));

    if (hasMyomerBooster && !options.ignoreMyomerBooster) {
      walkMP += weightClass === 'Heavy' || weightClass === 'Assault' ? 1 : 2;
    } else if (!hasMyomerBooster
      && equipment.some(mount => isMechanicalJumpBoosterEquipment(mount.equipment))) {
      walkMP++;
    }

    if (!options.ignoreDWP && equipment.some(mount => mount.isDWP)) {
      if (weightClass === 'Medium') walkMP -= 3;
      else if (weightClass === 'Heavy' || weightClass === 'Assault') walkMP -= 2;
      if (walkMP === 0) walkMP++;
    }

    return walkMP;
  }

  override computeJumpMP(options: MovementCalculationOptions): number {
    const equipment = this.equipment();
    if (!options.ignoreDWP && equipment.some(mount => mount.isDWP)) return 0;

    let jumpMP = this.baseJumpMP();
    if (jumpMP === 0 && equipment.some(mount => isMechanicalJumpBoosterEquipment(mount.equipment))) {
      jumpMP = 1;
    }
    if (jumpMP > 0 && equipment.some(mount => isPartialWingEquipment(mount.equipment))) {
      jumpMP++;
    }
    if (jumpMP > 0 && equipment.some(mount => isJumpBoosterEquipment(mount.equipment))) {
      jumpMP++;
    }
    return jumpMP;
  }

  protected override computeMaximumArmorPoints(): number {
    const maxPerTrooper: Partial<Record<WeightClass, number>> = {
      'Ultra Light': 2,
      'Light': 6,
      'Medium': 10,
      'Heavy': 14,
      'Assault': 18,
    };
    return (maxPerTrooper[this.weightClass()] ?? 0) * this.trooperCount();
  }

  override totalArmorPoints = computed(() => {
    const armorPerTrooper = this.armorValues().get('Squad');
    return (armorPerTrooper?.front ?? 0) * this.trooperCount();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  override get locationOrder(): readonly string[] {
    const locs: string[] = ['Squad'];
    for (let i = 1; i <= this.trooperCount(); i++) {
      locs.push(`Trooper ${i}`);
    }
    return locs;
  }

  override get validLocations(): ReadonlySet<string> {
    return new Set(this.locationOrder);
  }

  override damageLocations(): readonly EntityDamageLocation[] {
    const armor = this.armorValues().get('Squad') ?? locationArmor(0);
    return Array.from({ length: this.trooperCount() }, (_, index) => ({
      code: `Trooper ${index + 1}`,
      sheetCode: `T${index + 1}`,
      internalPoints: 1,
      armor,
      combinedPips: true,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    const values = new Map<string, number>();
    values.set('Squad', this.trooperCount());
    for (let i = 1; i <= this.trooperCount(); i++) {
      values.set(`Trooper ${i}`, 1);
    }
    return values;
  }

  protected override computeTotalInternalPoints(): number {
    return this.trooperCount();
  }

  protected override computeMaxArmor(
    _structureValues: Map<string, number>,
  ): Map<string, number> {
    // BA armor points depend on weight class
    const maxPerTrooper: Partial<Record<WeightClass, number>> = {
      'Ultra Light': 2, 'Light': 5, 'Medium': 8, 'Heavy': 10, 'Assault': 14,
    };
    const mx = maxPerTrooper[this.weightClass()] ?? 8;
    const maxArmor = new Map<string, number>();
    for (let i = 1; i <= this.trooperCount(); i++) {
      maxArmor.set(`Trooper ${i}`, mx);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.trooperCount() < 1 || this.trooperCount() > 6) {
      msgs.push({
        severity: 'error', category: 'general', code: 'BA_TROOPER_COUNT',
        message: `Trooper count ${this.trooperCount()} is out of range (1-6)`,
      });
    }

    return msgs;
  });
}
