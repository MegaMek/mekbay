// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForceUnit } from '../models/force-unit.model';
import type { UnitGroup } from '../models/force.model';
import { formationHasTargetCopyEffect } from './formation-type.model';

/** A target must be a different, non-empty formation that does not itself copy another formation. */
export function isValidFormationTarget<TUnit extends ForceUnit>(
    owner: UnitGroup<TUnit>,
    candidate: UnitGroup<TUnit> | null | undefined,
): candidate is UnitGroup<TUnit> {
    return !!candidate
        && candidate.force === owner.force
        && candidate.id !== owner.id
        && candidate.units().length > 0
        && !!candidate.activeFormation()
        && !formationHasTargetCopyEffect(candidate.activeFormation());
}

export function getFormationTargetCandidates<TUnit extends ForceUnit>(
    owner: UnitGroup<TUnit>,
): UnitGroup<TUnit>[] {
    return owner.force.groups()
        .filter((candidate): candidate is UnitGroup<TUnit> => (
            isValidFormationTarget(owner, candidate as UnitGroup<TUnit>)
        ));
}

export function resolveFormationTargetGroup<TUnit extends ForceUnit>(
    owner: UnitGroup<TUnit>,
): UnitGroup<TUnit> | null {
    if (!formationHasTargetCopyEffect(owner.activeFormation())) {
        return null;
    }

    const targetId = owner.formationTargetGroupId();
    if (!targetId) {
        return null;
    }

    const target = owner.force.groups().find((candidate) => candidate.id === targetId) as UnitGroup<TUnit> | undefined;
    return isValidFormationTarget(owner, target) ? target : null;
}

/**
 * Drop a persisted target when the owning formation no longer copies another
 * formation, or when the referenced group is no longer a legal target.
 */
export function clearInvalidFormationTargetSelection<TUnit extends ForceUnit>(
    owner: UnitGroup<TUnit>,
): boolean {
    if (!owner.formationTargetGroupId() || resolveFormationTargetGroup(owner)) {
        return false;
    }

    owner.formationTargetGroupId.set(null);
    return true;
}

/**
 * Alpha Strike Support Formation copied SPAs remain chosen at setup, but are
 * only active while at least three units in the Support Formation are active.
 * Ordinary formations are unaffected by this predicate.
 */
export function isFormationTargetCopyBonusActive<TUnit extends ForceUnit>(
    group: UnitGroup<TUnit>,
): boolean {
    if (!formationHasTargetCopyEffect(group.activeFormation())) {
        return true;
    }
    return resolveFormationTargetGroup(group) !== null
        && group.units().filter((unit) => !unit.destroyed).length >= 3;
}
