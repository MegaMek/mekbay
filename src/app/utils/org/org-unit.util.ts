// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../../models/entity/base-entity';
import { InfantryBaseEntity } from '../../models/entity/entities/infantry/infantry-base-entity';
import { convertEntityToAlphaStrike } from '../../models/entity/utils/alpha-strike/alpha-strike-converter';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { FormationUnitLike } from '../formation-unit-facts.util';
import type { OrgUnit } from './org-types';

/** Catalog rows already contain exactly the structural facts the solver needs. */
export function orgUnitFromSummary(summary: UnitSummary): OrgUnit {
    return summary;
}

/**
 * Compile the organization solver's small, immutable input from canonical Entity data.
 * This deliberately is not a UnitSummary projection: loaded CBT units never cross
 * back into the catalog model.
 */
export function orgUnitFromEntity(entity: BaseEntity): OrgUnit {
    const alphaStrike = convertEntityToAlphaStrike(entity);
    return Object.freeze({
        id: entity.mulId(),
        uuid: entity.uuid(),
        name: entity.displayName(),
        type: entity.unitType(),
        subtype: entity.unitSubtype(),
        moveType: entity.getMotiveTypeAsString() ?? 'None',
        omni: entity.omni() ? 1 : 0,
        tons: entity.tonnage(),
        bv: entity.battleValue(),
        internal: entity.totalInternalPoints(),
        squads: entity instanceof InfantryBaseEntity ? entity.squadCount() : 1,
        as: alphaStrike,
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
