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


import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { UnitGroup } from '../../models/force.model';
import { DialogsService } from '../../services/dialogs.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { SkillDropdownPanelComponent, type SkillPreviewEntry } from '../skill-dropdown-panel/skill-dropdown-panel.component';
import { SkillMatrixPanelComponent, type SkillMatrixCell } from '../skill-dropdown-panel/skill-matrix-panel.component';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import type { Unit } from '../../models/units.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../../models/crew-member.model';

/*
 * Author: Drake
 */

export interface EditPilotDialogData {
    unitId?: string;
    name: string;
    gunnery: number;
    piloting: number;
    labelGunnery?: string;
    labelPiloting?: string;
    disablePiloting?: boolean;
    commander?: boolean;
    group?: UnitGroup<CBTForceUnit> | null;
    /** Pre-skill BV (base + TAG + C3) for BV preview calculation. */
    preSkillBv?: number;
    /** Unit reference for effective piloting skill calculation. */
    unit?: Unit;
}

export interface EditPilotResult {
    name: string;
    gunnery: number;
    piloting: number;
    commander: boolean;
}

@Component({
    selector: 'edit-pilot-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './edit-pilot-dialog.component.html',
    styleUrls: ['./edit-pilot-dialog.component.scss']
})
export class EditPilotDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    gunneryTrigger = viewChild.required<ElementRef<HTMLDivElement>>('gunneryTrigger');
    pilotingTrigger = viewChild.required<ElementRef<HTMLDivElement>>('pilotingTrigger');

    public dialogRef = inject(DialogRef<EditPilotResult | null, EditPilotDialogComponent>);
    readonly data: EditPilotDialogData = inject(DIALOG_DATA) as EditPilotDialogData;
    private overlayManager = inject(OverlayManagerService);
    private dialogsService = inject(DialogsService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    currentGunnery = signal<number>(this.data.gunnery);
    currentPiloting = signal<number>(this.data.piloting);
    selectedGroupCommander = signal<boolean>(this.data.commander ?? false);

    readonly hasBvPreview = !!(this.data.preSkillBv != null && this.data.unit);
    readonly persistedOtherCommander = computed<CBTForceUnit | null>(() => {
        const group = this.data.group;
        const unitId = this.data.unitId;
        if (!group || !unitId) {
            return null;
        }

        return group.units().find((unit) => unit.id !== unitId && unit.commander()) ?? null;
    });

    /** 9x9 BV matrix: matrix[gunnery][piloting] = adjusted BV */
    bvMatrix = computed<number[][]>(() => {
        if (!this.hasBvPreview) return [];
        return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(g =>
            [0, 1, 2, 3, 4, 5, 6, 7, 8].map(p => this.calculateBv(g, p))
        );
    });

    gunneryEntries = computed<SkillPreviewEntry[]>(() => {
        const piloting = this.currentPiloting();
        return this.buildEntries(
            (skill) => this.calculateBv(skill, piloting),
            DEFAULT_GUNNERY_SKILL
        );
    });

    pilotingEntries = computed<SkillPreviewEntry[]>(() => {
        const gunnery = this.currentGunnery();
        return this.buildEntries(
            (skill) => this.calculateBv(gunnery, skill),
            DEFAULT_PILOTING_SKILL
        );
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.overlayManager.closeManagedOverlay('skill-gunnery-dropdown');
            this.overlayManager.closeManagedOverlay('skill-piloting-dropdown');
            this.overlayManager.closeManagedOverlay('skill-matrix');
        });
    }

    toggleGunneryDropdown(): void {
        this.openSkillDropdown(
            'skill-gunnery-dropdown',
            this.gunneryTrigger(),
            this.currentGunnery(),
            this.gunneryEntries(),
            (skill) => this.currentGunnery.set(skill),
            this.data.labelGunnery || 'Gunnery Skill'
        );
    }

    togglePilotingDropdown(): void {
        if (this.data.disablePiloting) return;
        this.openSkillDropdown(
            'skill-piloting-dropdown',
            this.pilotingTrigger(),
            this.currentPiloting(),
            this.pilotingEntries(),
            (skill) => this.currentPiloting.set(skill),
            this.data.labelPiloting || 'Piloting Skill'
        );
    }

    toggleMatrixView(): void {
        this.overlayManager.closeManagedOverlay('skill-matrix');

        const portal = new ComponentPortal(SkillMatrixPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            'skill-matrix',
            null,
            portal,
            {
                closeOnOutsideClick: true
            }
        );

        componentRef.setInput('matrix', this.bvMatrix());
        componentRef.setInput('selectedGunnery', this.currentGunnery());
        componentRef.setInput('selectedPiloting', this.currentPiloting());

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((cell: SkillMatrixCell) => {
                this.currentGunnery.set(cell.gunnery);
                this.currentPiloting.set(cell.piloting);
                this.overlayManager.closeManagedOverlay('skill-matrix');
            });
    }

    private formatCommanderDisplayName(unit: CBTForceUnit): string {
        const pilotName = unit.alias()?.trim();
        const unitName = unit.getDisplayName();
        if (pilotName) {
            return `${unitName} (pilot: ${pilotName})`;
        }
        return unitName;
    }

    async setGroupCommanderSelected(value: boolean): Promise<void> {
        if (value && !this.selectedGroupCommander()) {
            const otherCommander = this.persistedOtherCommander();
            if (otherCommander) {
                const otherCommanderName = this.formatCommanderDisplayName(otherCommander);
                const confirmed = await this.dialogsService.requestConfirmation(
                    `${otherCommanderName} is currently marked as the group commander. Making this unit the commander will remove that flag from ${otherCommanderName}. Continue?`,
                    'Replace Group Commander',
                    'info',
                );
                if (!confirmed) {
                    this.selectedGroupCommander.set(false);
                    return;
                }
            }
        }

        this.selectedGroupCommander.set(value);
    }

    private openSkillDropdown(
        key: string,
        trigger: ElementRef<HTMLElement>,
        currentSkill: number,
        entries: SkillPreviewEntry[],
        onSelect: (skill: number) => void,
        title?: string
    ): void {
        this.overlayManager.closeManagedOverlay(key);

        const portal = new ComponentPortal(SkillDropdownPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            key,
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                matchTriggerWidth: true,
                anchorActiveSelector: '.skill-option.active'
            }
        );

        componentRef.setInput('entries', entries);
        componentRef.setInput('selectedSkill', currentSkill);
        componentRef.setInput('valueLabel', 'BV');
        if (title) componentRef.setInput('title', title);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((skill: number) => {
                onSelect(skill);
                this.overlayManager.closeManagedOverlay(key);
            });
    }

    private calculateBv(gunnery: number, piloting: number): number {
        if (!this.hasBvPreview) return 0;
        return BVCalculatorUtil.calculateAdjustedBV(
            this.data.unit!,
            this.data.preSkillBv!,
            gunnery,
            piloting
        );
    }

    private buildEntries(calculate: (skill: number) => number, defaultSkill: number): SkillPreviewEntry[] {
        if (!this.hasBvPreview) {
            return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(skill => ({ skill, adjustedValue: 0, delta: 0 }));
        }
        const baseValue = calculate(defaultSkill);
        return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(skill => {
            const adjustedValue = calculate(skill);
            return { skill, adjustedValue, delta: adjustedValue - baseValue };
        });
    }

    submit() {
        const name = this.nameInput().nativeElement.value.trim();
        this.dialogRef.close({
            name,
            gunnery: this.currentGunnery(),
            piloting: this.data.disablePiloting ? this.data.piloting : this.currentPiloting(),
            commander: this.data.group ? this.selectedGroupCommander() : false,
        });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}