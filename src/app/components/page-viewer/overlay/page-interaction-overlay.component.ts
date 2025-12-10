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
    template: `
        @if (dirtyPhase()) {
            <div class="phase-controls">
                <button role="button" class="phase-button end-phase-button preventZoomReset" tabindex="0"
                    (click)="endPhase($event)">
                    COMMIT AND END PHASE
                </button>
            </div>
        }

        <div class="container">
            <button role="button" class="overlay-button turn-tracker-button preventZoomReset" tabindex="0"
                (click)="openTurnSummary($event)">
                @let phase = currentPhase();
                @if (falling()) {
                    <svg width="40px" height="40px" version="1.1" viewBox="0 0 16 14" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="m15.8 12.2-6.97-11.758a1 1 0 0 0-1.66 0l-7.007 11.858c-0.38 0.6-0.07 1.7 0.68 1.7h14.357c0.7 0 1-1.1 0.6-1.8z"
                            fill="#f00"/>
                        <path
                            d="m 10.8,11 c -0.6,-0.1 -1.11,0.1 -1.28,0.6 -0.16,0.4 0,1 0.47,1.2 0.61,0.1 1.11,0 1.31,-0.6 0.2,-0.5 0,-1 -0.5,-1.2 z M 3.61,8.15 5.82,9.38 6.02,9.44 6.31,9.38 7.96,8.56 8.12,10.8 c -0.69,0.5 -2.2,1.1 -2.41,1.3 -0.19,0.1 -0.26,0.4 -0.17,0.5 0.1,0.2 0.49,0.2 0.68,0.1 l 3.29,-1.6 c 0.1,0 0.17,-0.1 0.25,-0.2 l 1.54,-1.68 1.8,0.32 c 0.1,0 0.4,-0.1 0.4,-0.32 0,-0.25 -0.1,-0.44 -0.4,-0.5 L 11.3,8.35 c -0.2,0 -0.4,0.1 -0.5,0.22 L 9.99,9.3 9.77,7.24 C 9.77,7 9.52,6.67 9.36,6.58 L 7.71,5.93 7.63,4.05 C 7.63,3.85 7.39,3.55 7,3.54 6.62,3.53 6.39,3.92 6.39,4.17 l 0.17,2.25 c 0,0.16 0.16,0.33 0.33,0.41 L 7.88,7.24 6.15,8.15 4.18,7.08 C 3.79,6.94 3.51,7.05 3.36,7.34 3.2,7.62 3.36,7.98 3.61,8.15 Z"
                            fill="#ffffff" />
                    </svg>
                } @else if (hasPSRChecks()) {
                    <svg class="warning" fill="currentColor" width="40px" height="40px" viewBox="0 0 16 16"
                        xmlns="http://www.w3.org/2000/svg">
                        <path d="M15.83 13.23l-7-11.76a1 1 0 0 0-1.66 0L.16 13.3c-.38.64-.07 1.7.68 1.7H15.2C15.94 15 16.21 13.87 15.83 13.23Z" />
                        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="mathematical" font-size="8">
                            {{ psrCount() }}!
                        </text>
                    </svg>
                } @else {
                    <svg [class.dirty]="dirty()" [class.ranged]="phase === 'W'" [class.physical]="phase === 'P'"
                        [class.heat]="phase === 'H'" fill="currentColor" width="40px" height="40px" viewBox="0 0 32 32"
                        xmlns="http://www.w3.org/2000/svg">
                        <path class="octagon"
                            d="M30.8508,15.4487,23.8867,3.5322A1.0687,1.0687,0,0,0,22.9643,3H9.0357a1.0687,1.0687,0,0,0-.9224.5322L1.1492,15.4487a1.0933,1.0933,0,0,0,0,1.1026L8.1133,28.4678A1.0687,1.0687,0,0,0,9.0357,29H22.9643a1.0687,1.0687,0,0,0,.9224-.5322l6.9641-11.9165A1.0933,1.0933,0,0,0,30.8508,15.4487Z" />
                        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-size="16">
                            {{ currentPhase() }}
                        </text>
                    </svg>
                }
            </button>
        </div>
    `,
    host: {
        '[class.fixed-mode]': 'isFixedMode()'
    },
    styles: [`
        :host {
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 2;
            box-sizing: border-box;
            overflow: hidden;
        }
        
        /* Fixed mode: overlay is attached to container, not page-wrapper */
        :host.fixed-mode {
            /* Uses inset styling from inline styles set by page-viewer */
        }

        .container {
            display: block;
            position: absolute;
            box-sizing: border-box;
            pointer-events: none;
            overflow: hidden;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
        }

        .overlay-button {
            position: absolute;
            opacity: 0.8;
            outline: none;
            transition: opacity 0.2s;
            color: #000;
            padding: 0;
            margin: 0;
            border: none;
            background: none;
            cursor: pointer;
            pointer-events: auto;

            &:hover {
                opacity: 1.0;
            }
        }

        .phase-controls {
            bottom: 8px;
            left: 0;
            right: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            position: absolute;
            width: fit-content;
            margin-inline: auto;
            pointer-events: auto;
            gap: 8px;

            .phase-button {
                cursor: pointer;
                opacity: 1.0;
                margin-inline: auto;
                width: fit-content;
                border: 1px solid #000;
                padding: 8px;
                text-align: center;
                font-weight: bold;
                transition: filter 0.2s;
                font-size: 1.1em;

                &.end-phase-button {
                    background-color: #f00;
                    color: white;
                }

                &:hover {
                    filter: brightness(1.2);
                }
            }
        }

        .turn-tracker-button {
            top: 8px;
            right: 8px;
            width: 40px;
            height: 40px;

            svg {
                width: 100%;
                height: 100%;

                .octagon {
                    stroke: white;
                    stroke-width: 1;
                }

                text {
                    pointer-events: none;
                    font-weight: bold;
                    fill: #fff;
                }

                &.move .octagon {
                    fill: var(--phase-move);
                }
                &.ranged .octagon {
                    fill: var(--phase-ranged);
                }
                &.physical .octagon {
                    fill: var(--phase-physical);
                }
                &.heat .octagon {
                    fill: var(--phase-heat);
                }

                &.warning {
                    color: var(--damage-color);
                    text {
                        fill: #000;
                    }
                }
            }

            :host-context(.night-mode) & {
                color: #fff;
                svg text {
                    fill: #000;
                }
                svg .octagon {
                    stroke-width: 0;
                }
            }
        }

        @media print {
            :host {
                display: none !important;
            }
        }
    `]
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
