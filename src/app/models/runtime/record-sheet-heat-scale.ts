// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { nextHeat, nextHeatAdjustment } from './cbt-unit-runtime';
import { selectedWeaponHeat, selectedWeaponRows } from './equipment-panel';
import { projectTurnHeatIfFired } from './turn-heat-ledger';
import type { MekRecordSheetSnapshot } from './mek-record-sheet';
import type { NonMekRecordSheetSnapshot } from './non-mek-record-sheet';

/** The heat a scale shows, with its effects: the pending arrow, otherwise the current heat. */
export function displayedHeat(scale: Pick<RecordSheetHeatScale, 'current' | 'pending'>): number {
    return Math.max(0, nextHeat({ current: scale.current, pendingOverride: scale.pending }));
}

export interface RecordSheetHeatScale {
    readonly current: number;
    readonly pending?: number;
    /** How far the player set NEXT from the calculated heat, which NEXT follows; absent when it is no adjustment. */
    readonly adjustment?: number;
    readonly previous?: number;
    readonly projection?: number;
    readonly selectedWeapons?: number;
    /**
     * Where End Turn puts the heat, as APPLY HEAT would: NEXT when the player set one, otherwise the calculated heat when
     * End Turn calculates it (Yes or Ask). The scale draws a bar from NOW to it.
     */
    readonly outcome?: number;
}

interface HeatScaleProjection {
    readonly projected: number;
    readonly generatesHeat: boolean;
}

/** Marker semantics shared by every heat-tracking family, for the SVG sheet and the horizontal tactical scale. */
function heatScaleMarkers(
    heat: Readonly<{ current: number; pending?: number; pendingOffset?: number; previous: number }>,
    endTurnCalculatesHeat: boolean,
    projection: HeatScaleProjection | null,
): Omit<RecordSheetHeatScale, 'selectedWeapons'> {
    const { current, pending, pendingOffset, previous } = heat;
    const shown = projection !== null && (projection.generatesHeat || projection.projected !== current);
    const outcome = pending ?? (endTurnCalculatesHeat && shown ? projection.projected : undefined);
    const adjustment = projection
        ? nextHeatAdjustment({ pendingOverride: pending, pendingOffset }, projection.projected)
        : undefined;
    return {
        current, pending,
        ...(adjustment ? { adjustment } : {}),
        previous: previous !== current && previous !== outcome ? previous : undefined,
        projection: shown ? projection.projected : undefined,
        ...(outcome === undefined ? {} : { outcome }),
    };
}

export function recordSheetHeatScale(
    snapshot: Pick<MekRecordSheetSnapshot, 'heat' | 'endTurnCalculatesHeat' | 'heatProjection' | 'equipment'>
        & Partial<Pick<MekRecordSheetSnapshot, 'physicalAttacks'>>,
): RecordSheetHeatScale {
    const { current, pendingOverride: pending } = snapshot.heat;
    const projection = snapshot.heatProjection.kind === 'supported' ? snapshot.heatProjection.projection : null;
    const markers = heatScaleMarkers({ current, pending, pendingOffset: snapshot.heat.pendingOffset,
        previous: snapshot.heat.previous }, snapshot.endTurnCalculatesHeat, projection && {
        projected: projection.projected,
        generatesHeat: projection.sources.some(source => source.value > 0),
    });
    // The same selection the equipment dialog fires: its weapons and its heat-making physical attacks.
    const fire = selectedWeaponHeat({
        components: snapshot.equipment,
        physicalAttacks: snapshot.physicalAttacks?.kind === 'supported' ? snapshot.physicalAttacks.attacks : [],
    });
    const selectedWeapons = projection && fire.hasSelection
        ? projectTurnHeatIfFired(projection, fire.value,
            new Set(selectedWeaponRows(snapshot.equipment).map(row => row.componentId))).projected
        : undefined;
    return { ...markers, selectedWeapons };
}

/** Non-Mek markers: aerospace heat calculated to End Turn, with the arrow shown separately. */
export function nonMekRecordSheetHeatScale(
    snapshot: Pick<NonMekRecordSheetSnapshot, 'heat' | 'endTurnCalculatesHeat'>,
): RecordSheetHeatScale {
    const { current, pending, pendingOffset, previous, projection } = snapshot.heat;
    return heatScaleMarkers({ current, pending: pending ?? undefined, pendingOffset, previous },
        snapshot.endTurnCalculatesHeat, projection && {
        projected: projection.calculated,
        generatesHeat: projection.generated > 0,
    });
}
