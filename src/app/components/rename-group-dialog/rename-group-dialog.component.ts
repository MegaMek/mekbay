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


import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { takeUntilDestroyed, outputToObservable } from '@angular/core/rxjs-interop';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Force, UnitGroup } from '../../models/force.model';
import { FormationTypeDefinition, isNoFormation } from '../../utils/formation-type.model';
import { FormationInfoComponent } from '../formation-info/formation-info.component';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { FormationDropdownPanelComponent, FormationDisplayItem } from './formation-dropdown-panel.component';
import { FormationNamerUtil } from '../../utils/formation-namer.util';
/*
 * Author: Drake
 */
export interface RenameGroupDialogData {
    group: UnitGroup;
}

export interface RenameGroupDialogResult {
    /** Custom group name (empty string = unset / auto-generate). */
    name: string;
    /** Selected formation definition, or null to clear. */
    formation: FormationTypeDefinition | null;
}

@Component({
    selector: 'rename-group-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormationInfoComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
      <div class="wide-dialog-body">

        <div class="form-fields">
          <label class="field-label">Group Name <span class="optional">(optional)</span></label>
          <div class="input-wrapper">
            <div
              class="field-input"
              contentEditable="true"
              #inputRef
              autocomplete="off"
              [textContent]="data.group.name()"
              (keydown.enter)="submit()"
            ></div>
          </div>
          <p class="hint">If left empty, the formation name will be used</p>
        </div>

        <div class="form-fields">
          <label class="field-label">Formation</label>
          <div #formationTriggerWrapper class="input-wrapper">
            <button class="formation-selector bt-select" (click)="toggleFormationDropdown()">
              @if (selectedFormation(); as formation) {
                @if (isNoFormation(formation)) {
                  <span class="placeholder">No Formation</span>
                } @else {
                  <span class="formation-selector-name">{{ getDisplayName(formation) }}</span>
                }
              } @else {
                <span class="placeholder">Automatic</span>
              }
            </button>
            <button
              type="button"
              class="random-button"
              (click)="fillRandomFormation()"
              aria-label="Pick random formation"
            ></button>
          </div>
        </div>

        @if (selectedFormation(); as formation) {
          @if (!isNoFormation(formation)) {
          <details class="selected-formation-accordion">
            <summary class="selected-formation-summary">
              <span>Formation details</span>
              <svg class="expand-icon" width="16" height="16" viewBox="0 0 10 10" fill="currentColor"><path d="M3 1l5 4-5 4z"/></svg>
            </summary>
            <div class="selected-formation-details">
              <formation-info [formation]="formation" [gameSystem]="data.group.force.gameSystem" [unitCount]="data.group.units().length"></formation-info>
            </div>
          </details>
          }
        }
      </div>
      <div class="wide-dialog-actions">
        <button (click)="submit()" class="bt-button">CONFIRM</button>
        <button (click)="close()" class="bt-button">DISMISS</button>
      </div>
    </div>
    `,
    styles: [`
        .hint {
            font-size: 0.85em;
            color: var(--text-color-tertiary);
            margin-top: 2px;
            margin-bottom: 0;
        }

        .formation-selector {
            flex: 1 1 auto;
            min-width: 0;
            padding: 10px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            text-align: left;
            font-size: 1em;
        }

        .formation-selector:hover {
            border-color: #666;
        }

        .formation-selector-name {
            font-weight: 600;
        }

        .placeholder {
            color: #888;
        }

        .random-button {
            flex-shrink: 0;
            height: 32px;
            width: 32px;
            border: none;
            background: transparent url('/images/random.svg') center/24px 24px no-repeat;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s ease-in-out;
        }

        .random-button:hover,
        .random-button:focus {
            opacity: 1;
        }

        /* Selected formation accordion */
        .selected-formation-accordion {
            width: 100%;
            text-align: left;
            background: rgba(255, 255, 255, 0.04);
            margin-top: 4px;
        }

        .selected-formation-summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 0.85em;
            color: var(--text-color-secondary);
            list-style: none;
        }

        .selected-formation-summary::-webkit-details-marker {
            display: none;
        }

        .selected-formation-summary:hover {
            color: var(--text-color);
        }

        .expand-icon {
            transition: transform 0.2s;
        }

        .selected-formation-accordion[open] .expand-icon {
            transform: rotate(90deg);
        }

        .selected-formation-details {
            padding: 8px 12px 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            max-height: 40vh;
            overflow-y: auto;
        }
    `]
})

export class RenameGroupDialogComponent {
    inputRef = viewChild.required<ElementRef<HTMLDivElement>>('inputRef');
    formationTriggerWrapper = viewChild.required<ElementRef<HTMLDivElement>>('formationTriggerWrapper');

    public dialogRef: DialogRef<RenameGroupDialogResult | null, RenameGroupDialogComponent> = inject(DialogRef);
    readonly data: RenameGroupDialogData = inject(DIALOG_DATA);
    private forceBuilder = inject(ForceBuilderService);
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    /** Currently selected formation */
    selectedFormation = signal<FormationTypeDefinition | null>(this.data.group.formation());

    /** Pre-computed formation display list for the dropdown panel */
    formationDisplayList: FormationDisplayItem[] = FormationNamerUtil.getAvailableFormationDefinitions(this.data.group).map(def => ({
            definition: def,
            displayName: FormationNamerUtil.composeFormationDisplayName(def, this.data.group)
        }));
    constructor() {}

    /** Expose isNoFormation to the template */
    isNoFormation = isNoFormation;

    /** Compose a display name for a formation definition */
    getDisplayName(definition: FormationTypeDefinition): string {
        return FormationNamerUtil.composeFormationDisplayName(definition, this.data.group);
    }

    submit(): void {
        const name = this.inputRef().nativeElement.textContent?.trim() || '';
        this.dialogRef.close({ name, formation: this.selectedFormation() });
    }

    fillRandomFormation(): void {
        const list = this.formationDisplayList;
        if (list.length === 0) return;
        const currentId = this.selectedFormation()?.id ?? null;
        const candidates = list.length > 1
            ? list.filter(item => item.definition.id !== currentId)
            : list;
        const randomIndex = Math.floor(Math.random() * candidates.length);
        this.selectedFormation.set(candidates[randomIndex].definition);
    }

    toggleFormationDropdown(): void {
        this.overlayManager.closeManagedOverlay('formation-dropdown');

        const triggerWrapper = this.formationTriggerWrapper();
        if (!triggerWrapper) return;

        const portal = new ComponentPortal(FormationDropdownPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            'formation-dropdown',
            triggerWrapper,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'formation-dropdown-overlay',
                matchTriggerWidth: true,
                anchorActiveSelector: '.none-option.active, .formation-option-wrapper.active'
            }
        );

        componentRef.setInput('formations', this.formationDisplayList);
        componentRef.setInput('selectedFormationId', this.selectedFormation()?.id ?? null);
        componentRef.setInput('gameSystem', this.data.group.force.gameSystem);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((formation: FormationTypeDefinition | null) => {
                this.selectedFormation.set(formation);
                this.overlayManager.closeManagedOverlay('formation-dropdown');
            });
    }

    close(value: RenameGroupDialogResult | null = null): void {
        this.dialogRef.close(value);
    }
}