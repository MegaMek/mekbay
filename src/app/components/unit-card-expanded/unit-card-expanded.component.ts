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

import { ChangeDetectionStrategy, Component, inject, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { ForceUnit } from '../../models/force-unit.model';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, TagClickEvent } from '../unit-tags/unit-tags.component';
import { UnitComponentItemComponent } from '../unit-component-item/unit-component-item.component';
import { GameService } from '../../services/game.service';
import { DialogsService } from '../../services/dialogs.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { AdjustedBV } from '../../pipes/adjusted-bv.pipe';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { StatBarSpecsPipe } from '../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../pipes/filter-ammo.pipe';
import { ExpandedComponentsPipe } from '../../pipes/expanded-components.pipe';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { SearchTokensGroup, highlightMatches } from '../../utils/search.util';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../../models/crew-member.model';

/**
 * Author: Drake
 * An unit card component for displaying detailed unit information.
 * Displays full unit details including stats, equipment, and specials.
 */
@Component({
    selector: 'unit-card-expanded',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        UnitIconComponent,
        UnitTagsComponent,
        UnitComponentItemComponent,
        AdjustedBV,
        AdjustedPV,
        FormatNumberPipe,
        FormatTonsPipe,
        StatBarSpecsPipe,
        FilterAmmoPipe,
        ExpandedComponentsPipe,
        TooltipDirective
    ],
    templateUrl: './unit-card-expanded.component.html',
    styleUrl: './unit-card-expanded.component.scss'
})
export class UnitCardExpandedComponent {
    gameService = inject(GameService);
    private dialogsService = inject(DialogsService);
    private abilityLookup = inject(AsAbilityLookupService);

    /** 
     * The unit to display. Can be either a Unit or a ForceUnit.
     * When passing a ForceUnit, alias/gunnery/piloting are automatically extracted.
     */
    unit = input.required<Unit | ForceUnit>();

    /** Gunnery skill for BV/PV adjustment. Ignored when unit is a ForceUnit. */
    gunneryInput = input(DEFAULT_GUNNERY_SKILL, { alias: 'gunnery' });

    /** Piloting skill for BV adjustment. Ignored when unit is a ForceUnit. */
    pilotingInput = input(DEFAULT_PILOTING_SKILL, { alias: 'piloting' });

    /** Check if the input is a ForceUnit */
    private isForceUnit(u: Unit | ForceUnit): u is ForceUnit {
        return u instanceof ForceUnit;
    }

    /** Resolved Unit - extracts the Unit from ForceUnit if needed */
    readonly resolvedUnit = computed<Unit>(() => {
        const u = this.unit();
        return this.isForceUnit(u) ? u.getUnit() : u;
    });

    /** Resolved alias - from ForceUnit */
    readonly alias = computed<string | undefined>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            return u.alias();
        }
        return undefined;
    });

    /** Resolved gunnery skill - from ForceUnit crew or input */
    readonly gunnery = computed<number>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            if (u instanceof CBTForceUnit) {
                const crewMembers = u.getCrewMembers();
                const pilot = crewMembers[0];
                return pilot?.getSkill?.('gunnery') ?? DEFAULT_GUNNERY_SKILL;
            } else if (u instanceof ASForceUnit) {
                return u.pilotSkill();
            }
            return DEFAULT_GUNNERY_SKILL;
        }
        return this.gunneryInput();
    });

    /** Resolved piloting skill - from ForceUnit crew or input */
    readonly piloting = computed<number>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            if (u instanceof CBTForceUnit) {
                const crewMembers = u.getCrewMembers();
                const pilot = crewMembers[0];
                return pilot?.getSkill?.('piloting') ?? DEFAULT_PILOTING_SKILL;
            } else if (u instanceof ASForceUnit) {
                // AS uses same skill for both
                return u.pilotSkill();
            }
            return DEFAULT_PILOTING_SKILL;
        }
        return this.pilotingInput();
    });

    /** Whether the input is a ForceUnit (has pilot stats) */
    readonly hasForceUnit = computed<boolean>(() => {
        return this.isForceUnit(this.unit());
    });

    /** Pilot stats string from ForceUnit (e.g., "4/5") */
    readonly pilotStats = computed<string | null>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            return u.getPilotStats?.() ?? null;
        }
        return null;
    });

    /** Resolved BV/PV value - uses ForceUnit's getBv if available, otherwise calculates from skills */
    readonly resolvedBv = computed<number | null>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            return u.getBv();
        }
        return null; // Let the pipe calculate it
    });
    
    isAerospace = computed<boolean>(() => {
        const unit = this.resolvedUnit();
        const type = unit.as.TP;
        const movements = unit.as.MVm;
        return type === 'AF' || type === 'CF' || type === 'DA' || type === 'DS' 
            || type === 'SC' || type === 'WS' || type === 'SS' || type === 'JS'
            || (movements['a'] !== undefined) || (movements['p'] !== undefined) || (movements['k'] !== undefined);
    });

    showTMM = computed<boolean>(() => {
        return !this.isAerospace();
    });

    /** Whether this unit is currently selected/active */
    isSelected = input(false);

    /** Whether to use hex mode for AS movement display */
    useHex = input(false);

    /** Current sort key for highlighting (optional) */
    sortKey = input<string | null>(null);

    /** Label for sort slot when showing non-displayed sort field */
    sortSlotLabel = input<string | null>(null);

    /** Search tokens for text highlighting (optional) */
    searchTokens = input<SearchTokensGroup[]>([]);

    /** Whether to show expanded view (true) or compact view (false) */
    expandedView = input(true);

    /** Emitted when the card is clicked */
    cardClick = output<void>();

    /** Emitted when the tag button is clicked */
    tagClick = output<TagClickEvent>();

    /** Emitted when the pilot info is clicked (only for ForceUnit) */
    pilotClick = output<ForceUnit>();

    /**
     * Keys that are grouped together in the UI display.
     * When any key in a group is displayed, sorting by any other key in the group
     * should highlight that display (not create a separate sort slot).
     */
    private static readonly SORT_KEY_GROUPS: Record<string, readonly string[]> = {
        // AS damage displayed as S/M/L composite
        'as.damage': ['as.dmg._dmgS', 'as.dmg._dmgM', 'as.dmg._dmgL', 'as.dmg._dmgE'],
        // CBT movement displayed as "walk / run / jump / umu"
        'movement': ['walk', 'run', 'jump', 'umu'],
    };

    /**
     * Displayed keys/groups for view modes.
     */
    private static readonly VIEW_DISPLAYED_KEYS: Record<string, readonly string[]> = {
        'compact-cbt': ['name', 'bv', 'tons', 'year', 'role'],
        'compact-as': ['name', 'as.PV', 'as.SZ', 'as.TMM', 'year', 'role'],
        'expanded-cbt': [
            'name', 'bv', 'tons', 'year', 'role',
            'level', 'techBase', 'cost', 'moveType', 'c3', 'movement',
            'armorType', 'structureType', 'engine'
        ],
        'expanded-as': [
            'name', 'as.PV', 'as.SZ', 'as.TMM', 'year', 'role',
            'as._mv', 'as.damage',
            'as.Arm', 'as.Str', 'as.OV', 'as.Th', 'as.TP', 'tons', 'techBase'
        ],
    };

    /**
     * Conditional display checks for keys that are only shown when certain conditions are met.
     */
    private static readonly CONDITIONAL_DISPLAY: Record<string, (unit: Unit) => boolean> = {
        // AS conditional fields
        'as.OV': (unit) => unit.as?.usesOV ?? false,
        'as.Th': (unit) => unit.as?.usesTh ?? false,
        'as.damage': (unit) => !unit.as?.usesArcs,
        'as.dmg._dmgS': (unit) => !unit.as?.usesArcs,
        'as.dmg._dmgM': (unit) => !unit.as?.usesArcs,
        'as.dmg._dmgL': (unit) => !unit.as?.usesArcs,
        'as.dmg._dmgE': (unit) => !unit.as?.usesArcs,
        // CBT conditional fields
        'cost': (unit) => !!unit.cost,
        'c3': (unit) => !!unit.c3,
        'moveType': (unit) => !!unit.moveType,
        'armorType': (unit) => !!unit.armorType,
        'structureType': (unit) => !!unit.structureType,
        'engine': (unit) => !!unit.engine,
        'movement': (unit) => !!unit.walk,
        'walk': (unit) => !!unit.walk,
        'run': (unit) => !!unit.walk,
        'jump': (unit) => !!unit.jump,
        'umu': (unit) => !!unit.umu,
    };

    /** Computed sort slot - shows the sort value if not already displayed */
    sortSlot = computed<{ value: string; label: string | null } | null>(() => {
        const key = this.sortKey();
        const unit = this.resolvedUnit();
        if (!key || !unit) return null;

        // If this key is already displayed for this unit, don't show a separate slot
        if (this.isSortKeyDisplayedForUnit(key, unit)) return null;

        // Use nested property access for dotted keys like 'as.PV'
        const raw = this.getNestedProperty(unit, key);
        let value: string;

        if (raw == null) {
            value = '—';
        } else if (typeof raw === 'number') {
            value = FormatNumberPipe.formatValue(raw, true, false);
        } else {
            value = String(raw);
        }

        return {
            value,
            label: this.sortSlotLabel()
        };
    });

    onCardClick(): void {
        this.cardClick.emit();
    }

    onTagClick(event: TagClickEvent): void {
        this.tagClick.emit(event);
    }

    /** Handle pilot info click - emits pilotClick if this is a ForceUnit */
    onPilotClick(event: Event): void {
        event.stopPropagation();
        const u = this.unit();
        if (this.isForceUnit(u)) {
            this.pilotClick.emit(u);
        }
    }

    /** Handle AS special ability click - opens ability info dialog */
    onSpecialClick(special: string, event: Event): void {
        event.stopPropagation();
        const parsedAbility = this.abilityLookup.parseAbility(special);
        this.dialogsService.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }

    /**
     * Format AS movement with optional hex conversion.
     */
    formatASMovement(unit: Unit): string {
        const mvm = unit.as.MVm;
        if (!mvm) return unit.as.MV ?? '';

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        if (entries.length === 0) return unit.as.MV ?? '';

        // Sort so default movement comes first
        entries.sort((a, b) => {
            if (a[0] === '') return -1;
            if (b[0] === '') return 1;
            return 0;
        });

        return entries
            .map(([mode, inches]) => {
                if (this.useHex()) {
                    return Math.ceil(inches / 2) + mode;
                }
                return inches + '"' + mode;
            })
            .join('/');
    }

    /**
     * Check if the current sort key matches any of the provided keys or groups.
     */
    isSortActive(...keysOrGroups: string[]): boolean {
        const currentSort = this.sortKey();
        if (!currentSort) return false;

        for (const keyOrGroup of keysOrGroups) {
            // Check if it's a group name
            const group = UnitCardExpandedComponent.SORT_KEY_GROUPS[keyOrGroup];
            if (group) {
                if (group.includes(currentSort)) return true;
            } else if (keyOrGroup === currentSort) {
                return true;
            }
        }
        return false;
    }

    /**
     * Highlight search matches in text.
     */
    highlight(text: string): string {
        const tokens = this.searchTokens();
        if (!tokens || tokens.length === 0) return text;
        return highlightMatches(text, tokens, true);
    }

    /** Get the current view mode key */
    private getViewMode(): string {
        const isAS = this.gameService.isAlphaStrike();
        const expanded = this.expandedView();
        if (expanded) {
            return isAS ? 'expanded-as' : 'expanded-cbt';
        } else {
            return isAS ? 'compact-as' : 'compact-cbt';
        }
    }

    /**
     * Get a sort slot for compact view - shows the sort value if not already displayed.
     * Returns an object with key, value, label, img, alt, and numeric flag.
     */
    getSortSlotForCompact(unit: Unit): { key: string; value: string; label?: string; alt: string; numeric: boolean } | null {
        const sortKey = this.sortKey();
        if (!sortKey) return null;
        if (this.isSortKeyDisplayedForUnit(sortKey, unit)) return null;

        const raw = this.getNestedProperty(unit, sortKey);
        let value: string;
        let numeric = false;

        if (raw == null) {
            value = '—';
        } else if (typeof raw === 'number') {
            value = FormatNumberPipe.formatValue(raw, true, false);
            numeric = true;
        } else {
            value = String(raw);
        }

        return {
            key: sortKey,
            value,
            label: this.sortSlotLabel() ?? undefined,
            alt: this.sortSlotLabel() ?? sortKey,
            numeric
        };
    }

    /**
     * Check if a sort key is actually displayed for a specific unit.
     */
    private isSortKeyDisplayedForUnit(sortKey: string, unit: Unit): boolean {
        const viewKeys = UnitCardExpandedComponent.VIEW_DISPLAYED_KEYS[this.getViewMode()] || [];

        for (const keyOrGroup of viewKeys) {
            // Check if it's a group
            const group = UnitCardExpandedComponent.SORT_KEY_GROUPS[keyOrGroup];
            if (group) {
                if (group.includes(sortKey)) {
                    // Check group-level condition first, then individual key condition
                    const groupCondition = UnitCardExpandedComponent.CONDITIONAL_DISPLAY[keyOrGroup];
                    if (groupCondition && !groupCondition(unit)) return false;
                    const keyCondition = UnitCardExpandedComponent.CONDITIONAL_DISPLAY[sortKey];
                    return keyCondition ? keyCondition(unit) : true;
                }
            } else if (keyOrGroup === sortKey) {
                // Check if there's a conditional display check
                const condition = UnitCardExpandedComponent.CONDITIONAL_DISPLAY[sortKey];
                return condition ? condition(unit) : true;
            }
        }
        return false;
    }

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: any, key: string): any {
        if (!obj || !key) return undefined;
        if (!key.includes('.')) return obj[key];
        const parts = key.split('.');
        let cur: any = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    /** Format armor type - removes " Armor" suffix if present */
    formatArmorType(armorType: string | undefined): string {
        if (!armorType) return '';
        return armorType.endsWith(' Armor') ? armorType.slice(0, -6) : armorType;
    }

    /** Format structure type - removes " Structure" suffix if present */
    formatStructureType(structureType: string | undefined): string {
        if (!structureType) return '';
        return structureType.endsWith(' Structure') ? structureType.slice(0, -10) : structureType;
    }
}
