// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formatRulesReference, type RulesReference } from '../../models/common.model';
import { naturalCompare } from '../../utils/sort.util';

export interface AbilityDropdownOption {
    id: string;
    name: string;
    summary: string;
    rulesRef: RulesReference[];
    cost?: number;
    unitTypeRestricted?: boolean;
    unitTypeLabel?: string;
}

@Component({
    selector: 'ability-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" data-scroll-container>
            @if (allowCustom()) {
            <div 
                class="dropdown-option custom-ability-option"
                (click)="onAddCustom()">
                <div class="ability-header">
                    <span class="ability-name">+ Add Custom Ability</span>
                </div>
                <div class="ability-summary">Create a custom ability with your own name, cost, and description</div>
            </div>
            }
            @if (allowCustom() && sortedAbilities().length > 0) {
            <hr class="divider"/>
            }
            @for (ability of sortedAbilities(); track ability.id) {
                @let abilityCost = ability.cost ?? 0;
                @let isDisabled = disabledIds().includes(ability.id) || abilityCost > remainingCost() || !!ability.unitTypeRestricted;
                <div 
                    class="dropdown-option"
                    [class.disabled]="isDisabled"
                    [class.over-budget]="!disabledIds().includes(ability.id) && abilityCost > remainingCost()"
                    [class.unit-type-restricted]="!!ability.unitTypeRestricted"
                    (click)="onSelect(ability.id)">
                    <div class="ability-header">
                        <span class="ability-name">{{ ability.name }}</span>
                        @if (showCost()) {
                        <span class="ability-cost" [class.exceeds-budget]="abilityCost > remainingCost()">Cost: {{ abilityCost }}</span>
                        }
                    </div>
                    @if (ability.unitTypeLabel) {
                    <div class="unit-type-info" [class.unit-type-warning]="!!ability.unitTypeRestricted">
                        @if (ability.unitTypeRestricted) {
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M15.83 13.23l-7-11.76a1 1 0 0 0-1.66 0L.16 13.3c-.38.64-.07 1.7.68 1.7H15.2C15.94 15 16.21 13.87 15.83 13.23Zm-7 .37H7.14V11.89h1.7Zm0-3.57H7.16L7 4H9Z"/></svg>
                        }
                        {{ ability.unitTypeLabel }}
                    </div>
                    }
                    <div class="ability-summary" [innerHTML]="ability.summary"></div>
                    @if (ability.rulesRef.length) {
                    <div class="ability-meta">
                        <span class="ability-rules">
                        @for (rule of ability.rulesRef; let last = $last; track $index) {
                            {{ formatRuleReference(rule) }}
                            @if (!last) {
                                <span class="separator"> · </span>
                            }
                        }
                        </span>
                    </div>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
        }

        .dropdown-panel {
            box-sizing: border-box;
            overflow-y: auto;
        }

        .dropdown-option {
            padding: 10px 12px;
            cursor: pointer;
            border-bottom: 1px solid #333;
        }

        .dropdown-option:last-child {
            border-bottom: none;
        }

        .dropdown-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .dropdown-option.disabled {
            opacity: 0.4;
            pointer-events: none;
        }

        .dropdown-option.over-budget {
            opacity: 0.6;
        }

        .dropdown-option.unit-type-restricted {
            opacity: 0.45;
        }

        .ability-cost.exceeds-budget {
            color: red;
            background: rgba(255, 107, 107, 0.15);
        }

        .ability-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        .ability-name {
            font-weight: 600;
            color: var(--text-color);
        }

        .ability-cost {
            font-size: 0.85em;
            color: var(--bt-yellow);
            padding: 2px 6px;
            background: rgba(240, 192, 64, 0.15);
        }

        .ability-meta {
            margin-top: 4px;
        }

        .ability-rules {
            font-size: 0.8em;
            color: var(--text-color-tertiary);
        }

        .ability-summary {
            font-size: 0.85em;
            color: var(--text-color-secondary);
            line-height: 1.3;
        }

        .unit-type-info {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-bottom: 4px;
            font-size: 0.78em;
            color: var(--text-color-tertiary);
            font-style: italic;
        }

        .unit-type-warning {
            color: orange;
        }

        .custom-ability-option {
            background: rgba(234, 174, 63, 0.08);
        }

        .custom-ability-option:hover {
            background: rgba(234, 174, 63, 0.15);
        }

        .custom-ability-option .ability-name {
            color: var(--bt-yellow);
        }
    `]
})
export class AbilityDropdownPanelComponent {
    abilities = input.required<AbilityDropdownOption[]>();
    disabledIds = input<string[]>([]);
    remainingCost = input<number>(999);
    allowCustom = input<boolean>(true);
    showCost = input<boolean>(true);
    readonly formatRuleReference = formatRulesReference;
    readonly sortedAbilities = computed(() => {
        return [...this.abilities()].sort((left, right) => {
            const leftAvailable = this.isAbilityAvailable(left);
            const rightAvailable = this.isAbilityAvailable(right);
            if (leftAvailable !== rightAvailable) {
                return leftAvailable ? -1 : 1;
            }

            const nameComparison = naturalCompare(left.name, right.name);
            return nameComparison || naturalCompare(left.id, right.id);
        });
    });
    
    selected = output<string>();
    addCustom = output<void>();

    private isAbilityAvailable(ability: AbilityDropdownOption): boolean {
        return !this.disabledIds().includes(ability.id)
            && (ability.cost ?? 0) <= this.remainingCost()
            && !ability.unitTypeRestricted;
    }

    onSelect(abilityId: string) {
        const ability = this.abilities().find((entry) => entry.id === abilityId);
        if (!ability) return;
        if (this.disabledIds().includes(abilityId) || (ability.cost ?? 0) > this.remainingCost() || ability.unitTypeRestricted) return;
        this.selected.emit(abilityId);
    }

    onAddCustom(): void {
        this.addCustom.emit();
    }
}
