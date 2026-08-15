// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, Injector, signal, viewChild } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { displayPsrModifiers } from './page-turn-summary.util';
import { psrRollOutcome } from './page-psr-warning-panel.component';
import type { RuleCheckOutcome } from '../../../models/force-serialization';

export function toggleStandingUpOverlay(
    parent: PageInteractionOverlayComponent,
    overlayManager: OverlayManagerService,
    injector: Injector,
    overlay: Overlay,
): void {
    const unitId = parent.unit()?.id;
    if (!unitId) return;

    const overlayKey = `standingUp-${unitId}`;
    if (overlayManager.has(overlayKey)) {
        overlayManager.closeManagedOverlay(overlayKey);
        return;
    }

    const customInjector = Injector.create({
        providers: [{ provide: PageInteractionOverlayComponent, useValue: parent }],
        parent: injector,
    });
    const portal = new ComponentPortal(PageStandingUpPanelComponent, null, customInjector);
    overlayManager.createManagedOverlay(overlayKey, null, portal, {
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: 'standing-up-overlay-panel',
        closeOnOutsideClick: true,
        scrollStrategy: overlay.scrollStrategies.block(),
        positions: [],
    });
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
    readonly carefulStand = signal(false);
    readonly lastOutcome = signal<RuleCheckOutcome | null>(null);
    readonly rolledResult = signal<string | null>(null);
    readonly rolledResultTone = computed<'default' | 'success' | 'failed'>(() => {
        if (this.rolledResult() === 'SUCCESS') return 'success';
        if (this.rolledResult() === 'FAILED') return 'failed';
        return 'default';
    });

    readonly targetRoll = computed(() => {
        const target = this.unit()?.PSRTargetRoll() ?? 0;
        return target - (this.carefulStand() ? 2 : 0);
    });

    readonly attempts = computed(() => this.unit()?.turnState().standAttempts() ?? 0);

    readonly modifiersList = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return [
            ...displayPsrModifiers(unit.PSRModifiers().modifiers),
            ...(this.carefulStand() ? [{ pilotCheck: -2, reason: 'Careful stand', loc: undefined }] : []),
        ];
    });

    close(): void {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`standingUp-${unitId}`);
    }

    setCarefulStand(event: Event): void {
        this.carefulStand.set((event.target as HTMLInputElement).checked);
    }

    roll(): void {
        const roller = this.diceRoller();
        if (!roller || roller.isRolling() || this.lastOutcome() === 'success') return;
        this.lastOutcome.set(null);
        this.rolledResult.set(null);
        roller.roll();
    }

    onRollFinished(event: { readonly results: number[]; readonly sum: number }): void {
        const result = psrRollOutcome(event.sum, this.targetRoll());
        this.resolve(result);
        if (this.lastOutcome() === result) this.rolledResult.set(result.toUpperCase());
    }

    resolve(outcome: RuleCheckOutcome): void {
        const unit = this.unit();
        if (!unit || this.lastOutcome() === 'success') return;
        this.rolledResult.set(null);
        if (unit.turnState().resolveStandAttempt(outcome)) this.lastOutcome.set(outcome);
    }

    adjustAttempts(delta: number): void {
        this.unit()?.turnState().adjustStandAttempts(delta);
        if (this.lastOutcome() !== 'success') this.lastOutcome.set(null);
        this.rolledResult.set(null);
    }
}
