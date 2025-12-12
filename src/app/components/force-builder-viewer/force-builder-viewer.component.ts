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

import { Component, computed, Injector, ElementRef, effect, inject, ChangeDetectionStrategy, viewChild, viewChildren, input, signal, afterNextRender, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { Force, UnitGroup } from '../../models/force.model';
import { ForceUnit } from '../../models/force-unit.model';
import { DragDropModule, CdkDragDrop, moveItemInArray, CdkDragMove } from '@angular/cdk/drag-drop'
import { DialogsService } from '../../services/dialogs.service';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { ShareForceDialogComponent, ShareForceDialogData } from '../share-force-dialog/share-force-dialog.component';
import { UnitBlockComponent } from '../unit-block/unit-block.component';
import { CompactModeService } from '../../services/compact-mode.service';
import { ToastService } from '../../services/toast.service';
import { C3NetworkDialogComponent, C3NetworkDialogData, C3NetworkDialogResult } from '../c3-network-dialog/c3-network-dialog.component';

/*
 * Author: Drake
 */
@Component({
    selector: 'force-builder-viewer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, DragDropModule, UnitBlockComponent],
    templateUrl: './force-builder-viewer.component.html',
    styleUrls: ['./force-builder-viewer.component.scss']
})
export class ForceBuilderViewerComponent {
    protected forceBuilderService = inject(ForceBuilderService);
    protected toastService = inject(ToastService);
    protected layoutService = inject(LayoutService);
    compactModeService = inject(CompactModeService);
    private dialogsService = inject(DialogsService);
    private injector = inject(Injector);
    private scrollableContent = viewChild<ElementRef<HTMLDivElement>>('scrollableContent');
    private newGroupDropzone = viewChild<ElementRef<HTMLElement>>('newGroupDropzone');
    forceUnitItems = viewChildren<ElementRef<HTMLElement>>('forceUnitItem');

    miniMode = input<boolean>(false);

    compactMode = computed(() => {
        return this.compactModeService.compactMode();
    });

    hasEmptyGroups = computed(() => {
        return this.forceBuilderService.currentForce()?.groups().some(g => g.units().length === 0);
    });

    // --- Gesture State ---
    public readonly isUnitDragging = signal<boolean>(false); // Flag for unit drag/sorting

    //Units autoscroll
    private autoScrollVelocity = signal<number>(0);     // px/sec (+ down, - up)
    private autoScrollRafId?: number;
    private lastAutoScrollTs?: number;
    private readonly AUTOSCROLL_EDGE = 64;   // px threshold from edge to start scrolling
    private readonly AUTOSCROLL_MAX = 600;   // px/sec max scroll speed
    private readonly AUTOSCROLL_MIN = 40;

    hasSingleGroup = computed(() => {
        return this.forceBuilderService.currentForce()?.groups().length === 1;
    });

    constructor() {
        effect(() => {
            const selected = this.forceBuilderService.selectedUnit();
            if (selected) {
                afterNextRender(() => {
                    this.scrollToUnit(selected.id);
                }, { injector: this.injector });
            }
        });
        inject(DestroyRef).onDestroy(() => {
            this.stopAutoScrollLoop();
        });
    }

    onUnitKeydown(event: KeyboardEvent, index: number) {
        const units = this.forceBuilderService.currentForce()?.units();
        if (!units || units.length === 0) return;
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

    forceName =  computed(() => this.forceBuilderService.currentForce()?.name);

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
        if (this.forceBuilderService.forceUnits()?.length === 0) {
            this.layoutService.closeMenu();
        }
    }

    async repairUnit(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to repair the unit "${unit.getUnit()?.chassis} ${unit.getUnit()?.model}"? This will reset all damage and status effects.`,
            `Repair ${unit.getUnit()?.chassis}`,
            'info');
        if (confirmed) {
            unit.repairAll();
            this.toastService.show(`Repaired unit ${unit.getUnit()?.chassis} ${unit.getUnit()?.model}.`, 'success');
            return true;
        };
        return false;
    }

    showUnitInfo(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const unitList = this.forceBuilderService.currentForce()?.units();
        if (!unitList) return;
        const unitIndex = unitList.findIndex(u => u.id === unit.id);
        const ref = this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: unitList,
                unitIndex: unitIndex
            }
        });

    }

    openC3Network(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const force = this.forceBuilderService.currentForce();
        const allUnits = force?.units();
        if (!allUnits || !force) return;

        const ref = this.dialogsService.createDialog<C3NetworkDialogResult>(C3NetworkDialogComponent, {
            data: <C3NetworkDialogData>{
                units: allUnits,
                networks: force.c3Networks(),
                readOnly: unit.readOnly()
            },
            width: '100dvw',
            height: '100dvh',
            maxWidth: '100dvw',
            maxHeight: '100dvh',
            panelClass: 'c3-network-dialog-panel'
        });

        ref.closed.subscribe((result) => {
            if (result?.updated) {
                // Save networks back to force
                force.setNetwork(result.networks);
                this.toastService.show('C3 network configuration saved', 'success');
            }
        });
    }



    async editPilot(event: MouseEvent, unit: ForceUnit) {
        if (unit.readOnly()) return;
        event.stopPropagation();
        const crew = unit.getCrewMembers();
        const pilot = crew.length > 0 ? crew[0] : undefined;
        await this.forceBuilderService.editPilotOfUnit(unit, pilot);
    }


    toggleMenu() {
        this.layoutService.toggleMenu();
    }

    onUnitDragStart() {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.isUnitDragging.set(true);
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

        const force = this.forceBuilderService.currentForce();
        if (!force) return;
        const groups = force.groups();

        const groupIdFromContainer = (id?: string) => id && id.startsWith('group-') ? id.substring('group-'.length) : null;

        const fromGroupId = groupIdFromContainer(event.previousContainer?.id);
        const toGroupId = groupIdFromContainer(event.container?.id);

        if (!fromGroupId || !toGroupId) return;

        const fromGroup = groups.find(g => g.id === fromGroupId);
        const toGroup = groups.find(g => g.id === toGroupId);
        if (!fromGroup || !toGroup) return;
        
        // No-op if same group and same index
        if (fromGroup === toGroup && event.previousIndex === event.currentIndex) {
            return;
        }
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
        const groups = this.forceBuilderService.currentForce()?.groups() || [];
        const ids = groups.map(g => `group-${g.id}`);
        if (this.newGroupDropzone()?.nativeElement) {
            ids.push('new-group-dropzone');
        }
        return ids;
    }

    dropForNewGroup(event: CdkDragDrop<any, any, any>) {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce || !currentForce.owned()) return;

        // Create the group first (force.addGroup already updates force.groups())
        const newGroup = currentForce.addGroup('New Group');
        if (!newGroup) return;

        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) {
            // previous container isn't a group (nothing to move)
            return;
        }

        const sourceGroupId = prevId.substring('group-'.length);
        const sourceGroup = currentForce.groups().find(g => g.id === sourceGroupId);
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
        currentForce.removeEmptyGroups();

        // Commit change
        currentForce.emitChanged();

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

    shareForce() {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce) return;
        this.dialogsService.createDialog(ShareForceDialogComponent, {
            data: { force: currentForce }
        });
    }

    onEmptyGroupClick(group: UnitGroup) {
        if (this.forceBuilderService.readOnlyForce()) return;
        if (group.units().length === 0) {
            this.forceBuilderService.removeGroup(group);
        }
    }

}