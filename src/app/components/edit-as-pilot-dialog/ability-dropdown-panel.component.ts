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
import { ASPilotAbility } from '../../models/pilot-abilities.model';

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
            @for (ability of abilities(); track ability.id) {
                @let isDisabled = isAbilityDisabled(ability);
                <div 
                    class="dropdown-option"
                    [class.disabled]="isDisabled"
                    [class.over-budget]="!disabledIds().includes(ability.id) && ability.cost > remainingCost()"
                    (click)="onSelect(ability.id)">
                    <div class="ability-header">
                        <span class="ability-name">{{ ability.name }}</span>
                        <span class="ability-cost" [class.exceeds-budget]="ability.cost > remainingCost()">Cost: {{ ability.cost }}</span>
                    </div>
                    <div class="ability-meta">
                        <span class="ability-rules">{{ ability.rulesBook }}, p.{{ ability.rulesPage }}</span>
                    </div>
                    <div class="ability-summary">{{ ability.summary[0] }}</div>
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
            margin-bottom: 4px;
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
    abilities = input.required<ASPilotAbility[]>();
    disabledIds = input<string[]>([]);
    remainingCost = input<number>(999); // Default high value if not set
    
    selected = output<string>();
    addCustom = output<void>();

    /** Check if an ability should be disabled (already selected or exceeds budget) */
    isAbilityDisabled(ability: ASPilotAbility): boolean {
        return this.disabledIds().includes(ability.id) || ability.cost > this.remainingCost();
    }

    onSelect(abilityId: string) {
        const ability = this.abilities().find(a => a.id === abilityId);
        if (!ability || this.isAbilityDisabled(ability)) {
            return;
        }
        this.selected.emit(abilityId);
    }

    onAddCustom(): void {
        this.addCustom.emit();
    }
}
