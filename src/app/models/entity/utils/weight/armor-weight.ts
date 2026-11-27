// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ArmorEquipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';
import type { MountedArmor } from '../../components';
import { resolveArmorEquipment } from '../../types/armor';

/**
 * Resolve the armor descriptor used by MegaMek's lab mass and cost.
 * An explicit unknown BLK armor tech level uses the Inner Sphere lookup,
 * even when the containing unit has a Clan tech base.
 */
export function resolveLabArmorEquipment(
  entity: BaseEntity,
  mounted: MountedArmor,
): ArmorEquipment {
  if (mounted.technology.scope !== 'Unknown') return mounted.armor;
  return resolveArmorEquipment(mounted.type, false, entity.getEquipmentRegistry()) ?? mounted.armor;
}
