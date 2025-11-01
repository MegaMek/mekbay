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
import { SvgZoomPanService } from './svg-zoom-pan.service';
import { OptionsService } from '../../services/options.service';
import { DbService } from '../../services/db.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceUnit } from '../../models/force-unit.model';
import { LoggerService } from '../../services/logger.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { TooltipDirective } from '../../directives/tooltip.directive';

/*
 * Author: Drake
 */
@Component({
    selector: 'svg-interaction-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, TooltipDirective],
    template: `
        <div class="container" [ngStyle]="containerStyle()">
            @if (hasPSRChecks()) {
                <svg class="PSRwarning preventZoomReset" (click)="openPsrWarning($event)" tabindex="0" role="button" aria-label="PSR Warning" title="PSR Warning"
                    [tooltip]="'This unit has a PSR (Pilot Skill Roll) warning.'"
                    fill="currentColor" width="40px" height="40px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                <path d="M15.83 13.23l-7-11.76a1 1 0 0 0-1.66 0L.16 13.3c-.38.64-.07 1.7.68 1.7H15.2C15.94 15 16.21 13.87 15.83 13.23Z" />
                <text x="50%" y="55%" text-anchor="middle" dominant-baseline="mathematical" fill="#000" font-size="8" font-weight="bold" pointer-events="none">
                    {{ psrCount() }}!
                </text>
                </svg>
            }
            <div class="preventZoomReset summary framed-borders-for-sheet">
                <div class="header">Turn Summary</div>
                <div class="summary-entry">Total damage: 21</div>
                <button role="button" class="summary-entry button warning" (click)="openPsrWarning($event)" tabindex="0">
                    ⚠ PSR Check! ({{ psrCount() }})
                </button>
                <button role="button" class="summary-entry button" tabindex="0">
                    End Turn
                </button>
            </div>
        </div>
   `,
    styles: `
        :host {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            pointer-events: none;
            z-index: 2;
        }
        .container {   
            width: 100%;
            height: 100%;
            display: block;
            position: relative;
        }
        .PSRwarning {
            position: absolute;
            top: 8px;
            right: 8px;
            color: var(--bt-yellow);
            opacity: 0.8;
            pointer-events: auto;
            cursor: pointer;
            outline: none;
            transition: opacity 0.2s;
        }
        .PSRwarning:hover {
            opacity: 1.0;
        }
        .summary {
            pointer-events: auto;
            position: absolute;
            top: 8px;
            right: 8px;
            padding: 4px;
            opacity: 0.8;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: opacity 0.2s;
            display: none;
        }
        .summary:hover {
            opacity: 1.0;
        }
        .header {
            font-weight: bold;
            margin-bottom: 4px;
            text-align: center;
        }
        .summary-entry {
            font-size: 0.9em;
        }

        .summary-entry.button {
            pointer-events: auto;
            cursor: pointer;
            outline: none;
            background: none;
            border: var(--background-color-light);
            border: 1px solid var(--border-color);
            padding: 4px 8px;
        }
        .summary-entry.button.warning {
            color: #ffcc00;
        }

        .summary-entry.button:hover {
            background-color: #eee;
            opacity: 1.0;
        }

        @media print {
            :host {
                display: none !important;
            }
        }
 `,
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

    hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.hasPSRChecks();
    });

    psrCount = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.getPSRChecksCount() + 1;
    });

    containerStyle = computed(() => {
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

    openPsrWarning(event: MouseEvent) {
        event.stopPropagation();

        // toggle: close if already open
        if (this.overlayManager.has('psrWarning')) {
            this.overlayManager.closeManagedOverlay('psrWarning');
            return;
        }

        const target = event.currentTarget as HTMLElement || (event.target as HTMLElement);
        const portal = new ComponentPortal(PsrWarningPanelComponent, null, this.injector);
        const compRef = this.overlayManager.createManagedOverlay('psrWarning', target, portal, {
            hasBackdrop: false,
            panelClass: 'psr-warning-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.close()
        });
    }
}
@Component({
    selector: 'psr-warning-panel',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="psr-panel framed-borders has-shadow" (click)="$event.stopPropagation()">
        <div class="psr-header">
            <strong>PSR Warning</strong>
        </div>
        <div class="psr-body">
            This unit has a PSR (Pilot Skill Roll) warning.
        </div>
        <div class="psr-actions">
            <button class="bt-button" type="button" (click)="close()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .psr-panel {
            padding: 12px;
            max-width: 320px;
            background: var(--background-color-menu, #222);
            color: var(--text-color, #fff);
        }
        .psr-header {
            margin-bottom: 8px;
            font-size: 1em;
        }
        .psr-body {
            margin-bottom: 12px;
            font-size: 0.9em;
            color: var(--text-color-secondary, #bbb);
        }
        .psr-actions {
            display: flex;
            justify-content: center;
        }
    `]
})
class PsrWarningPanelComponent {
    private overlayManager = inject(OverlayManagerService);
    close() {
        this.overlayManager.closeManagedOverlay('psrWarning');
    }
}