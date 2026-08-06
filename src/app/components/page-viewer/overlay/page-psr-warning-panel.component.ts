// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, Injector, signal, viewChild } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import type { PSRCheck } from '../../../models/rules/unit-type-rules';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { displayPsrModifiers } from './page-turn-summary.util';
import { getMekLocationLabel } from '../../../models/entity/types';

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
            { provide: PageInteractionOverlayComponent, useValue: parent }
        ],
        parent: injector
    });
    const portal = new ComponentPortal(PagePsrWarningPanelComponent, null, customInjector);
    overlayManager.createManagedOverlay(overlayKey, null, portal, {
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: 'psr-warning-overlay-panel',
        closeOnOutsideClick: true,
        scrollStrategy: overlay.scrollStrategies.block(),
        positions: []
    });
}

@Component({
    selector: 'page-psr-warning-panel',
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-psr-warning-panel.component.html',
    styleUrl: './page-psr-warning-panel.component.scss',
})
export class PagePsrWarningPanelComponent {
    private readonly parent = inject(PageInteractionOverlayComponent);
    private readonly overlayManager = inject(OverlayManagerService);
    readonly diceRoller = viewChild<DiceRollerComponent>('roller');
    readonly unit = this.parent.unit;
    readonly rolledResult = signal<string | null>(null);
    readonly rolledResultTone = computed<'default' | 'success' | 'failed'>(() => {
        if (this.rolledResult() === 'SUCCESS') return 'success';
        if (this.rolledResult() === 'FAILED') return 'failed';
        return 'default';
    });
    private rollingCheck: PSRCheck | null = null;
    readonly locationLabel = getMekLocationLabel;

    close(): void {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`psrWarning-${unitId}`);
    }

    roll(check: PSRCheck): void {
        const roller = this.diceRoller();
        if (!roller || roller.isRolling() || this.outcome(check) || this.isAutomaticFailure(check)) return;
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
        this.resolve(check, result);
    }

    resolve(check: PSRCheck, result: 'success' | 'failed'): void {
        const unit = this.unit();
        if (!unit) return;
        if (check.resolution) {
            unit.resolveRuleCheck(check.resolution.key, check.resolution.token, result);
        } else if (check.id) {
            unit.turnState().resolvePSRCheck(check.id, result);
        }
        if (this.psrChecks().length === 0) this.close();
    }

    outcome(check: PSRCheck) {
        if (!check.id || check.resolution) return undefined;
        return this.unit()?.turnState().getPSROutcome(check.id);
    }

    isAutomaticFailure(check: PSRCheck): boolean {
        return this.unit()?.turnState().autoFall() === true && check.failureOutcome === 'Fall';
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
            .filter(check => check.fallCheck !== undefined)
            .sort((left, right) => this.checkDisplayOrder(left) - this.checkDisplayOrder(right));
    });

    readonly allChecksAutomaticFailure = computed(() => {
        const checks = this.psrChecks();
        return checks.length > 0 && checks.every(check => this.isAutomaticFailure(check));
    });

    private checkDisplayOrder(check: PSRCheck): number {
        if (this.isAutomaticFailure(check)) return 2;
        if (this.outcome(check)) return 1;
        return 0;
    }
}
