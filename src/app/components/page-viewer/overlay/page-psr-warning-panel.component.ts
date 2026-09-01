// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Injector, signal, viewChild } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

import type {
    MekAutomaticFallV2,
    MekPilotCheckOutcomeV2,
    MekPilotCheckV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import type { CBTMekForceMember } from '../../../models/force-member.model';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import {
    MekTurnSummaryRuntimeController,
} from './mek-turn-summary-runtime.controller';
import {
    actionableMekPilotChecks,
    composeMekPsrDisplayModifiers,
    openTurnSummaryChildOverlay,
    PAGE_TURN_MEMBER,
} from './page-turn-summary.util';

type PsrOutcomeSource = 'committed' | 'selected' | 'cascade';

interface PsrOutcomeState {
    readonly outcome: MekPilotCheckOutcomeV2;
    readonly source: PsrOutcomeSource;
}

export function psrRollOutcome(sum: number, target: number): MekPilotCheckOutcomeV2 {
    return sum >= target ? 'success' : 'failed';
}

export function togglePsrWarningOverlay(
    member: CBTMekForceMember | null,
    overlayManager: OverlayManagerService,
    injector: Injector,
    overlay: Overlay,
    beforeOpen?: () => void
): void {
    const unitId = member?.id;
    if (!unitId) return;

    const overlayKey = `psrWarning-${unitId}`;
    if (overlayManager.has(overlayKey)) {
        overlayManager.closeManagedOverlay(overlayKey);
        return;
    }

    beforeOpen?.();
    const customInjector = Injector.create({
        providers: [{ provide: PAGE_TURN_MEMBER, useValue: member }],
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
    private readonly member = inject(PAGE_TURN_MEMBER);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly options = inject(OptionsService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    readonly diceRoller = viewChild<DiceRollerComponent>('roller');
    readonly rolledResult = signal<string | null>(null);
    readonly rolledResultTone = computed<'default' | 'success' | 'failed'>(() => {
        if (this.rolledResult() === 'SUCCESS') return 'success';
        if (this.rolledResult() === 'FAILED') return 'failed';
        return 'default';
    });
    readonly controlRollFullLabel = computed(() => 'Piloting Skill Rolls');

    private controller: MekTurnSummaryRuntimeController | null = null;
    private rollingCheck: MekPilotCheckV2 | null = null;
    private readonly selectedOutcomes = signal<Readonly<Record<string, MekPilotCheckOutcomeV2>>>({});
    private readonly selectedDice = signal<Readonly<Record<string, readonly [number, number]>>>({});

    readonly automaticFalls = computed(() =>
        this.runtime()?.snapshot().movementState.automaticFalls ?? []);
    readonly psrChecks = computed(() => actionableMekPilotChecks(
        this.runtime()?.snapshot().movementState.checks ?? [],
        this.automaticFalls().length > 0,
    ));
    readonly targetRoll = computed(() => {
        const checks = this.psrChecks();
        return checks.find(check => check.status === 'pending')?.targetNumber
            ?? checks[0]?.targetNumber
            ?? 0;
    });
    readonly modifiersList = computed(() => {
        const snapshot = this.runtime()?.snapshot();
        const permanent = snapshot?.movement.kind === 'supported'
            ? snapshot.movement.permanentPsrModifiers
            : [];
        return composeMekPsrDisplayModifiers(permanent, snapshot?.movementState.checks ?? []);
    });
    private readonly resolutionStates = computed<ReadonlyMap<string, PsrOutcomeState>>(() => {
        const states = new Map<string, PsrOutcomeState>();
        const selected = this.selectedOutcomes();
        let priorFallFailed = this.automaticFalls().length > 0;
        for (const check of this.psrChecks()) {
            if (check.status !== 'pending') {
                states.set(check.checkId, { outcome: check.status, source: 'committed' });
                if (check.status === 'failed' && isCascadeFallPilotCheck(check)) priorFallFailed = true;
                continue;
            }
            if (priorFallFailed && isCascadeFallPilotCheck(check)) {
                states.set(check.checkId, { outcome: 'failed', source: 'cascade' });
                continue;
            }
            const outcome = selected[check.checkId];
            if (!outcome) continue;
            states.set(check.checkId, { outcome, source: 'selected' });
            if (outcome === 'failed' && isCascadeFallPilotCheck(check)) priorFallFailed = true;
        }
        return states;
    });
    readonly showRollDetails = computed(() => this.psrChecks().length > 0);
    readonly canAccept = computed(() => {
        const checks = this.psrChecks();
        const states = this.resolutionStates();
        return checks.length > 0
            && checks.every(check => states.has(check.checkId))
            && [...states.values()].some(state => state.source !== 'committed');
    });

    automaticFallReason(fall: MekAutomaticFallV2): string {
        return fall.triggerKind === 'gyro-destroyed' ? 'Gyro destroyed' : 'Leg destroyed';
    }

    locationLabel(locationId: string | undefined): string | null {
        return locationId
            ? this.runtime()?.snapshot().locationLabels[locationId] ?? null
            : null;
    }

    close(): void {
        this.overlayManager.closeManagedOverlay(`psrWarning-${this.member.id}`);
    }

    roll(check: MekPilotCheckV2): void {
        const roller = this.diceRoller();
        if (!roller || roller.isRolling() || !this.canEditOutcome(check)) return;
        this.rollingCheck = check;
        this.rolledResult.set(null);
        roller.roll();
    }

    onRollFinished(event: { readonly results: number[]; readonly sum: number }): void {
        const runtime = this.runtime();
        const check = this.rollingCheck;
        this.rollingCheck = null;
        if (!runtime || !check || event.results.length < 2) return;
        const outcome = psrRollOutcome(event.sum, check.targetNumber);
        this.rolledResult.set(outcome.toUpperCase());
        this.selectOutcome(check, outcome, validPsrDice(event.results));
    }

    selectOutcome(
        check: MekPilotCheckV2,
        outcome: MekPilotCheckOutcomeV2,
        dice: readonly [number, number] | null = null,
    ): void {
        if (!this.canEditOutcome(check)) return;
        this.selectedOutcomes.update(current => ({ ...current, [check.checkId]: outcome }));
        this.selectedDice.update(current => {
            if (dice) return { ...current, [check.checkId]: dice };
            const { [check.checkId]: _removed, ...remaining } = current;
            return remaining;
        });
        this.rolledResult.set(outcome.toUpperCase());
    }

    outcome(check: MekPilotCheckV2): MekPilotCheckOutcomeV2 | undefined {
        return this.resolutionStates().get(check.checkId)?.outcome;
    }

    diceFor(check: MekPilotCheckV2): readonly [number, number] | null {
        return this.resolutionStates().get(check.checkId)?.source === 'selected'
            ? this.selectedDice()[check.checkId] ?? null
            : null;
    }

    canEditOutcome(check: MekPilotCheckV2): boolean {
        const source = this.resolutionStates().get(check.checkId)?.source;
        return source === undefined || source === 'selected';
    }

    isCascadedFailure(check: MekPilotCheckV2): boolean {
        return this.resolutionStates().get(check.checkId)?.source === 'cascade';
    }

    failureLabel(check: MekPilotCheckV2): string {
        if (check.source.triggerKind === 'shutdown') return 'Shutdown';
        if (check.source.triggerKind === 'get-up') return 'Remain prone';
        return 'Fall';
    }

    async accept(): Promise<void> {
        const runtime = this.runtime();
        if (!runtime || !this.canAccept()) return;
        const states = this.resolutionStates();
        const resolutions = this.psrChecks().flatMap(check => {
            const state = states.get(check.checkId);
            return state && state.source !== 'committed'
                ? [{ check, outcome: state.outcome, dice: this.diceFor(check) }]
                : [];
        });
        for (const resolution of resolutions) {
            if (!await runtime.resolveCheckOutcome(
                resolution.check.checkId,
                resolution.check.targetNumber,
                resolution.outcome,
                resolution.dice ?? undefined,
            )) return;
        }
        this.selectedOutcomes.set({});
        this.selectedDice.set({});
        this.close();
    }

    private runtime(): MekTurnSummaryRuntimeController | null {
        if (!this.controller || this.controller.member !== this.member) {
            this.controller = new MekTurnSummaryRuntimeController(
                this.member,
                this.options,
                this.toast,
                this.destroyRef,
            );
        }
        return this.controller;
    }
}

function isCascadeFallPilotCheck(check: MekPilotCheckV2): boolean {
    return check.source.triggerKind !== 'shutdown'
        && check.source.triggerKind !== 'get-up';
}

function validPsrDice(results: readonly number[]): readonly [number, number] | null {
    return results.length === 2
        && results.every(value => Number.isInteger(value) && value >= 1 && value <= 6)
        ? [results[0]!, results[1]!]
        : null;
}
