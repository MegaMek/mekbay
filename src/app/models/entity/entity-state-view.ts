// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import type { AmmoEquipment } from '../equipment.model';
import type { ArmorFace } from './types';

/** Resolved movement facts exposed by a runtime overlay to entity calculations. */
export interface EntityMovementStateView {
  readonly walk: number;
  readonly run: number;
  readonly jump: number;
  readonly umu: number;
}

/**
 * Current gameplay facts consumed by entity-owned calculations.
 *
 * The runtime may store these facts sparsely; this view resolves absent entries
 * against the bound entity. It owns no rules or calculations.
 */
export interface EntityStateView {
  readonly destroyed: boolean;
  readonly movement: EntityMovementStateView;
  readonly engineHits: number;
  equipmentStatus(mountId: string): EquipmentStatus;
  armorRemaining(location: string, face: ArmorFace): number;
  structureRemaining(location: string): number;
  ammoRemaining(mountId: string): number;
  ammoEquipment(mountId: string): AmmoEquipment | null;
}
