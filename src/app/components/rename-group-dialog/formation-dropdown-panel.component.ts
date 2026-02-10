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

import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormationTypeDefinition } from '../../utils/formation-type.model';
import { FormationInfoComponent } from '../formation-info/formation-info.component';
import { GameSystem } from '../../models/common.model';

/*
 * Author: Drake
 */
export interface FormationDisplayItem {
    definition: FormationTypeDefinition;
    displayName: string;
}

@Component({
    selector: 'formation-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormationInfoComponent],
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" data-scroll-container>
            <!-- None option -->
            <div class="none-option"
                 [class.active]="!selectedFormationId()"
                 (click)="onSelectNone()">
                <span class="formation-name">None</span>
                <span class="formation-summary-text">No formation assigned</span>
            </div>
            <hr class="divider"/>

            @for (item of formations(); track item.definition.id) {
                <div class="formation-option-wrapper" [class.active]="selectedFormationId() === item.definition.id">
                    <div class="formation-option" (click)="onSelect(item.definition)">
                        <span class="formation-option-name">{{ item.displayName }}</span>
                        <button class="expand-btn"
                                (click)="toggleExpand($event, item.definition.id)"
                                [class.expanded]="expandedId() === item.definition.id"
                                title="Show details">
                            <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                                <path d="M3 1l5 4-5 4z"/>
                            </svg>
                        </button>
                    </div>
                    @if (expandedId() === item.definition.id) {
                        <div class="formation-option-details">
                            <formation-info [formation]="item.definition" [gameSystem]="gameSystem()"></formation-info>
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

        .none-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);
        }

        .none-option.active:hover {
            background: var(--bt-yellow-background-bright-transparent);
        }

        .formation-name {
            font-weight: 600;
            color: var(--text-color);
        }

        .formation-summary-text {
            font-size: 0.85em;
            color: var(--text-color-secondary);
        }

        .divider {
            border: none;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            margin: 0;
        }

        .formation-option-wrapper {
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .formation-option-wrapper.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);
        }

        .formation-option-wrapper.active:hover {
            background: var(--bt-yellow-background-bright-transparent);
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
    `]
})
export class FormationDropdownPanelComponent {
    formations = input.required<FormationDisplayItem[]>();
    selectedFormationId = input<string | null>(null);
    gameSystem = input<GameSystem>(GameSystem.ALPHA_STRIKE);

    selected = output<FormationTypeDefinition | null>();

    expandedId = signal<string | null>(null);

    toggleExpand(event: MouseEvent, id: string): void {
        event.stopPropagation();
        this.expandedId.update(current => current === id ? null : id);
    }

    onSelect(definition: FormationTypeDefinition): void {
        this.selected.emit(definition);
    }

    onSelectNone(): void {
        this.selected.emit(null);
    }
}
