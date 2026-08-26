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
    diceForMekPilotCheckOutcome,
    MekTurnSummaryRuntimeController,
} from './mek-turn-summary-runtime.controller';
import {
    actionableMekPilotChecks,
    composeMekPsrDisplayModifiers,
    openTurnSummaryChildOverlay,
    PAGE_TURN_MEMBER,
} from './page-turn-summary.util';

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
    readonly allChecksAutomaticFailure = computed(() => {
        const checks = this.psrChecks();
        return this.automaticFalls().length + checks.length > 0
            && checks.every(check => this.isAutomaticFailure(check));
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
        if (!roller || roller.isRolling() || this.outcome(check) || this.isAutomaticFailure(check)) return;
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
        runtime.setDie(check.checkId, 0, event.results[0]!);
        runtime.setDie(check.checkId, 1, event.results[1]!);
        void runtime.resolveCheck(check.checkId);
    }

    resolve(check: MekPilotCheckV2, outcome: MekPilotCheckOutcomeV2): void {
        const runtime = this.runtime();
        const dice = diceForMekPilotCheckOutcome(check.targetNumber, outcome);
        if (!runtime || !dice || check.status !== 'pending') return;
        runtime.setDie(check.checkId, 0, dice[0]);
        runtime.setDie(check.checkId, 1, dice[1]);
        this.rolledResult.set(outcome.toUpperCase());
        void runtime.resolveCheck(check.checkId);
    }

    outcome(check: MekPilotCheckV2): MekPilotCheckOutcomeV2 | undefined {
        return check.status === 'pending' ? undefined : check.status;
    }

    isAutomaticFailure(check: MekPilotCheckV2): boolean {
        return check.targetNumber > 12;
    }

    failureLabel(check: MekPilotCheckV2): string {
        if (check.source.triggerKind === 'shutdown') return 'Shutdown';
        if (check.source.triggerKind === 'get-up') return 'Remain prone';
        return 'Fall';
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
