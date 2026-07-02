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

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { type FormationTypeDefinition, NO_FORMATION, NO_FORMATION_ID } from '../../utils/formation-type.model';
import { FormationInfoComponent } from '../formation-info/formation-info.component';
import { GameSystem } from '../../models/common.model';

/*
 * Author: Drake
 */
export interface FormationDisplayItem {
    definition: FormationTypeDefinition;
    displayName: string;
    isValid: boolean;
    /** Whether this formation required organization-level requirement filtering. */
    requirementsFiltered: boolean;
    /** Optional org composition name that caused requirement filtering. */
    requirementsFilterCompositionName?: string;
    /** Optional notice describing which structural units were ignored. */
    requirementsFilterNotice?: string;
}

export const AUTOMATIC_FORMATION_KEY = '__automatic__';

export type FormationDropdownActiveTarget = 'entry' | 'details';

export interface FormationDropdownActiveOption {
    selectionKey: string;
    target: FormationDropdownActiveTarget;
}

export interface FormationDropdownPointerHoverEvent {
    selectionKey: string;
    target: FormationDropdownActiveTarget;
    clientX: number;
    clientY: number;
}

@Component({
    selector: 'formation-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormationInfoComponent],
    template: `
        <div
            class="dropdown-shell glass has-shadow framed-borders"
            [id]="optionsId()"
            role="listbox"
            [attr.aria-label]="label()"
            [attr.aria-activedescendant]="activeOptionId()"
        >
            <div class="header">
                <input
                    class="bt-input"
                    type="text"
                    placeholder="Search formations..."
                    [value]="searchText()"
                    (input)="onSearch($any($event.target).value)" />
            </div>
            <div class="dropdown-panel" data-scroll-container>
                <!-- Automatic option (null = system picks best formation) -->
                <div class="dropdown-option none-option"
                     role="option"
                     [id]="optionId(0)"
                     [class.active]="!selectedFormationId()"
                     [class.keyboard-active]="isActiveTarget(automaticFormationKey, 'entry')"
                     [attr.aria-selected]="!selectedFormationId()"
                     (click)="onSelectAutomatic()"
                     (pointerenter)="onOptionPointerHover(automaticFormationKey, 'entry', $event)"
                     (pointermove)="onOptionPointerHover(automaticFormationKey, 'entry', $event)">
                    <span class="formation-name">Automatic</span>
                    <span class="formation-summary-text">System picks the best matching formation</span>
                </div>
                <!-- No Formation option (explicit opt-out) -->
                <div class="dropdown-option none-option"
                     role="option"
                     [id]="optionId(1)"
                     [class.active]="selectedFormationId() === noFormationId"
                     [class.keyboard-active]="isActiveTarget(noFormationId, 'entry')"
                     [attr.aria-selected]="selectedFormationId() === noFormationId"
                     (click)="onSelectNoFormation()"
                     (pointerenter)="onOptionPointerHover(noFormationId, 'entry', $event)"
                     (pointermove)="onOptionPointerHover(noFormationId, 'entry', $event)">
                    <span class="formation-name">No Formation</span>
                    <span class="formation-summary-text">Explicitly opt out of any formation</span>
                </div>
                <hr class="divider"/>

                @if (validFormations().length > 0) {
                    <div class="section-label">Valid Formations</div>
                    @for (item of validFormations(); let optionIndex = $index; track item.definition.id) {
                        <div class="formation-option-wrapper"
                             role="option"
                             [id]="optionId(validOptionIndex(optionIndex))"
                             [class.active]="selectedFormationId() === item.definition.id"
                             [class.keyboard-active]="isActiveTarget(item.definition.id, 'entry')"
                             [attr.aria-selected]="selectedFormationId() === item.definition.id"
                             (pointerenter)="onOptionPointerHover(item.definition.id, 'entry', $event)"
                             (pointermove)="onOptionPointerHover(item.definition.id, 'entry', $event)">
                            <div class="formation-option" (click)="onSelect(item.definition)">
                                <span class="formation-option-name">{{ item.displayName }}</span>
                                <button class="expand-btn"
                                        type="button"
                                        [id]="optionTargetId(validOptionIndex(optionIndex), 'details')"
                                        (click)="toggleExpand($event, item.definition.id)"
                                        (pointerenter)="onOptionPointerHover(item.definition.id, 'details', $event)"
                                        (pointermove)="onOptionPointerHover(item.definition.id, 'details', $event)"
                                        [class.active]="isActiveTarget(item.definition.id, 'details')"
                                        [class.expanded]="expandedId() === item.definition.id"
                                        title="Show details">
                                    <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                                        <path d="M3 1l5 4-5 4z"/>
                                    </svg>
                                </button>
                            </div>
                            @if (expandedId() === item.definition.id) {
                                <div class="formation-option-details">
                                    <formation-info [formation]="item.definition" [gameSystem]="gameSystem()" [showTitle]="false" [isValid]="true" [requirementsFiltered]="item.requirementsFiltered" [requirementsFilterCompositionName]="item.requirementsFilterCompositionName" [requirementsFilterNotice]="item.requirementsFilterNotice"></formation-info>
                                </div>
                            }
                        </div>
                    }
                }

                @if (validFormations().length > 0 && otherFormations().length > 0) {
                    <hr class="divider"/>
                }

                @if (otherFormations().length > 0) {
                    <div class="section-label">Invalid Formations</div>
                    @for (item of otherFormations(); let optionIndex = $index; track item.definition.id) {
                        <div class="formation-option-wrapper not-matching"
                             role="option"
                             [id]="optionId(otherOptionIndex(optionIndex))"
                             [class.active]="selectedFormationId() === item.definition.id"
                             [class.keyboard-active]="isActiveTarget(item.definition.id, 'entry')"
                             [attr.aria-selected]="selectedFormationId() === item.definition.id"
                             (pointerenter)="onOptionPointerHover(item.definition.id, 'entry', $event)"
                             (pointermove)="onOptionPointerHover(item.definition.id, 'entry', $event)">
                            <div class="formation-option" (click)="onSelect(item.definition)">
                                <svg class="invalid-marker" fill="currentColor" width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M15.83 13.23l-7-11.76a1 1 0 0 0-1.66 0L.16 13.3c-.38.64-.07 1.7.68 1.7H15.2C15.94 15 16.21 13.87 15.83 13.23Zm-7 .37H7.14V11.89h1.7Zm0-3.57H7.16L7 4H9Z"/></svg>
                                <span class="formation-option-name">{{ item.displayName }}</span>
                                <button class="expand-btn"
                                        type="button"
                                        [id]="optionTargetId(otherOptionIndex(optionIndex), 'details')"
                                        (click)="toggleExpand($event, item.definition.id)"
                                        (pointerenter)="onOptionPointerHover(item.definition.id, 'details', $event)"
                                        (pointermove)="onOptionPointerHover(item.definition.id, 'details', $event)"
                                        [class.active]="isActiveTarget(item.definition.id, 'details')"
                                        [class.expanded]="expandedId() === item.definition.id"
                                        title="Show details">
                                    <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                                        <path d="M3 1l5 4-5 4z"/>
                                    </svg>
                                </button>
                            </div>
                            @if (expandedId() === item.definition.id) {
                                <div class="formation-option-details">
                                    <formation-info [formation]="item.definition" [gameSystem]="gameSystem()" [showTitle]="false" [isValid]="false" [requirementsFiltered]="item.requirementsFiltered" [requirementsFilterCompositionName]="item.requirementsFilterCompositionName" [requirementsFilterNotice]="item.requirementsFilterNotice"></formation-info>
                                </div>
                            }
                        </div>
                    }
                }
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            min-height: 0;
        }

        .dropdown-shell {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
        }

        .header {
            flex: 0 0 auto;
            padding: 4px 6px;
            border-bottom: 1px solid var(--border-color);

            .bt-input {
                width: 100%;
            }
        }

        .dropdown-panel {
            box-sizing: border-box;
            overflow-y: auto;
            flex: 1 1 auto;
            min-height: 0;
        }

        .dropdown-option {
            border-left: 3px solid transparent;
        }

        .dropdown-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left-color: var(--bt-yellow);
        }

        .dropdown-option.active:hover {
            background: var(--bt-yellow-background-bright-transparent);
        }

        .dropdown-option.keyboard-active:not(.active) {
            background: rgba(255, 255, 255, 0.1);
        }

        .none-option {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 2px;
            background: rgba(255, 255, 255, 0.03);
        }

        .none-option:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .formation-name {
            font-weight: 600;
            color: var(--text-color);
        }

        .formation-summary-text {
            font-size: 0.85em;
            color: var(--text-color-secondary);
        }

        .formation-option-wrapper {
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            border-left: 3px solid transparent;
        }

        .formation-option-wrapper.active {
            border-left: 3px solid var(--bt-yellow);
        }

        .formation-option-wrapper.active > .formation-option {
            background: var(--bt-yellow-background-transparent);
        }

        .formation-option-wrapper.active > .formation-option:hover {
            background: var(--bt-yellow-background-bright-transparent);
        }

        .formation-option-wrapper.keyboard-active:not(.active) > .formation-option {
            background: rgba(255, 255, 255, 0.1);
        }

        .formation-option {
            padding-left: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .formation-option:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .formation-option-name {
            flex: 1;
            font-weight: 600;
            font-size: 0.95em;
            color: var(--text-color);
        }

        .expand-btn {
            flex-shrink: 0;
            background: none;
            border: none;
            color: var(--text-color-tertiary);
            cursor: pointer;
            padding: 10px 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s;
        }

        .expand-btn:hover {
            color: var(--text-color);
        }

        .expand-btn.active {
            color: var(--text-color);
            background: rgba(255, 255, 255, 0.12);
        }

        .expand-btn svg {
            transition: transform 0.2s;
        }

        .expand-btn.expanded svg {
            transform: rotate(90deg);
        }

        .formation-option-details {
            padding: 4px 12px 12px 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            overflow-y: auto;
        }

        .section-label {
            padding: 8px 12px 4px;
            font-size: 0.75em;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-color-tertiary);
        }

        .formation-option-wrapper.not-matching {
            &.active {
                border-left-color: red;
            }

            &.active > .formation-option {
                background: rgba(255, 0, 0, 0.08);
            }

            & > .formation-option:hover {
                background: rgba(255, 0, 0, 0.08);
            }
        }

        .invalid-marker {
            flex-shrink: 0;
            color: red;
        }

    `]
})
export class FormationDropdownPanelComponent {
    readonly automaticFormationKey = AUTOMATIC_FORMATION_KEY;

    formations = input.required<FormationDisplayItem[]>();
    selectedFormationId = input<string | null>(null);
    gameSystem = input<GameSystem>(GameSystem.ALPHA_STRIKE);
    label = input('Select formation');
    optionsId = input('');
    activeKey = input(AUTOMATIC_FORMATION_KEY);
    activeTarget = input<FormationDropdownActiveTarget>('entry');

    selected = output<FormationTypeDefinition | null>();
    pointerHovered = output<FormationDropdownPointerHoverEvent>();

    expandedId = signal<string | null>(null);
    searchText = signal<string>('');
    readonly noFormationId = NO_FORMATION_ID;

    private sortByDisplayName(items: FormationDisplayItem[]): FormationDisplayItem[] {
        return [...items].sort((left, right) => left.displayName.localeCompare(right.displayName));
    }

    filteredFormations = computed<FormationDisplayItem[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return [...this.formations()];

        return this.formations().filter(item => {
            const hay = this.getFormationSearchText(item);
            return tokens.every(token => hay.includes(token));
        });
    });

    /** Formations that are valid for the current group. */
    validFormations = computed<FormationDisplayItem[]>(() => {
        return this.sortByDisplayName(this.filteredFormations().filter(f => f.isValid));
    });

    /** Formations that are NOT valid for the current group. */
    otherFormations = computed<FormationDisplayItem[]>(() => {
        return this.sortByDisplayName(this.filteredFormations().filter(f => !f.isValid));
    });

    visibleOptionTargets = computed<FormationDropdownActiveOption[]>(() => {
        return [
            { selectionKey: AUTOMATIC_FORMATION_KEY, target: 'entry' },
            { selectionKey: NO_FORMATION_ID, target: 'entry' },
            ...this.validFormations().flatMap(item => this.formationTargets(item.definition.id)),
            ...this.otherFormations().flatMap(item => this.formationTargets(item.definition.id)),
        ];
    });

    readonly activeOptionId = computed(() => {
        const activeIndex = this.visibleOptionTargets().findIndex(option => this.matchesActiveTarget(option));
        return activeIndex >= 0
            ? this.optionTargetIdForActiveIndex(activeIndex)
            : '';
    });

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }

    optionTargetId(index: number, target: FormationDropdownActiveTarget): string {
        return target === 'entry' ? this.optionId(index) : `${this.optionId(index)}-${target}`;
    }

    validOptionIndex(index: number): number {
        return 2 + index;
    }

    otherOptionIndex(index: number): number {
        return 2 + this.validFormations().length + index;
    }

    isActiveTarget(selectionKey: string, target: FormationDropdownActiveTarget): boolean {
        return this.activeKey() === selectionKey && this.activeTarget() === target;
    }

    toggleExpand(event: MouseEvent, id: string): void {
        event.stopPropagation();
        this.toggleExpandedId(id);
    }

    toggleExpandedId(id: string): void {
        this.expandedId.update(current => current === id ? null : id);
    }

    onSearch(text: string) {
        this.searchText.set(text);
    }

    onOptionPointerHover(selectionKey: string, target: FormationDropdownActiveTarget, event: PointerEvent): void {
        if (target === 'details') {
            event.stopPropagation();
        }
        this.pointerHovered.emit({
            selectionKey,
            target,
            clientX: event.clientX,
            clientY: event.clientY,
        });
    }

    onSelect(definition: FormationTypeDefinition): void {
        this.selected.emit(definition);
    }

    /** Automatic: emits null so the system picks the best formation. */
    onSelectAutomatic(): void {
        this.selected.emit(null);
    }

    /** No Formation: emits the NO_FORMATION sentinel so auto-assign is skipped. */
    onSelectNoFormation(): void {
        this.selected.emit(NO_FORMATION);
    }

    private getFormationSearchText(item: FormationDisplayItem): string {
        return [item.displayName, item.definition.name, item.definition.id]
            .join(' ')
            .toLowerCase();
    }

    private formationTargets(selectionKey: string): FormationDropdownActiveOption[] {
        return [
            { selectionKey, target: 'entry' },
            { selectionKey, target: 'details' },
        ];
    }

    private matchesActiveTarget(option: FormationDropdownActiveOption): boolean {
        return option.selectionKey === this.activeKey() && option.target === this.activeTarget();
    }

    private optionTargetIdForActiveIndex(activeIndex: number): string {
        const precedingDetailsTargets = this.visibleOptionTargets()
            .slice(0, activeIndex + 1)
            .filter(option => option.target === 'details')
            .length;
        const rowIndex = activeIndex - precedingDetailsTargets;
        const activeTarget = this.visibleOptionTargets()[activeIndex]?.target ?? 'entry';
        return this.optionTargetId(rowIndex, activeTarget);
    }
}
