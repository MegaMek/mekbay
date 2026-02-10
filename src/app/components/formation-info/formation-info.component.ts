/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormationTypeDefinition, FormationEffectGroup, RulesReference } from '../../utils/formation-type.model';
import { ASPilotAbility, AS_PILOT_ABILITIES } from '../../models/as-abilities.model';
import { ASCommandAbility, AS_COMMAND_ABILITIES } from '../../models/as-command-abilities.model';
import { Rulebook } from '../../models/common.model';

/*
 * Author: Drake
 *
 * Reusable formation info card component.
 * Displays formation details, effect description, and ability cards.
 * Used in both the rename-group-dialog accordion and the formation-info-dialog.
 */

export interface ResolvedAbility {
    pilotAbility?: ASPilotAbility;
    commandAbility?: ASCommandAbility;
    name: string;
    summary: string[];
    rulesBook: string;
    rulesPage: number;
    cost?: number;
}

export interface ResolvedEffectGroup {
    group: FormationEffectGroup;
    abilities: ResolvedAbility[];
    selectionLabel: string;
    distributionLabel: string;
}

@Component({
    selector: 'formation-info',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    template: `
        @if (formation(); as def) {
        <div class="formation-info">
            <div class="formation-header">
                <span class="formation-name">{{ def.name }}</span>
                @if (def.exclusiveFaction) {
                    <span class="faction-badge">{{ def.exclusiveFaction }}</span>
                }
                @if (def.techBase && def.techBase !== 'Special') {
                    <span class="tech-badge">{{ def.techBase }}</span>
                }
            </div>

            <div class="formation-description">{{ def.description }}</div>

            @if (def.effectDescription) {
                <div class="effect-section">
                    <div class="effect-label">Formation Bonus</div>
                    <div class="effect-description">{{ def.effectDescription }}</div>

                    @if (rulesRefText().length > 0) {
                        <div class="rules-references">
                            @for (ref of rulesRefText(); track $index) {
                                <span class="rules-ref">{{ ref }}</span>
                            }
                        </div>
                    }
                </div>
            }

            @if (resolvedEffectGroups().length > 0) {
                <div class="abilities-section">
                    <div class="abilities-header" (click)="toggleAllAbilities()">
                        <span class="abilities-label">Granted Abilities</span>
                        <svg class="chevron" width="12px" height="12px" fill="currentColor" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" [class.collapsed]="!allAbilitiesExpanded()">
                            <path d="M0 2l5 6 5-6z"/>
                        </svg>
                    </div>
                    @for (eg of resolvedEffectGroups(); track $index) {
                        @let groupIdx = $index;
                        <div class="effect-group">
                            <div class="effect-group-meta">
                                <span class="meta-item">{{ eg.selectionLabel }}</span>
                                <span class="meta-separator">·</span>
                                <span class="meta-item">{{ eg.distributionLabel }}</span>
                                @if (eg.group.perTurn) {
                                    <span class="meta-separator">·</span>
                                    <span class="meta-item per-turn">Per turn</span>
                                }
                            </div>
                            @for (ability of eg.abilities; track ability.name) {
                                <div class="ability-card">
                                    <div class="ability-card-toggle" (click)="toggleAbility(groupIdx, ability.name)">
                                        <span class="ability-card-name">{{ ability.name }}</span>
                                        <svg class="chevron" width="10px" height="10px" fill="currentColor" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" [class.collapsed]="!isAbilityExpanded(groupIdx, ability.name)">
                                            <path d="M0 2l5 6 5-6z"/>
                                        </svg>
                                    </div>
                                    @if (isAbilityExpanded(groupIdx, ability.name)) {
                                    <div class="ability-card-body">
                                        @for (line of ability.summary; track line) {
                                            <div class="ability-card-summary">{{ line }}</div>
                                        }
                                        <div class="ability-card-rules">{{ ability.rulesBook }}, p.{{ ability.rulesPage }}</div>
                                    </div>
                                    }
                                </div>
                            }
                        </div>
                    }
                </div>
            }
        </div>
        }
    `,
    styles: [`
        :host {
            display: block;
        }

        .formation-info {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .formation-header {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .formation-name {
            font-weight: 700;
            font-size: 1.05em;
            color: var(--bt-yellow);
        }

        .faction-badge,
        .tech-badge {
            font-size: 0.75em;
            padding: 2px 6px;
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-color-secondary);
            white-space: nowrap;
        }

        .formation-description {
            font-size: 0.9em;
            color: var(--text-color-secondary);
            line-height: 1.4;
        }

        .effect-section {
            padding: 8px 10px;
            background: rgba(255, 255, 255, 0.04);
            border-left: 3px solid var(--bt-yellow);
        }

        .effect-label {
            font-size: 0.8em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-color-secondary);
            margin-bottom: 6px;
        }

        .abilities-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            user-select: none;
            margin-bottom: 6px;
        }

        .abilities-header:hover {
            opacity: 0.85;
        }

        .abilities-label {
            font-size: 0.8em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-color-secondary);
        }

        .effect-description {
            font-size: 0.88em;
            line-height: 1.45;
            color: var(--text-color);
        }

        .abilities-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .effect-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .effect-group-meta {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            font-size: 0.78em;
            color: var(--text-color-tertiary);
        }

        .meta-separator {
            color: var(--text-color-tertiary);
        }

        .per-turn {
            color: var(--bt-yellow);
        }

        .chevron {
            color: var(--text-color-secondary);
            transition: transform 0.15s ease;
            flex-shrink: 0;
        }

        .chevron.collapsed {
            transform: rotate(-90deg);
        }

        .ability-card {
            background: rgba(255, 255, 255, 0.04);
            border-left: 2px solid rgba(240, 192, 64, 0.4);
        }

        .ability-card-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 10px;
            cursor: pointer;
            user-select: none;
        }

        .ability-card-toggle:hover {
            background: rgba(255, 255, 255, 0.04);
        }

        .ability-card-body {
            padding: 0 10px 8px;
        }

        .ability-card-name {
            font-weight: 600;
            font-size: 0.92em;
            color: var(--text-color);
        }

        .ability-card-summary {
            font-size: 0.85em;
            line-height: 1.4;
            color: var(--text-color-secondary);
            margin-bottom: 2px;
        }

        .rules-references,
        .ability-card-rules {
            font-size: 0.78em;
            color: var(--text-color-tertiary);
            font-style: italic;
            margin-top: 4px;
        }
    `]
})
export class FormationInfoComponent {
    formation = input<FormationTypeDefinition | null>(null);
    /** Optional unit count in the group — used to compute concrete numbers for distribution labels. */
    unitCount = input<number | undefined>(undefined);

    /** Set of expanded individual abilities, keyed by "groupIndex:abilityName". */
    private expandedAbilities = signal(new Set<string>());
    /** Whether any ability is currently expanded — drives the master chevron. */
    allAbilitiesExpanded = computed(() => this.expandedAbilities().size > 0);

    /** Collect all ability keys from the resolved groups. */
    private allAbilityKeys = computed<string[]>(() =>
        this.resolvedEffectGroups().flatMap((eg, gi) =>
            eg.abilities.map(a => `${gi}:${a.name}`)
        )
    );

    /** Master toggle: expand all or collapse all individual abilities. */
    toggleAllAbilities(): void {
        if (this.allAbilitiesExpanded()) {
            this.expandedAbilities.set(new Set());
        } else {
            this.expandedAbilities.set(new Set(this.allAbilityKeys()));
        }
    }

    toggleAbility(groupIndex: number, abilityName: string): void {
        const key = `${groupIndex}:${abilityName}`;
        this.expandedAbilities.update(set => {
            const next = new Set(set);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    isAbilityExpanded(groupIndex: number, abilityName: string): boolean {
        const key = `${groupIndex}:${abilityName}`;
        const isExpanded = this.expandedAbilities().has(key);
        return isExpanded;
    }

    resolvedEffectGroups = computed<ResolvedEffectGroup[]>(() => {
        const def = this.formation();
        if (!def?.effectGroups) return [];

        return def.effectGroups.map(group => {
            const abilities: ResolvedAbility[] = [];

            // Resolve pilot abilities
            if (group.abilityIds) {
                for (const id of group.abilityIds) {
                    const pilot = AS_PILOT_ABILITIES.find(a => a.id === id);
                    if (pilot) {
                        abilities.push({
                            pilotAbility: pilot,
                            name: pilot.name,
                            summary: pilot.summary,
                            rulesBook: pilot.rulesBook,
                            rulesPage: pilot.rulesPage,
                        });
                    }
                }
            }

            // Resolve command abilities
            if (group.commandAbilityIds) {
                for (const id of group.commandAbilityIds) {
                    const cmd = AS_COMMAND_ABILITIES.find(a => a.id === id);
                    if (cmd) {
                        abilities.push({
                            commandAbility: cmd,
                            name: cmd.name,
                            summary: cmd.summary,
                            rulesBook: cmd.rulesBook,
                            rulesPage: cmd.rulesPage,
                        });
                    }
                }
            }

            return {
                group,
                abilities,
                selectionLabel: this.getSelectionLabel(group.selection),
                distributionLabel: this.getDistributionLabel(group),
            };
        });
    });

    rulesRefText = computed<string[]>(() => {
        const def = this.formation();
        if (!def?.rulesRef) return [];
        return def.rulesRef.map(ref => `${ref.book}, p.${ref.page}`);
    });

    private getSelectionLabel(selection: FormationEffectGroup['selection']): string {
        switch (selection) {
            case 'choose-one': return 'Choose one ability for all';
            case 'choose-each': return 'Each recipient chooses';
            case 'all': return 'All listed abilities';
            default: return selection;
        }
    }

    private getDistributionLabel(group: FormationEffectGroup): string {
        const n = this.unitCount();
        switch (group.distribution) {
            case 'all': return 'All units';
            case 'half-round-down': {
                const count = n != null ? Math.floor(n / 2) : undefined;
                return count != null ? `Up to half — ${count} units` : 'Up to half (round down)';
            }
            case 'half-round-up': {
                const count = n != null ? Math.ceil(n / 2) : undefined;
                return count != null ? `Up to half — ${count} units` : 'Up to half (round up)';
            }
            case 'percent-75': {
                const count = n != null ? Math.round(n * 0.75) : undefined;
                return count != null ? `75% of units — ${count} units` : '75% of units';
            }
            case 'up-to-50-percent': {
                const count = n != null ? Math.floor(n * 0.5) : undefined;
                return count != null ? `Up to 50% — ${count} units` : 'Up to 50% of units';
            }
            case 'fixed': return `Up to ${group.count ?? '?'} units`;
            case 'fixed-pairs': return `${group.count ?? '?'} identical pairs`;
            case 'conditional': return group.condition ?? 'Conditional';
            case 'remainder': return 'Remaining units';
            case 'shared-pool': return 'Shared pool';
            case 'role-filtered': return `${group.roleFilter ?? 'Matching'} role units`;
            case 'commander': return 'Commander only';
            default: return group.distribution;
        }
    }
}
