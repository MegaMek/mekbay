// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../models/entity/base-entity';
import {
  getDefaultSpriteAssignmentKeyForFacts,
  resolveUnitSpriteAssignmentPath,
  type UnitSpriteAssignmentFacts,
  type UnitSpriteAssignments,
} from './unit-sprite-assignment-resolver';

export type UnitIconResolver = (entity: BaseEntity) => string;

function spriteAssignmentFacts(entity: BaseEntity): UnitSpriteAssignmentFacts {
  return {
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
 * Resolves the image path selected by MegaMek's `MekTileset.entryFor`.
 * Exact unit mappings take precedence over chassis mappings and family defaults.
 */
export function resolveUnitSpritePath(entity: BaseEntity, assignments: UnitSpriteAssignments | undefined): string {
  return resolveUnitSpriteAssignmentPath(spriteAssignmentFacts(entity), assignments) ?? '';
}

export function createUnitIconResolver(assignments: UnitSpriteAssignments | undefined): UnitIconResolver {
  return entity => resolveUnitSpritePath(entity, assignments);
}
