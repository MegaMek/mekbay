// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, InjectionToken, Injector, signal, type Signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { isFallPSRCheck, psrFailureLabel, type PSRCheck } from '../../../models/rules/unit-type-rules';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { displayPsrModifiers, openTurnSummaryChildOverlay } from './page-turn-summary.util';
import { getMekLocationLabel } from '../../../models/entity/types';

type PsrOutcome = 'success' | 'failed';
type PsrOutcomeSource = 'committed' | 'selected' | 'cascade' | 'automatic';

interface PsrOutcomeState {
    readonly outcome: PsrOutcome;
    readonly source: PsrOutcomeSource;
}

export interface PsrWarningDialogData {
    readonly unit: CBTForceUnit;
}

export const PSR_WARNING_UNIT = new InjectionToken<Signal<CBTForceUnit | null>>('PSR_WARNING_UNIT');
const PSR_WARNING_CLOSE = new InjectionToken<() => void>('PSR_WARNING_CLOSE');

export function psrRollOutcome(sum: number, target: number): 'success' | 'failed' {
    return sum >= target ? 'success' : 'failed';
}

export function togglePsrWarningOverlay(
    parent: PageInteractionOverlayComponent,
    overlayManager: OverlayManagerService,
    injector: Injector,
    overlay: Overlay,
    beforeOpen?: () => void
): void {
    const unitId = parent.unit()?.id;
    if (!unitId) return;

    const overlayKey = `psrWarning-${unitId}`;
    if (overlayManager.has(overlayKey)) {
        overlayManager.closeManagedOverlay(overlayKey);
        return;
    }

    beforeOpen?.();
    const customInjector = Injector.create({
        providers: [
            { provide: PSR_WARNING_UNIT, useValue: parent.unit },
            {
                provide: PSR_WARNING_CLOSE,
                useValue: () => overlayManager.closeManagedOverlay(overlayKey),
            },
        ],
        parent: injector
    });
    const portal = new ComponentPortal(PagePsrWarningPanelComponent, null, customInjector);
    openTurnSummaryChildOverlay(overlayManager, unitId, () =>
        overlayManager.createManagedOverlay(overlayKey, null, portal, {
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'psr-warning-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: overlay.scrollStrategies.block(),
            positions: []
        })
    );
}

@Component({
    selector: 'page-psr-warning-panel',
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-psr-warning-panel.component.html',
    styleUrl: './page-psr-warning-panel.component.scss',
})
export class PagePsrWarningPanelComponent {
    private readonly overlayUnit = inject(PSR_WARNING_UNIT, { optional: true });
    private readonly overlayClose = inject(PSR_WARNING_CLOSE, { optional: true });
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly dialogData = inject<PsrWarningDialogData | null>(DIALOG_DATA, { optional: true });
    private readonly dialogRef = inject<DialogRef<boolean> | null>(DialogRef, { optional: true });
    readonly diceRoller = viewChild<DiceRollerComponent>('roller');
    readonly unit = this.overlayUnit ?? computed(() => this.dialogData?.unit ?? null);
    readonly rolledResult = signal<string | null>(null);
    readonly rolledResultTone = computed<'default' | 'success' | 'failed'>(() => {
        if (this.rolledResult() === 'SUCCESS') return 'success';
        if (this.rolledResult() === 'FAILED') return 'failed';
        return 'default';
    });
    private readonly selectedOutcomes = computed<Readonly<Record<string, PsrOutcome>>>(() =>
        this.unit()?.psrOutcomeSelections() ?? {});
    private readonly selectedDice = computed<Readonly<Record<string, readonly [number, number]>>>(() =>
        this.unit()?.psrDiceSelections?.() ?? {});
    private rollingCheck: PSRCheck | null = null;
    readonly locationLabel = getMekLocationLabel;

    close(accepted = false): void {
        if (this.dialogRef) {
            this.dialogRef.close(accepted);
            return;
        }
        if (this.overlayClose) {
            this.overlayClose();
            return;
        }
        this.overlayManager.closeManagedOverlay(`psrWarning-${this.unit()?.id}`);
    }

    roll(check: PSRCheck): void {
        const roller = this.diceRoller();
        if (!roller || roller.isRolling() || !this.canEditOutcome(check)) return;
        this.rollingCheck = check;
        this.rolledResult.set(null);
        roller.roll();
    }

    onRollFinished(event: { readonly results: number[]; readonly sum: number }): void {
        const unit = this.unit();
        const check = this.rollingCheck;
        this.rollingCheck = null;
        if (!unit || !check) return;

        const result = psrRollOutcome(event.sum, unit.PSRTargetRoll());
        this.rolledResult.set(result.toUpperCase());
        this.selectOutcome(check, result, validPsrDice(event.results));
    }

    selectOutcome(
        check: PSRCheck,
        result: PsrOutcome,
        dice: readonly [number, number] | null = null,
    ): void {
        const checkId = check.id;
        const unit = this.unit();
        if (!unit || !checkId || !this.canEditOutcome(check)) return;
        unit.psrOutcomeSelections.update(current => ({ ...current, [checkId]: result }));
        unit.psrDiceSelections?.update(current => {
            if (dice) return { ...current, [checkId]: [...dice] as readonly [number, number] };
            const { [checkId]: _removed, ...remaining } = current;
            return remaining;
        });
    }

    diceFor(check: PSRCheck): readonly [number, number] | null {
        return check.id && this.resolutionStates().get(check.id)?.source === 'selected'
            ? this.selectedDice()[check.id] ?? null
            : null;
    }

    outcome(check: PSRCheck): PsrOutcome | undefined {
        return check.id ? this.resolutionStates().get(check.id)?.outcome : undefined;
    }

    canEditOutcome(check: PSRCheck): boolean {
        const source = check.id ? this.resolutionStates().get(check.id)?.source : undefined;
        return source === undefined || source === 'selected';
    }

    isCascadedFailure(check: PSRCheck): boolean {
        return check.id ? this.resolutionStates().get(check.id)?.source === 'cascade' : false;
    }

    isAutomaticFailure(check: PSRCheck): boolean {
        const turnState = this.unit()?.turnState();
        return this.committedOutcome(check) === undefined
            && turnState !== undefined
            && (turnState.isPSRCheckAutomaticFailure(check)
                || (turnState.autoFall() && isFallPSRCheck(check)));
    }

    failureLabel(check: PSRCheck): string {
        return psrFailureLabel(check);
    }

    readonly canAccept = computed(() => {
        const checks = this.psrChecks();
        const states = this.resolutionStates();
        return checks.length > 0
            && checks.every(check => check.id !== undefined && states.has(check.id))
            && Array.from(states.values()).some(state => state.source !== 'committed');
    });

    accept(): void {
        const unit = this.unit();
        if (!unit || !this.canAccept()) return;
        const resolutions = this.psrChecks().flatMap(check => {
            if (!check.id) return [];
            const state = this.resolutionStates().get(check.id);
            return state && state.source !== 'committed'
                ? [{ check, outcome: state.outcome }]
                : [];
        });
        if (resolutions.length === 0) return;

        for (const resolution of resolutions) {
            this.applyOutcome(resolution.check, resolution.outcome);
        }
        unit.psrOutcomeSelections.set({});
        unit.psrDiceSelections?.set({});
        this.close(true);
    }

    private applyOutcome(check: PSRCheck, result: PsrOutcome): void {
        const unit = this.unit();
        if (!unit) return;
        if (check.resolution) {
            unit.resolveRuleCheck(check.resolution.key, check.resolution.token, result);
        } else if (check.id) {
            unit.turnState().resolvePSRCheck(check.id, result);
        }
    }

    private committedOutcome(check: PSRCheck): PsrOutcome | undefined {
        const unit = this.unit();
        if (!unit) return undefined;
        if (check.resolution) {
            const ruleCheck = unit.getRuleCheck(check.resolution.key);
            if (!ruleCheck || ruleCheck.token !== check.resolution.token || ruleCheck.status === 'pending') {
                return undefined;
            }
            return ruleCheck.status;
        }
        return check.id ? unit.turnState().getPSROutcome(check.id) : undefined;
    }

    readonly modifiersList = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return displayPsrModifiers(unit.PSRModifiers().modifiers);
    });

    readonly controlRollFullLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'Piloting Skill Rolls';
        return unit.rules.controlRollFullLabel;
    });

    readonly psrChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.turnState().getPSRChecks()
            .filter(check => check.fallCheck !== undefined);
    });

    private readonly resolutionStates = computed<ReadonlyMap<string, PsrOutcomeState>>(() => {
        const states = new Map<string, PsrOutcomeState>();
        const selected = this.selectedOutcomes();
        let priorFallFailed = false;

        for (const check of this.psrChecks()) {
            if (!check.id) continue;
            const committed = this.committedOutcome(check);
            if (committed) {
                states.set(check.id, { outcome: committed, source: 'committed' });
                if (committed === 'failed' && isFallPSRCheck(check)) priorFallFailed = true;
                continue;
            }
            if (this.isAutomaticFailure(check)) {
                states.set(check.id, { outcome: 'failed', source: 'automatic' });
                if (isFallPSRCheck(check)) priorFallFailed = true;
                continue;
            }
            if (priorFallFailed && isFallPSRCheck(check)) {
                states.set(check.id, { outcome: 'failed', source: 'cascade' });
                continue;
            }
            const outcome = selected[check.id];
            if (!outcome) continue;
            states.set(check.id, { outcome, source: 'selected' });
            if (outcome === 'failed' && isFallPSRCheck(check)) priorFallFailed = true;
        }
        return states;
    });

    readonly allChecksAutomaticFailure = computed(() => {
        const checks = this.psrChecks();
        return checks.length > 0 && checks.every(check => this.isAutomaticFailure(check));
    });

    readonly showRollDetails = computed(() => this.psrChecks().length > 0
        && !this.allChecksAutomaticFailure());
}

function validPsrDice(results: readonly number[]): readonly [number, number] | null {
    return results.length === 2
        && results.every(value => Number.isInteger(value) && value >= 1 && value <= 6)
        ? [results[0], results[1]]
        : null;
}
