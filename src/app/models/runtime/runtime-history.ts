// SPDX-License-Identifier: GPL-3.0-or-later

import type { JsonValue } from '../persisted-unit-state';

/** Stable wire IDs. Existing numeric meanings must never be reassigned. */
export const RUNTIME_HISTORY_MESSAGE = Object.freeze({
    UNIT_ACTION: 0,
    FORCE_ACTION: 1,
    DAMAGE_ARMOR: 2,
    REPAIR_ARMOR: 3,
    DAMAGE_INTERNAL: 4,
    REPAIR_INTERNAL: 5,
    DAMAGE_CRITICAL: 6,
    REPAIR_CRITICAL: 7,
    COMPONENT_STATUS: 8,
    PHASE_COMMITTED: 9,
    PHASE_DISCARDED: 10,
    TURN_ENDED: 11,
    CONDITION_CHANGED: 12,
    CREW_CHANGED: 13,
    AMMO_CHANGED: 14,
    WEAPONS_FIRED: 16,
    EQUIPMENT_CHANGED: 17,
    HEAT_CHANGED: 18,
    UNIT_REPAIRED: 19,
    C3_CHANGED: 20,
    CREW_SKILL_CHANGED: 21,
    LOCATION_CONDITION_CHANGED: 22,
    MEK_ACTION_CHANGED: 23,
    MOVEMENT_CHANGED: 24,
    AIRBORNE_CHANGED: 25,
    COMPONENT_MODE_CHANGED: 26,
    SPOTTING_CHANGED: 27,
    COVER_CHANGED: 28,
} as const);

export type RuntimeHistoryMessageId = typeof RUNTIME_HISTORY_MESSAGE[keyof typeof RUNTIME_HISTORY_MESSAGE];

const RUNTIME_HISTORY_MESSAGE_IDS = new Set<number>(Object.values(RUNTIME_HISTORY_MESSAGE));

export function isRuntimeHistoryMessageId(value: unknown): value is RuntimeHistoryMessageId {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && RUNTIME_HISTORY_MESSAGE_IDS.has(value);
}

/** One compact message inside its containing turn/phase arrays. */
export type SerializedRuntimeHistoryMessage = readonly [
    messageId: RuntimeHistoryMessageId,
    ...data: JsonValue[],
];

export interface SerializedRuntimeHistoryTurn {
    /** Turn number. */
    readonly n: number;
    /** Ordered phases containing ordered compact messages. */
    readonly p: readonly (readonly SerializedRuntimeHistoryMessage[])[];
}

/**
 * Durable history keeps each unit instance ID once. Unit-scoped messages store the
 * corresponding numeric index as their first payload value.
 */
export interface SerializedRuntimeHistory {
    readonly u: readonly string[];
    readonly t: readonly SerializedRuntimeHistoryTurn[];
}

export interface RuntimeHistoryEvent {
    readonly turn: number;
    readonly phase: number;
    readonly message: SerializedRuntimeHistoryMessage;
}

export interface RuntimeHistoryEventInput {
    readonly turn?: number;
    readonly phase?: number;
    readonly messageId: RuntimeHistoryMessageId;
    readonly data?: readonly JsonValue[];
}

export interface RuntimeHistoryFormatContext {
    unitLabel(instanceId: string): string;
    targetLabel?(
        instanceId: string,
        kind: RuntimeHistoryTargetKind,
        targetId: string,
    ): string;
    crewLabel?(instanceId: string, occurrence: number): string;
    ammoLabel?(instanceId: string, munitionKey: string): string;
    readonly omitUnitLabel?: boolean;
}

export type RuntimeHistoryTargetKind = 'armor' | 'internal' | 'critical' | 'component';

export function appendSerializedRuntimeHistoryTurn(
    history: SerializedRuntimeHistory,
    turn: SerializedRuntimeHistoryTurn,
): SerializedRuntimeHistory {
    const units = [...history.u];
    const unitIndexes = new Map(units.map((instanceId, index) => [instanceId, index] as const));
    const phases = turn.p.map(phase => Object.freeze(phase.map(message => {
        if (!runtimeHistoryMessageCanReferenceUnit(message[0]) || typeof message[1] !== 'string') {
            return message;
        }
        let unitIndex = unitIndexes.get(message[1]);
        if (unitIndex === undefined) {
            unitIndex = units.length;
            units.push(message[1]);
            unitIndexes.set(message[1], unitIndex);
        }
        return Object.freeze([
            message[0],
            unitIndex,
            ...message.slice(2),
        ]) as SerializedRuntimeHistoryMessage;
    })));
    return Object.freeze({
        u: Object.freeze(units),
        t: Object.freeze([...history.t, Object.freeze({ n: turn.n, p: Object.freeze(phases) })]),
    });
}

export function expandSerializedRuntimeHistoryMessage(
    history: SerializedRuntimeHistory,
    message: SerializedRuntimeHistoryMessage,
): SerializedRuntimeHistoryMessage {
    if (!runtimeHistoryMessageCanReferenceUnit(message[0]) || typeof message[1] !== 'number') {
        return message;
    }
    const instanceId = history.u[message[1]];
    if (instanceId === undefined) return message;
    return Object.freeze([
        message[0],
        instanceId,
        ...message.slice(2),
    ]) as SerializedRuntimeHistoryMessage;
}

export function runtimeHistoryMessageCanReferenceUnit(messageId: RuntimeHistoryMessageId): boolean {
    return messageId !== RUNTIME_HISTORY_MESSAGE.FORCE_ACTION
        && messageId !== RUNTIME_HISTORY_MESSAGE.C3_CHANGED;
}

export function runtimeHistoryMessageRequiresUnit(messageId: RuntimeHistoryMessageId): boolean {
    return runtimeHistoryMessageCanReferenceUnit(messageId)
        && messageId !== RUNTIME_HISTORY_MESSAGE.EQUIPMENT_CHANGED;
}

/** Expanded history rows carry their unit instance ID as the first payload value. */
export function runtimeHistoryMessageUnitId(
    message: SerializedRuntimeHistoryMessage,
): string | null {
    return runtimeHistoryMessageCanReferenceUnit(message[0]) && typeof message[1] === 'string'
        ? message[1]
        : null;
}

export function formatRuntimeHistoryMessage(
    message: SerializedRuntimeHistoryMessage,
    context: RuntimeHistoryFormatContext,
): string {
    const messageId = message[0];
    const data = message.slice(1);
    const instanceId = text(data[0]);
    const unit = () => context.unitLabel(instanceId);
    const scoped = (body: string) => context.omitUnitLabel === true
        ? body
        : `${unit()}: ${body}`;
    const target = (kind: RuntimeHistoryTargetKind) => context.targetLabel?.(
        instanceId,
        kind,
        text(data[1]),
    ) ?? text(data[1]);
    switch (messageId) {
        case RUNTIME_HISTORY_MESSAGE.UNIT_ACTION:
            return scoped(words(data[1]));
        case RUNTIME_HISTORY_MESSAGE.FORCE_ACTION:
            return words(data[0]);
        case RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR:
            return scoped(`${number(data[2])} armor damage at ${target('armor')}${pending(data[3])}`);
        case RUNTIME_HISTORY_MESSAGE.REPAIR_ARMOR:
            return scoped(`Repaired ${number(data[2])} armor at ${target('armor')}${pending(data[3])}`);
        case RUNTIME_HISTORY_MESSAGE.DAMAGE_INTERNAL:
            return scoped(`${number(data[2])} internal damage at ${target('internal')}${pending(data[3])}`);
        case RUNTIME_HISTORY_MESSAGE.REPAIR_INTERNAL:
            return scoped(`Repaired ${number(data[2])} internal at ${target('internal')}${pending(data[3])}`);
        case RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL:
            return scoped(criticalChange(false, number(data[2]), target('critical'), data[3]));
        case RUNTIME_HISTORY_MESSAGE.REPAIR_CRITICAL:
            return scoped(criticalChange(true, number(data[2]), target('critical'), data[3]));
        case RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS:
            return scoped(`${target('component')} is ${words(data[2])}${pending(data[3])}`);
        case RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED:
            return scoped('Committed pending changes');
        case RUNTIME_HISTORY_MESSAGE.PHASE_DISCARDED:
            return scoped('Discarded pending changes');
        case RUNTIME_HISTORY_MESSAGE.TURN_ENDED:
            return scoped('Ended turn');
        case RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED:
            return scoped(`${data[3] === true ? 'Set' : 'Cleared'} ${words(data[1])}`);
        case RUNTIME_HISTORY_MESSAGE.CREW_CHANGED:
            return scoped(formatCrewRuntimeChange(data, context, instanceId));
        case RUNTIME_HISTORY_MESSAGE.AMMO_CHANGED:
            return scoped('Updated ammunition');
        case RUNTIME_HISTORY_MESSAGE.WEAPONS_FIRED:
            return scoped(formatWeaponFire(data, context, instanceId, target('component')));
        case RUNTIME_HISTORY_MESSAGE.EQUIPMENT_CHANGED:
            return data[0] === undefined ? 'Updated equipment' : scoped('Updated equipment');
        case RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED:
            return data[0] === undefined ? 'Updated heat' : scoped(formatHeatChange(data));
        case RUNTIME_HISTORY_MESSAGE.UNIT_REPAIRED:
            return scoped('Repaired unit');
        case RUNTIME_HISTORY_MESSAGE.C3_CHANGED:
            return 'Updated C3 network';
        case RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED:
            return scoped(formatCrewSkillChange(data, context, instanceId));
        case RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED:
            return scoped(formatLocationConditionChange(data, target('internal')));
        case RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED:
            return scoped(formatMekActionChange(data));
        case RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED:
            return scoped(formatMovementChange(data));
        case RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED:
            return scoped(formatAirborneChange(data));
        case RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED:
            return scoped(`${target('component')} mode: ${mode(data[2])} → ${mode(data[3])}`);
        case RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED:
            return scoped(data[2] === true ? 'Declared spotting' : 'Stopped spotting');
        case RUNTIME_HISTORY_MESSAGE.COVER_CHANGED:
            return scoped(formatCoverChange(number(data[2])));
    }
}

function formatWeaponFire(
    data: readonly JsonValue[],
    context: RuntimeHistoryFormatContext,
    instanceId: string,
    weapon: string,
): string {
    const munitionKey = text(data[2]);
    if (!munitionKey) return `Fired ${weapon}`;
    const ammo = context.ammoLabel?.(instanceId, munitionKey) ?? munitionKey;
    return `Fired ${weapon} using ${ammo}`;
}

function formatMovementChange(data: readonly JsonValue[]): string {
    const mode = movementModeLabel(number(data[3]));
    if (mode === null) return 'Cleared movement';
    const distance = number(data[4]);
    return `Declared ${mode} ${distance} ${distance === 1 ? 'hex' : 'hexes'}`;
}

function formatAirborneChange(data: readonly JsonValue[]): string {
    const state = number(data[2]);
    return state === 1 ? 'Declared airborne'
        : state === 0 ? 'Declared ground'
            : 'Cleared airborne/ground declaration';
}

function formatCoverChange(cover: number): string {
    if (cover === 1) return 'Declared light cover';
    if (cover === 2) return 'Declared heavy cover';
    if (cover >= 3 && cover <= 5) return `Declared cover water depth ${cover - 2}`;
    if (cover >= 6 && cover <= 8) return `Declared cover building level ${cover - 5}`;
    return 'Cleared cover';
}

function mode(value: JsonValue | undefined): string {
    return typeof value === 'string' && value.trim() ? value : 'Default';
}

function movementModeLabel(value: number): string | null {
    return ({
        1: 'Stationary',
        2: 'Walk',
        3: 'Run',
        4: 'Jump',
        5: 'UMU',
        6: 'VTOL',
        7: 'Sprint',
    } as const)[value as 1 | 2 | 3 | 4 | 5 | 6] ?? null;
}

function criticalChange(
    repaired: boolean,
    count: number,
    target: string,
    pendingValue: JsonValue | undefined,
): string {
    const quantity = `${count === 1 ? '' : `${count} `}critical hit${count === 1 ? '' : 's'}`;
    const label = repaired ? `Repaired ${quantity}` : count === 1 ? 'Critical hit' : quantity;
    return `${label} on ${target}${pending(pendingValue)}`;
}

function formatHeatChange(data: readonly JsonValue[]): string {
    const kind = data[1];
    const before = number(data[2]);
    const after = number(data[3]);
    switch (kind) {
        case 0: return `Heat ${before} → ${after}`;
        case 1: return `Heat target ${before} → ${after}`;
        case 2: return `Heat sinks off ${before} → ${after}`;
        default: return 'Updated heat';
    }
}

function formatCrewRuntimeChange(
    data: readonly JsonValue[],
    context: RuntimeHistoryFormatContext,
    instanceId: string,
): string {
    const occurrence = number(data[1]);
    const label = context.crewLabel?.(instanceId, occurrence) ?? crewFallbackLabel(occurrence);
    const changes: string[] = [];
    const beforeWounds = number(data[2]);
    const afterWounds = number(data[3]);
    if (beforeWounds !== afterWounds) changes.push(`hits ${beforeWounds} → ${afterWounds}`);
    const beforeState = crewStateLabel(number(data[4]));
    const afterState = crewStateLabel(number(data[5]));
    if (beforeState !== afterState) changes.push(`state ${beforeState} → ${afterState}`);
    return changes.length === 0 ? `${label} state changed` : `${label}: ${changes.join('; ')}`;
}

function formatCrewSkillChange(
    data: readonly JsonValue[],
    context: RuntimeHistoryFormatContext,
    instanceId: string,
): string {
    const occurrence = number(data[1]);
    const label = context.crewLabel?.(instanceId, occurrence) ?? crewFallbackLabel(occurrence);
    const skill = data[2] === 0 ? 'Gunnery' : 'Piloting';
    return `${label}: ${skill} skill ${number(data[3])} → ${number(data[4])}`;
}

function formatLocationConditionChange(data: readonly JsonValue[], target: string): string {
    const condition = text(data[2]);
    const before = number(data[3]);
    const after = number(data[4]);
    const suffix = pending(data[5]);
    if (condition === 'blown-off') {
        if (before === after) return `${target} blow-off result absorbed${suffix}`;
        return after > 0 ? `${target} blown off${suffix}` : `${target} reattached${suffix}`;
    }
    if (condition === 'narc') {
        if (after > before) return `NARC pod attached to ${target}${suffix}`;
        const remaining = after > 0 ? ` (${after} remaining)` : '';
        return `NARC pod removed from ${target}${remaining}${suffix}`;
    }
    if (condition === 'flooded') {
        return after > 0 ? `${target} flooded${suffix}` : `${target} no longer flooded${suffix}`;
    }
    const label = words(condition);
    if (after === 0) return `Cleared ${label.toLowerCase()} at ${target}${suffix}`;
    if (before === 0 && after === 1) return `${target}: ${label}${suffix}`;
    return `${target}: ${label} ${before} → ${after}${suffix}`;
}

function formatMekActionChange(data: readonly JsonValue[]): string {
    return data[2] === 1 ? 'Shut down' : 'Started up';
}

function crewFallbackLabel(occurrence: number): string {
    return occurrence === 0 ? 'Pilot' : `Crew ${occurrence + 1}`;
}

function crewStateLabel(value: number): string {
    switch (value) {
        case 1: return 'unconscious';
        case 2: return 'ejected';
        case 3: return 'dead';
        case 4: return 'killed';
        case 5: return 'stunned';
        default: return 'conscious';
    }
}

function text(value: JsonValue | undefined): string {
    return typeof value === 'string' ? value : '';
}

function number(value: JsonValue | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function words(value: JsonValue | undefined): string {
    const valueText = text(value).replaceAll('-', ' ');
    return valueText.charAt(0).toUpperCase() + valueText.slice(1);
}

function pending(value: JsonValue | undefined): string {
    return value === 'pending' ? ' (pending)' : '';
}
