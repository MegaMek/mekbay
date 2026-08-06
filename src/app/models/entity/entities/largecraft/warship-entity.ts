// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  EntityType,
  LARGE_CRAFT_LOCATIONS,
} from '../../types';
import { JumpShipEntity } from './jumpship-entity';
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import { getWarshipConstructionTech } from '../../components';

/**
 * Broadside locations used by WarShips (in addition to the standard 6).
 */
const WARSHIP_EQUIP_LOCS = [
  'Nose', 'FLS', 'FRS', 'ALS', 'ARS', 'Aft',
  'Left Broadside', 'Right Broadside', 'Hull',
] as const;

// ============================================================================
// WarShipEntity - KF-drive capital warships with broadside arcs
// ============================================================================

export class WarShipEntity extends JumpShipEntity {
  override readonly entityType: EntityType = 'WarShip';

  override componentLocationOrder(): readonly string[] {
    return [...super.componentLocationOrder(), 'Left Broadside', 'Right Broadside'];
  }

  override componentLocationLabel(location: string): string {
    return ({ 'Left Broadside': 'LBS', 'Right Broadside': 'RBS' })[location]
      ?? super.componentLocationLabel(location);
  }

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('WarShip');
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getWarshipConstructionTech(this.driveCoreType() === 'Primitive')];
  }

  // ── Location overrides ──

  override get locationOrder(): readonly string[] {
    return LARGE_CRAFT_LOCATIONS;
  }

  override get equipLocations(): readonly string[] {
    return [...WARSHIP_EQUIP_LOCS];
  }

  override get validLocations(): ReadonlySet<string> {
    return new Set([...LARGE_CRAFT_LOCATIONS, 'Left Broadside', 'Right Broadside', 'Hull']);
  }
}
