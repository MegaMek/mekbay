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

import { Component, inject, ElementRef, signal, HostListener, ChangeDetectionStrategy, output, viewChild, effect, computed, HostBinding, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { Unit } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ToastService } from '../../services/toast.service';
import { ForceUnit } from '../../models/force-unit.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Router } from '@angular/router';
import { copyTextToClipboard } from '../../utils/clipboard.util';
import { FloatingOverlayService } from '../../services/floating-overlay.service';
import { SwipeDirective, SwipeEndEvent, SwipeMoveEvent, SwipeStartEvent } from '../../directives/swipe.directive';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { REMOTE_HOST } from '../../models/common.model';
import { UnitDetailsGeneralTabComponent } from './tabs/unit-details-general-tab.component';
import { UnitDetailsIntelTabComponent } from './tabs/unit-details-intel-tab.component';
import { UnitDetailsFactionTabComponent } from './tabs/unit-details-factions-tab.component';
import { UnitDetailsSheetTabComponent } from './tabs/unit-details-sheet-tab.component';

/*
 * Author: Drake
 */
export interface UnitDetailsDialogData {
    unitList: Unit[] | ForceUnit[];
    unitIndex: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
}

interface ManufacturerInfo {
    manufacturer: string;
    factory: string;
}

@Component({
    selector: 'unit-details-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, SwipeDirective, UnitIconComponent, UnitDetailsGeneralTabComponent, UnitDetailsIntelTabComponent, UnitDetailsFactionTabComponent, UnitDetailsSheetTabComponent],
    templateUrl: './unit-details-dialog.component.html',
    styleUrls: ['./unit-details-dialog.component.css']
})
export class UnitDetailsDialogComponent {
    dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    dialogRef = inject(DialogRef<UnitDetailsDialogComponent>);
    data = inject(DIALOG_DATA) as UnitDetailsDialogData;
    toastService = inject(ToastService);
    router = inject(Router);
    floatingOverlayService = inject(FloatingOverlayService);
    add = output<Unit>();
    baseDialogRef = viewChild('baseDialog', { read: ElementRef });

    tabs = ['General', 'Intel', 'Factions', 'Sheet'];
    activeTab = signal(this.tabs[0]);

    unitList: Unit[] | ForceUnit[] = this.data.unitList;
    unitIndex = signal(this.data.unitIndex);
    gunnerySkill = computed<number | undefined>(() => {
        const currentUnit = this.unitList[this.unitIndex()]
        if (currentUnit instanceof CBTForceUnit) {
            return currentUnit.getCrewMember(0).getSkill('gunnery');
        } else 
        if (currentUnit instanceof ASForceUnit) {
            return currentUnit.getPilotSkill();
        }
        return this.data.gunnerySkill;
    });
    pilotingSkill = computed<number | undefined>(() => {
        const currentUnit = this.unitList[this.unitIndex()]
        if (currentUnit instanceof CBTForceUnit) {
            return currentUnit.getCrewMember(0).getSkill('piloting');
        } else 
        if (currentUnit instanceof ASForceUnit) {
            return currentUnit.getPilotSkill();
        }
        return this.data.pilotingSkill;
    });

    fluffImageUrl = signal<string | null>(null);

    // Swipe animation state
    isSwipeAnimating = signal(false);
    incomingUnit = signal<Unit | null>(null);
    
    // Real-time swipe following state
    isSwiping = signal(false);
    
    // CSS custom properties for panel positions
    currentPanelOffset = signal('0');
    incomingPanelOffset = signal('100%');
    
    get unit(): Unit {
        const currentUnit = this.unitList[this.unitIndex()]
        if (currentUnit instanceof ForceUnit) {
            return currentUnit.getUnit();
        }
        return currentUnit;
    }

    @HostBinding('class.fluff-background')
    get hostHasFluff(): boolean {
        return !!this.fluffImageUrl();
    }

    @HostBinding('style.--fluff-bg')
    get hostFluffBg(): string | null {
        const url = this.fluffImageUrl();
        return url ? `url("${url}")` : null;
    }
    
    constructor() {
        effect(() => {
            this.unit; // Re-run when unit changes
            this.updateFluffImage();
        });
        effect(() => {
            this.unit;
            this.activeTab()
            this.router.navigate([], {
                queryParams: {
                    shareUnit: this.unit.name,
                    tab: this.activeTab(),
                },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        });
        this.dialogRef.closed.subscribe(() => {
            this.router.navigate([], {
                queryParams: {
                    shareUnit: null,
                    tab: null,
                },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        });
    }

    private updateFluffImage() {
        this.fluffImageUrl.set(null);

        if (this.unit?.fluff?.img) {
            if (this.unit.fluff.img.endsWith('hud.png')) return; // Ignore HUD images
            this.fluffImageUrl.set(`${REMOTE_HOST}/images/fluff/${this.unit.fluff.img}`);
        }
    }

    onFluffImageError() {
        this.fluffImageUrl.set(null);
    }

    // Keyboard navigation (Left/Right)
    @HostListener('window:keydown', ['$event'])
    onWindowKeyDown(event: KeyboardEvent) {
        // Ignore if typing in an input/textarea/contentEditable
        const target = event.target as HTMLElement | null;
        if (target) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
        }
        // Ignore with modifiers
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        if (event.key === 'ArrowLeft') {
            if (this.hasPrev) {
                this.onPrev();
                event.preventDefault();
            }
        } else if (event.key === 'ArrowRight') {
            if (this.hasNext) {
                this.onNext();
                event.preventDefault();
            }
        }
    }

    get hasPrev(): boolean {
        return this.unitList && this.unitIndex() > 0;
    }

    get hasNext(): boolean {
        return this.unitList && this.unitIndex() < this.unitList.length - 1;
    }

    private getUnitAtIndex(index: number): Unit {
        const item = this.unitList[index];
        if (item instanceof ForceUnit) {
            return item.getUnit();
        }
        return item;
    }

    onPrev() {
        if (this.hasPrev && !this.isSwipeAnimating() && !this.isSwiping()) {
            // Emulate RIGHT swipe: current goes right, prev comes from left
            this.navigateToUnit(this.unitIndex() - 1, 'right');
        }
    }

    onNext() {
        if (this.hasNext && !this.isSwipeAnimating() && !this.isSwiping()) {
            // Emulate LEFT swipe: current goes left, next comes from right
            this.navigateToUnit(this.unitIndex() + 1, 'left');
        }
    }

    /**
     * Navigate to a new unit with animation.
     * @param newIndex - The index of the unit to navigate to
     * @param swipeDirection - 'left' means swiping left (current goes left, incoming from right)
     *                        'right' means swiping right (current goes right, incoming from left)
     */
    private navigateToUnit(newIndex: number, swipeDirection: 'left' | 'right') {
        this.floatingOverlayService.hide();
        
        // Set incoming unit
        this.incomingUnit.set(this.getUnitAtIndex(newIndex));
        this.isSwiping.set(false);
        
        // Set initial positions for animation
        if (swipeDirection === 'left') {
            // Swiping left: current goes to -100%, incoming starts at 100% and goes to 0
            this.currentPanelOffset.set('0');
            this.incomingPanelOffset.set('100%');
        } else {
            // Swiping right: current goes to 100%, incoming starts at -100% and goes to 0
            this.currentPanelOffset.set('0');
            this.incomingPanelOffset.set('-100%');
        }
        
        // Trigger animation on next frame
        requestAnimationFrame(() => {
            this.isSwipeAnimating.set(true);
            
            if (swipeDirection === 'left') {
                this.currentPanelOffset.set('-100%');
                this.incomingPanelOffset.set('0');
            } else {
                this.currentPanelOffset.set('100%');
                this.incomingPanelOffset.set('0');
            }
            
            // After animation completes, update the actual unit
            setTimeout(() => {
                this.unitIndex.set(newIndex);
                this.isSwipeAnimating.set(false);
                this.currentPanelOffset.set('0');
                this.incomingPanelOffset.set('100%');
                this.incomingUnit.set(null);
            }, 300); // Match CSS transition duration
        });
    }

    async onAdd() {
        const selectedUnit = (this.unit instanceof ForceUnit) ? this.unit.getUnit() : this.unit;
        let gunnery;
        let piloting;
        if (this.unit instanceof CBTForceUnit) {
            gunnery = this.unit.getCrewMember(0).getSkill('gunnery');
            piloting = this.unit.getCrewMember(0).getSkill('piloting');
        } else if (this.unit instanceof ASForceUnit) {
            gunnery = this.unit.getPilotSkill();
            piloting = this.unit.getPilotSkill();
        } else {
            gunnery = this.gunnerySkill();
            piloting = this.pilotingSkill();
        }
        const addedUnit = await this.forceBuilderService.addUnit(
            selectedUnit,
            gunnery,
            piloting,
        );
        if (addedUnit) {
            this.toastService.show(`${selectedUnit.chassis} ${selectedUnit.model} added to the force.`, 'success');
            this.add.emit(selectedUnit);
        }
        this.onClose();
    }

    onClose() {
        this.dialogRef.close();
    }

    formatThousands(value: number): string {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    onShare() {
        const domain = window.location.origin + window.location.pathname;
        const unitName = encodeURIComponent(this.unit.name);
        const tab = encodeURIComponent(this.activeTab());
        const shareUrl = `${domain}?shareUnit=${unitName}&tab=${tab}`;
        const shareText = `${this.unit.chassis} ${this.unit.model}`;
        if (navigator.share) {
            navigator.share({
                title: shareText,
                url: shareUrl
            }).catch(() => {
                // fallback if user cancels or error
                copyTextToClipboard(shareUrl);
                this.toastService.show('Unit link copied to clipboard.', 'success');
            });
        } else {
            copyTextToClipboard(shareText);
            this.toastService.show('Unit link copied to clipboard.', 'success');
        }
    }

    public shouldBlockSwipe = (): boolean => {
        if (this.isSwipeAnimating()) return true;
        const index = this.unitIndex();
        return (index === 0 && !this.hasNext) || (index === this.unitList.length - 1 && !this.hasPrev);
    };

    public onSwipeStart(event: SwipeStartEvent): void {
        if (this.isSwipeAnimating()) return;
        this.floatingOverlayService.hide();
        this.isSwiping.set(true);
        this.currentPanelOffset.set('0');
        this.incomingUnit.set(null);
    }

    public onSwipeMove(event: SwipeMoveEvent): void {
        if (this.isSwipeAnimating()) return;
        
        const deltaX = event.deltaX;
        
        // Determine which unit would be incoming based on swipe direction
        // Swiping right (deltaX > 0) = going to previous unit, incoming from LEFT
        // Swiping left (deltaX < 0) = going to next unit, incoming from RIGHT
        if (deltaX > 0 && this.hasPrev) {
            // Swiping right - show previous unit coming from the left
            const prevUnit = this.getUnitAtIndex(this.unitIndex() - 1);
            if (this.incomingUnit() !== prevUnit) {
                this.incomingUnit.set(prevUnit);
            }
            // Current panel moves right by deltaX
            this.currentPanelOffset.set(`${deltaX}px`);
            // Incoming panel starts at -100% and moves right with the swipe
            this.incomingPanelOffset.set(`calc(-100% + ${deltaX}px)`);
        } else if (deltaX < 0 && this.hasNext) {
            // Swiping left - show next unit coming from the right
            const nextUnit = this.getUnitAtIndex(this.unitIndex() + 1);
            if (this.incomingUnit() !== nextUnit) {
                this.incomingUnit.set(nextUnit);
            }
            // Current panel moves left by deltaX (negative)
            this.currentPanelOffset.set(`${deltaX}px`);
            // Incoming panel starts at 100% and moves left with the swipe
            this.incomingPanelOffset.set(`calc(100% + ${deltaX}px)`);
        } else {
            // Dampen the swipe if at boundary (no prev/next available)
            this.currentPanelOffset.set(`${deltaX * 0.3}px`);
            this.incomingUnit.set(null);
        }
    }

    public onSwipeEnd(event: SwipeEndEvent): void {
        if (this.isSwipeAnimating()) {
            this.isSwiping.set(false);
            this.resetSwipeState();
            return;
        }
        
        this.isSwiping.set(false);
        
        if (!event.success) {
            // Animate back to original position
            this.animateSwipeCancel();
            return;
        }
        
        const direction = event.direction;
        // Swipe left = go to next unit
        // Swipe right = go to previous unit
        if (direction === 'left' && this.hasNext) {
            this.completeSwipeAnimation('left', this.unitIndex() + 1);
        } else if (direction === 'right' && this.hasPrev) {
            this.completeSwipeAnimation('right', this.unitIndex() - 1);
        } else {
            this.animateSwipeCancel();
        }
    }
    
    private animateSwipeCancel(): void {
        // Animate back to start position
        this.isSwipeAnimating.set(true);
        this.currentPanelOffset.set('0');
        
        // Determine where to animate incoming panel back to
        const incoming = this.incomingUnit();
        if (incoming) {
            const currentIdx = this.unitIndex();
            const incomingIdx = this.unitList.findIndex(u => {
                const unit = u instanceof ForceUnit ? u.getUnit() : u;
                return unit === incoming;
            });
            if (incomingIdx < currentIdx) {
                // Was coming from left, animate back to left
                this.incomingPanelOffset.set('-100%');
            } else {
                // Was coming from right, animate back to right
                this.incomingPanelOffset.set('100%');
            }
        }
        
        setTimeout(() => {
            this.resetSwipeState();
        }, 300);
    }
    
    private completeSwipeAnimation(swipeDirection: 'left' | 'right', newIndex: number): void {
        this.isSwipeAnimating.set(true);
        
        if (swipeDirection === 'left') {
            // Swiping left: current goes to -100%, incoming goes to 0
            this.currentPanelOffset.set('-100%');
            this.incomingPanelOffset.set('0');
        } else {
            // Swiping right: current goes to 100%, incoming goes to 0
            this.currentPanelOffset.set('100%');
            this.incomingPanelOffset.set('0');
        }
        
        setTimeout(() => {
            this.unitIndex.set(newIndex);
            this.resetSwipeState();
        }, 300);
    }
    
    private resetSwipeState(): void {
        this.isSwipeAnimating.set(false);
        this.isSwiping.set(false);
        this.currentPanelOffset.set('0');
        this.incomingPanelOffset.set('100%');
        this.incomingUnit.set(null);
    }
}