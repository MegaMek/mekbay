// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BaseEntity } from '../models/entity/base-entity';
import type { UnitSummary } from '../models/unit-summary.model';
import {
  getDefaultSpriteAssignmentKeyForFacts,
  resolveUnitSpriteAssignmentPath,
  type UnitSpriteAssignmentFacts,
  type UnitSpriteAssignments,
} from './unit-sprite-assignment-resolver';

export type UnitIconResolver = (entity: BaseEntity) => string;

function spriteAssignmentFacts(entity: BaseEntity | UnitSummary): UnitSpriteAssignmentFacts {
  if (!(entity instanceof BaseEntity)) {
    return {
      resolvedIconPath: entity.icon,
      displayName: `${entity.chassis} ${entity.model}`.trim(),
      fullChassis: entity.chassis,
      entityType: entity.entityType,
      weightClass: entity.weightClass === 'Ultra Light/PA(L)/Exoskeleton' ? 'Ultra Light'
        : entity.weightClass === 'Colossal/Super-Heavy' ? 'Super Heavy' : entity.weightClass,
      motiveType: entity.moveType,
      chassisConfig: entity.subtype === 'Land-Air BattleMek' ? 'LAM'
        : entity.subtype.startsWith('QuadVee') ? 'QuadVee' : entity.moveType,
    };
  }
  return {
    iconPath: entity.iconPath(),
    displayName: entity.displayName(),
    fullChassis: entity.fullChassis(),
    entityType: entity.entityType,
    weightClass: entity.weightClass(),
    motiveType: entity.motiveType(),
    ...('chassisConfig' in entity
      ? { chassisConfig: (entity as BaseEntity & { readonly chassisConfig: string }).chassisConfig }
      : {}),
  };
}

/** Mirrors MegaMek's `MekTileset.genericFor` selection for supported entities. */
export function getDefaultSpriteAssignmentKey(entity: BaseEntity): string {
  return getDefaultSpriteAssignmentKeyForFacts(spriteAssignmentFacts(entity));
}

/**
 * Explicit sprites precede MegaMek's exact, chassis and family assignments.
 */
export function resolveUnitSpritePath(
  entity: BaseEntity | UnitSummary,
  assignments: UnitSpriteAssignments | undefined,
  isAvailable?: (path: string) => boolean,
): string {
  return resolveUnitSpriteAssignmentPath(spriteAssignmentFacts(entity), assignments, isAvailable) ?? '';
}

export function createUnitIconResolver(assignments: UnitSpriteAssignments | undefined): UnitIconResolver {
  return entity => resolveUnitSpritePath(entity, assignments);
}
