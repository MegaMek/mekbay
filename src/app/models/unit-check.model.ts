// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTAutomationKey } from './options.model';

export const UNIT_CHECK_KIND = {
    HEAT_SHUTDOWN: 'heat-shutdown',
    SHUTDOWN_RECOVERY: 'shutdown-recovery',
    HEAT_AMMO_EXPLOSION: 'heat-ammo-explosion',
    HEAT_RANDOM_MOVEMENT: 'heat-random-movement',
    HEAT_PILOT_DAMAGE: 'heat-pilot-damage',
    HEAT_LIFE_SUPPORT: 'heat-life-support',
    LIFE_SUPPORT_DROWNING: 'life-support-drowning',
    AERO_CONTROL_RECOVERY: 'aero-control-recovery',
    SEATBELT: 'seatbelt',
    CONSCIOUSNESS: 'consciousness',
    CONSCIOUSNESS_RECOVERY: 'consciousness-recovery',
} as const;

export type PendingUnitCheckKind = typeof UNIT_CHECK_KIND[keyof typeof UNIT_CHECK_KIND];

export const PENDING_UNIT_CHECK_KINDS: readonly PendingUnitCheckKind[] =
    Object.values(UNIT_CHECK_KIND);

export const UNIT_CHECK_CAUSE = {
    HEAT_RANDOM_MOVEMENT: UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT,
} as const;

export type UnitCheckCause = typeof UNIT_CHECK_CAUSE[keyof typeof UNIT_CHECK_CAUSE];
export type UnitCheckOutcome = 'success' | 'failed';

/** Values needed to present or classify a check, independent of its storage shape. */
export interface UnitCheckContext {
    readonly target?: number;
    readonly heat: number;
    readonly hits: number;
    readonly cause?: UnitCheckCause;
    readonly crewName?: string;
    readonly crewHits: number;
    readonly consciousnessCheckHit: number | null;
}

interface UnitCheckDefinition {
    readonly label: string;
    readonly notificationGroupLabel?: string;
    readonly reviewLabel?: string;
    readonly dialogTitle?: string;
    readonly priority: number;
    readonly immediatePriority?: number;
    readonly heatEffect?: true;
    readonly pilotDamagePhase?: 'heat' | 'end';
    readonly approvedAutomatic?: true;
    readonly crewOwned?: true;
    readonly resolvesBeforePsr?: true;
    readonly cascadeParticipant?: true;
    readonly requiresAmmoSelection?: true;
    readonly automationKey: CBTAutomationKey | ((context: UnitCheckContext) => CBTAutomationKey);
    readonly usesPilotAutomation: boolean | ((context: UnitCheckContext) => boolean);
    readonly description: (context: UnitCheckContext) => string;
    readonly reviewDescription?: (context: UnitCheckContext) => string;
    readonly failureOutcome: (context: UnitCheckContext) => string;
    readonly successLabel?: string;
    readonly failedLabel?: string;
    readonly automaticLabel?: string;
    readonly automaticEffect: (context: UnitCheckContext, outcome: UnitCheckOutcome) => string | null;
}

function pilotHits(context: UnitCheckContext): string {
    return `${context.hits} pilot hit${context.hits === 1 ? '' : 's'}`;
}

/**
 * The single exhaustive definition of kind-dependent unit-check behavior.
 * Adding a kind is a compile error until its presentation, ordering, and
 * automation ownership are defined here.
 */
export const UNIT_CHECK_DEFINITIONS = {
    [UNIT_CHECK_KIND.HEAT_SHUTDOWN]: {
        label: 'Shutdown',
        priority: 10,
        heatEffect: true,
        automationKey: 'heatEffectsCheck',
        usesPilotAutomation: false,
        description: context => context.target !== undefined ? 'Avoid shutdown.' : 'Automatic shutdown!',
        reviewDescription: context => context.target !== undefined
            ? `Shutdown check ${context.target}+`
            : 'Automatic shutdown!',
        failureOutcome: () => 'shutdown',
        automaticEffect: (_context, outcome) => outcome === 'failed' ? 'unit shut down' : 'shutdown avoided',
    },
    [UNIT_CHECK_KIND.SHUTDOWN_RECOVERY]: {
        label: 'Shutdown recovery',
        priority: 10,
        heatEffect: true,
        automationKey: 'heatEffectsCheck',
        usesPilotAutomation: false,
        description: context => context.target !== undefined ? 'Restart engine.' : 'Heat below 14.',
        reviewDescription: context => context.target !== undefined
            ? `Shutdown recovery check ${context.target}+`
            : `Engine restarts automatically at heat ${context.heat}`,
        failureOutcome: () => 'remains shutdown',
        successLabel: 'RESTARTS',
        failedLabel: 'REMAINS SHUTDOWN',
        automaticLabel: 'AUTOMATIC RESTART',
        automaticEffect: (_context, outcome) => outcome === 'success'
            ? 'unit restarted'
            : 'unit remains shut down',
    },
    [UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION]: {
        label: 'Ammunition explosion',
        priority: 20,
        heatEffect: true,
        requiresAmmoSelection: true,
        automationKey: 'heatEffectsCheck',
        usesPilotAutomation: false,
        description: () => 'Avoid ammunition explosion.',
        reviewDescription: context => `Ammunition explosion check ${context.target}+`,
        failureOutcome: () => 'ammunition explosion',
        automaticEffect: (_context, outcome) => outcome === 'success'
            ? 'ammunition explosion avoided'
            : null,
    },
    [UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT]: {
        label: 'Random movement',
        priority: 30,
        heatEffect: true,
        automationKey: 'heatEffectsCheck',
        usesPilotAutomation: false,
        description: context => context.target !== undefined
            ? 'Keep the navigation and piloting systems online.'
            : 'Ends the heat-induced random-movement effect.',
        reviewDescription: context => context.target !== undefined
            ? `Random movement check ${context.target}+`
            : `Heat ${context.heat} ends the heat-induced random-movement effect`,
        failureOutcome: () => 'random movement',
        automaticEffect: (_context, outcome) => outcome === 'success'
            ? 'random movement avoided'
            : 'random movement and out-of-control applied',
    },
    [UNIT_CHECK_KIND.HEAT_PILOT_DAMAGE]: {
        label: 'Pilot heat damage',
        priority: 40,
        heatEffect: true,
        pilotDamagePhase: 'heat',
        automationKey: 'heatEffectsCheck',
        usesPilotAutomation: true,
        description: context => `Avoid pilot damage from heat ${context.heat}.`,
        reviewDescription: context => `Pilot heat damage check ${context.target}+`
            + ` · ${pilotHits(context)} on failure`,
        failureOutcome: pilotHits,
        automaticEffect: (context, outcome) => outcome === 'failed'
            ? `${pilotHits(context)} applied`
            : 'pilot damage avoided',
    },
    [UNIT_CHECK_KIND.HEAT_LIFE_SUPPORT]: {
        label: 'Life Support damage',
        priority: 50,
        heatEffect: true,
        pilotDamagePhase: 'heat',
        approvedAutomatic: true,
        automationKey: 'pilotHitsAndConsciousnessCheck',
        usesPilotAutomation: true,
        description: context => `Damaged life support (${pilotHits(context)})`,
        failureOutcome: pilotHits,
        automaticLabel: 'AUTOMATIC DAMAGE',
        automaticEffect: (context, outcome) => outcome === 'failed'
            ? `${pilotHits(context)} applied`
            : 'pilot damage avoided',
    },
    [UNIT_CHECK_KIND.LIFE_SUPPORT_DROWNING]: {
        label: 'Life Support drowning',
        priority: 85,
        heatEffect: true,
        pilotDamagePhase: 'end',
        approvedAutomatic: true,
        automationKey: 'pilotHitsAndConsciousnessCheck',
        usesPilotAutomation: true,
        description: context => `Damaged life support (${pilotHits(context)})`,
        failureOutcome: pilotHits,
        automaticLabel: 'AUTOMATIC DAMAGE',
        automaticEffect: (context, outcome) => outcome === 'failed'
            ? `${pilotHits(context)} applied`
            : 'pilot damage avoided',
    },
    [UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY]: {
        label: 'Regain aerospace control',
        priority: 65,
        automationKey: context => context.cause === UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT
            ? 'heatEffectsCheck'
            : 'pilotHitsAndConsciousnessCheck',
        usesPilotAutomation: context => context.cause !== UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT,
        description: context => context.cause === UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT
            ? 'Regain control after heat-induced random movement.'
            : 'Regain control after going out of control.',
        failureOutcome: () => 'remains out of control',
        successLabel: 'REGAINS CONTROL',
        failedLabel: 'REMAINS OUT OF CONTROL',
        automaticEffect: (_context, outcome) => outcome === 'success'
            ? 'control restored'
            : 'unit remains out of control',
    },
    [UNIT_CHECK_KIND.SEATBELT]: {
        label: 'Seatbelt check',
        notificationGroupLabel: 'Seatbelt checks',
        reviewLabel: 'Seatbelt check · Falling',
        priority: 70,
        immediatePriority: 6,
        crewOwned: true,
        cascadeParticipant: true,
        automationKey: 'pilotHitsAndConsciousnessCheck',
        usesPilotAutomation: true,
        description: () => 'Reason: Falling. Avoid pilot damage.',
        failureOutcome: () => 'pilot hit',
        successLabel: 'PASSED',
        failedLabel: 'PILOT HIT',
        automaticEffect: (_context, outcome) => outcome === 'failed'
            ? '1 pilot hit applied'
            : 'pilot damage avoided',
    },
    [UNIT_CHECK_KIND.CONSCIOUSNESS]: {
        label: 'Consciousness check',
        notificationGroupLabel: 'Consciousness checks',
        dialogTitle: 'Consciousness Rolls',
        priority: 80,
        immediatePriority: 5,
        crewOwned: true,
        resolvesBeforePsr: true,
        cascadeParticipant: true,
        automationKey: 'pilotHitsAndConsciousnessCheck',
        usesPilotAutomation: true,
        description: context => {
            const hitText = context.consciousnessCheckHit !== null
                && context.consciousnessCheckHit < context.crewHits
                ? `Pilot hit ${context.consciousnessCheckHit} of ${context.crewHits}`
                : `${context.crewHits} pilot hit${context.crewHits === 1 ? '' : 's'}`;
            return `${context.crewName ? `${context.crewName}: ` : ''}${hitText}.`;
        },
        failureOutcome: () => 'unconsciousness',
        successLabel: 'STAYS CONSCIOUS',
        failedLabel: 'UNCONSCIOUS',
        automaticEffect: (_context, outcome) => outcome === 'failed'
            ? 'crew member rendered unconscious'
            : 'crew member remains conscious',
    },
    [UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY]: {
        label: 'Consciousness recovery',
        notificationGroupLabel: 'Consciousness recovery',
        dialogTitle: 'Recover Consciousness',
        priority: 82,
        immediatePriority: 60,
        crewOwned: true,
        resolvesBeforePsr: true,
        automationKey: 'pilotHitsAndConsciousnessCheck',
        usesPilotAutomation: true,
        description: context => `${context.crewName ? `${context.crewName}: ` : ''}`
            + 'Restores consciousness; the unit may act next turn.',
        failureOutcome: () => 'remains unconscious',
        successLabel: 'WAKES UP',
        failedLabel: 'STAYS UNCONSCIOUS',
        automaticEffect: (_context, outcome) => outcome === 'success'
            ? 'crew member regained consciousness'
            : 'crew member remains unconscious',
    },
} as const satisfies Readonly<Record<PendingUnitCheckKind, UnitCheckDefinition>>;

type UnitCheckDefinitions = typeof UNIT_CHECK_DEFINITIONS;

export type HeatEffectKind = {
    [K in PendingUnitCheckKind]: UnitCheckDefinitions[K] extends { readonly heatEffect: true } ? K : never;
}[PendingUnitCheckKind];

export interface HeatEffectDescriptor {
    readonly kind: HeatEffectKind;
    readonly target?: number;
    readonly result?: { readonly kind: 'automatic'; readonly outcome: UnitCheckOutcome };
    readonly hits?: number;
}

export function unitCheckDefinition(kind: PendingUnitCheckKind): UnitCheckDefinition {
    return UNIT_CHECK_DEFINITIONS[kind];
}

export function unitCheckLabel(kind: PendingUnitCheckKind, review = false): string {
    const definition = unitCheckDefinition(kind);
    return review ? definition.reviewLabel ?? definition.label : definition.label;
}

export function unitCheckNotificationGroupLabel(kind: PendingUnitCheckKind): string {
    const definition = unitCheckDefinition(kind);
    return definition.notificationGroupLabel ?? definition.label;
}

export function unitCheckPriority(kind: PendingUnitCheckKind, immediate: boolean): number {
    const definition = unitCheckDefinition(kind);
    return immediate ? definition.immediatePriority ?? definition.priority : definition.priority;
}

export function unitCheckAutomationKey(
    kind: PendingUnitCheckKind,
    context: UnitCheckContext,
): CBTAutomationKey {
    const automationKey = unitCheckDefinition(kind).automationKey;
    return typeof automationKey === 'function' ? automationKey(context) : automationKey;
}

export function unitCheckUsesPilotAutomation(
    kind: PendingUnitCheckKind,
    context: UnitCheckContext,
): boolean {
    const usesPilotAutomation = unitCheckDefinition(kind).usesPilotAutomation;
    return typeof usesPilotAutomation === 'function'
        ? usesPilotAutomation(context)
        : usesPilotAutomation;
}

export function unitCheckDescription(kind: PendingUnitCheckKind, context: UnitCheckContext): string {
    return unitCheckDefinition(kind).description(context);
}

export function unitCheckReviewDescription(kind: PendingUnitCheckKind, context: UnitCheckContext): string {
    const definition = unitCheckDefinition(kind);
    return (definition.reviewDescription ?? definition.description)(context);
}

export function unitCheckFailureOutcome(kind: PendingUnitCheckKind, context: UnitCheckContext): string {
    return unitCheckDefinition(kind).failureOutcome(context);
}

export function unitCheckActionLabel(kind: PendingUnitCheckKind, outcome: UnitCheckOutcome): string {
    const definition = unitCheckDefinition(kind);
    return outcome === 'success'
        ? definition.successLabel ?? 'SUCCESS'
        : definition.failedLabel ?? 'FAILED';
}

export function unitCheckAutomaticLabel(kind: PendingUnitCheckKind, outcome: UnitCheckOutcome): string {
    return unitCheckDefinition(kind).automaticLabel
        ?? (outcome === 'success' ? 'AUTOMATIC SUCCESS' : 'AUTOMATIC FAILURE');
}

export function unitCheckAutomaticEffect(
    kind: PendingUnitCheckKind,
    context: UnitCheckContext,
    outcome: UnitCheckOutcome,
): string | null {
    return unitCheckDefinition(kind).automaticEffect(context, outcome);
}

export function unitCheckDialogTitle(kind: PendingUnitCheckKind): string | undefined {
    return unitCheckDefinition(kind).dialogTitle;
}

export function unitCheckIsPilotHitHeatEffect(kind: PendingUnitCheckKind): boolean {
    return unitCheckDefinition(kind).pilotDamagePhase !== undefined;
}

export function unitCheckPilotDamagePhase(kind: PendingUnitCheckKind): 'heat' | 'end' | undefined {
    return unitCheckDefinition(kind).pilotDamagePhase;
}

export function unitCheckIsApprovedAutomatic(kind: PendingUnitCheckKind): boolean {
    return unitCheckDefinition(kind).approvedAutomatic === true;
}

export function unitCheckIsCrewOwned(kind: PendingUnitCheckKind): boolean {
    return unitCheckDefinition(kind).crewOwned === true;
}

export function unitCheckResolvesBeforePsr(kind: PendingUnitCheckKind): boolean {
    return unitCheckDefinition(kind).resolvesBeforePsr === true;
}

export function unitCheckIsCascadeParticipant(kind: PendingUnitCheckKind): boolean {
    return unitCheckDefinition(kind).cascadeParticipant === true;
}

export function unitCheckRequiresAmmoSelection(kind: PendingUnitCheckKind): boolean {
    return unitCheckDefinition(kind).requiresAmmoSelection === true;
}
