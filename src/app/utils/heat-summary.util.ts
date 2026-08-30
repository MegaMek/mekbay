// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

const HEAT_DISSIPATION_DEFICIT_SOURCE_ID = 'heat-dissipation-deficit';

export interface HeatSummarySource {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    /** Optional label used only by compact presentations. */
    readonly group?: string;
    readonly inventorySelection?: boolean;
}

export interface HeatSummaryRow {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly kind: 'source' | 'sink';
    readonly inventorySelection?: boolean;
}

export interface HeatSummaryOptions {
    readonly groupSources?: boolean;
}

/** Builds source and cooling rows without collapsing detail unless explicitly requested. */
export function buildHeatSummaryRows(
    sources: readonly HeatSummarySource[],
    dissipationBalance: number,
    consumedDissipation: number,
    projectedHeat: number,
    options: HeatSummaryOptions = {},
): HeatSummaryRow[] {
    const rows: HeatSummaryRow[] = [];
    const groupedRowIndexes = new Map<string, number>();
    for (const source of sources) {
        if (source.value <= 0 || source.id === HEAT_DISSIPATION_DEFICIT_SOURCE_ID) continue;
        const group = options.groupSources ? source.group?.trim() : undefined;
        const groupKey = group
            ?.toLowerCase()
            .replace(/[^a-z0-9]+/gu, '-')
            .replace(/^-|-$/gu, '');
        if (group && groupKey) {
            const existingIndex = groupedRowIndexes.get(groupKey);
            if (existingIndex !== undefined) {
                const existing = rows[existingIndex];
                rows[existingIndex] = {
                    ...existing,
                    value: existing.value + source.value,
                    ...(source.inventorySelection ? { inventorySelection: true } : {}),
                };
                continue;
            }
            groupedRowIndexes.set(groupKey, rows.length);
            rows.push({
                id: groupKey,
                label: group,
                value: source.value,
                kind: 'source',
                ...(source.inventorySelection ? { inventorySelection: true } : {}),
            });
            continue;
        }
        rows.push({
            id: source.id,
            label: source.id === 'damaged-engine' ? 'Engine' : source.label,
            value: source.value,
            kind: 'source',
            ...(source.inventorySelection ? { inventorySelection: true } : {}),
        });
    }

    const balance = Number.isFinite(dissipationBalance) ? dissipationBalance : 0;
    const consumed = Number.isFinite(consumedDissipation) ? Math.max(0, consumedDissipation) : 0;
    const clippedAtZero = balance > 0 && consumed < balance && projectedHeat === 0;
    if (balance < 0 || (balance > 0 && consumed > 0)) {
        rows.push({
            id: 'heat-sink',
            label: clippedAtZero ? `Sink (${balance})` : 'Sink',
            value: balance > 0 ? -(clippedAtZero ? consumed : balance) : Math.abs(balance),
            kind: 'sink',
        });
    }
    return rows;
}
