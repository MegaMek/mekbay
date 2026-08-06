// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Signal, computed } from '@angular/core';
import { EquipmentRegistry } from '../../../equipment-lookup';
import { BaseEntity } from '../../base-entity';
import type { UnitSubtype, UnitType } from '../../types';
import {
  EntityType,
  EntityValidationMessage,
  requireArmorEquipment,
  TechRatingSource,
} from '../../types';
import {
  getHandheldWeaponConstructionTech,
  MountedArmor,
} from '../../components';

// ============================================================================
// HandheldWeaponEntity - standalone handheld weapons (for BA / Mek carry)
// ============================================================================

export class HandheldWeaponEntity extends BaseEntity {
  override componentLocationLabel(location: string): string {
    return location === 'Gun' ? 'GUN' : super.componentLocationLabel(location);
  }
  override readonly entityType: EntityType = 'HandheldWeapon';

  constructor(equipmentRegistry: EquipmentRegistry) {
    super(equipmentRegistry);
    this.setUniformArmor(new MountedArmor({
      armor: requireArmorEquipment('STANDARD', false, equipmentRegistry),
      techBase: 'IS',
      technology: { level: 'Introductory', scope: 'IS' },
      techRating: 'A',
    }));
  }

  override unitType(): UnitType {
    return 'Handheld Weapon';
  }

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('Handheld Weapon');
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getHandheldWeaponConstructionTech()];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    return ['Gun'];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set(['Gun']);
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeExpectedEngineRating(): number | null {
    return null;
  }

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    return new Map();
  }

  protected override computeMaxArmor(
    _structureValues: Map<string, number>,
  ): Map<string, number> {
    return new Map();
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    return [];
  });
}
