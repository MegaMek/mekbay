// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ImmutableIndex } from '../entity/immutable-collections';
import { compareText } from '../../utils/string.util';

/**
 * The heat ledger every heat-tracking unit keeps through a turn, 'Mek and aerospace alike. APPLY HEAT settles the turn
 * so far: the heat each source has produced is recorded as settled and the dissipation used is booked. Afterwards a
 * source counts only the heat it adds beyond what was settled, that heat meets only the heat sinks left over, and sinks
 * lost since give back the heat they had dissipated.
 */
export interface TurnHeatLedger {
    /** Heat settled per source id. */
    readonly settledHeat: ReadonlyMap<string, number>;
    /** Dissipation the settled heat used; absent until APPLY HEAT first settles the turn. */
    readonly heatDissipationConsumed?: number;
}

export interface TurnHeatSource {
    readonly id: string;
    readonly label: string;
    readonly value: number;
}

/** The heat source the sinks lost since APPLY HEAT give back. */
export const HEAT_DISSIPATION_DEFICIT_ID = 'heat-dissipation-deficit';

/** Bounds for a saved ledger: far beyond any unit's heat, yet small enough that a damaged save stays harmless. */
const MAX_SETTLED_SOURCES = 256;
const MAX_SOURCE_ID_LENGTH = 256;

/** Heat is a whole number of points; one bound serves every family, command and save format. */
export const MAX_HEAT_VALUE = 1_000_000;

/** Heat sources named for a component: `<kind>:<componentId>` (`componentHeatSourceId`). */
export const COMPONENT_HEAT_SOURCE_KINDS = ['ppc-capacitor', 'risc-viral-jammer', 'vibroblade', 'equipment', 'nova-cews',
    'mobile-hpg'] as const;

/** The id of the heat source a component produces. */
export function componentHeatSourceId(kind: (typeof COMPONENT_HEAT_SOURCE_KINDS)[number], componentId: string): string {
    return `${kind}:${componentId}`;
}

/** A source id the ledger holds: canonical text of at most 256 characters. */
export function isTurnHeatSourceId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_SOURCE_ID_LENGTH && value.trim() === value;
}

export const PRISTINE_TURN_HEAT_LEDGER: TurnHeatLedger = Object.freeze({
    settledHeat: new ImmutableIndex<string, number>([]),
});

/** The turn's heat from `current`: what the sources add beyond the settled heat, against the dissipation left. */
export function projectTurnHeat<T extends TurnHeatSource>(
    current: number,
    sources: readonly T[],
    capacity: number,
    ledger: TurnHeatLedger,
): Readonly<{
    sources: readonly T[];
    deficit: number;
    remaining: number;
    generated: number;
    dissipated: number;
    projected: number;
}> {
    const unsettled = sources.flatMap(source => {
        const value = source.value - (ledger.settledHeat.get(source.id) ?? 0);
        return value <= 0 ? [] : [value === source.value ? source : Object.freeze({ ...source, value })];
    });
    const consumed = ledger.heatDissipationConsumed ?? 0;
    const remaining = Math.max(0, capacity - consumed);
    const deficit = Math.max(0, consumed - capacity);
    const generated = unsettled.reduce((total, source) => total + source.value, 0) + deficit;
    // Settled heat is the player's for the turn so far: leftover sinks cool only heat generated since.
    const coolable = (ledger.heatDissipationConsumed === undefined ? current : 0) + generated;
    const dissipated = Math.min(remaining, coolable);
    return Object.freeze({
        sources: Object.freeze(unsettled),
        deficit,
        remaining,
        generated,
        dissipated,
        projected: Math.min(MAX_HEAT_VALUE, current + generated - dissipated),
    });
}

/** What a turn's heat projects from (`projectTurnHeat`): every source before the settled heat is taken off. */
export interface TurnHeatBasis {
    readonly current: number;
    readonly committedSources: readonly (TurnHeatSource & { readonly replacedByFiringEntryId?: string })[];
    readonly capacity: number;
    readonly ledger: TurnHeatLedger;
}

/**
 * The turn's heat if the selected weapons fire now: FIRED fires every selected weapon, so their `fireHeat` adds to the
 * weapons heat the turn already has. A source a selected weapon (`firing`) takes over when it fires, a charged
 * capacitor it discharges, counts with it.
 */
export function projectTurnHeatIfFired(
    basis: TurnHeatBasis,
    fireHeat: number,
    firing: ReadonlySet<string>,
): ReturnType<typeof projectTurnHeat> {
    const fired = basis.committedSources.find(source => source.id === 'weapons')?.value ?? 0;
    const sources = basis.committedSources.filter(source => source.id !== 'weapons'
        && (source.replacedByFiringEntryId === undefined || !firing.has(source.replacedByFiringEntryId)));
    return projectTurnHeat(basis.current,
        [...sources, { id: 'weapons', label: 'Weapons', value: fired + fireHeat }],
        basis.capacity, basis.ledger);
}

/**
 * The ledger once the turn so far settles: every source's heat now (`sources`, as projected before settling) is
 * settled, never less than before, and `dissipated` is booked against the cooling `capacity` left.
 */
export function settleTurnHeatLedger(
    ledger: TurnHeatLedger,
    capacity: number,
    sources: readonly TurnHeatSource[],
    dissipated: number,
): TurnHeatLedger {
    const settledHeat = new Map(ledger.settledHeat);
    for (const source of sources) {
        if (source.value > 0) settledHeat.set(source.id, Math.max(settledHeat.get(source.id) ?? 0, source.value));
    }
    return Object.freeze({
        settledHeat: sortedLedgerIndex(settledHeat),
        heatDissipationConsumed: Math.min(ledger.heatDissipationConsumed ?? 0, capacity) + dissipated,
    });
}

/** The ledger's sparse wire form, the same for every family's turn. */
export function serializeTurnHeatLedger(ledger: TurnHeatLedger) {
    return {
        ...(ledger.settledHeat.size === 0 ? {} : {
            settledHeat: Object.freeze([...ledger.settledHeat]
                .map(([sourceId, heat]) => Object.freeze({ sourceId, heat }))),
        }),
        ...(ledger.heatDissipationConsumed === undefined
            ? {}
            : { heatDissipationConsumed: ledger.heatDissipationConsumed }),
    };
}

/** Reads a saved ledger, as `serializeTurnHeatLedger` writes it; `fail` throws the caller's validation error. */
export function readTurnHeatLedger(
    settledHeat: unknown,
    heatDissipationConsumed: unknown,
    path: string,
    fail: (message: string, path: string) => never,
): TurnHeatLedger {
    if (settledHeat !== undefined && (!Array.isArray(settledHeat) || settledHeat.length === 0)) {
        fail('must be a non-empty array when present', `${path}.settledHeat`);
    }
    const entries = ((settledHeat ?? []) as unknown[]).map((row, index): readonly [unknown, unknown] => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)
            || Object.keys(row).some(key => key !== 'sourceId' && key !== 'heat')) {
            fail('must be { sourceId, heat }', `${path}.settledHeat[${index}]`);
        }
        return [(row as Record<string, unknown>)['sourceId'], (row as Record<string, unknown>)['heat']];
    });
    const ledger = canonicalTurnHeatLedger(entries, heatDissipationConsumed, path, fail);
    // The wire is canonical, as `serializeTurnHeatLedger` writes it.
    if ([...ledger.settledHeat.keys()].some((sourceId, index) => sourceId !== entries[index]![0])) {
        fail('sources must be unique and sorted', `${path}.settledHeat`);
    }
    return ledger;
}

/** Validates a ledger and returns it in canonical form, its sources sorted by id. */
export function canonicalTurnHeatLedger(
    settledHeat: Iterable<readonly [unknown, unknown]>,
    heatDissipationConsumed: unknown,
    path: string,
    fail: (message: string, path: string) => never,
): TurnHeatLedger {
    const entries = [...settledHeat];
    if (entries.length > MAX_SETTLED_SOURCES) {
        fail(`must hold at most ${MAX_SETTLED_SOURCES} sources`, `${path}.settledHeat`);
    }
    const ledger = new Map<string, number>();
    entries.forEach(([sourceId, heat], index) => {
        const entryPath = `${path}.settledHeat[${index}]`;
        if (!isTurnHeatSourceId(sourceId)) fail('source id must be canonical text', entryPath);
        if (typeof heat !== 'number' || !Number.isSafeInteger(heat) || heat <= 0 || heat > MAX_HEAT_VALUE) {
            fail(`heat must be a whole number from 1 to ${MAX_HEAT_VALUE}`, entryPath);
        }
        if (ledger.has(sourceId)) fail('source ids must be unique', entryPath);
        ledger.set(sourceId, heat);
    });
    if (heatDissipationConsumed !== undefined && (typeof heatDissipationConsumed !== 'number'
        || !Number.isSafeInteger(heatDissipationConsumed)
        || heatDissipationConsumed < 0 || heatDissipationConsumed > MAX_HEAT_VALUE)) {
        fail(`must be a whole number from 0 to ${MAX_HEAT_VALUE}`, `${path}.heatDissipationConsumed`);
    }
    return Object.freeze({
        settledHeat: sortedLedgerIndex(ledger),
        ...(heatDissipationConsumed === undefined ? {} : { heatDissipationConsumed }),
    });
}

function sortedLedgerIndex(ledger: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
    return new ImmutableIndex([...ledger].sort(([left], [right]) => compareText(left, right)));
}
