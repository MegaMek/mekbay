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

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PilotAbility, getAbilityDetails, PilotAbilityRuleDetails } from '../../models/pilot-abilities.model';
import { GameSystem, RulesReference } from '../../models/common.model';
import { ASUnitTypeCode } from '../../models/units.model';

interface ResolvedDropdownAbility {
    ability: PilotAbility;
    details: PilotAbilityRuleDetails;
    summary: string;
    rulesRef: RulesReference[];
    unitTypeRestricted: boolean;
    unitTypeLabel: string | undefined;
}

@Component({
    selector: 'ability-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" data-scroll-container>
            <div 
                class="dropdown-option custom-ability-option"
                (click)="onAddCustom()">
                <div class="ability-header">
                    <span class="ability-name">+ Add Custom Ability</span>
                </div>
                <div class="ability-summary">Create a custom ability with your own name, cost, and description</div>
            </div>
            <hr class="divider"/>
            @for (resolved of resolvedAbilities(); track resolved.ability.id) {
                @let isDisabled = disabledIds().includes(resolved.ability.id) || resolved.ability.cost > remainingCost();
                <div 
                    class="dropdown-option"
                    [class.disabled]="isDisabled"
                    [class.over-budget]="!disabledIds().includes(resolved.ability.id) && resolved.ability.cost > remainingCost()"
                    [class.unit-type-restricted]="resolved.unitTypeRestricted"
                    (click)="onSelect(resolved.ability.id)">
                    <div class="ability-header">
                        <span class="ability-name">{{ resolved.ability.name }}</span>
                        <span class="ability-cost" [class.exceeds-budget]="resolved.ability.cost > remainingCost()">Cost: {{ resolved.ability.cost }}</span>
                    </div>
                    @if (resolved.unitTypeLabel) {
                    <div class="unit-type-info" [class.unit-type-warning]="resolved.unitTypeRestricted">
                        @if (resolved.unitTypeRestricted) {
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M15.83 13.23l-7-11.76a1 1 0 0 0-1.66 0L.16 13.3c-.38.64-.07 1.7.68 1.7H15.2C15.94 15 16.21 13.87 15.83 13.23Zm-7 .37H7.14V11.89h1.7Zm0-3.57H7.16L7 4H9Z"/></svg>
                        }
                        {{ resolved.unitTypeLabel }}
                    </div>
                    }
                    <div class="ability-summary">{{ resolved.summary }}</div>
                    @if (resolved.rulesRef.length) {
                    <div class="ability-meta">
                        <span class="ability-rules">
                        @for (rule of resolved.rulesRef; let last = $last; track $index) {
                            {{ rule.book }}, p.{{ rule.page }}
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
    abilities = input.required<PilotAbility[]>();
    disabledIds = input<string[]>([]);
    remainingCost = input<number>(999);
    /** The unit's AS type code for filtering abilities by unitTypeFilter. */
    unitTypeCode = input<ASUnitTypeCode | undefined>(undefined);
    
    selected = output<string>();
    addCustom = output<void>();

    /** Pre-resolve all display data for each ability once via computed. */
    resolvedAbilities = computed<ResolvedDropdownAbility[]>(() => {
        const unitType = this.unitTypeCode();
        return this.abilities().map(ability => {
            const details = getAbilityDetails(ability, GameSystem.ALPHA_STRIKE);
            const unitTypeRestricted = !!(unitType && details.unitTypeFilter?.length && !details.unitTypeFilter.includes(unitType));
            return {
                ability,
                details,
                summary: details.summary[0] ?? '',
                rulesRef: details.rulesRef ?? [],
                unitTypeRestricted,
                unitTypeLabel: details.unitType,
            };
        });
    });

    onSelect(abilityId: string) {
        const resolved = this.resolvedAbilities().find(r => r.ability.id === abilityId);
        if (!resolved) return;
        if (this.disabledIds().includes(abilityId) || resolved.ability.cost > this.remainingCost()) return;
        this.selected.emit(abilityId);
    }

    onAddCustom(): void {
        this.addCustom.emit();
    }
}
