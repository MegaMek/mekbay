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

import { Component, computed, HostBinding, HostListener, Injector, ElementRef, Renderer2, effect, inject, OnDestroy, ChangeDetectionStrategy, viewChild, viewChildren, output, input, contentChild, signal, afterNextRender, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { UnitSearchComponent } from '../unit-search/unit-search.component';
import { ForceUnit, UnitGroup } from '../../models/force-unit.model';
import { DragDropModule, CdkDragDrop, moveItemInArray, CdkDragMove } from '@angular/cdk/drag-drop'
import { Dialog } from '@angular/cdk/dialog';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { Portal, PortalModule } from '@angular/cdk/portal';
import { ShareForceDialogComponent } from '../share-force-dialog/share-force-dialog.component';
import { UnitBlockComponent } from '../unit-block/unit-block.component';
import { CdkMenuModule } from '@angular/cdk/menu';
import { OptionsDialogComponent } from '../options-dialog/options-dialog.component';
import { ForceLoadDialogComponent } from '../force-load-dialog/force-load-dialog.component';
import { ToastService } from '../../services/toast.service';
import { DataService } from '../../services/data.service';
import { PrintUtil } from '../../utils/print.util';
import { ForcePackDialogComponent } from '../force-pack-dialog/force-pack-dialog.component';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { OptionsService } from '../../services/options.service';
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
    imports: [CommonModule, PortalModule, DragDropModule, CdkMenuModule, UnitBlockComponent],
    templateUrl: './force-builder-viewer.component.html',
    styleUrls: ['./force-builder-viewer.component.scss']
})
export class ForceBuilderViewerComponent implements OnDestroy {
    protected forceBuilderService = inject(ForceBuilderService);
    protected layoutService = inject(LayoutService);
    private dataService = inject(DataService);
    private optionsService = inject(OptionsService);
    private toastService = inject(ToastService);
    private elRef = inject(ElementRef<HTMLElement>);
    private renderer = inject(Renderer2);
    private dialog = inject(Dialog);
    private injector = inject(Injector);
    unitSearchPortal = input<Portal<any>>();
    unitSearchComponent = input<UnitSearchComponent>();
    private scrollableContent = viewChild<ElementRef<HTMLDivElement>>('scrollableContent');
    forceUnitItems = viewChildren<ElementRef<HTMLElement>>('forceUnitItem');
    private burgerLipBtn = viewChild<ElementRef<HTMLButtonElement>>('burgerLipBtn');

    compactMode = signal<boolean>(false);

    lockAxis = computed(() => {
        return !this.compactMode() ? 'y' : null;
    });

    hasEmptyGroups = computed(() => {
        return this.forceBuilderService.force.groups().some(g => g.units().length === 0);
    });

    // --- Gesture State ---
    private isDragging = false;
    private startX = 0;
    private startY = 0;
    private hostWidth = 0;
    private hasMoved = false; // Flag to distinguish tap from swipe
    isUnitDragging = signal<boolean>(false); // Flag for unit drag/sorting

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

    //Units autoscroll
    private autoScrollVelocity = signal<number>(0);     // px/sec (+ down, - up)
    private autoScrollRafId?: number;
    private lastAutoScrollTs?: number;
    private readonly AUTOSCROLL_EDGE = 64;   // px threshold from edge to start scrolling
    private readonly AUTOSCROLL_MAX = 600;   // px/sec max scroll speed
    private readonly AUTOSCROLL_MIN = 40;

    @HostBinding('class.is-mobile-menu-open')
    get isMobileMenuOpen() {
        return this.layoutService.isMobile() && this.layoutService.isMenuOpen();
    }

    hasSingleGroup = computed(() => {
        return this.forceBuilderService.force.groups().length === 1;
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
                afterNextRender(() => {
                    this.scrollToUnit(selected.id);
                }, { injector: this.injector });
            }
        });
        effect(() => {
            const height = this.layoutService.windowHeight();
            const lip =  this.burgerLipBtn()?.nativeElement;
            if (lip) {
                if (lip.style.bottom !== 'auto') return; // Nothing to do, we are not using 'top' positioning
                const topStr = lip.style.top;
                const lipTop = (topStr ? parseFloat(topStr) : lip.offsetTop) || 0;
                const maxTop = Math.max(0, height - lip.offsetHeight);
                if (lipTop > maxTop) {
                    // Reset lip positioning
                    this.renderer.setStyle(lip, 'top', null);
                    this.renderer.setStyle(lip, 'bottom', null);
                }
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
        const unitList = this.forceBuilderService.forceUnits();
        const unitIndex = unitList.findIndex(u => u.id === unit.id);
        const ref = this.dialog.open(UnitDetailsDialogComponent, {
            disableClose: true,
            data: <UnitDetailsDialogData>{
                unitList: unitList,
                unitIndex: unitIndex
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
        this.stopAutoScrollLoop();
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
        if (!this.layoutService.isMobile() || this.isUnitDragging()) return;

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
        if (this.forceBuilderService.readOnlyForce()) return;
        this.isUnitDragging.set(true);
        if (this.isDragging) {
            this.isDragging = false;
            this.renderer.removeClass(this.elRef.nativeElement, 'is-dragging');
            this.renderer.removeStyle(this.elRef.nativeElement, 'transform');
            this.layoutService.isMenuDragging.set(false);
            this.cleanupTouchListeners(); // Clean up listeners when unit drag starts
        }
    }

    onUnitDragMoved(event: CdkDragMove<any>) {
       if (this.forceBuilderService.readOnlyForce()) return;

       const scrollRef = this.scrollableContent?.();
       if (!scrollRef) {
           this.stopAutoScrollLoop();
           return;
       }
       const container = scrollRef.nativeElement as HTMLElement;
       const rect = container.getBoundingClientRect();

       // Get pointer Y position from event (or fallback to last known position)
       const pointerY = (event.event as PointerEvent)?.clientY ?? event.pointerPosition?.y;
       if (pointerY == null) {
           this.stopAutoScrollLoop();
           return;
       }

       const topDist = pointerY - rect.top;
       const bottomDist = rect.bottom - pointerY;

       let ratio = 0;
       if (topDist < this.AUTOSCROLL_EDGE) {
           ratio = (this.AUTOSCROLL_EDGE - topDist) / this.AUTOSCROLL_EDGE; // 0..1
           ratio = Math.max(0, Math.min(1, ratio));
           ratio = ratio * ratio; // ease-in
           this.autoScrollVelocity.set(-Math.max(this.AUTOSCROLL_MIN, ratio * this.AUTOSCROLL_MAX));
       } else if (bottomDist < this.AUTOSCROLL_EDGE) {
           ratio = (this.AUTOSCROLL_EDGE - bottomDist) / this.AUTOSCROLL_EDGE;
           ratio = Math.max(0, Math.min(1, ratio));
           ratio = ratio * ratio;
           this.autoScrollVelocity.set(Math.max(this.AUTOSCROLL_MIN, ratio * this.AUTOSCROLL_MAX));
       } else {
           this.autoScrollVelocity.set(0);
       }

       if (Math.abs(this.autoScrollVelocity()) > 0.5) {
           this.startAutoScrollLoop();
       } else {
           this.stopAutoScrollLoop();
       }
    }

    onUnitDragEnd() {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.stopAutoScrollLoop();
        this.isUnitDragging.set(false);
    }

       
    private startAutoScrollLoop() {
        if (this.autoScrollRafId) return;
        this.lastAutoScrollTs = performance.now();
        const step = (ts: number) => {
            // If RAF was cancelled, abort
            if (!this.autoScrollRafId) return;
            const last = this.lastAutoScrollTs ?? ts;
            // clamp dt to avoid huge jumps
            const dt = Math.min(100, ts - last) / 1000;
            this.lastAutoScrollTs = ts;

            const v = this.autoScrollVelocity();
            if (Math.abs(v) > 0.5) {
                const scrollRef = this.scrollableContent?.();
                if (scrollRef) {
                    const el = scrollRef.nativeElement as HTMLElement;
                    const delta = v * dt;
                    // clamp new scrollTop inside scrollable range
                    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + delta));
                }
                this.autoScrollRafId = requestAnimationFrame(step);
            } else {
                this.stopAutoScrollLoop();
            }
        };
        this.autoScrollRafId = requestAnimationFrame(step);
    }

    private stopAutoScrollLoop() {
        if (this.autoScrollRafId) {
            cancelAnimationFrame(this.autoScrollRafId);
            this.autoScrollRafId = undefined;
        }
        this.autoScrollVelocity.set(0);
        this.lastAutoScrollTs = undefined;
    }

    drop(event: CdkDragDrop<ForceUnit[]>) {
        if (this.forceBuilderService.readOnlyForce()) return;
        
        const force = this.forceBuilderService.force;
        const groups = force.groups();

        const groupIdFromContainer = (id?: string) => id && id.startsWith('group-') ? id.substring('group-'.length) : null;

        const fromGroupId = groupIdFromContainer(event.previousContainer?.id);
        const toGroupId = groupIdFromContainer(event.container?.id);

        if (!fromGroupId || !toGroupId) return;

       const fromGroup = groups.find(g => g.id === fromGroupId);
        const toGroup = groups.find(g => g.id === toGroupId);
        if (!fromGroup || !toGroup) return;

        // Work with snapshots of the signals' arrays and then write them back.
        if (fromGroup === toGroup) {
            const units = [...fromGroup.units()]; // snapshot
            moveItemInArray(units, event.previousIndex, event.currentIndex);
            fromGroup.units.set(units);
        } else {
            const fromUnits = [...fromGroup.units()];
            const toUnits = [...toGroup.units()];

            // Remove from source
            const [moved] = fromUnits.splice(event.previousIndex, 1);
            if (!moved) return;

            // Insert into destination at the requested index
            const insertIndex = Math.min(Math.max(0, event.currentIndex), toUnits.length);
            toUnits.splice(insertIndex, 0, moved);

            fromGroup.units.set(fromUnits);
            toGroup.units.set(toUnits);
            this.forceBuilderService.generateGroupNameIfNeeded(fromGroup);
            this.forceBuilderService.generateGroupNameIfNeeded(toGroup);
        }
        force.removeEmptyGroups();
        // Notify force that structure changed
        force.emitChanged();
    }

    connectedDropLists(): string[] {
        const groups = this.forceBuilderService.force.groups() || [];
        const ids = groups.map(g => `group-${g.id}`);
        ids.push('new-group-dropzone');
        return ids;
    }

    dropForNewGroup(event: CdkDragDrop<any, any, any>) {        
        if (this.forceBuilderService.readOnlyForce()) return;

        const force = this.forceBuilderService.force;

        // Create the group first (force.addGroup already updates force.groups())
        const newGroup = force.addGroup('New Group');
        if (!newGroup) return;

        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) {
            // previous container isn't a group (nothing to move)
            return;
        }

        const sourceGroupId = prevId.substring('group-'.length);
        const sourceGroup = force.groups().find(g => g.id === sourceGroupId);
        if (!sourceGroup) return;

        // Move the item from source to the new group
        const sourceUnits = [...sourceGroup.units()];
        const [moved] = sourceUnits.splice(event.previousIndex, 1);
        if (!moved) return;

        const targetUnits = [...newGroup.units(), moved]; // append to end
        sourceGroup.units.set(sourceUnits);
        newGroup.units.set(targetUnits);
        this.forceBuilderService.generateGroupNameIfNeeded(sourceGroup);
        this.forceBuilderService.generateGroupNameIfNeeded(newGroup);
        force.removeEmptyGroups();

        // Commit change
        force.emitChanged();

        // Select the moved unit
        this.forceBuilderService.selectUnit(moved);
    }

    private scrollToUnit(id: string) {
        const scrollContainer = this.scrollableContent()?.nativeElement;
        if (!scrollContainer) return;
        const unitElement = scrollContainer.querySelector(`#unit-${CSS.escape(id)}`) as HTMLElement;
        if (unitElement) {
            unitElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    promptChangeForceName() {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.forceBuilderService.promptChangeForceName();
    }

    promptChangeGroupName(group: UnitGroup) {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.forceBuilderService.promptChangeGroupName(group);
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

    shareForce() {
        this.dialog.open(ShareForceDialogComponent);
    }

    toggleCompactMode() {
        this.compactMode.set(!this.compactMode());
    }

    onEmptyGroupClick(group: UnitGroup) {
        if (this.forceBuilderService.readOnlyForce()) return;
        if (group.units().length === 0) {
            this.forceBuilderService.removeGroup(group);
        }
    }

    showOptionsMenu(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        this.forceBuilderService.selectUnit(unit);
    }

    
    showOptionsDialog(): void {
        this.dialog.open(OptionsDialogComponent);
    }

    showLoadForceDialog(): void {
        const ref = this.dialog.open(ForceLoadDialogComponent);
        ref.componentInstance?.load.subscribe(async (force) => {
            if (force instanceof LoadForceEntry) {
                const requestedForce = await this.dataService.getForce(force.instanceId);
                if (!requestedForce) {
                    this.toastService.show('Failed to load force.', 'error');
                    return;
                }
                this.forceBuilderService.loadForce(requestedForce);
            } else {
                if (force && force.units && force.units.length > 0) {
                    await this.forceBuilderService.createNewForce();
                    const group = this.forceBuilderService.addGroup();
                    for (const unit of force.units) {
                        if (!unit?.unit) continue;
                        this.forceBuilderService.addUnit(unit.unit, undefined, undefined, group);
                    }
                }
            }
            ref.close();
        });
    }

    showForcePackDialog(): void {
        const ref = this.dialog.open(ForcePackDialogComponent);
        ref.componentInstance?.add.subscribe(async (pack) => {
            if (pack) {
                const group = this.forceBuilderService.addGroup();
                for (const unit of pack.units) {
                    if (!unit?.unit) continue;
                    this.forceBuilderService.addUnit(unit.unit, undefined, undefined, group);
                }
            }
            ref.close();
        });
    }

    async requestNewForce(): Promise<void> {
        if (await this.forceBuilderService.createNewForce()) {
            this.layoutService.closeMenu();
        }
    }

    async requestRepairAll(): Promise<void> {
        if (await this.forceBuilderService.repairAllUnits()) {
            this.toastService.show(`Repaired all units.`, 'info');
        }
    }

    async requestCloneForce(): Promise<void> {
        this.forceBuilderService.requestCloneForce();
    }

    printAll(): void {
        PrintUtil.multipagePrint(this.dataService, this.optionsService, this.forceBuilderService.forceUnits());
    }
}