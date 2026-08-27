// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, InjectionToken, Injector, signal, viewChild } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { displayPsrModifiers, openTurnSummaryChildOverlay } from './page-turn-summary.util';
import { psrRollOutcome } from './page-psr-warning-panel.component';
import type { RuleCheckOutcome } from '../../../models/force-serialization';

export const STANDING_UP_REVIEW_ONLY = new InjectionToken<boolean>('Standing up review');

export interface StandingUpOverlayOptions {
    readonly reviewOnly?: boolean;
}

export function toggleStandingUpOverlay(
    parent: PageInteractionOverlayComponent,
    overlayManager: OverlayManagerService,
    injector: Injector,
    overlay: Overlay,
    options: StandingUpOverlayOptions = {},
): void {
    const unitId = parent.unit()?.id;
    if (!unitId) return;

    const overlayKey = `standingUp-${unitId}`;
    if (overlayManager.has(overlayKey)) {
        overlayManager.closeManagedOverlay(overlayKey);
        return;
    }

    const customInjector = Injector.create({
        providers: [
            { provide: PageInteractionOverlayComponent, useValue: parent },
            { provide: STANDING_UP_REVIEW_ONLY, useValue: options.reviewOnly ?? false },
        ],
        parent: injector,
    });
    const portal = new ComponentPortal(PageStandingUpPanelComponent, null, customInjector);
    openTurnSummaryChildOverlay(overlayManager, unitId, () =>
        overlayManager.createManagedOverlay(overlayKey, null, portal, {
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'standing-up-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: overlay.scrollStrategies.block(),
            positions: [],
        })
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
    private readonly parent = inject(PageInteractionOverlayComponent);
    private readonly overlayManager = inject(OverlayManagerService);
    readonly diceRoller = viewChild<DiceRollerComponent>('roller');
    readonly unit = this.parent.unit;
    readonly reviewOnly = inject(STANDING_UP_REVIEW_ONLY, { optional: true }) ?? false;
    readonly carefulStand = signal(
        this.unit()?.rules.supportsCarefulStand === true
        && this.unit()?.turnState().carefulStand?.() === true
    );
    readonly lastOutcome = signal<RuleCheckOutcome | null>(null);
    readonly rolledResult = signal<string | null>(null);
    private readonly pendingRolledOutcome = signal<RuleCheckOutcome | null>(null);
    readonly rolledResultTone = computed<'default' | 'success' | 'failed'>(() => {
        if (this.rolledResult() === 'SUCCESS') return 'success';
        if (this.rolledResult() === 'FAILED') return 'failed';
        return 'default';
    });
    readonly standingModifier = computed(() => this.unit()?.rules.standingUpPSRModifier ?? 0);
    readonly rollOverlayCloseHint = computed(() => this.pendingRolledOutcome() === 'failed'
        ? 'Click to apply the failure and resolve the fall'
        : 'Click to apply the standing result');

    readonly targetRoll = computed(() => {
        const target = this.unit()?.PSRTargetRoll() ?? 0;
        return target + this.standingModifier() - (this.carefulStand() ? 2 : 0);
    });

    readonly attempts = computed(() => this.unit()?.turnState().standAttempts() ?? 0);
    readonly canStandWithoutPSR = computed(() => this.unit()?.turnState().canStandWithoutPSR() ?? false);
    readonly attemptLimit = computed(() => {
        const unit = this.unit();
        return unit?.rules.getStandAttemptLimit(unit.turnState()) ?? null;
    });
    readonly supportsCarefulStand = computed(() => this.unit()?.rules.supportsCarefulStand ?? false);
    readonly canCarefulStand = computed(() => {
        const unit = this.unit();
        return unit?.rules.canCarefulStand(unit.turnState()) ?? false;
    });
    readonly canAttemptStand = computed(() => this.unit()?.turnState().canStandUp() ?? false);

    readonly modifiersList = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return [
            ...displayPsrModifiers(unit.PSRModifiers().modifiers),
            ...(this.standingModifier() !== 0
                ? [{ pilotCheck: this.standingModifier(), reason: 'Standing up', loc: undefined }]
                : []),
            ...(this.carefulStand() ? [{ pilotCheck: -2, reason: 'Careful stand', loc: undefined }] : []),
        ];
    });

    close(): void {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`standingUp-${unitId}`);
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
        this.pendingRolledOutcome.set(null);
        roller.roll();
    }

    onRollFinished(event: { readonly results: number[]; readonly sum: number }): void {
        if (this.reviewOnly) return;
        const result = psrRollOutcome(event.sum, this.targetRoll());
        this.pendingRolledOutcome.set(result);
        this.rolledResult.set(result.toUpperCase());
    }

    onRollOverlayClosed(): void {
        if (this.reviewOnly) return;
        const outcome = this.pendingRolledOutcome();
        if (!outcome) return;
        this.pendingRolledOutcome.set(null);
        this.resolve(outcome);
    }

    resolve(outcome: RuleCheckOutcome): void {
        if (this.reviewOnly) return;
        const unit = this.unit();
        if (!unit || this.lastOutcome() === 'success') return;
        this.rolledResult.set(null);
        if (unit.turnState().resolveStandAttempt(outcome, { carefulStand: this.carefulStand() })) {
            this.lastOutcome.set(outcome);
            if (outcome === 'failed') this.close();
        }
    }

    adjustAttempts(delta: number): void {
        //Note: even in reviewOnly mode we still allow to adjust the attempts. That's the whole point of the review mode...
        const turnState = this.unit()?.turnState();
        turnState?.adjustStandAttempts(delta);
        const committedCarefulStand = turnState?.carefulStand?.();
        if (committedCarefulStand !== undefined) this.carefulStand.set(committedCarefulStand);
        if (this.lastOutcome() !== 'success') this.lastOutcome.set(null);
        this.rolledResult.set(null);
        this.pendingRolledOutcome.set(null);
    }
}
