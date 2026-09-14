// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekRecordSheetSnapshot } from './mek-record-sheet';

export interface RecordSheetHeatScale {
    readonly current: number;
    readonly pending?: number;
    readonly previous?: number;
    readonly projection?: number;
    readonly selectedWeapons?: number;
    readonly automaticProjection: boolean;
}

/** Shared marker semantics for the SVG sheet and the horizontal tactical scale. */
export function recordSheetHeatScale(
    snapshot: Pick<MekRecordSheetSnapshot, 'heat' | 'heatPolicy' | 'heatProjection' | 'equipment'>,
): RecordSheetHeatScale {
    const { current, pendingOverride: pending, previous } = snapshot.heat;
    const projection = snapshot.heatProjection.kind === 'supported' ? snapshot.heatProjection.projection : null;
    const automatic = snapshot.heatPolicy === 'automatic';
    const automaticProjection = automatic && pending === undefined && projection?.hasPendingResolution === true;
    const target = pending ?? (automaticProjection ? projection?.projected : undefined);
    let projected: number | undefined;
    let selectedWeapons: number | undefined;
    if (projection) {
        if (automaticProjection || (!automatic && (projection.sources.some(source => source.value > 0)
            || projection.projected !== current))) {
            projected = projection.projected;
        }
        if (!automatic) {
            const selected = snapshot.equipment.filter(row => row.status === 'available'
                && row.weapon?.selectable === true && row.weapon.selection !== undefined);
            if (selected.length > 0) {
                const selectedIds = new Set(selected.map(row => row.componentId));
                const sources = projection.sources.filter(source => source.id !== 'weapons'
                    && (source.replacedByFiringEntryId === undefined || !selectedIds.has(source.replacedByFiringEntryId)));
                const generated = sources.reduce((total, source) => total + source.value, 0)
                    + selected.reduce((total, row) => total + (row.weapon?.firingHeat ?? 0), 0);
                selectedWeapons = current + generated - Math.min(projection.remainingDissipation, current + generated);
            }
        }
    }
    return {
        current, pending,
        previous: previous !== current && previous !== target ? previous : undefined,
        projection: projected, selectedWeapons, automaticProjection,
    };
}
