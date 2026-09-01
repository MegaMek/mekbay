// SPDX-License-Identifier: GPL-3.0-or-later

import type { AutomationCheck } from './automation-check.model';

export type CBTUnitCheckPresentation = Pick<
    AutomationCheck,
    'label' | 'description' | 'failureOutcome' | 'successLabel' | 'failedLabel'
        | 'automaticLabel' | 'priority'
>;

export type CBTUnitCheckPresentationKind =
    | 'shutdown'
    | 'startup'
    | 'ammo-explosion'
    | 'random-movement'
    | 'clear-heat-control'
    | 'control-recovery'
    | 'pilot-damage'
    | 'life-support-damage'
    | 'life-support-drowning'
    | 'seatbelt'
    | 'consciousness-recovery';

export interface CBTUnitCheckPresentationContext {
    readonly targetNumber?: number;
    readonly heat?: number;
    readonly hits?: number;
    readonly crewName?: string;
    readonly controlCause?: 'heat-random-movement' | 'controller-loss';
}

export interface CBTUnitCheckAutomaticResult {
    readonly outcome: 'success' | 'failed';
    /** Null means the rules resolved the result without rolling dice. */
    readonly total: number | null;
    readonly targetNumber?: number;
    /** Overrides the canonical effect; explicit null suppresses it. */
    readonly effect?: string | null;
}

/** Canonical origin/next labels for the runtime-neutral pending-check UI. */
export function cbtUnitCheckPresentation(
    kind: CBTUnitCheckPresentationKind,
    context: CBTUnitCheckPresentationContext = {},
): CBTUnitCheckPresentation {
    const hits = Math.max(0, Math.trunc(context.hits ?? 0));
    const pilotHits = `${hits} pilot hit${hits === 1 ? '' : 's'}`;
    switch (kind) {
        case 'shutdown':
            return {
                label: 'Shutdown',
                description: context.targetNumber === undefined ? 'Automatic shutdown!' : 'Avoid shutdown.',
                failureOutcome: 'shutdown',
                priority: 10,
            };
        case 'startup':
            return {
                label: 'Shutdown recovery',
                description: context.targetNumber === undefined
                    ? 'Heat below 14.'
                    : 'Restart engine.',
                failureOutcome: 'remains shutdown',
                successLabel: 'RESTARTS',
                failedLabel: 'REMAINS SHUTDOWN',
                automaticLabel: 'AUTOMATIC RESTART',
                priority: 10,
            };
        case 'ammo-explosion':
            return {
                label: 'Ammunition explosion',
                description: 'Avoid ammunition explosion.',
                failureOutcome: 'ammunition explosion',
                priority: 20,
            };
        case 'random-movement':
            return {
                label: 'Random movement',
                description: 'Keep the navigation and piloting systems online.',
                failureOutcome: 'random movement',
                priority: 30,
            };
        case 'clear-heat-control':
            return {
                label: 'Random movement',
                description: 'Ends the heat-induced random-movement effect.',
                failureOutcome: 'random movement',
                priority: 30,
            };
        case 'pilot-damage':
            return {
                label: 'Pilot heat damage',
                description: `Avoid pilot damage from heat ${context.heat ?? 0}.`,
                failureOutcome: pilotHits,
                priority: 40,
            };
        case 'life-support-damage':
            return {
                label: 'Life Support damage',
                description: `Damaged life support (${pilotHits})`,
                failureOutcome: pilotHits,
                automaticLabel: 'AUTOMATIC DAMAGE',
                priority: 50,
            };
        case 'control-recovery':
            return {
                label: 'Regain aerospace control',
                description: context.controlCause === 'controller-loss'
                    ? 'Regain control after going out of control.'
                    : 'Regain control after heat-induced random movement.',
                failureOutcome: 'remains out of control',
                successLabel: 'REGAINS CONTROL',
                failedLabel: 'REMAINS OUT OF CONTROL',
                priority: 65,
            };
        case 'seatbelt':
            return {
                label: 'Seatbelt check · Falling',
                description: 'Reason: Falling. Avoid pilot damage.',
                failureOutcome: 'pilot hit',
                successLabel: 'PASSED',
                failedLabel: 'PILOT HIT',
                priority: 70,
            };
        case 'consciousness-recovery':
            return {
                label: 'Consciousness recovery',
                description: `${context.crewName ? `${context.crewName}: ` : ''}`
                    + 'Restores consciousness; the unit may act next turn.',
                failureOutcome: 'remains unconscious',
                successLabel: 'WAKES UP',
                failedLabel: 'STAYS UNCONSCIOUS',
                priority: 82,
            };
        case 'life-support-drowning':
            return {
                label: 'Life Support drowning',
                description: `Damaged life support (${pilotHits})`,
                failureOutcome: pilotHits,
                automaticLabel: 'AUTOMATIC DAMAGE',
                priority: 85,
            };
    }
}

/** Canonical origin/next wording used in the end-turn review before checks run. */
export function cbtUnitCheckReviewDescription(
    kind: CBTUnitCheckPresentationKind,
    context: CBTUnitCheckPresentationContext = {},
): string {
    const hits = Math.max(0, Math.trunc(context.hits ?? 0));
    const pilotHits = `${hits} pilot hit${hits === 1 ? '' : 's'}`;
    switch (kind) {
        case 'shutdown':
            return context.targetNumber === undefined
                ? 'Automatic shutdown!'
                : `Shutdown check ${context.targetNumber}+`;
        case 'startup':
            return context.targetNumber === undefined
                ? `Engine restarts automatically at heat ${context.heat ?? 0}`
                : `Shutdown recovery check ${context.targetNumber}+`;
        case 'ammo-explosion':
            return context.targetNumber === undefined
                ? 'Automatic ammunition explosion'
                : `Ammunition explosion check ${context.targetNumber}+`;
        case 'random-movement':
            return context.targetNumber === undefined
                ? `Heat ${context.heat ?? 0} ends the heat-induced random-movement effect`
                : `Random movement check ${context.targetNumber}+`;
        case 'clear-heat-control':
            return `Heat ${context.heat ?? 0} ends the heat-induced random-movement effect`;
        case 'pilot-damage':
            return context.targetNumber === undefined
                ? `Automatic pilot heat damage · ${pilotHits}`
                : `Pilot heat damage check ${context.targetNumber}+ · ${pilotHits} on failure`;
        case 'life-support-damage':
        case 'life-support-drowning':
            return `Damaged life support (${pilotHits})`;
        case 'control-recovery':
        case 'seatbelt':
        case 'consciousness-recovery':
            return cbtUnitCheckPresentation(kind, context).description;
    }
}

/** Canonical origin/next effect text for automatic check notifications. */
export function cbtUnitCheckAutomaticEffect(
    kind: CBTUnitCheckPresentationKind,
    outcome: 'success' | 'failed',
    context: CBTUnitCheckPresentationContext = {},
): string | null {
    const hits = Math.max(0, Math.trunc(context.hits ?? 0));
    const pilotHits = `${hits} pilot hit${hits === 1 ? '' : 's'}`;
    switch (kind) {
        case 'shutdown':
            return outcome === 'failed' ? 'unit shut down' : 'shutdown avoided';
        case 'startup':
            return outcome === 'success' ? 'unit restarted' : 'unit remains shut down';
        case 'ammo-explosion':
            return outcome === 'success' ? 'ammunition explosion avoided' : null;
        case 'random-movement':
        case 'clear-heat-control':
            return outcome === 'success'
                ? 'random movement avoided'
                : 'random movement and out-of-control applied';
        case 'control-recovery':
            return outcome === 'success' ? 'control restored' : 'unit remains out of control';
        case 'pilot-damage':
        case 'life-support-damage':
        case 'life-support-drowning':
            return outcome === 'failed' ? `${pilotHits} applied` : 'pilot damage avoided';
        case 'seatbelt':
            return outcome === 'failed' ? '1 pilot hit applied' : 'pilot damage avoided';
        case 'consciousness-recovery':
            return outcome === 'success'
                ? 'crew member regained consciousness'
                : 'crew member remains unconscious';
    }
}

/** Formats the exact automatic-result notification shared by direct runtimes. */
export function cbtUnitCheckAutomaticMessage(
    kind: CBTUnitCheckPresentationKind,
    result: CBTUnitCheckAutomaticResult,
    context: CBTUnitCheckPresentationContext = {},
): string {
    const detail = result.total === null
        ? ' (automatic)'
        : result.targetNumber === undefined
            ? ''
            : ` (${result.total} vs ${result.targetNumber}+)`;
    const effect = Object.prototype.hasOwnProperty.call(result, 'effect')
        ? result.effect ?? null
        : cbtUnitCheckAutomaticEffect(kind, result.outcome, context);
    return `${cbtUnitCheckPresentation(kind, context).label}: `
        + `${result.outcome === 'success' ? 'PASSED' : 'FAILED'}${detail}`
        + `${effect ? ` — ${effect}` : ''}`;
}
