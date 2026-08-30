// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../common.model';
import {
    ecmModes,
    isAngelEcmEquipment,
    isECMMode,
    isEcmEquipment,
} from '../ecm-mode.model';
import type { Equipment } from '../equipment.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { isBapEquipment } from '../bap-equipment.model';
import { isElectronicInterfaceEquipment } from '../battle-armor-equipment.model';
import { c3EquipmentTraits, isNovaC3Equipment } from '../c3-network.model';
import { utilityEquipmentKind } from '../utility-equipment.model';

export const POWER_ENABLED_MODE = 'enabled';
export const POWER_ENABLING_MODE = 'enabling';
export const POWER_DISABLED_MODE = 'disabled';
export const POWER_DISABLING_MODE = 'disabling';

export type EquipmentPowerMode =
    | typeof POWER_ENABLED_MODE
    | typeof POWER_ENABLING_MODE
    | typeof POWER_DISABLED_MODE
    | typeof POWER_DISABLING_MODE;

export const EQUIPMENT_POWER_MODES: readonly EquipmentPowerMode[] = Object.freeze([
    POWER_ENABLED_MODE,
    POWER_ENABLING_MODE,
    POWER_DISABLED_MODE,
    POWER_DISABLING_MODE,
]);

const ECM_PENDING_PREFIX = 'ecm-pending:';
export interface ElectronicComponentFact {
    readonly componentId: ComponentId;
    readonly equipment: Equipment;
    readonly mode?: string;
    readonly operational: boolean;
}

export interface ElectronicClaims {
    readonly ecm: boolean;
    readonly probe: boolean;
}

export interface EcmModeState {
    readonly current: ECMMode;
    readonly next: ECMMode;
    readonly pending: boolean;
}

export interface ElectronicComponentModeDefinition {
    readonly modes: readonly string[];
    readonly defaultMode: string;
}

export interface ElectronicModeUpdate {
    readonly componentId: ComponentId;
    readonly mode: string;
}

export type ElectronicModeRequestPlan =
    | Readonly<{ readonly kind: 'not-electronic' }>
    | Readonly<{ readonly kind: 'invalid' }>
    | Readonly<{ readonly kind: 'unchanged' }>
    | Readonly<{
        readonly kind: 'changed';
        readonly updates: readonly ElectronicModeUpdate[];
    }>;

export function isNovaCewsEquipment(equipment: Equipment | null | undefined): boolean {
    return isNovaC3Equipment(equipment);
}

export function isNovaCewsFlags(flags: ReadonlySet<string>): boolean {
    return c3EquipmentTraits(flags).networkTypes.includes('nova');
}

export function isStandaloneBapEquipment(equipment: Equipment | null | undefined): boolean {
    return isBapEquipment(equipment)
        && !isEcmEquipment(equipment)
        && !isNovaCewsEquipment(equipment);
}

export function isSearchlightEquipment(equipment: Equipment | null | undefined): boolean {
    return utilityEquipmentKind(equipment) === 'searchlight';
}

export function isGenericEndPhasePowerEquipment(
    equipment: Equipment | null | undefined,
    protoMek = false,
): boolean {
    const isElectronicInterface = isElectronicInterfaceEquipment(equipment);
    const generic = utilityEquipmentKind(equipment) === 'minesweeper' || isElectronicInterface;
    return generic && (!protoMek || !isElectronicInterface);
}

export function isPowerControlledEquipment(
    equipment: Equipment | null | undefined,
    protoMek = false,
): boolean {
    return isNovaCewsEquipment(equipment)
        || isStandaloneBapEquipment(equipment)
        || isSearchlightEquipment(equipment)
        || isGenericEndPhasePowerEquipment(equipment, protoMek);
}

/** Canonical user-facing modes and pristine default for shared electronic behavior. */
export function electronicComponentModes(
    equipment: Equipment | null | undefined,
    protoMek = false,
): ElectronicComponentModeDefinition | null {
    if (isPowerControlledEquipment(equipment, protoMek)) {
        return Object.freeze({ modes: EQUIPMENT_POWER_MODES, defaultMode: POWER_ENABLED_MODE });
    }
    if (equipment && isEcmEquipment(equipment) && !isNovaCewsEquipment(equipment)) {
        return Object.freeze({
            modes: ecmModes(isAngelEcmEquipment(equipment)),
            defaultMode: ECMMode.ECM,
        });
    }
    return null;
}

/** Modes accepted by persistence, including the sparse tagged ECM transition state. */
export function electronicRuntimeModes(
    equipment: Equipment | null | undefined,
    protoMek = false,
): readonly string[] {
    if (isPowerControlledEquipment(equipment, protoMek)) return EQUIPMENT_POWER_MODES;
    return equipment ? ecmRuntimeModes(equipment) : Object.freeze([]);
}

export function electronicClaims(
    equipment: Equipment | null | undefined,
): ElectronicClaims {
    const nova = isNovaCewsEquipment(equipment);
    return Object.freeze({
        ecm: nova || isEcmEquipment(equipment),
        probe: nova || isBapEquipment(equipment),
    });
}

export function powerMode(value: string | undefined): EquipmentPowerMode {
    return isEquipmentPowerMode(value) ? value : POWER_ENABLED_MODE;
}

export function isEquipmentPowerMode(value: unknown): value is EquipmentPowerMode {
    return typeof value === 'string' && EQUIPMENT_POWER_MODES.includes(value as EquipmentPowerMode);
}

/** Current-turn effects survive a queued shutdown and do not begin during startup. */
export function powerEffectivelyEnabled(value: string | undefined): boolean {
    const state = powerMode(value);
    return state === POWER_ENABLED_MODE || state === POWER_DISABLING_MODE;
}

/** State that will be effective after the End Phase settles. */
export function powerNextEnabled(value: string | undefined): boolean {
    const state = powerMode(value);
    return state === POWER_ENABLED_MODE || state === POWER_ENABLING_MODE;
}

export function nextPowerToggleMode(value: string | undefined): EquipmentPowerMode {
    switch (powerMode(value)) {
        case POWER_ENABLED_MODE: return POWER_DISABLING_MODE;
        case POWER_DISABLING_MODE: return POWER_ENABLED_MODE;
        case POWER_DISABLED_MODE: return POWER_ENABLING_MODE;
        case POWER_ENABLING_MODE: return POWER_DISABLED_MODE;
    }
}

export function settlePowerMode(value: string | undefined): EquipmentPowerMode {
    switch (powerMode(value)) {
        case POWER_ENABLING_MODE: return POWER_ENABLED_MODE;
        case POWER_DISABLING_MODE: return POWER_DISABLED_MODE;
        default: return powerMode(value);
    }
}

export function encodeEcmPendingMode(current: ECMMode, next: ECMMode): string {
    return `${ECM_PENDING_PREFIX}${current}:${next}`;
}

export function ecmModeState(
    equipment: Equipment,
    value: string | undefined,
): EcmModeState {
    const supported = ecmModes(isAngelEcmEquipment(equipment));
    const fallback = ECMMode.ECM;
    if (value?.startsWith(ECM_PENDING_PREFIX)) {
        const [current, next, extra] = value.slice(ECM_PENDING_PREFIX.length).split(':');
        if (extra === undefined
            && isECMMode(current)
            && isECMMode(next)
            && supported.includes(current)
            && supported.includes(next)) {
            return Object.freeze({ current, next, pending: true });
        }
    }
    const current = isECMMode(value) && supported.includes(value) ? value : fallback;
    return Object.freeze({ current, next: current, pending: false });
}

export function ecmRuntimeModes(equipment: Equipment): readonly string[] {
    if (!isEcmEquipment(equipment) || isNovaCewsEquipment(equipment)) return Object.freeze([]);
    const modes = ecmModes(isAngelEcmEquipment(equipment));
    return Object.freeze([
        ...modes,
        ...modes.flatMap(current => modes.map(next => encodeEcmPendingMode(current, next))),
    ]);
}

export function isEcmRuntimeMode(equipment: Equipment, value: string): boolean {
    return ecmRuntimeModes(equipment).includes(value);
}

export function currentRawEcmMode(fact: ElectronicComponentFact): ECMMode {
    if (isNovaCewsEquipment(fact.equipment)) {
        return powerEffectivelyEnabled(fact.mode) ? ECMMode.ECM : ECMMode.OFF;
    }
    return ecmModeState(fact.equipment, fact.mode).current;
}

export function nextRawEcmMode(fact: ElectronicComponentFact): ECMMode {
    if (isNovaCewsEquipment(fact.equipment)) {
        return powerNextEnabled(fact.mode) ? ECMMode.ECM : ECMMode.OFF;
    }
    return ecmModeState(fact.equipment, fact.mode).next;
}

export function currentRawProbePowered(fact: ElectronicComponentFact): boolean {
    return electronicClaims(fact.equipment).ecm
        ? currentRawEcmMode(fact) !== ECMMode.OFF
        : powerEffectivelyEnabled(fact.mode);
}

export function nextRawProbePowered(fact: ElectronicComponentFact): boolean {
    return electronicClaims(fact.equipment).ecm
        ? nextRawEcmMode(fact) !== ECMMode.OFF
        : powerNextEnabled(fact.mode);
}

export function hasPendingElectronicActivation(fact: ElectronicComponentFact): boolean {
    if (isNovaCewsEquipment(fact.equipment) || isStandaloneBapEquipment(fact.equipment)) {
        return powerMode(fact.mode) === POWER_ENABLING_MODE;
    }
    const state = ecmModeState(fact.equipment, fact.mode);
    return state.pending && state.next !== ECMMode.OFF;
}

export function effectiveEcmMode(
    facts: readonly ElectronicComponentFact[],
    componentId: ComponentId,
    next = false,
): ECMMode {
    const fact = facts.find(candidate => candidate.componentId === componentId);
    if (!fact || !electronicClaims(fact.equipment).ecm) return ECMMode.OFF;
    const raw = next ? nextRawEcmMode(fact) : currentRawEcmMode(fact);
    if (raw === ECMMode.OFF) return ECMMode.OFF;
    return preferredEcmSuite(facts, next)?.componentId === componentId ? raw : ECMMode.OFF;
}

export function activeProbeEffectivelyPowered(
    facts: readonly ElectronicComponentFact[],
    componentId: ComponentId,
    next = false,
): boolean {
    const fact = facts.find(candidate => candidate.componentId === componentId);
    if (!fact || !electronicClaims(fact.equipment).probe) return false;
    const powered = probePoweredForSelection(facts, fact, next);
    return powered && preferredProbeSuite(facts, next)?.componentId === componentId;
}

export function presentedProbePowerMode(
    facts: readonly ElectronicComponentFact[],
    componentId: ComponentId,
): EquipmentPowerMode {
    const fact = facts.find(candidate => candidate.componentId === componentId);
    if (!fact) return POWER_DISABLED_MODE;
    const state = powerMode(fact.mode);
    if (state === POWER_ENABLING_MODE || state === POWER_DISABLING_MODE) return state;
    return activeProbeEffectivelyPowered(facts, componentId, true)
        ? POWER_ENABLED_MODE
        : POWER_DISABLED_MODE;
}

export function presentedElectronicPowerMode(
    facts: readonly ElectronicComponentFact[],
    componentId: ComponentId,
): EquipmentPowerMode {
    const fact = facts.find(candidate => candidate.componentId === componentId);
    if (!fact) return POWER_DISABLED_MODE;
    const raw = powerMode(fact.mode);
    if (raw === POWER_ENABLING_MODE || raw === POWER_DISABLING_MODE) return raw;
    if (isStandaloneBapEquipment(fact.equipment)) {
        return presentedProbePowerMode(facts, componentId);
    }
    if (isNovaCewsEquipment(fact.equipment)) {
        return effectiveEcmMode(facts, componentId, true) === ECMMode.OFF
            ? POWER_DISABLED_MODE
            : POWER_ENABLED_MODE;
    }
    return raw;
}

export function cancelPendingElectronicActivation(
    equipment: Equipment,
    value: string | undefined,
): string | undefined {
    if (isNovaCewsEquipment(equipment) || isStandaloneBapEquipment(equipment)) {
        return powerMode(value) === POWER_ENABLING_MODE ? POWER_DISABLED_MODE : value;
    }
    const state = ecmModeState(equipment, value);
    return state.pending && state.next !== ECMMode.OFF ? state.current : value;
}

export function settleElectronicMode(
    equipment: Equipment,
    value: string | undefined,
): string | undefined {
    if (isPowerControlledEquipment(equipment)) return settlePowerMode(value);
    if (!isEcmEquipment(equipment)) return value;
    const state = ecmModeState(equipment, value);
    return state.pending ? state.next : state.current;
}

export function electronicOffMode(equipment: Equipment): string {
    return isPowerControlledEquipment(equipment) ? POWER_DISABLED_MODE : ECMMode.OFF;
}

/**
 * Validate one delayed electronic selection and return its complete atomic mode update.
 * Competing startups are cancelled here so both Mek and non-Mek runtimes share the same
 * last-selection-wins rule without reconstructing mutable mounted-equipment state.
 */
export function planElectronicModeRequest(
    facts: readonly ElectronicComponentFact[],
    componentId: ComponentId,
    requestedMode: string,
    protoMek = false,
): ElectronicModeRequestPlan {
    const selected = facts.find(fact => fact.componentId === componentId);
    if (!selected) return Object.freeze({ kind: 'not-electronic' });
    const powerControlled = isPowerControlledEquipment(selected.equipment, protoMek);
    const ecmControlled = isEcmEquipment(selected.equipment)
        && !isNovaCewsEquipment(selected.equipment);
    if (!powerControlled && !ecmControlled) return Object.freeze({ kind: 'not-electronic' });
    if (!selected.operational) return Object.freeze({ kind: 'invalid' });

    let selectedMode: string;
    let activating: boolean;
    if (powerControlled) {
        const presented = presentedElectronicPowerMode(facts, componentId);
        if (requestedMode !== nextPowerToggleMode(presented)) {
            return Object.freeze({ kind: 'invalid' });
        }
        selectedMode = requestedMode;
        activating = requestedMode === POWER_ENABLING_MODE;
    } else {
        const requested = ecmModeState(selected.equipment, requestedMode);
        if (requested.pending || requested.current !== requestedMode) {
            return Object.freeze({ kind: 'invalid' });
        }
        if (effectiveEcmMode(facts, componentId, true) === requested.current) {
            return Object.freeze({ kind: 'unchanged' });
        }
        const current = ecmModeState(selected.equipment, selected.mode).current;
        selectedMode = encodeEcmPendingMode(current, requested.current);
        activating = requested.current !== ECMMode.OFF;
    }

    const updates = new Map<ComponentId, string>([[componentId, selectedMode]]);
    if (activating) {
        const selectedClaims = electronicClaims(selected.equipment);
        for (const other of facts) {
            if (other.componentId === componentId) continue;
            const otherClaims = electronicClaims(other.equipment);
            if ((!selectedClaims.ecm || !otherClaims.ecm)
                && (!selectedClaims.probe || !otherClaims.probe)
                || !hasPendingElectronicActivation(other)) continue;
            const mode = cancelPendingElectronicActivation(other.equipment, other.mode);
            if (mode !== undefined) updates.set(other.componentId, mode);
        }
    }
    return Object.freeze({
        kind: 'changed',
        updates: Object.freeze([...updates].map(([id, mode]) =>
            Object.freeze({ componentId: id, mode }))),
    });
}

/** Complete queued power/ECM transitions and deactivate suites displaced by a startup. */
export function planElectronicSettlement(
    facts: readonly ElectronicComponentFact[],
    protoMek = false,
): readonly ElectronicModeUpdate[] {
    const activating = facts.filter(hasPendingElectronicActivation);
    const updates = new Map<ComponentId, string>();
    for (const fact of facts) {
        if (!isPowerControlledEquipment(fact.equipment, protoMek)
            && !isEcmEquipment(fact.equipment)) continue;
        const mode = isPowerControlledEquipment(fact.equipment, protoMek)
            ? settlePowerMode(fact.mode)
            : settleElectronicMode(fact.equipment, fact.mode);
        if (mode !== undefined && mode !== fact.mode) updates.set(fact.componentId, mode);
    }
    for (const selected of activating) {
        const selectedClaims = electronicClaims(selected.equipment);
        for (const other of facts) {
            if (other.componentId === selected.componentId) continue;
            const otherClaims = electronicClaims(other.equipment);
            if ((!selectedClaims.ecm || !otherClaims.ecm)
                && (!selectedClaims.probe || !otherClaims.probe)) continue;
            updates.set(other.componentId, isPowerControlledEquipment(other.equipment, protoMek)
                ? POWER_DISABLED_MODE
                : ECMMode.OFF);
        }
    }
    return Object.freeze([...updates].map(([componentId, mode]) =>
        Object.freeze({ componentId, mode })));
}

function preferredEcmSuite(
    facts: readonly ElectronicComponentFact[],
    next: boolean,
): ElectronicComponentFact | undefined {
    const candidates = facts.filter(fact => fact.operational
        && electronicClaims(fact.equipment).ecm
        && (next ? nextRawEcmMode(fact) : currentRawEcmMode(fact)) !== ECMMode.OFF);
    const activating = next ? candidates.filter(hasPendingElectronicActivation) : [];
    const selection = activating.length > 0 ? activating : candidates;
    return selection.find(fact => isAngelEcmEquipment(fact.equipment)) ?? selection[0];
}

function preferredProbeSuite(
    facts: readonly ElectronicComponentFact[],
    next: boolean,
): ElectronicComponentFact | undefined {
    const candidates = facts.filter(fact => fact.operational
        && electronicClaims(fact.equipment).probe
        && probePoweredForSelection(facts, fact, next));
    const activating = next ? candidates.filter(hasPendingElectronicActivation) : [];
    if (activating.length > 0) return activating[0];
    return candidates.find(fact => electronicClaims(fact.equipment).ecm) ?? candidates[0];
}

function probePoweredForSelection(
    facts: readonly ElectronicComponentFact[],
    fact: ElectronicComponentFact,
    next: boolean,
): boolean {
    return electronicClaims(fact.equipment).ecm
        ? effectiveEcmMode(facts, fact.componentId, next) !== ECMMode.OFF
        : next ? nextRawProbePowered(fact) : currentRawProbePowered(fact);
}
