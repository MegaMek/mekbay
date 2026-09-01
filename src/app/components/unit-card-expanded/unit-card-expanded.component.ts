// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, input, output, computed } from '@angular/core';
import type { UnitSummary, UnitComponent } from '../../models/unit-summary.model';
import { ForceUnit } from '../../models/force-unit.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, type TagClickEvent } from '../unit-tags/unit-tags.component';
import { UnitComponentItemComponent } from '../unit-component-item/unit-component-item.component';
import { GameService } from '../../services/game.service';
import { GameSystem } from '../../models/common.model';
import { DialogsService } from '../../services/dialogs.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { AbilityInfoDialogComponent, type AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { AdjustedBV } from '../../pipes/adjusted-bv.pipe';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { StatBarSpecsPipe } from '../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../pipes/filter-ammo.pipe';
import { ExpandedComponentsPipe } from '../../pipes/expanded-components.pipe';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { ColorScheme } from '../../models/options.model';
import { type SearchTokensGroup, highlightMatches } from '../../utils/search.util';
import { formatASDamageValue, isASDamageFilterKey } from '../../utils/as-damage.util';
import type { TooltipLine } from '../tooltip/tooltip.component';
import {
    MEGAMEK_AVAILABILITY_BADGE_COLORS,
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_PRODUCTION_ICON_PATH,
    MEGAMEK_SALVAGE_ICON_PATH,
} from '../../models/megamek/availability.model';
import {
    AS_TYPE_DISPLAY_NAMES,
    MEGAMEK_RARITY_PRODUCTION_SORT_KEY,
    MEGAMEK_RARITY_SALVAGE_SORT_KEY,
    isMegaMekRaritySortKey,
} from '../../services/unit-search-filters.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../../models/crew.model';
import { getNormalizationGunnery, getNormalizationPiloting, type UnitSearchNormalizationMatch } from '../../models/unit-search-result.model';
import { caseRecordSheetLabel } from '../../models/case-equipment.model';
import { formatMovement, isAerospace } from '../../utils/as-common.util';
import { AlphaStrikeCardComponent } from '../alpha-strike-card/alpha-strike-card.component';
import type { MegaMekUnitAvailabilityDetail } from '../../services/unit-availability-source.service';
import { OptionsService } from '../../services/options.service';
import { formatBvPv } from '../../utils/force-viewer-bv-pv-display.util';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { adjustPointValueForSkill } from '../../utils/pv-skill-adjustment.util';
import { DataService } from '../../services/data.service';
import { getProperty } from '../../utils/unit-search-shared.util';

/**
 * An unit card component for displaying detailed unit information.
 * Displays full unit details including stats, equipment, and specials.
 */
@Component({
    selector: 'unit-card-expanded',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        UnitIconComponent,
        UnitTagsComponent,
        UnitComponentItemComponent,
        AlphaStrikeCardComponent,
        AdjustedBV,
        AdjustedPV,
        FormatNumberPipe,
        FormatTonsPipe,
        StatBarSpecsPipe,
        FilterAmmoPipe,
        TooltipDirective
    ],
    templateUrl: './unit-card-expanded.component.html',
    styleUrl: './unit-card-expanded.component.scss'
})
export class UnitCardExpandedComponent {
    readonly megaMekAvailabilityUnknown = MEGAMEK_AVAILABILITY_UNKNOWN;

    gameService = inject(GameService);
    private dialogsService = inject(DialogsService);
    private abilityLookup = inject(AsAbilityLookupService);
    private optionsService = inject(OptionsService);
    private dataService = inject(DataService);
    private expandedComponentsPipe = new ExpandedComponentsPipe();
    readonly unitTypeDisplayNames = AS_TYPE_DISPLAY_NAMES;
    readonly megaMekRequisitionIconPath = MEGAMEK_PRODUCTION_ICON_PATH;
    readonly megaMekSalvageIconPath = MEGAMEK_SALVAGE_ICON_PATH;
    readonly megaMekRarityRequisitionSortKey = MEGAMEK_RARITY_PRODUCTION_SORT_KEY;
    readonly megaMekRaritySalvageSortKey = MEGAMEK_RARITY_SALVAGE_SORT_KEY;

    /** 
     * The unit to display. Can be either a Unit or a ForceUnit.
     * When passing a ForceUnit, alias/gunnery/piloting are automatically extracted.
     */
    unit = input.required<UnitSummary | ForceUnit>();

    /** Gunnery skill for BV/PV adjustment. Ignored when unit is a ForceUnit. */
    gunneryInput = input(DEFAULT_GUNNERY_SKILL, { alias: 'gunnery' });

    /** Piloting skill for BV adjustment. Ignored when unit is a ForceUnit. */
    pilotingInput = input(DEFAULT_PILOTING_SKILL, { alias: 'piloting' });

    /** Immutable adjusted-BV and skill context selected by BV normalization search. */
    searchResultContext = input<UnitSearchNormalizationMatch | null>(null);

    /** To force view of pilot skills even when we don't have a ForceUnit (e.g., force generator) */
    forceShowPilotInfo = input(false);

    /** Show adjusted and base BV/PV for a plain search-result Unit. */
    useBvPvDisplayOption = input(false);

    /** Forcibly override game system detection */
    gameSystemOverride = input<GameSystem | null>(null);

    /** Whether to show tags on the unit card */
    showTags = input(true);

    enableTagsEditing = input(true);

    /** Check if the input is a ForceUnit */
    protected isForceUnit(u: UnitSummary | ForceUnit): u is ForceUnit {
        return u instanceof ForceUnit;
    }

    /** Resolved Unit - extracts the Unit from ForceUnit if needed */
    readonly resolvedUnit = computed<UnitSummary>(() => {
        const u = this.unit();
        return this.isForceUnit(u) ? u.getSummary() : u;
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
            if (u instanceof ASForceUnit) {
                return u.pilotSkill();
            }
            return DEFAULT_GUNNERY_SKILL;
        }
        const context = this.searchResultContext();
        return context ? getNormalizationGunnery(context) : this.gunneryInput();
    });

    /** Resolved piloting skill - from ForceUnit crew or input */
    readonly piloting = computed<number>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            if (u instanceof ASForceUnit) {
                // AS uses same skill for both
                return u.pilotSkill();
            }
            return DEFAULT_PILOTING_SKILL;
        }
        const context = this.searchResultContext();
        return context ? getNormalizationPiloting(context) : this.pilotingInput();
    });

    /** Whether the input is a ForceUnit (has pilot stats) */
    readonly hasForceUnit = computed<boolean>(() => {
        return this.isForceUnit(this.unit());
    });

    /** Pilot stats string from ForceUnit (e.g., "4/5") */
    readonly pilotStats = computed<string | null>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            return `${u.getPilotStats()}`;
        }
        if (this.forceShowPilotInfo() || this.searchResultContext()) {
            if (this.isAlphaStrike()) {
                return `${this.gunnery()}`;
            }
            return `${this.gunnery()}/${this.piloting()}`;
        }
        return null;
    });

    private readonly standaloneSearchBvPv = computed<string | null>(() => {
        if (!this.useBvPvDisplayOption()) {
            return null;
        }

        const unit = this.resolvedUnit();
        const base = this.isAlphaStrike() ? unit.as.PV : unit.bv;
        const adjusted = this.searchResultContext()?.adjustedValue ?? (this.isAlphaStrike()
            ? adjustPointValueForSkill(base, this.gunnery())
            : BVCalculatorUtil.calculateAdjustedBV(unit, base, this.gunnery(), this.piloting()));
        return formatBvPv(adjusted, base, 'both');
    });

    /** Resolved BV/PV display for a live ForceUnit or standalone search result. */
    readonly resolvedBv = computed<string | null>(() => {
        const unit = this.unit();
        if (this.isForceUnit(unit)) {
            return formatBvPv(
                unit.getBv(),
                unit.getPreSkillBv(),
                this.optionsService.options().forceViewerBVPVDisplay,
            );
        }

        return this.standaloneSearchBvPv();
    });

    /** Resolved BV/PV display for compact cards, including plain unit-search results. */
    readonly resolvedCompactBv = computed<string | null>(() => {
        return this.resolvedBv();
    });

    readonly expandedComponents = computed<UnitComponent[]>(() => {
        return this.expandedComponentsPipe.transform(
            this.resolvedUnit().comp ?? [],
            internalName => this.dataService.findEquipment(internalName),
        );
    });
    
    /** Derives Alpha Strike status from the ForceUnit's force when available, falls back to global game mode. */
    isAlphaStrike = computed<boolean>(() => {
        const u = this.unit();
        if (this.isForceUnit(u)) {
            return u.force.gameSystem === GameSystem.AS;
        }
        if (this.gameSystemOverride()) {
            return this.gameSystemOverride() === GameSystem.AS;
        }
        return this.gameService.isAlphaStrike();
    });

    isAerospace = computed<boolean>(() => {
        const unit = this.resolvedUnit();
        const type = unit.as.TP;
        const movements = unit.as.MVm;
        return isAerospace(type, movements);
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

    /** Optional per-card sort slot override for custom sort keys. */
    sortSlotOverride = input<{ value: string; numeric?: boolean } | null>(null);

    /** Optional fixed MegaMek availability display, used by unit-search results only. */
    megaMekAvailability = input<readonly MegaMekUnitAvailabilityDetail[] | null>(null);

    readonly megaMekAvailabilityBadges = computed(() => {
        const badges = this.megaMekAvailability() ?? [];
        return badges.map((badge) => ({
            ...badge,
            color: MEGAMEK_AVAILABILITY_BADGE_COLORS[badge.rarity],
        }));
    });

    readonly megaMekAvailabilityTooltip = computed<TooltipLine[] | null>(() => {
        const badges = this.megaMekAvailability();
        if (!badges || badges.length === 0) {
            return null;
        }

        return badges.map((badge) => ({
            label: badge.source === MEGAMEK_AVAILABILITY_UNKNOWN ? 'Availability' : badge.source,
            value: badge.rarity,
        }));
    });

    /** Search tokens for text highlighting (optional) */
    searchTokens = input<SearchTokensGroup[]>([]);

    /** Whether to show expanded view (true) or compact view (false) */
    expandedView = input(true);

    /** Whether to show alpha-strike card view (renders the actual AS card) */
    cardView = input(false);

    /** Whether to show the info button */
    showInfoButton = input(true);

    /** Whether to show a select checkbox */
    showSelectCheckbox = input(false);

    /** Card style for alpha-strike card view */
    cardStyle = input<ColorScheme>('default');

    /** Emitted when the info button is clicked */
    infoClick = output<void>();

    /** Emitted when the card is clicked */
    cardClick = output<void>();

    /** Emitted when the select button is clicked */
    selectClick = output<void>();

    /** Emitted when the tag button is clicked */
    tagClick = output<TagClickEvent>();

    /** Emitted whenever visible pilot info is clicked. */
    pilotInfoClick = output<void>();

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
            'level', '_techBaseDisplay', 'cost', 'moveType', 'c3', 'movement',
            'armorType', 'structureType', 'engine'
        ],
        'expanded-as': [
            'name', 'as.PV', 'as.SZ', 'as.TMM', 'year', 'role',
            'as._mv', 'as.damage',
            'as.Arm', 'as.Str', 'as.OV', 'as.Th', 'as.TP', 'tons', '_techBaseDisplay'
        ],
    };

    /**
     * Conditional display checks for keys that are only shown when certain conditions are met.
     */
    private static readonly CONDITIONAL_DISPLAY: Record<string, (unit: UnitSummary) => boolean> = {
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

        const override = this.sortSlotOverride();
        if (override) {
            return {
                value: override.value,
                label: this.sortSlotLabel()
            };
        }

        // Use nested property access for dotted keys like 'as.PV'
        const raw = getProperty(unit, key);
        let value: string;

        if (raw == null) {
            value = '—';
        } else if (typeof raw === 'number') {
            value = isASDamageFilterKey(key) ? formatASDamageValue(raw) : FormatNumberPipe.formatValue(raw, true, false);
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

    onInfoClick(event: Event): void {
        event.stopPropagation();
        this.infoClick.emit();
    }

    onSelectClick(event: Event): void {
        event.stopPropagation();
        this.selectClick.emit();
    }

    /** Handle pilot info click - emits pilotClick if this is a ForceUnit */
    onPilotClick(event: Event): void {
        event.stopPropagation();
        this.pilotInfoClick.emit();
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
    formatASMovement(unit: UnitSummary): string {
        const mvm = unit.as.MVm;
        if (!mvm) return unit.as.MV ?? '';

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        if (entries.length === 0) return unit.as.MV ?? '';

        return entries
            .sort((a, b) => {
                if (a[0] === '') return -1;
                if (b[0] === '') return 1;
                return 0;
            })
            .map(([mode, inches]) => formatMovement(inches, mode, this.useHex()))
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
        const isAS = this.isAlphaStrike();
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
    getSortSlotForCompact(unit: UnitSummary): { key: string; value: string; label?: string; alt: string; numeric: boolean } | null {
        const sortKey = this.sortKey();
        if (!sortKey) return null;
        if (this.isSortKeyDisplayedForUnit(sortKey, unit)) return null;

        const override = this.sortSlotOverride();
        if (override) {
            return {
                key: sortKey,
                value: override.value,
                label: this.sortSlotLabel() ?? undefined,
                alt: this.sortSlotLabel() ?? sortKey,
                numeric: override.numeric ?? false,
            };
        }

        const raw = getProperty(unit, sortKey);
        let value: string;
        let numeric = false;

        if (raw == null) {
            value = '—';
        } else if (typeof raw === 'number') {
            value = isASDamageFilterKey(sortKey) ? formatASDamageValue(raw) : FormatNumberPipe.formatValue(raw, true, false);
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
    private isSortKeyDisplayedForUnit(sortKey: string, unit: UnitSummary): boolean {
        if (isMegaMekRaritySortKey(sortKey) && this.megaMekAvailability() !== null) {
            return true;
        }

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

    /** Map of normalized location code -> '[CASE]' or '[CASE II]' for locations that have CASE equipment */
    private caseByLocation = computed<Map<string, string>>(() => {
        const u = this.resolvedUnit();
        const result = new Map<string, string>();
        if (!u?.comp) return result;
        for (const comp of u.comp) {
            const equipment = comp.eq ?? this.dataService.findEquipment(comp.id);
            if (!equipment || !comp.l) continue;
            const label = caseRecordSheetLabel(equipment) ?? undefined;
            if (label) result.set(this.normalizeLoc(comp.l), label);
        }
        return result;
    });

    private normalizeLoc(loc: string): string {
        if (!loc) return 'UNK';
        let norm = (loc === '*') ? 'ALL' : loc.trim();
        norm = norm.replace(/[^A-Za-z0-9_-]/g, '');
        if (/^[0-9]/.test(norm)) norm = 'L' + norm;
        if (!norm) norm = 'UNK';
        return norm;
    }

    /** Returns the CASE label for a raw location string */
    getCaseLabel(loc: string): string {
        return this.caseByLocation().get(this.normalizeLoc(loc)) ?? '';
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
