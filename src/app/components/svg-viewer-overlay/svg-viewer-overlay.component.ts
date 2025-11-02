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

import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, inject, Injector, input, signal, viewChild, Signal, effect, computed, DestroyRef, afterNextRender, ElementRef } from '@angular/core';
import { SvgZoomPanService } from '../svg-viewer/svg-zoom-pan.service';
import { OptionsService } from '../../services/options.service';
import { DbService } from '../../services/db.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceUnit } from '../../models/force-unit.model';
import { LoggerService } from '../../services/logger.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { TurnSummaryPanelComponent } from './turn-summary.component';

/*
 * Author: Drake
 */
@Component({
    selector: 'svg-interaction-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './svg-viewer-overlay.component.html',
    styleUrls: ['./svg-viewer-overlay.component.scss']
})
export class SvgInteractionOverlayComponent {
    logger = inject(LoggerService);
    private destroyRef = inject(DestroyRef);
    private injector = inject(Injector);
    private dialogsService = inject(DialogsService);
    private layoutService = inject(LayoutService);
    private zoomPanService = inject(SvgZoomPanService);
    overlayManager = inject(OverlayManagerService);
    optionsService = inject(OptionsService);
    dbService = inject(DbService);
    private overlay = inject(Overlay);
    private host = inject(ElementRef<HTMLElement>);

    unit = input<ForceUnit | null>(null);
    width = input(200);
    height = input(200);

    get nativeElement(): HTMLElement {
        return this.host.nativeElement;
    }

    hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().hasPSRCheck();
    });

    psrCount = computed<number>(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().getPSRChecks().length;
    });

    currentPhase = computed(() => {
        const unit = this.unit();
        if (!unit) return '';
        return unit.turnState().currentPhase();
    });

    fixedPosition = computed(() => {
        const unit = this.unit();
        const state = this.zoomPanService.getState();
        const translate = state.translate();
        const scale = state.scale();
        const hostEl = this.host?.nativeElement as HTMLElement | null;
        const hostRect = hostEl ? hostEl.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        const hostWidth = hostRect.width;
        const hostHeight = hostRect.height;

        // If the unit sheet, once scaled, would be larger than the viewport,
        // we then fix the position of the overlay to avoid overflow
        const shouldFix = (this.width() * scale > hostWidth) && (this.height() * scale > hostHeight);
        return shouldFix;
    });

    containerStyle = computed(() => {
        this.overlayManager.repositionAll();
        if (this.fixedPosition()) {
            return {};
        }
        const unit = this.unit();
        const state = this.zoomPanService.getState();
        const scale = state.scale();
        const translate = state.translate();
        const hostEl = this.host?.nativeElement as HTMLElement | null;
        const hostRect = hostEl ? hostEl.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        const hostWidth = hostRect.width;
        const hostHeight = hostRect.height;
        // We make the container fit to the unit's sheet size.
        // But if the sheet is too zoomed in, so that it exceeds the viewport size,
        // we limit it to the viewport size to avoid overflow.
        const translateX = Math.max(0, translate.x);
        const translateY = Math.max(0, translate.y);
        let width = this.width();
        let height = this.height();
        if (width * scale > hostWidth) {
            width = hostWidth / scale;
        }
        if (height * scale > hostHeight) {
            height = hostHeight / scale;
        }
        let finalWidth = width * scale;
        let finalHeight = height * scale;
        const style = {
            width: finalWidth + 'px',
            height: finalHeight + 'px',
            left: translateX + 'px',
            top: translateY + 'px',
        };
        return style;
    });

    constructor() { }


    openTurnSummary(event: MouseEvent) {
        event.stopPropagation();

        // toggle: close if already open
        if (this.overlayManager.has('turnSummary')) {
            this.overlayManager.closeManagedOverlay('turnSummary');
            return;
        }

        const target = event.currentTarget as HTMLElement || (event.target as HTMLElement);
        const portal = new ComponentPortal(TurnSummaryPanelComponent, null, this.injector);
        const compRef = this.overlayManager.createManagedOverlay('turnSummary', target, portal, {
            hasBackdrop: false,
            panelClass: 'turn-summary-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });
    }
}
