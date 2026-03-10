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
    name: string;
    gunnery: number;
    piloting: number;
    labelGunnery?: string;
    labelPiloting?: string;
    disablePiloting?: boolean;
    /** Pre-skill BV (base + TAG + C3) for BV preview calculation. */
    preSkillBv?: number;
    /** Unit reference for effective piloting skill calculation. */
    unit?: Unit;
}

export interface EditPilotResult {
    name: string;
    gunnery: number;
    piloting: number;
}

@Component({
    selector: 'edit-pilot-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">Warrior Data</h2>
        <div class="wide-dialog-body">
            <div class="form-fields">
                <label class="field-label">Name</label>
                <input #nameInput type="text" class="field-input" autocomplete="off" [value]="data.name || ''" maxlength="32" (keydown.enter)="submit()" />
            </div>
            <div class="form-row no-stack">
                <div class="form-fields">
                    <label class="field-label">{{ data.labelGunnery || 'Gunnery Skill' }}</label>
                    <div #gunneryTrigger>
                        <button class="bt-select skill-selector" (click)="toggleGunneryDropdown()">
                            <span class="skill-selector-value">{{ currentGunnery() }}</span>
                        </button>
                    </div>
                </div>
                <div class="form-fields" [class.disabled]="!!data.disablePiloting">
                    <label class="field-label">{{ data.labelPiloting || 'Piloting Skill' }}</label>
                    <div #pilotingTrigger>
                        <button class="bt-select skill-selector" [disabled]="!!data.disablePiloting" (click)="togglePilotingDropdown()">
                            <span class="skill-selector-value">{{ currentPiloting() }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button (click)="submit()" class="bt-button">CONFIRM</button>
            @if (!data.disablePiloting && hasBvPreview) {
            <button #matrixTrigger class="bt-button square" title="Skill Matrix" (click)="toggleMatrixView()">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="4" height="4" rx="0.5"/>
                    <rect x="6" y="1" width="4" height="4" rx="0.5"/>
                    <rect x="11" y="1" width="4" height="4" rx="0.5"/>
                    <rect x="1" y="6" width="4" height="4" rx="0.5"/>
                    <rect x="6" y="6" width="4" height="4" rx="0.5"/>
                    <rect x="11" y="6" width="4" height="4" rx="0.5"/>
                    <rect x="1" y="11" width="4" height="4" rx="0.5"/>
                    <rect x="6" y="11" width="4" height="4" rx="0.5"/>
                    <rect x="11" y="11" width="4" height="4" rx="0.5"/>
                </svg>
            </button>
            }
            <button (click)="close()" class="bt-button">DISMISS</button>
        </div>
    </div>
    `,
    styles: `
        .skill-selector {
            width: 100%;
            text-align: center;
            font-size: 1em;
            padding: 8px 20px 8px 8px;
        }
        .skill-selector-value {
            font-weight: 700;
        }
    `,
})
export class EditPilotDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    gunneryTrigger = viewChild.required<ElementRef<HTMLDivElement>>('gunneryTrigger');
    pilotingTrigger = viewChild.required<ElementRef<HTMLDivElement>>('pilotingTrigger');

    public dialogRef = inject(DialogRef<EditPilotResult | null, EditPilotDialogComponent>);
    readonly data: EditPilotDialogData = inject(DIALOG_DATA) as EditPilotDialogData;
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    currentGunnery = signal<number>(this.data.gunnery);
    currentPiloting = signal<number>(this.data.piloting);

    readonly hasBvPreview = !!(this.data.preSkillBv != null && this.data.unit);

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
            piloting: this.data.disablePiloting ? this.data.piloting : this.currentPiloting()
        });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}