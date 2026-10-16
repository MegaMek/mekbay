// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { HeatAutomationPolicy } from './cbt-unit-runtime';
import type { MekRecordSheetSnapshot } from './mek-record-sheet';
import type { NonMekRecordSheetSnapshot } from './non-mek-record-sheet';

export interface RecordSheetHeatScale {
    readonly current: number;
    readonly pending?: number;
    readonly previous?: number;
    readonly projection?: number;
    readonly selectedWeapons?: number;
    readonly automaticProjection: boolean;
}

interface HeatScaleProjection {
    readonly projected: number;
    readonly generatesHeat: boolean;
}

/** Marker semantics shared by every heat-tracking family, for the SVG sheet and the horizontal tactical scale. */
function heatScaleMarkers(
    heat: Readonly<{ current: number; pending?: number; previous: number }>,
    policy: HeatAutomationPolicy,
    projection: HeatScaleProjection | null,
): Omit<RecordSheetHeatScale, 'selectedWeapons'> {
    const { current, pending, previous } = heat;
    const automatic = policy === 'automatic';
    const hasPendingResolution = projection !== null && (projection.generatesHeat || projection.projected !== current);
    const automaticProjection = automatic && pending === undefined && hasPendingResolution;
    const target = pending ?? (automaticProjection ? projection?.projected : undefined);
    const shown = projection !== null && (automaticProjection || (!automatic && hasPendingResolution));
    return {
        current, pending,
        previous: previous !== current && previous !== target ? previous : undefined,
        projection: shown ? projection.projected : undefined,
        automaticProjection,
    };
}

export function recordSheetHeatScale(
    snapshot: Pick<MekRecordSheetSnapshot, 'heat' | 'heatPolicy' | 'heatProjection' | 'equipment'>,
): RecordSheetHeatScale {
    const { current, pendingOverride: pending } = snapshot.heat;
    const projection = snapshot.heatProjection.kind === 'supported' ? snapshot.heatProjection.projection : null;
    const automatic = snapshot.heatPolicy === 'automatic';
    const markers = heatScaleMarkers({ current, pending, previous: snapshot.heat.previous }, snapshot.heatPolicy, projection && {
        projected: projection.projected,
        generatesHeat: projection.sources.some(source => source.value > 0),
    });
    let selectedWeapons: number | undefined;
    if (projection && !automatic) {
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
    return { ...markers, selectedWeapons };
}

/** Non-Mek markers: aerospace heat calculated to End Turn, with the arrow shown separately. */
export function nonMekRecordSheetHeatScale(
    snapshot: Pick<NonMekRecordSheetSnapshot, 'heat' | 'heatPolicy'>,
): RecordSheetHeatScale {
    const { current, pending, previous, projection } = snapshot.heat;
    return heatScaleMarkers({ current, pending: pending ?? undefined, previous }, snapshot.heatPolicy, projection && {
        projected: projection.calculated,
        generatesHeat: projection.generated > 0,
    });
}
