/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import {
    Component,
    ChangeDetectionStrategy,
    inject,
    Injector,
    input,
    computed,
    ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { OptionsService } from '../../../services/options.service';
import { DialogsService } from '../../../services/dialogs.service';
import { LoggerService } from '../../../services/logger.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { CBTForce } from '../../../models/cbt-force.model';
import { PageTurnSummaryPanelComponent } from './page-turn-summary.component';

/*
 * Author: Drake
 * 
 * PageInteractionOverlayComponent - Interaction overlay for a single page in the page viewer.
 * 
 * This component provides turn tracking UI controls placed on each page/unit.
 */

@Component({
    selector: 'page-interaction-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './page-interaction-overlay.component.html',
    host: {
        '[class.fixed-mode]': 'isFixedMode()'
    },
    styleUrls: [`./page-interaction-overlay.component.scss`]
})
export class PageInteractionOverlayComponent {
    private logger = inject(LoggerService);
    private injector = inject(Injector);
    private dialogsService = inject(DialogsService);
    private overlayManager = inject(OverlayManagerService);
    private optionsService = inject(OptionsService);
    private overlay = inject(Overlay);
    private host = inject(ElementRef<HTMLElement>);

    // Inputs
    unit = input<CBTForceUnit | null>(null);
    force = input<CBTForce | null>(null);
    
    /**
     * When 'fixed', the overlay is bound to the container and stays stable during zoom/pan.
     * When 'page', the overlay is bound to the page-wrapper and moves with zoom/pan.
     * Default is 'page' for backwards compatibility and multi-page mode.
     */
    mode = input<'fixed' | 'page'>('page');
    
    // Host class binding for fixed mode styling
    isFixedMode = computed(() => this.mode() === 'fixed');

    get nativeElement(): HTMLElement {
        return this.host.nativeElement;
    }

    dirty = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirty();
    });

    dirtyPhase = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirtyPhase();
    });

    falling = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().autoFall();
    });

    hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().PSRRollsCount() > 0;
    });

    psrCount = computed<number>(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().PSRRollsCount();
    });

    currentPhase = computed(() => {
        const unit = this.unit();
        if (!unit) return '';
        return unit.turnState().currentPhase();
    });

    endTurnButtonVisible = computed(() => {
        const force = this.force();
        if (!force) return false;
        const units = force.units();
        return units.some(u => u.turnState().dirty());
    });

    openTurnSummary(event: MouseEvent) {
        event.stopPropagation();

        const unitId = this.unit()?.id;
        const overlayKey = `turnSummary-${unitId}`;

        // Toggle: close if already open
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }

        const target = event.currentTarget as HTMLElement || (event.target as HTMLElement);

        // Create a custom injector that provides this component as the parent
        const customInjector = Injector.create({
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: this }
            ],
            parent: this.injector
        });

        const portal = new ComponentPortal(PageTurnSummaryPanelComponent, null, customInjector);

        const compRef = this.overlayManager.createManagedOverlay<PageTurnSummaryPanelComponent>(overlayKey, target, portal, {
            hasBackdrop: false,
            panelClass: 'turn-summary-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: this.nativeElement,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });

        if (compRef) {
            compRef.setInput('endTurnForAllButtonVisible', this.endTurnButtonVisible());
            compRef.instance.endTurnForAllClicked.subscribe(() => {
                this.endTurnForAll();
            });
        }
    }

    async endTurnForAll() {
        const confirm = await this.dialogsService.requestConfirmation(
            'Are you sure you want to end the turn for all units?',
            'End Turn',
            'info'
        );
        if (!confirm) return;
        const force = this.force();
        if (!force) return;
        force.units().forEach(unit => {
            unit.endTurn();
        });
    }

    async endPhase(event: MouseEvent) {
        event.stopPropagation();
        this.unit()?.endPhase();
    }

    async endTurn(event: MouseEvent) {
        event.stopPropagation();
        this.unit()?.endTurn();
    }

    /**
     * Closes all overlays opened by this component (turn summary, PSR warning, etc.).
     */
    closeAllOverlays(): void {
        const unitId = this.unit()?.id;
        if (!unitId) return;
        
        // Close turn summary overlay
        this.overlayManager.closeManagedOverlay(`turnSummary-${unitId}`);
        // Close PSR warning overlay if any
        this.overlayManager.closeManagedOverlay(`psrWarning-${unitId}`);
    }
}
