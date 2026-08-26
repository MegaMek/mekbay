// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { getUnitTechBaseDisplay } from '../models/tech.model';

/**
 * Initializes the small mutable presentation/search overlay on one detached
 * IndexedDB UnitSummary. Publication remains immutable on disk; duplicating
 * every 10k+ in-memory row at startup only creates a second large object graph
 * before the catalog can become interactive.
 */
export function materializeUnitSummaryView(summary: UnitSummary): UnitSummary {
    if (Object.prototype.hasOwnProperty.call(summary, 'fluff')
        || Object.prototype.hasOwnProperty.call(summary, 'sheets')) {
        throw new Error('Catalog UnitSummary cannot contain native-source fluff or sheet paths');
    }
    // IndexedDB rows are detached and writable, so the 10k+ core catalog avoids
    // a second object graph. Smaller provider catalogs may deliberately publish
    // frozen summaries; copy only those rows before attaching transient state.
    const view = Object.isExtensible(summary) ? summary : { ...summary };
    // Search preparation attaches parsed damage values and may normalize jump-only
    // movement on these two small branches. Immutable publications deep-freeze
    // them, so detach only the mutable Alpha Strike overlay instead of cloning the
    // complete summary graph.
    if (view.as && (
        !Object.isExtensible(view.as)
        || !Object.isExtensible(view.as.dmg)
        || !Object.isExtensible(view.as.MVm)
    )) {
        view.as = {
            ...view.as,
            dmg: { ...view.as.dmg },
            MVm: { ...view.as.MVm },
        };
    }
    view.engine ??= '';
    view._searchKey = '';
    view._displayType = '';
    view._techBaseDisplay = getUnitTechBaseDisplay(view);
    view._maxRange = 0;
    view._weightedMaxRange = 0;
    view._dissipationEfficiency = 0;
    view._mdSumNoPhysical = 0;
    view._mdSumNoPhysicalNoOneshots = 0;
    view._nameTags = [];
    view._chassisTags = [];
    return view;
}
