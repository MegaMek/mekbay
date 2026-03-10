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
import { takeUntilDestroyed, outputToObservable } from '@angular/core/rxjs-interop';
import { ForceBuilderService } from '../../services/force-builder.service';
import type { Force, UnitGroup } from '../../models/force.model';
import { type FormationTypeDefinition, isNoFormation } from '../../utils/formation-type.model';
import { FormationInfoComponent } from '../formation-info/formation-info.component';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { FormationDropdownPanelComponent, type FormationDisplayItem } from './formation-dropdown-panel.component';
import { FormationNamerUtil } from '../../utils/formation-namer.util';
import { FORMATION_DEFINITIONS } from '../../utils/formation-definitions';
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
    action: 'confirm' | 'unset';
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
          <div class="input-wrapper name-input-wrapper">
            <div
              class="field-input"
              contentEditable="true"
              #inputRef
              autocomplete="off"
              [attr.data-placeholder]="placeholderName()"
              [textContent]="data.group.name()"
              (keydown.enter)="submit()"
              (input)="onInputCleanup($event)"
            ></div>
            @if (nameHasText()) {
            <button
              type="button"
              class="clear-btn"
              (click)="clearName()"
              title="Clear"
              aria-label="Clear"
              tabindex="-1"
            >&#10005;</button>
            }
          </div>
          <p class="hint">If left empty, the formation name will be used</p>
        </div>

        <div class="form-fields">
          <label class="field-label">Formation</label>
          <div #formationTriggerWrapper class="input-wrapper">
            <button class="formation-selector bt-select" [class.danger]="!isSelectedFormationValid()" (click)="toggleFormationDropdown()">
              @if (selectedFormation(); as formation) {
                @if (isNoFormation(formation)) {
                  <span class="placeholder">No Formation</span>
                } @else {
                  @if (!isSelectedFormationValid()) {
                    <svg class="formation-selector-warning" fill="currentColor" width="14px" height="14px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                      <path d="M15.83 13.23l-7-11.76a1 1 0 0 0-1.66 0L.16 13.3c-.38.64-.07 1.7.68 1.7H15.2C15.94 15 16.21 13.87 15.83 13.23Zm-7 .37H7.14V11.89h1.7Zm0-3.57H7.16L7 4H9Z"/>
                    </svg>
                  }
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
          @if (selectedFormation(); as formation) {
            @if (!isNoFormation(formation)) {
            @if (!isSelectedFormationValid()) {
            <div class="formation-warning">
              @if (getRequirementsText(formation); as reqText) {
                <div class="formation-warning-body">
                  <strong>Missing requirements:</strong>
                  @if (getParentRequirementsText(formation); as parentReqText) {
                    <span class="formation-warning-req"><strong>{{ getParentFormationName(formation) }}:</strong> {{ parentReqText }}</span>
                    <span class="formation-warning-req"><strong>{{ formation.name }}:</strong> {{ reqText }}</span>
                  } @else {
                    <span class="formation-warning-req">{{ reqText }}</span>
                  }
                </div>
              } @else {
              <span>Formation does not match the current group composition</span>
              }
            </div>
            }
            <details class="selected-formation-accordion">
              <summary class="selected-formation-summary">
                <span>Formation details</span>
                <svg class="expand-icon" width="16" height="16" viewBox="0 0 10 10" fill="currentColor"><path d="M3 1l5 4-5 4z"/></svg>
              </summary>
              <div class="selected-formation-details">
                <formation-info [formation]="formation" [gameSystem]="data.group.force.gameSystem" [unitCount]="data.group.units().length" [isValid]="isSelectedFormationValid()" [novaFiltered]="isSelectedFormationNovaFiltered()"></formation-info>
              </div>
            </details>
            }
          }
        </div>

      </div>
      @if (!data.group.formationLock) {
        <p class="formation-hint">The formation will change dynamically based on group composition. Confirm to lock it in.</p>
      }
      <div class="wide-dialog-actions">
        <button (click)="submit()" class="bt-button">CONFIRM</button>
        <button (click)="submitUnset()" class="bt-button">UNSET</button>
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
            gap: 8px;
        }

        .formation-selector:hover {
            border-color: #666;
        }

        .formation-selector-name {
            font-weight: 600;
        }

        .formation-selector-warning {
            color: red;
            flex-shrink: 0;
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

        .formation-warning {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            margin-top: 4px;
            font-size: 0.85em;
            color: red;
            background: rgba(255, 0, 0, 0.08);
            border-left: 3px solid red;
        }

        .formation-warning-body {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .formation-warning-req {
            display: block;
        }

        .formation-hint {
            font-size: 0.85em;
            color: var(--text-color-tertiary);
            margin: 4px 0 0;
            text-align: center;
        }

        .name-input-wrapper {
            position: relative;
        }

        .name-input-wrapper .field-input {
            padding-right: 32px;
        }

        .clear-btn {
            position: absolute;
            right: 4px;
            top: 0;
            bottom: 0;
            margin: auto 0;
            background: transparent;
            border: none;
            color: #999;
            font-size: 1em;
            font-weight: 700;
            cursor: pointer;
            padding: 0 6px;
            height: 32px;
            width: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
            line-height: 1;
            z-index: 1;
        }

        .clear-btn:hover {
            color: #ff4444;
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

    /** Tracks whether the name input has text */
    nameHasText = signal<boolean>(!!this.data.group.name());

    /** Currently selected formation */
    selectedFormation = signal<FormationTypeDefinition | null>(this.data.group.formation());

    /** All formation definitions with validity flag. */
    formationDisplayList: FormationDisplayItem[] = (() => {
        const validMatches = FormationNamerUtil.getAvailableFormationDefinitions(this.data.group);
        const validMap = new Map(validMatches.map(m => [m.definition.id, m]));
        return FORMATION_DEFINITIONS
            .filter(def => def.validator)
            .map(def => {
                const match = validMap.get(def.id);
                return {
                    definition: def,
                    displayName: FormationNamerUtil.composeFormationDisplayName(def, this.data.group, match?.novaFiltered ?? false),
                    isValid: !!match,
                    novaFiltered: match?.novaFiltered ?? false,
                };
            });
    })();

    /** Whether the currently selected formation is valid for the group. */
    isSelectedFormationValid = computed<boolean>(() => {
        const sel = this.selectedFormation();
        if (!sel || isNoFormation(sel)) return true;
        return this.formationDisplayList.some(f => f.definition.id === sel.id && f.isValid);
    });

    /** Whether the currently selected formation was matched via the Nova rule. */
    isSelectedFormationNovaFiltered = computed<boolean>(() => {
        const sel = this.selectedFormation();
        if (!sel || isNoFormation(sel)) return false;
        return this.formationDisplayList.some(f => f.definition.id === sel.id && f.isValid && f.novaFiltered);
    });

    /** Placeholder name based on the currently selected formation. */
    placeholderName = computed<string>(() => {
        const sel = this.selectedFormation();
        if (sel && !isNoFormation(sel)) {
            return FormationNamerUtil.composeFormationDisplayName(sel, this.data.group);
        }
        return this.data.group.sizeName() ?? 'Group';
    });

    constructor() { }

    /** Clear the name input */
    clearName(): void {
        const nativeEl = this.inputRef().nativeElement;
        if (!nativeEl) return;
        nativeEl.textContent = '';
        nativeEl.innerHTML = '';
        this.nameHasText.set(false);
        nativeEl.focus();
    }

    /** Clear leftover <br> / whitespace so :empty placeholder works */
    onInputCleanup(event: Event): void {
        const el = event.target as HTMLElement;
        const hasText = !!el.textContent?.trim();
        this.nameHasText.set(hasText);
        if (!hasText) {
            el.innerHTML = '';
        }
    }

    /** Expose isNoFormation to the template */
    isNoFormation = isNoFormation;

    /** Get requirements text for a formation definition, including parent requirements */
    getRequirementsText(formation: FormationTypeDefinition): string | null {
        if (!formation.requirements) return null;
        return formation.requirements(this.data.group.force.gameSystem) || null;
    }

    /** Get parent formation requirements text */
    getParentRequirementsText(formation: FormationTypeDefinition): string | null {
        if (!formation.parent) return null;
        const parent = FORMATION_DEFINITIONS.find(d => d.id === formation.parent);
        if (!parent?.requirements) return null;
        return parent.requirements(this.data.group.force.gameSystem) || null;
    }

    /** Get parent formation name */
    getParentFormationName(formation: FormationTypeDefinition): string {
        if (!formation.parent) return '';
        return FORMATION_DEFINITIONS.find(d => d.id === formation.parent)?.name ?? '';
    }

    /** Compose a display name for a formation definition */
    getDisplayName(definition: FormationTypeDefinition): string {
        return FormationNamerUtil.composeFormationDisplayName(definition, this.data.group, this.isSelectedFormationNovaFiltered());
    }

    submit(): void {
        const name = this.inputRef().nativeElement.textContent?.trim() || '';
        this.dialogRef.close({ name, formation: this.selectedFormation(), action: 'confirm' });
    }

    submitUnset(): void {
        this.dialogRef.close({ name: '', formation: null, action: 'unset' });
    }

    fillRandomFormation(): void {
        const validList = this.formationDisplayList.filter(item => item.isValid);
        if (validList.length === 0) {
            this.selectedFormation.set(null);
            return;
        }
        const currentId = this.selectedFormation()?.id ?? null;
        const candidates = validList.length > 1
            ? validList.filter(item => item.definition.id !== currentId)
            : validList;
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