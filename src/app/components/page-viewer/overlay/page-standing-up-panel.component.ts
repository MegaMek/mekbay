// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    InjectionToken,
    Injector,
    signal,
    viewChild,
} from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

import type { MekPilotCheckOutcomeV2 } from '../../../models/runtime/mek-movement-psr-v2';
import type { CBTMekForceMember } from '../../../models/force-member.model';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { MekTurnSummaryRuntimeController } from './mek-turn-summary-runtime.controller';
import {
    composeMekPsrDisplayModifiers,
    openTurnSummaryChildOverlay,
    PAGE_TURN_MEMBER,
} from './page-turn-summary.util';
import { psrRollOutcome } from './page-psr-warning-panel.component';

export const STANDING_UP_REVIEW_ONLY = new InjectionToken<boolean>('Standing up review');

export function toggleStandingUpOverlay(
    member: CBTMekForceMember | null,
    overlayManager: OverlayManagerService,
    injector: Injector,
    overlay: Overlay,
    reviewOnly = false,
): void {
    const unitId = member?.id;
    if (!unitId) return;
    const key = `standingUp-${unitId}`;
    if (overlayManager.has(key)) {
        overlayManager.closeManagedOverlay(key);
        return;
    }
    const childInjector = Injector.create({
        providers: [
            { provide: PAGE_TURN_MEMBER, useValue: member },
            { provide: STANDING_UP_REVIEW_ONLY, useValue: reviewOnly },
        ],
        parent: injector,
    });
    const portal = new ComponentPortal(PageStandingUpPanelComponent, null, childInjector);
    openTurnSummaryChildOverlay(overlayManager, unitId, () =>
        overlayManager.createManagedOverlay(key, null, portal, {
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'standing-up-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: overlay.scrollStrategies.block(),
            positions: [],
        }),
    );
}

@Component({
    selector: 'page-standing-up-panel',
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-standing-up-panel.component.html',
    styleUrls: [
        './page-psr-warning-panel.component.scss',
        './page-standing-up-panel.component.scss',
    ],
})
export class PageStandingUpPanelComponent {
    private readonly member = inject(PAGE_TURN_MEMBER);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly options = inject(OptionsService);
    private readonly toast = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    readonly reviewOnly = inject(STANDING_UP_REVIEW_ONLY, { optional: true }) ?? false;
    readonly diceRoller = viewChild<DiceRollerComponent>('roller');
    readonly carefulStand = signal(false);
    readonly lastOutcome = signal<MekPilotCheckOutcomeV2 | null>(null);
    readonly rolledResult = signal<string | null>(null);
    readonly rolledResultTone = computed<'default' | 'success' | 'failed'>(() => {
        if (this.rolledResult() === 'SUCCESS') return 'success';
        if (this.rolledResult() === 'FAILED') return 'failed';
        return 'default';
    });

    private readonly runtime = this.createRuntime();
    private readonly movement = computed(() => {
        const movement = this.runtime?.snapshot().movement;
        return movement?.kind === 'supported' ? movement : null;
    });
    readonly standing = computed(() => this.movement()?.standing ?? null);
    readonly targetRoll = computed(() =>
        (this.standing()?.targetNumber ?? 0) - (this.carefulStand() ? 2 : 0));
    readonly attempts = computed(() => this.runtime?.snapshot().movementState.standAttempts ?? 0);
    readonly canStandWithoutPSR = computed(() => this.standing()?.requiresPilotCheck === false);
    readonly attemptLimit = computed(() => this.standing()?.attemptLimit ?? null);
    readonly supportsCarefulStand = computed(() => this.standing()?.supportsCarefulStand ?? false);
    readonly canCarefulStand = computed(() => this.standing()?.canCarefulStand ?? false);
    readonly canAttemptStand = computed(() => this.runtime?.unitActions()
        .some(action => action.kind === 'get-up' && action.legal) ?? false);
    readonly modifiersList = computed(() => {
        const standing = this.standing();
        if (!standing) return [];
        const snapshot = this.runtime?.snapshot();
        const permanent = snapshot?.movement.kind === 'supported'
            ? snapshot.movement.permanentPsrModifiers
            : [];
        return [
            ...composeMekPsrDisplayModifiers(permanent, snapshot?.movementState.checks ?? []),
            ...(standing.standingModifier === 0
                ? []
                : [{ reason: 'Standing up', modifier: standing.standingModifier }]),
            ...(this.carefulStand() ? [{ reason: 'Careful stand', modifier: -2 }] : []),
        ];
    });

    constructor() {
        this.carefulStand.set(this.runtime?.snapshot().movementState.carefulStand ?? false);
    }

    close(): void {
        this.overlayManager.closeManagedOverlay(`standingUp-${this.member.id}`);
    }

    setCarefulStand(event: Event): void {
        if (this.reviewOnly) return;
        const checked = (event.target as HTMLInputElement).checked;
        this.carefulStand.set(checked && this.canCarefulStand());
    }

    roll(): void {
        if (this.reviewOnly) return;
        const roller = this.diceRoller();
        if (!roller || roller.isRolling() || this.lastOutcome() === 'success') return;
        this.lastOutcome.set(null);
        this.rolledResult.set(null);
        roller.roll();
    }

    async onRollFinished(event: { readonly results: number[]; readonly sum: number }): Promise<void> {
        if (this.reviewOnly || event.results.length < 2) return;
        const outcome = psrRollOutcome(event.sum, this.targetRoll());
        const accepted = await this.runtime?.resolveStandAttempt(this.carefulStand(), {
            dice: [event.results[0]!, event.results[1]!],
            claimedOutcome: outcome,
        });
        if (accepted) {
            this.lastOutcome.set(outcome);
            this.rolledResult.set(outcome.toUpperCase());
        }
    }

    async resolve(outcome: MekPilotCheckOutcomeV2): Promise<void> {
        if (this.reviewOnly || this.lastOutcome() === 'success') return;
        this.rolledResult.set(null);
        const accepted = await this.runtime?.resolveStandOutcome(this.carefulStand(), outcome);
        if (accepted) this.lastOutcome.set(outcome);
    }

    async adjustAttempts(delta: number): Promise<void> {
        const accepted = await this.runtime?.adjustStandAttempts(delta);
        if (!accepted) return;
        if (delta < 0) this.carefulStand.set(false);
        if (this.lastOutcome() !== 'success') this.lastOutcome.set(null);
        this.rolledResult.set(null);
    }

    private createRuntime(): MekTurnSummaryRuntimeController | null {
        return new MekTurnSummaryRuntimeController(this.member, this.options, this.toast, this.destroyRef);
    }
}
