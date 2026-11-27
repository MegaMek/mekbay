// SPDX-License-Identifier: GPL-3.0-or-later

export type AutomationCheckOutcome = 'success' | 'failed';

export interface AutomationCheckChoice {
    readonly id: string;
    readonly label: string;
    readonly detail?: string;
}

/** Runtime-neutral roll presented by the shared pending-check dialog. */
export interface AutomationCheck {
    readonly id: string;
    readonly subject: string;
    readonly label: string;
    readonly description: string;
    readonly failureOutcome: string;
    readonly targetNumber?: number;
    readonly automaticOutcome?: AutomationCheckOutcome;
    /** A failure forces later checks in the same group to fail. */
    readonly failureGroup?: string;
    readonly cascadeFailureLabel?: string;
    readonly successLabel?: string;
    readonly failedLabel?: string;
    readonly automaticLabel?: string;
    /** Stable rules ordering; lower priorities are presented first. */
    readonly priority?: number;
    /** Choices shown only after failure; a single choice is selected implicitly. */
    readonly failureChoices?: readonly AutomationCheckChoice[];
}

/** Stable sort without making display order depend on unit iteration order. */
export function orderedAutomationChecks(
    checks: readonly AutomationCheck[],
): readonly AutomationCheck[] {
    return Object.freeze(checks
        .map((check, index) => ({ check, index }))
        .sort((left, right) => (left.check.priority ?? Number.MAX_SAFE_INTEGER)
            - (right.check.priority ?? Number.MAX_SAFE_INTEGER)
            || left.index - right.index)
        .map(row => row.check));
}

export interface AutomationCheckResolution {
    readonly id: string;
    readonly outcome: AutomationCheckOutcome;
    readonly dice: readonly [number, number] | null;
    readonly automatic: boolean;
    readonly selectionId?: string;
}

/** Player-entered state retained while a resumable check dialog is closed. */
export interface AutomationCheckSelection {
    readonly id: string;
    readonly outcome: AutomationCheckOutcome;
    readonly dice: readonly [number, number] | null;
    readonly selectionId?: string;
}

export interface AutomationCheckDialogData {
    readonly title: string;
    readonly checks: readonly AutomationCheck[];
    readonly initiallyFailedGroups: ReadonlySet<string>;
    readonly initialSelections?: readonly AutomationCheckSelection[];
    readonly selectionsChanged?: (selections: readonly AutomationCheckSelection[]) => void;
}
