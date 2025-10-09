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

import { Component, computed, HostBinding, HostListener, ElementRef, Renderer2, effect, inject, OnDestroy, ChangeDetectionStrategy, viewChild, viewChildren, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { UnitSearchComponent } from '../unit-search/unit-search.component';
import { Unit } from '../../models/units.model';
import { ForceUnit } from '../../models/force-unit.model';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop'
import { PopupMenuComponent } from '../../components/popup-menu/popup-menu.component';
import { Dialog } from '@angular/cdk/dialog';
import { UnitDetailsDialogComponent } from '../unit-details-dialog/unit-details-dialog.component';

/*
 * Author: Drake
 */

// --- Gesture Constants ---
const SWIPE_ACTIVATION_ZONE_PERCENT = 0.05; // Gesture is active in the leftmost 5% of the screen
const SWIPE_SNAP_THRESHOLD_PERCENT = 0.5;   // Menu snaps open/closed if dragged > 50% of its width

@Component({
    selector: 'force-builder-viewer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitSearchComponent, DragDropModule, PopupMenuComponent],
    templateUrl: './force-builder-viewer.component.html',
    styleUrls: ['./force-builder-viewer.component.scss']
})
export class ForceBuilderViewerComponent implements OnDestroy {
    protected forceBuilderService = inject(ForceBuilderService);
    protected layoutService = inject(LayoutService);
    private elRef = inject(ElementRef<HTMLElement>);
    private renderer = inject(Renderer2);
    private dialog = inject(Dialog);
    menuSelect = output<string>();
    private unitSearchComponent = viewChild(UnitSearchComponent);
    private scrollableContent = viewChild<ElementRef<HTMLDivElement>>('scrollableContent');
    forceUnitItems = viewChildren<ElementRef<HTMLElement>>('forceUnitItem');
    private burgerLipBtn = viewChild<ElementRef<HTMLButtonElement>>('burgerLipBtn');

    // --- Gesture State ---
    private isDragging = false;
    private startX = 0;
    private startY = 0;
    private hostWidth = 0;
    private hasMoved = false; // Flag to distinguish tap from swipe
    private isUnitDragging = false; // Flag for unit drag/sorting

    // Touch event listeners for dynamic management
    private touchMoveListener?: (event: TouchEvent) => void;
    private touchEndListener?: (event: TouchEvent) => void;
    private touchCancelListener?: (event: TouchEvent) => void;

    // Lip drag state
    private isLipDragging = false;
    private lipStartY = 0;
    private lipStartTop = 0;
    private lipPointerId: number | null = null;
    private lipMoved = false;
    private ignoreNextLipClick = false;
    private lipMoveUnlisten?: () => void;
    private lipUpUnlisten?: () => void;

    @HostBinding('class.is-mobile-menu-open')
    get isMobileMenuOpen() {
        return this.layoutService.isMobile() && this.layoutService.isMenuOpen();
    }
    totalBv = computed(() => {
        return this.forceBuilderService.forceUnits().reduce((sum, unit) => sum + (unit.getBv()), 0);
    });

    constructor() {
        effect(() => {
            // When the menu is closed, ensure the advanced search panel is also closed.
            if (!this.layoutService.isMenuOpen()) {
                this.unitSearchComponent()?.closeAdvPanel();
            }
        });

        effect(() => {
            const selected = this.forceBuilderService.selectedUnit();
            if (selected) {
                setTimeout(() => {
                    this.scrollToUnit(selected.id);
                }, 50);
            }
        });
    }

    onUnitKeydown(event: KeyboardEvent, index: number) {
        const units = this.forceBuilderService.forceUnits();
        if (event.key === 'ArrowDown') {
            if (index < units.length - 1) {
                event.preventDefault();
                const next = this.forceUnitItems()?.[index + 1];
                next?.nativeElement.focus();
                this.selectUnit(units[index + 1]);
            }
        } else if (event.key === 'ArrowUp') {
            if (index > 0) {
                event.preventDefault();
                const prev = this.forceUnitItems()?.[index - 1];
                prev?.nativeElement.focus();
                this.selectUnit(units[index - 1]);
            }
        }
    }

    get forceName() {
        return computed(() => this.forceBuilderService.force.name);
    }

    selectUnit(unit: ForceUnit) {
        this.forceBuilderService.selectUnit(unit);
        if (this.layoutService.isMobile()) {
            this.layoutService.closeMenu();
        }
    }

    async removeUnit(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        await this.forceBuilderService.removeUnit(unit);
        // If this was the last unit, close the menu (offcanvas OFF mode)
        if (this.forceBuilderService.forceUnits().length === 0) {
            this.layoutService.closeMenu();
        }
    }

    showUnitInfo(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const unitList = this.forceBuilderService.forceUnits().map(u => u.getUnit());
        const unitIndex = unitList.findIndex(u => u.name === unit.getUnit().name);
        this.dialog.open(UnitDetailsDialogComponent, {
            data: {
                unitList: unitList,
                unitIndex: unitIndex,
                hideAddButton: true
            }
        });
    }

    toggleC3Link(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        unit.setC3Linked(!unit.c3Linked);
    }

    toggleMenu() {
        this.layoutService.toggleMenu();
    }

    ngOnDestroy() {
        this.cleanupTouchListeners();
        this.cleanupLipListeners();
    }

    private addTouchListeners() {
        this.touchMoveListener = (event: TouchEvent) => this.onTouchMove(event);
        this.touchEndListener = (event: TouchEvent) => this.onTouchEnd(event);
        this.touchCancelListener = (event: TouchEvent) => this.onTouchCancel(event);

        document.addEventListener('touchmove', this.touchMoveListener, { passive: false });
        document.addEventListener('touchend', this.touchEndListener);
        document.addEventListener('touchcancel', this.touchCancelListener);
    }

    private cleanupTouchListeners() {
        if (this.touchMoveListener) {
            document.removeEventListener('touchmove', this.touchMoveListener);
            this.touchMoveListener = undefined;
        }
        if (this.touchEndListener) {
            document.removeEventListener('touchend', this.touchEndListener);
            this.touchEndListener = undefined;
        }
        if (this.touchCancelListener) {
            document.removeEventListener('touchcancel', this.touchCancelListener);
            this.touchCancelListener = undefined;
        }
    }

    // --- Touch Gesture Handling ---

    completeDragGesture() {
        this.layoutService.isMenuDragging.set(false); // <-- Release the lock
        this.cleanupTouchListeners(); // Clean up dynamic listeners

        // If there was no movement, it was a tap. Do nothing.
        if (!this.hasMoved) {
            this.isDragging = false;
            this.renderer.removeClass(this.elRef.nativeElement, 'is-dragging');
            return;
        }

        this.isDragging = false;
        this.renderer.removeClass(this.elRef.nativeElement, 'is-dragging');

        const transformStyle = this.elRef.nativeElement.style.transform;
        const currentTranslateX = parseInt(transformStyle.replace(/translateX\(|\)|px/g, ''), 10) || 0;

        this.renderer.removeStyle(this.elRef.nativeElement, 'transform');

        const openRatio = (this.hostWidth + currentTranslateX) / this.hostWidth;

        if (openRatio > SWIPE_SNAP_THRESHOLD_PERCENT) {
            this.layoutService.isMenuOpen.set(true);
        } else {
            this.layoutService.isMenuOpen.set(false);
        }
    }

    @HostListener('document:touchstart', ['$event'])
    onTouchStart(event: TouchEvent) {
        if (!this.layoutService.isMobile() || this.isUnitDragging) return;

        if (this.unitSearchComponent()?.advOpen()) {
            const advPanelEl = this.unitSearchComponent()?.advPanel()?.nativeElement;
            // If the touch is inside the panel, block the swipe gesture.
            if (advPanelEl && advPanelEl.contains(event.target as Node)) {
                return;
            }
        }

        const touchX = event.touches[0].clientX;
        const touchY = event.touches[0].clientY;
        const menuIsOpen = this.layoutService.isMenuOpen();
        const inActivationZone = touchX < window.innerWidth * SWIPE_ACTIVATION_ZONE_PERCENT;
        const onTheMenu = this.elRef.nativeElement.contains(event.target as Node);
        const isOnLipButton = (event.target as HTMLElement)?.classList?.contains('burger-lip-btn');

        if ((menuIsOpen && onTheMenu) || (!menuIsOpen && (inActivationZone || isOnLipButton))) {
            // Set initial menu open ratio based on current state
            if (menuIsOpen) {
                this.layoutService.menuOpenRatio.set(1);
            } else {
                this.layoutService.menuOpenRatio.set(0);
            }
            this.isDragging = true;
            this.layoutService.isMenuDragging.set(true);
            this.hasMoved = false; // Reset movement flag on new touch
            this.startX = touchX;
            this.startY = touchY;
            this.hostWidth = this.elRef.nativeElement.offsetWidth;
            this.renderer.addClass(this.elRef.nativeElement, 'is-dragging');

            // Add the other touch listeners only when dragging starts
            this.addTouchListeners();
        }
    }

    private onTouchMove(event: TouchEvent) {
        if (!this.isDragging) return;

        const currentX = event.touches[0].clientX;
        const currentY = event.touches[0].clientY;
        const deltaX = currentX - this.startX;
        const deltaY = currentY - this.startY;
        const menuIsOpen = this.layoutService.isMenuOpen();

        // If the movement is primarily vertical, cancel the drag
        if (menuIsOpen && (Math.abs(deltaY) > Math.abs(deltaX))) {
            this.completeDragGesture();
            return;
        }

        // If we move, set the flag and prevent default to stop page scroll
        this.hasMoved = true;
        event.preventDefault();
        

        const targetX = menuIsOpen
            ? Math.max(-this.hostWidth, Math.min(0, deltaX)) // Closing
            : Math.max(-this.hostWidth, Math.min(0, -this.hostWidth + deltaX)); // Opening

        this.renderer.setStyle(this.elRef.nativeElement, 'transform', `translateX(${targetX}px)`);
        const openRatio = (this.hostWidth + targetX) / this.hostWidth;
        this.layoutService.menuOpenRatio.set(openRatio);
    }

    private onTouchEnd(event: TouchEvent) {
        if (!this.isDragging) return;
        this.completeDragGesture();
    }

    private onTouchCancel(event: TouchEvent) {
        if (!this.isDragging) return;
        this.completeDragGesture();
    }

    onUnitDragStart() {
        this.isUnitDragging = true;
        if (this.isDragging) {
            this.isDragging = false;
            this.renderer.removeClass(this.elRef.nativeElement, 'is-dragging');
            this.renderer.removeStyle(this.elRef.nativeElement, 'transform');
            this.layoutService.isMenuDragging.set(false);
            this.cleanupTouchListeners(); // Clean up listeners when unit drag starts
        }
    }

    onUnitDragEnd() {
        setTimeout(() => {
            this.isUnitDragging = false;
        }, 50);
    }

    formatValue(val: number, formatThousands: boolean = false): string {
        if (val >= 10_000_000_000) {
            return `${Math.round(val / 1_000_000_000)}kkk`;
        }
        if (val >= 10_000_000) {
            return `${Math.round(val / 1_000_000)}kk`;
        }
        if (val >= 10_000) {
            return `${Math.round(val / 1_000)}k`;
        }
        const rounded = Math.round(val);
        if (formatThousands) {
            return rounded.toLocaleString();
        }
        return rounded.toString();
    }

    formatTons(tons: number): string {
        const format = (num: number) => Math.round(num * 100) / 100;
        if (tons < 1000) {
            return `${format(tons)}`;
        } else if (tons < 1000000) {
            return `${format(tons / 1000)}k`;
        } else {
            return `${format(tons / 1000000)}M`;
        }
    }

    formatPilotData(unit: ForceUnit): string {
        const pilot = unit.getCrewMember(0);
        if (!pilot) return 'N/A';
        return `${pilot.getSkill('gunnery')} / ${pilot.getSkill('piloting')}`;
    }

    drop(event: CdkDragDrop<ForceUnit[]>) {
        this.forceBuilderService.reorderUnit(event.previousIndex, event.currentIndex);
    }

    private scrollToUnit(id: string) {
        const scrollContainer = this.scrollableContent()?.nativeElement;
        if (!scrollContainer) return;
        const unitElement = scrollContainer.querySelector(`#unit-${CSS.escape(id)}`) as HTMLElement;
        if (unitElement) {
            unitElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    onMenuSelected(option: string) {
        this.menuSelect.emit(option);
    }

    promptChangeForceName() {
        this.forceBuilderService.promptChangeForceName();
    }

    getUnitImg(unit: ForceUnit): string | undefined {
        return `https://db.mekbay.com/images/units/${unit.getUnit().icon}`;
    }

    // --- Lip vertical drag handlers ---
    onLipPointerDown(event: PointerEvent) {
        if (!this.layoutService.isMobile()) return;
        const lipBtn = this.burgerLipBtn();
        if (!lipBtn) return;

        const btnEl = lipBtn.nativeElement;
        this.isLipDragging = true;
        this.lipMoved = false;
        this.ignoreNextLipClick = false;
        this.lipPointerId = event.pointerId;

        // Calculate current top relative to host
        const hostRect = this.elRef.nativeElement.getBoundingClientRect();
        const btnRect = btnEl.getBoundingClientRect();
        const currentTop = btnRect.top - hostRect.top;

        this.lipStartTop = currentTop;
        this.lipStartY = event.clientY;

        // Ensure we're using 'top' for positioning during drag
        this.renderer.setStyle(btnEl, 'top', `${currentTop}px`);
        this.renderer.setStyle(btnEl, 'bottom', 'auto');

        // Capture pointer and listen for move/up on the element
        try { btnEl.setPointerCapture(event.pointerId); } catch {}
        this.lipMoveUnlisten = this.renderer.listen(btnEl, 'pointermove', (e: PointerEvent) => this.onLipPointerMove(e));
        this.lipUpUnlisten = this.renderer.listen(btnEl, 'pointerup', (e: PointerEvent) => this.onLipPointerUp(e));

        // Prevent scroll/page gestures
        event.preventDefault();
        event.stopPropagation();
    }

    private onLipPointerMove(event: PointerEvent) {
        if (!this.isLipDragging || event.pointerId !== this.lipPointerId) return;
        const lipBtn = this.burgerLipBtn();
        if (!lipBtn) return;

        const btnEl = lipBtn.nativeElement;

        const deltaY = event.clientY - this.lipStartY;
        const proposedTop = this.lipStartTop + deltaY;

        const hostHeight = this.elRef.nativeElement.offsetHeight;
        const btnHeight = btnEl.offsetHeight;

        const minTop = 0;
        const maxTop = Math.max(0, hostHeight - btnHeight);
        const clampedTop = Math.min(Math.max(proposedTop, minTop), maxTop);

        // Update position
        this.renderer.setStyle(btnEl, 'top', `${clampedTop}px`);

        // Mark as moved when there is perceptible movement
        if (!this.lipMoved && Math.abs(deltaY) > 3) {
            this.lipMoved = true;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    private onLipPointerUp(event: PointerEvent) {
        if (!this.isLipDragging || event.pointerId !== this.lipPointerId) return;
        const lipBtn = this.burgerLipBtn();
        if (!lipBtn) return;

        // If the lip actually moved, suppress the subsequent click
        if (this.lipMoved) {
            this.ignoreNextLipClick = true;
        }

        const btnEl = lipBtn.nativeElement;
        try { btnEl.releasePointerCapture(event.pointerId); } catch {}

        this.isLipDragging = false;
        this.lipPointerId = null;
        this.cleanupLipListeners();

        event.preventDefault();
        event.stopPropagation();
    }

    private cleanupLipListeners() {
        if (this.lipMoveUnlisten) {
            this.lipMoveUnlisten();
            this.lipMoveUnlisten = undefined;
        }
        if (this.lipUpUnlisten) {
            this.lipUpUnlisten();
            this.lipUpUnlisten = undefined;
        }
    }

    onLipClick(event: MouseEvent) {
        // If a drag just happened, prevent the toggle click
        if (this.ignoreNextLipClick) {
            this.ignoreNextLipClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.toggleMenu();
    }
}