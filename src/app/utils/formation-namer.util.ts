// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { FormationTypeDefinition } from './formation-type.model';
import type { UnitGroup } from '../models/force.model';

/** Appends `*` when organization-level units were excluded from formation requirements. */
export function composeFormationDisplayName(
    definition: FormationTypeDefinition,
    group: UnitGroup,
    requirementsFiltered = false,
): string {
    const organizationalName = group.organizationalName();
    const suffix = requirementsFiltered ? ' *' : '';
    if (organizationalName && definition.name.includes(organizationalName)) {
        return definition.name + suffix;
    }
    if (organizationalName?.includes('Level')) {
        return organizationalName + ' - ' + definition.name + suffix;
    }
    return definition.name + ' ' + organizationalName + suffix;
}
