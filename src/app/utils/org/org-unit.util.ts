// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../../models/entity/base-entity';
import { InfantryBaseEntity } from '../../models/entity/entities/infantry/infantry-base-entity';
import { alphaStrikeUnitType } from '../../models/entity/utils/alpha-strike/foundation/unit-classification';
import { alphaStrikeMovement } from '../../models/entity/utils/alpha-strike/foundation/movement';
import { collectAlphaStrikeInfantrySpecials } from '../../models/entity/utils/alpha-strike/specials/core-specials';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { FormationUnitLike } from '../formation-unit-facts.util';
import type { OrgEntityUnit, OrgUnit } from './org-types';

/** Catalog rows already contain exactly the structural facts the solver needs. */
export function orgUnitFromSummary(summary: UnitSummary): OrgUnit {
    return summary;
}

/**
 * Compile the organization solver's small, immutable input from canonical Entity data.
 * This deliberately is not a UnitSummary projection: loaded CBT units never cross
 * back into the catalog model.
 */
export function orgUnitFromEntity(entity: BaseEntity): OrgEntityUnit {
    const type = alphaStrikeUnitType(entity);
    const infantrySpecials = collectAlphaStrikeInfantrySpecials(entity, type);
    return Object.freeze({
        mul1id: entity.mulId(),
        uuid: entity.uuid(),
        name: entity.displayName(),
        type: entity.unitType(),
        subtype: entity.unitSubtype(),
        moveType: entity.getMotiveTypeAsString() ?? 'None',
        omni: entity.omni() ? 1 : 0,
        tons: entity.tonnage(),
        internal: entity.totalInternalPoints(),
        squads: entity instanceof InfantryBaseEntity ? entity.squadCount() : 1,
        transportSpecials: Object.freeze((['MEC', 'XMEC'] as const).filter(special => infantrySpecials.has(special))),
        as: Object.freeze({
            TP: type,
            MVm: alphaStrikeMovement(entity).values,
        }),
    });
}

/** Entity wins whenever a loaded formation member exposes both representations. */
export function orgUnitFromFormationUnit(unit: FormationUnitLike): OrgUnit {
    const entity = unit.getFormationEntity?.();
    if (entity) return orgUnitFromEntity(entity);

    const summary = unit.getFormationSummary?.();
    if (summary) return orgUnitFromSummary(summary);

    throw new Error('Formation unit has neither Entity nor catalog organization facts');
}
