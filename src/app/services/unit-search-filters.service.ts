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

import { Injectable, signal, computed, effect, inject, untracked, DestroyRef } from '@angular/core';
import type { Era } from '../models/eras.model';
import type { Unit } from '../models/units.model';
import {
    MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS,
    MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS,
    MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    getMegaMekAvailabilityRarityForScore,
    getMegaMekAvailabilityValueForSource,
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_AVAILABILITY_NOT_AVAILABLE,
    type MegaMekAvailabilityFrom,
    type MegaMekAvailabilityRarity,
} from '../models/megamek/availability.model';
import { DataService } from './data.service';
import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { getForcePacks } from '../models/forcepacks.model';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { parseSearchQuery, type SearchTokensGroup } from '../utils/search.util';
import { OptionsService } from './options.service';
import { LoggerService } from './logger.service';
import { GameSystem } from '../models/common.model';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';
import { GameService } from './game.service';
import { UrlStateService } from './url-state.service';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';
import { filterStateToSemanticText, tokensToFilterState, type WildcardPattern } from '../utils/semantic-filter.util';
import { parseSemanticQueryAST, type ParseResult, type ParseError, isComplexQuery } from '../utils/semantic-filter-ast.util';
import { getSnapshotForcePackNames, type AdvOptionsContextSnapshot } from '../utils/unit-search-adv-options.util';
import { buildUnitSearchAdvOptions } from '../utils/unit-search-adv-options-builder.util';
import type { UnitSearchDropdownValuesDependencies } from '../utils/unit-search-dropdown-values.util';
import { applyFilterStateToUnits, type UnitFilterKernelDependencies } from '../utils/unit-filter-kernel.util';
import { getAdvancedFilterConfigByKey, isFilterAvailableForAvailabilitySource } from '../utils/unit-search-filter-config.util';
import { buildUnitSearchQueryParameters, parseAndValidateCompactFiltersFromUrl, parseUnitSearchScalarUrlState } from '../utils/unit-search-url-filters.util';
import { generatePublicTagsParam, mergePublicTagReferences, parsePublicTagsParam } from '../utils/unit-search-public-tags-url.util';
import {
    buildPromotedSearchText,
    canonicalizeSemanticFilterState,
    getCommittedSemanticTokens,
    getSemanticFilterKeysFromParsed,
    type UnitSearchSemanticStateDependencies,
} from '../utils/unit-search-semantic-state.util';
import {
    getProperty,
    getSelectedPositiveDropdownNames,
    getUnitComponentData,
    measureStage,
    normalizeMultiStateSelection,
} from '../utils/unit-search-shared.util';
import { executeUnitSearch } from '../utils/unit-search-executor.util';
import { UnitSearchWorkerClient } from '../utils/unit-search-worker-client.util';
import { SEARCH_WORKER_FACTORY } from '../utils/unit-search-worker-factory.util';
import {
    buildWorkerExecutionQuery,
    buildWorkerSearchRequest as buildUnitSearchWorkerRequest,
    getWorkerCorpusSnapshot as getCachedWorkerCorpusSnapshot,
    getWorkerCorpusVersion as getUnitSearchWorkerCorpusVersion,
} from '../utils/unit-search-worker-request.util';
import { buildWorkerSearchTelemetrySnapshot, hydrateWorkerResultUnits } from '../utils/unit-search-worker-result.util';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import { UserStateService } from './userState.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { type MegaMekAvailabilityFilterContext, type MegaMekUnitAvailabilityDetail, UnitAvailabilitySourceService } from './unit-availability-source.service';
import {
    getPositiveDropdownNamesFromFilter,
    hasResolvedDropdownNames,
    resolveDropdownNamesFromFilter,
    type ResolvedDropdownNames,
} from '../utils/filter-name-resolution.util';
import { sortAvailableDropdownOptions, sortDropdownOptionObjects } from '../utils/unit-search-dropdown-sort.util';
import { compareUnitsByName } from '../utils/sort.util';
import type { UnitSearchWorkerCorpusSnapshot, UnitSearchWorkerQueryRequest, UnitSearchWorkerResultMessage } from '../utils/unit-search-worker-protocol.util';
import {
    ADVANCED_FILTERS,
    type AvailabilityFilterScope,
    type AdvFilterConfig,
    type AdvOptionsTelemetrySnapshot,
    AdvFilterType,
    type FilterState,
    DROPDOWN_FILTERS,
    getMegaMekRaritySortAvailabilitySources,
    isMegaMekRaritySortKey,
    RANGE_FILTERS,
    type DropdownFilterConfig,
    type RangeFilterConfig,
    type SearchTelemetrySnapshot,
    type SearchTelemetryStage,
    type SerializedSearchFilter,
} from './unit-search-filters.model';

const FORCE_PACK_OPTION_UNIVERSE = getForcePacks().map(pack => ({ name: pack.name }));
const MEGAMEK_WORKER_CONTEXT_FILTER_KEYS = new Set(['era', 'faction']);
const MEGAMEK_WORKER_AVAILABILITY_FILTER_KEYS = new Set(['availabilityFrom', 'availabilityRarity']);
const MEGAMEK_WORKER_AVAILABILITY_SEMANTIC_FIELDS = new Set(['from', 'rarity']);
const MEGAMEK_WORKER_SEMANTIC_FIELDS = new Set(['era', 'faction', 'from', 'rarity']);

/** Check if any element in sourceSet exists in targetSet. */
function setHasAny<T>(sourceSet: ReadonlySet<T>, targetSet: ReadonlySet<T>): boolean {
    const [smaller, larger] = sourceSet.size <= targetSet.size
        ? [sourceSet, targetSet]
        : [targetSet, sourceSet];
    for (const item of smaller) {
        if (larger.has(item)) return true;
    }
    return false;
}

interface AvailabilitySelectionScopeParts {
    eraNames: string[];
    factionNames: string[];
    availabilityFromNames: string[];
    availabilityRarityNames: MegaMekAvailabilityRarity[];
}

interface UnitSearchClosePanelsRequest {
    requestId: number;
    exitExpandedView: boolean;
}

@Injectable({ providedIn: 'root' })
export class UnitSearchFiltersService {
    dataService = inject(DataService);
    optionsService = inject(OptionsService);
    gameService = inject(GameService);
    logger = inject(LoggerService);
    private readonly searchWorkerFactory = inject(SEARCH_WORKER_FACTORY);
    private urlStateService = inject(UrlStateService);
    private userStateService = inject(UserStateService);
    private publicTagsService = inject(PublicTagsService);
    private tagsService = inject(TagsService);
    private unitAvailabilitySource = inject(UnitAvailabilitySourceService);

    ADVANCED_FILTERS = ADVANCED_FILTERS;

    /** Display name resolvers that need service dependencies (can't be defined in static config) */
    private readonly displayNameFns: Partial<Record<string, (v: string) => string>> = {
        'source': (v) => this.dataService.getSourcebookTitle(v),
    };

    private buildIndexedDropdownOptions(
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        displayNameFn?: (value: string) => string | undefined,
        contextUnitIds?: ReadonlySet<string>,
    ): { name: string; img?: string; displayName?: string; available?: boolean }[] {
        const universe = this.dataService.getDropdownOptionUniverse(conf.key);
        if (universe.length === 0) {
            return [];
        }

        const contextUnitIdSet = contextUnitIds ?? new Set(contextUnits.map(unit => unit.name));
        const availableOptions = universe.map(option => {
            const indexedIds = this.dataService.getIndexedUnitIds(conf.key, option.name);
            const available = indexedIds ? setHasAny(indexedIds, contextUnitIdSet) : false;

            return {
                name: option.name,
                ...(option.img ? { img: option.img } : {}),
                ...(displayNameFn ? { displayName: displayNameFn(option.name) } : {}),
                available,
            };
        });

        return sortDropdownOptionObjects(availableOptions, conf.sortOptions);
    }

    /** Dropdown filter configs for current game system */
    readonly dropdownConfigs = computed((): readonly DropdownFilterConfig[] => {
        const gs = this.gameService.currentGameSystem();
        const availabilitySource = this.optionsService.options().availabilitySource;
        return DROPDOWN_FILTERS.filter(f => (
            (!f.game || f.game === gs)
            && isFilterAvailableForAvailabilitySource(f, availabilitySource)
        ));
    });

    /** Range filter configs for current game system */
    readonly rangeConfigs = computed((): readonly RangeFilterConfig[] => {
        const gs = this.gameService.currentGameSystem();
        const availabilitySource = this.optionsService.options().availabilitySource;
        return RANGE_FILTERS.filter(f => (
            (!f.game || f.game === gs)
            && isFilterAvailableForAvailabilitySource(f, availabilitySource)
        ));
    });

    pilotGunnerySkill = signal(4);
    pilotPilotingSkill = signal(5);
    /** BV/PV budget limit. 0 means no limit. */
    bvPvLimit = signal(0);
    /** Current force total BV/PV, fed from the component layer. */
    forceTotalBvPv = signal(0);
    searchText = signal('');
    filterState = signal<FilterState>({});
    selectedSort = signal<string>('');
    selectedSortDirection = signal<'asc' | 'desc'>('asc');
    expandedView = signal(false);
    advOpen = signal(false);
    private readonly closePanelsRequestState = signal<UnitSearchClosePanelsRequest>({
        requestId: 0,
        exitExpandedView: false,
    });
    readonly closePanelsRequest = this.closePanelsRequestState.asReadonly();
    private totalRangesCache: Record<string, [number, number]> = {};
    private indexedUniverseNamesCache = new Map<string, string[]>();
    private urlStateInitialized = signal(false);
    private readonly searchTelemetryState = signal<SearchTelemetrySnapshot | null>(null);
    readonly searchTelemetry = this.searchTelemetryState.asReadonly();
    private readonly advOptionsTelemetryState = signal<AdvOptionsTelemetrySnapshot | null>(null);
    readonly advOptionsTelemetry = this.advOptionsTelemetryState.asReadonly();
    private readonly workerSearchEnabled = signal(this.canUseSearchWorker());
    private readonly uncappedWorkerFilteredUnitsState = signal<Unit[]>([]);
    private advOptionsTelemetryPublishVersion = 0;
    private lastSearchTelemetryLogKey = '';
    private readonly slowSearchTelemetryThresholdMs = 75;
    private searchWorkerClient: UnitSearchWorkerClient | null = null;
    private cachedWorkerCorpusVersion: string | null = null;
    private cachedWorkerCorpusSnapshot: UnitSearchWorkerCorpusSnapshot | null = null;
    private searchRequestRevision = 0;
    private readonly availabilitySelectionScopePartsCache = new WeakMap<FilterState, AvailabilitySelectionScopeParts>();
    private readonly workerRequestRevision = signal(0);
    private readonly workerResultRevision = signal(0);
    private readonly workerSearchActive = computed(() => {
        return this.workerSearchEnabled() && !this.shouldForceMegaMekSyncSearch();
    });

    requestClosePanels(options: { exitExpandedView?: boolean } = {}): void {
        const currentRequest = this.closePanelsRequestState();
        this.closePanelsRequestState.set({
            requestId: currentRequest.requestId + 1,
            exitExpandedView: !!options.exitExpandedView,
        });
    }

    /**
     * True when filtered results match the latest search request.
     * False while a worker search is in-flight and results are stale.
     * Mode-agnostic: when the worker is disabled (sync fallback), revisions
     * are synced in disableWorkerSearch() so this stays true.
     */
    readonly isSearchSettled = computed(() => {
        return !this.workerSearchActive() || this.workerResultRevision() === this.workerRequestRevision();
    });

    /** Signal that changes when unit tags are updated. Used to trigger reactivity in tag-dependent components. */
    readonly tagsVersion = signal(0);

    private invalidateIndexedDropdownUniverseCache(): void {
        this.indexedUniverseNamesCache.clear();
    }

    private invalidateCorpusCaches(): void {
        this.invalidateIndexedDropdownUniverseCache();
        this.cachedWorkerCorpusVersion = null;
        this.cachedWorkerCorpusSnapshot = null;
        this.searchTelemetryState.set(null);
        this.advOptionsTelemetryState.set(null);
        this.advOptionsTelemetryPublishVersion = 0;
        this.lastSearchTelemetryLogKey = '';
    }

    /** Pending foreign tags to import from URL. Format: Array of { publicId, tagName } */
    readonly pendingForeignTags = signal<Array<{ publicId: string; tagName: string }>>([]);

    /**
     * Public tags parameter for URL. Format: publicId1:tag1,publicId2:tag2
     * Computed from current search text, filter state, and tag sources.
     */
    readonly publicTagsParam = computed(() => {
        this.tagsVersion();
        this.pendingForeignTags();

        return generatePublicTagsParam({
            searchText: this.searchText(),
            filterState: this.filterState(),
            gameSystem: this.gameService.currentGameSystem(),
            myPublicId: this.userStateService.publicId(),
            nameTags: this.tagsService.getNameTags(),
            chassisTags: this.tagsService.getChassisTags(),
            publicTags: this.publicTagsService.getAllPublicTags(),
            pendingForeignTags: this.pendingForeignTags(),
        });
    });

    /** Callback to show foreign tag import dialog - set by component layer */
    private showForeignTagDialogCallback: ((publicId: string, tagNames: string[]) => Promise<'ignore' | 'temporary' | 'subscribe'>) | null = null;

    /**
     * Set the callback for showing the foreign tag import dialog.
     * This must be called from the component layer to wire up UI integration.
     */
    setForeignTagDialogCallback(callback: (publicId: string, tagNames: string[]) => Promise<'ignore' | 'temporary' | 'subscribe'>): void {
        this.showForeignTagDialogCallback = callback;
    }

    /** Whether to automatically convert UI filter changes to semantic text */
    readonly autoConvertToSemantic = computed(() =>
        this.optionsService.options().automaticallyConvertFiltersToSemantic
    );

    /**
     * Flag to prevent feedback loops when programmatically updating search text.
     * Non-reactive to avoid triggering recomputation.
     */
    private isSyncingToText = false;

    /**
     * Parsed semantic query as AST (supports nested brackets and OR operators).
     * Primary parser for all semantic query processing.
     */
    private readonly semanticParsedAST = computed((): ParseResult => {
        return parseSemanticQueryAST(this.searchText(), this.gameService.currentGameSystem());
    });

    /**
     * Parse errors from the semantic query.
     * Used for validation display with error highlighting.
     */
    readonly parseErrors = computed((): ParseError[] => {
        return this.semanticParsedAST().errors;
    });

    /**
     * Whether the query is too complex to represent in flat UI filters.
     * Complex queries include: OR operators, nested brackets, etc.
     * When true, the filter dropdowns should be hidden in favor of the query.
     */
    readonly isComplexQuery = computed((): boolean => {
        return isComplexQuery(this.semanticParsedAST().ast);
    });

    /**
     * Effective text search - extracts the text portion from semantic query.
     * Used for relevance scoring and display, not for filtering (AST handles that).
     */
    readonly effectiveTextSearch = computed(() => {
        return this.semanticParsedAST().textSearch || '';
    });

    /**
     * Set of filter keys that currently have semantic representation in the search text.
     * Uses AST parser to properly handle brackets and boolean operators.
     * Used to determine which filters are "linked" (UI changes should update text).
     */
    readonly semanticFilterKeys = computed((): Set<string> => {
        return getSemanticFilterKeysFromParsed(this.semanticParsedAST());
    });

    private getSemanticStateDependencies(): UnitSearchSemanticStateDependencies {
        return {
            getDropdownOptionUniverse: (filterKey: string) => this.dataService.getDropdownOptionUniverse(filterKey).map(option => option.name),
            getExternalDropdownValues: (filterKey: string) => {
                if (filterKey === 'era') {
                    return this.dataService.getEras().map(era => era.name);
                }
                if (filterKey === 'faction') {
                    return this.dataService.getFactions().map(faction => faction.name);
                }
                if (filterKey === 'availabilityRarity') {
                    return [...MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS];
                }
                if (filterKey === 'availabilityFrom') {
                    return [...MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS];
                }
                if (filterKey === 'forcePack') {
                    return getForcePacks().map(pack => pack.name);
                }
                return [];
            },
            getDisplayName: (filterKey: string, value: string) => {
                const conf = getAdvancedFilterConfigByKey(filterKey);
                const fn = conf?.displayNameFn ?? this.displayNameFns[filterKey];
                return fn?.(value);
            },
        };
    }

    private getDropdownValuesDependencies(): UnitSearchDropdownValuesDependencies {
        return {
            getDropdownOptionUniverse: (filterKey: string) => this.getIndexedUniverseNames(filterKey),
            getExternalDropdownValues: (filterKey: string) => {
                if (filterKey === 'era') {
                    return this.dataService.getEras().map(era => era.name);
                }
                if (filterKey === 'faction') {
                    return this.dataService.getFactions().map(faction => faction.name);
                }
                if (filterKey === 'availabilityRarity') {
                    return [...MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS];
                }
                if (filterKey === 'availabilityFrom') {
                    return [...MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS];
                }
                if (filterKey === 'forcePack') {
                    return getForcePacks().map(pack => pack.name);
                }
                return [];
            },
            units: this.units,
            getProperty,
        };
    }

    private getApplicableFilterState(state: FilterState): FilterState {
        const availabilitySource = this.optionsService.options().availabilitySource;
        const applicableState: FilterState = {};

        for (const [key, value] of Object.entries(state)) {
            const conf = getAdvancedFilterConfigByKey(key);
            if (conf && !isFilterAvailableForAvailabilitySource(conf, availabilitySource)) {
                continue;
            }

            applicableState[key] = value;
        }

        return applicableState;
    }

    private shouldForceMegaMekSyncSearch(): boolean {
        const availabilitySource = this.optionsService.options().availabilitySource;

        if (this.isComplexQuery()) {
            const hasComplexWorkerExcludedSemanticFilters = this.semanticParsedAST().tokens.some((token) => (
                MEGAMEK_WORKER_AVAILABILITY_SEMANTIC_FIELDS.has(token.field)
                || (
                    availabilitySource === 'megamek'
                    && MEGAMEK_WORKER_SEMANTIC_FIELDS.has(token.field)
                )
            ));
            if (hasComplexWorkerExcludedSemanticFilters) {
                return true;
            }
        }

        if (availabilitySource !== 'megamek') {
            return false;
        }

        const workerFilterState = this.getWorkerFilterState(this.getApplicableFilterState(this.effectiveFilterState()));
        return this.effectiveTextSearch().trim().length === 0 && Object.keys(workerFilterState).length === 0;
    }

    private shouldStripFilterFromWorker(key: string): boolean {
        return MEGAMEK_WORKER_AVAILABILITY_FILTER_KEYS.has(key)
            || (
                this.optionsService.options().availabilitySource === 'megamek'
                && MEGAMEK_WORKER_CONTEXT_FILTER_KEYS.has(key)
            );
    }

    private getWorkerFilterState(state: FilterState): FilterState {
        const workerState: FilterState = { ...state };
        for (const key of Object.keys(workerState)) {
            if (this.shouldStripFilterFromWorker(key)) {
                delete workerState[key];
            }
        }

        return workerState;
    }

    private getWorkerPostFilterState(state: FilterState): FilterState {
        const postFilterState: FilterState = {};
        for (const [key, filterState] of Object.entries(state)) {
            if (filterState && this.shouldStripFilterFromWorker(key)) {
                postFilterState[key] = filterState;
            }
        }

        const needsMulAvailabilityScope = !this.unitAvailabilitySource.useMegaMekAvailability()
            && (
                postFilterState['availabilityFrom']?.interactedWith
                || postFilterState['availabilityRarity']?.interactedWith
            );
        if (needsMulAvailabilityScope) {
            if (state['era']?.interactedWith) {
                postFilterState['era'] = state['era'];
            }
            if (state['faction']?.interactedWith) {
                postFilterState['faction'] = state['faction'];
            }
        }

        return postFilterState;
    }

    private getWorkerSortKey(): string {
        return isMegaMekRaritySortKey(this.selectedSort())
            ? ''
            : this.selectedSort();
    }

    private getSelectedRegularDropdownNames(filterStateEntry?: FilterState[string]): string[] {
        if (!filterStateEntry?.interactedWith) {
            return [];
        }

        return getSelectedPositiveDropdownNames(filterStateEntry.value);
    }

    private getPositiveFactionNames(filterStateEntry?: FilterState[string]): string[] {
        if (!filterStateEntry?.interactedWith) {
            return [];
        }

        const allFactionNames = this.dataService.getFactions().map(faction => faction.name);
        return getPositiveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterStateEntry.value),
            allFactionNames,
            filterStateEntry.wildcardPatterns,
        );
    }

    private resolveEraNamesFromFilter(filterStateEntry?: FilterState[string]): ResolvedDropdownNames {
        if (!filterStateEntry?.interactedWith) {
            return { or: [], and: [], not: [] };
        }

        return resolveDropdownNamesFromFilter(
            normalizeMultiStateSelection(filterStateEntry.value),
            this.dataService.getEras().map((era) => era.name),
            filterStateEntry.wildcardPatterns,
        );
    }

    private hasResolvedDropdownNames(resolved: ResolvedDropdownNames): boolean {
        return hasResolvedDropdownNames(resolved);
    }

    private getAvailabilitySelectionScopeParts(state: FilterState): AvailabilitySelectionScopeParts {
        const cached = this.availabilitySelectionScopePartsCache.get(state);
        if (cached) {
            return cached;
        }

        const parts: AvailabilitySelectionScopeParts = {
            eraNames: this.getSelectedRegularDropdownNames(state['era']),
            factionNames: this.getPositiveFactionNames(state['faction']),
            availabilityFromNames: this.getSelectedRegularDropdownNames(state['availabilityFrom']),
            availabilityRarityNames: this.getSelectedRegularDropdownNames(state['availabilityRarity']) as MegaMekAvailabilityRarity[],
        };
        this.availabilitySelectionScopePartsCache.set(state, parts);
        return parts;
    }

    private buildAvailabilityFilterContext(scope?: AvailabilityFilterScope): MegaMekAvailabilityFilterContext | null {
        if (!scope) {
            return {
                bridgeThroughMulMembership: !this.unitAvailabilitySource.useMegaMekAvailability(),
            };
        }

        const context: MegaMekAvailabilityFilterContext = {
            bridgeThroughMulMembership: scope.bridgeThroughMulMembership
                ?? !this.unitAvailabilitySource.useMegaMekAvailability(),
        };

        if (scope.eraNames !== undefined) {
            const eraIds = new Set(
                scope.eraNames
                    .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                    .filter((eraId): eraId is number => eraId !== undefined),
            );
            if (eraIds.size === 0) {
                return null;
            }
            context.eraIds = eraIds;
        }

        if (scope.factionNames !== undefined) {
            const factionIds = new Set(
                scope.factionNames
                    .map((factionName) => this.dataService.getFactionByName(factionName)?.id)
                    .filter((factionId): factionId is number => factionId !== undefined),
            );
            if (factionIds.size === 0) {
                return null;
            }
            context.factionIds = factionIds;
        }

        if (scope.availabilityFromNames !== undefined) {
            const availabilityFrom = new Set(
                scope.availabilityFromNames
                    .filter((value): value is MegaMekAvailabilityFrom => (
                        value === 'Production' || value === 'Salvage'
                    )),
            );
            if (availabilityFrom.size > 0) {
                context.availabilityFrom = availabilityFrom;
            }
        }

        return context;
    }

    private buildMegaMekAvailabilityScope(
        state: FilterState,
        options: { includeAvailabilityFrom?: boolean } = {},
    ): AvailabilityFilterScope | undefined {
        const { eraNames, factionNames, availabilityFromNames } = this.getAvailabilitySelectionScopeParts(state);
        const scope: AvailabilityFilterScope = this.unitAvailabilitySource.useMegaMekAvailability()
            ? {}
            : { bridgeThroughMulMembership: true };
        const includeAvailabilityFrom = options.includeAvailabilityFrom ?? true;

        if (eraNames.length > 0) {
            scope.eraNames = eraNames;
        }
        if (factionNames.length > 0) {
            scope.factionNames = factionNames;
        }
        if (includeAvailabilityFrom && availabilityFromNames.length > 0) {
            scope.availabilityFromNames = availabilityFromNames;
        }

        return Object.keys(scope).length > 0 ? scope : undefined;
    }

    private buildMegaMekRaritySortScope(state: FilterState): AvailabilityFilterScope | undefined {
        const scope = this.buildMegaMekAvailabilityScope(state, { includeAvailabilityFrom: false });
        const selectedSort = this.selectedSort();
        if (!isMegaMekRaritySortKey(selectedSort)) {
            return scope;
        }

        return {
            ...(scope ?? {}),
            availabilityFromNames: [...getMegaMekRaritySortAvailabilitySources(selectedSort)],
        };
    }

    private readonly megaMekAvailabilityDisplayScope = computed(() => {
        return this.buildMegaMekAvailabilityScope(this.getApplicableFilterState(this.effectiveFilterState()), {
            includeAvailabilityFrom: false,
        });
    });

    private readonly megaMekAvailabilityDisplayContext = computed<MegaMekAvailabilityFilterContext | null>(() => {
        return this.buildAvailabilityFilterContext(this.megaMekAvailabilityDisplayScope());
    });

    private readonly megaMekRaritySortScope = computed(() => {
        return this.buildMegaMekRaritySortScope(this.getApplicableFilterState(this.effectiveFilterState()));
    });

    private readonly megaMekRaritySortContext = computed<MegaMekAvailabilityFilterContext | null>(() => {
        return this.buildAvailabilityFilterContext(this.megaMekRaritySortScope());
    });

    private getMegaMekRaritySortScoreFromContext(unit: Unit, context: MegaMekAvailabilityFilterContext | null): number {
        if (context === null) {
            return 0;
        }

        return this.unitAvailabilitySource.getMegaMekAvailabilityScore(unit, context);
    }

    public getMegaMekRaritySortScore(unit: Unit, scope?: AvailabilityFilterScope): number {
        if (scope === undefined) {
            return this.getMegaMekRaritySortScoreFromContext(unit, this.megaMekRaritySortContext());
        }

        return this.getMegaMekRaritySortScoreFromContext(unit, this.buildAvailabilityFilterContext(scope));
    }

    public getMegaMekAvailabilitySources(unit: Unit, scope?: AvailabilityFilterScope): readonly MegaMekAvailabilityFrom[] {
        const context = scope === undefined
            ? this.megaMekAvailabilityDisplayContext()
            : this.buildAvailabilityFilterContext(scope);
        if (context === null) {
            return [];
        }

        return this.getScopedMegaMekAvailabilitySources(scope).filter((source) => {
            return this.unitAvailabilitySource.unitMatchesAvailabilityFrom(unit, source, context);
        });
    }

    public getMegaMekAvailabilityBadges(unit: Unit, scope?: AvailabilityFilterScope): readonly MegaMekUnitAvailabilityDetail[] {
        const selectionScope = scope === undefined
            ? this.megaMekAvailabilityDisplayScope()
            : scope;
        const baseScope = selectionScope === undefined
            ? undefined
            : {
                ...(selectionScope.eraNames !== undefined ? { eraNames: selectionScope.eraNames } : {}),
                ...(selectionScope.factionNames !== undefined ? { factionNames: selectionScope.factionNames } : {}),
                ...(selectionScope.bridgeThroughMulMembership ? { bridgeThroughMulMembership: true } : {}),
            };
        const baseContext = this.buildAvailabilityFilterContext(baseScope);
        if (baseContext === null) {
            return [];
        }

        const availabilitySelectionScopeParts = this.getAvailabilitySelectionScopeParts(
            this.getApplicableFilterState(this.effectiveFilterState()),
        );
        const selectedAvailabilityFromNames = selectionScope?.availabilityFromNames
            ?? availabilitySelectionScopeParts.availabilityFromNames;
        const selectedAvailabilityRarityNames = (selectionScope?.availabilityRarityNames
            ?? availabilitySelectionScopeParts.availabilityRarityNames) as MegaMekAvailabilityRarity[];
        const selectedPositiveSources = selectedAvailabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Production' || value === 'Salvage'
        ));
        const selectedPositiveRarities = new Set(
            selectedAvailabilityRarityNames.filter((rarity): rarity is Exclude<MegaMekAvailabilityRarity, typeof MEGAMEK_AVAILABILITY_UNKNOWN | typeof MEGAMEK_AVAILABILITY_NOT_AVAILABLE> => (
                rarity !== MEGAMEK_AVAILABILITY_UNKNOWN && rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE
            )),
        );
        const includesUnknownSelection = selectedAvailabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN)
            || selectedAvailabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const badges: MegaMekUnitAvailabilityDetail[] = [];
        const activeSources = selectedPositiveSources.length > 0
            ? selectedPositiveSources
            : selectedAvailabilityFromNames.length === 0
                ? MEGAMEK_AVAILABILITY_FROM_OPTIONS
                : [];

        for (const source of activeSources) {
            const score = this.getMegaMekRaritySortScore(unit, {
                ...(baseScope ?? {}),
                availabilityFromNames: [source],
            });
            if (score < 1) {
                continue;
            }

            const rarity = getMegaMekAvailabilityRarityForScore(score);
            if (rarity === MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
                continue;
            }

            if (selectedAvailabilityRarityNames.length > 0 && !selectedPositiveRarities.has(rarity)) {
                continue;
            }

            badges.push({
                source,
                score,
                rarity,
            });
        }

        if (
            this.unitAvailabilitySource.unitMatchesAvailabilityFrom(unit, MEGAMEK_AVAILABILITY_UNKNOWN, baseContext)
            && (includesUnknownSelection || badges.length === 0)
        ) {
            badges.unshift({
                source: MEGAMEK_AVAILABILITY_UNKNOWN,
                score: -1,
                rarity: MEGAMEK_AVAILABILITY_UNKNOWN,
            });
        }

        return badges;
    }

    private getScopedMegaMekAvailabilitySources(scope?: AvailabilityFilterScope): readonly MegaMekAvailabilityFrom[] {
        const selectedAvailabilityFromNames = scope?.availabilityFromNames
            ?? this.getAvailabilitySelectionScopeParts(this.getApplicableFilterState(this.effectiveFilterState())).availabilityFromNames;
        const selectedSources = selectedAvailabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Production' || value === 'Salvage'
        ));

        return selectedSources.length > 0
            ? selectedSources
            : MEGAMEK_AVAILABILITY_FROM_OPTIONS;
    }

    private unitMatchesAvailabilityFrom(unit: Unit, availabilityFromName: string, scope?: AvailabilityFilterScope): boolean {
        const context = this.buildAvailabilityFilterContext(scope);
        if (context === null) {
            return false;
        }

        return this.unitAvailabilitySource.unitMatchesAvailabilityFrom(unit, availabilityFromName, context);
    }

    private unitMatchesAvailabilityRarity(unit: Unit, rarityName: string, scope?: AvailabilityFilterScope): boolean {
        const context = this.buildAvailabilityFilterContext(scope);
        if (context === null) {
            return false;
        }

        return this.unitAvailabilitySource.unitMatchesAvailabilityRarity(unit, rarityName, context);
    }

    private buildMegaMekAvailabilityDropdownOptions(
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        state: FilterState,
    ): { name: string; img?: string; displayName?: string; available: boolean }[] | null {
        const useMegaMekAvailability = this.unitAvailabilitySource.useMegaMekAvailability();
        const { availabilityFromNames, availabilityRarityNames } = this.getAvailabilitySelectionScopeParts(state);
        const useScopedAvailabilityDropdowns = useMegaMekAvailability
            || availabilityFromNames.length > 0
            || availabilityRarityNames.length > 0;

        if (conf.key === 'era') {
            return useScopedAvailabilityDropdowns
                ? this.buildMegaMekEraDropdownOptions(conf, contextUnits, state)
                : this.buildExternalDropdownOptions(conf, contextUnits, state);
        }

        if (conf.key === 'faction') {
            return useScopedAvailabilityDropdowns
                ? this.buildMegaMekFactionDropdownOptions(conf, contextUnits, state)
                : this.buildExternalDropdownOptions(conf, contextUnits, state);
        }

        if (conf.key === 'availabilityRarity' || conf.key === 'availabilityFrom') {
            return this.buildInferredAvailabilityDropdownOptions(conf, contextUnits, state);
        }

        return null;
    }

    private buildExternalDropdownCandidateState(
        currentFilterState: FilterState[string] | undefined,
        optionName: string,
    ): FilterState[string] {
        const currentSelection = currentFilterState?.interactedWith
            ? normalizeMultiStateSelection(currentFilterState.value)
            : {};
        const hasAndSelections = Object.values(currentSelection).some((selection) => selection.state === 'and');

        if (!hasAndSelections) {
            return {
                value: {
                    [optionName]: {
                        name: optionName,
                        state: 'or',
                        count: 1,
                    },
                },
                interactedWith: true,
            };
        }

        const nextSelection: MultiStateSelection = { ...currentSelection };
        if (!nextSelection[optionName]) {
            nextSelection[optionName] = {
                name: optionName,
                state: 'and',
                count: 1,
            };
        }

        return {
            ...currentFilterState,
            value: nextSelection,
            interactedWith: true,
        };
    }

    private buildExternalDropdownOptions(
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        state: FilterState,
    ): { name: string; img?: string; displayName?: string; available: boolean }[] | null {
        if (conf.key !== 'era' && conf.key !== 'faction') {
            return null;
        }

        const contextUnitIds = new Set(
            contextUnits.map((unit) => this.unitAvailabilitySource.getUnitAvailabilityKey(unit)),
        );
        const currentFilterState = state[conf.key];

        const options = this.dataService.getDropdownOptionUniverse(conf.key).map((option) => {
            const candidateFilterState = this.buildExternalDropdownCandidateState(currentFilterState, option.name);
            const candidateUnitIds = conf.key === 'era'
                ? this.getUnitIdsForExternalFilters(candidateFilterState, state['faction'])
                : this.getUnitIdsForExternalFilters(state['era'], candidateFilterState);

            return {
                name: option.name,
                ...(option.img ? { img: option.img } : {}),
                available: candidateUnitIds !== null && setHasAny(contextUnitIds, candidateUnitIds),
            };
        });

        return sortDropdownOptionObjects(options, conf.sortOptions);
    }

    private buildInferredAvailabilityDropdownOptions(
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        state: FilterState,
    ): { name: string; img?: string; displayName?: string; available: boolean }[] {
        const { eraNames, factionNames, availabilityFromNames, availabilityRarityNames } = this.getAvailabilitySelectionScopeParts(state);
        const scope: AvailabilityFilterScope = {
            ...(eraNames.length > 0 ? { eraNames } : {}),
            ...(factionNames.length > 0 ? { factionNames } : {}),
            ...(conf.key !== 'availabilityFrom' && availabilityFromNames.length > 0
                ? { availabilityFromNames }
                : {}),
            ...(!this.unitAvailabilitySource.useMegaMekAvailability()
                ? { bridgeThroughMulMembership: true }
                : {}),
        };

        const context = this.buildAvailabilityFilterContext(scope);
        if (context === null) {
            return conf.key === 'availabilityFrom'
                ? MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS.map((availabilityFromName) => ({ name: availabilityFromName, available: false }))
                : MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS.map((rarityName) => ({ name: rarityName, available: false }));
        }

        const contextUnitIds = new Set(contextUnits.map((unit) => unit.name));

        if (conf.key === 'availabilityFrom') {
            return MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS.map((availabilityFromName) => ({
                name: availabilityFromName,
                available: setHasAny(
                    contextUnitIds,
                    this.getMegaMekAvailabilityCandidateUnitIds(
                        scope,
                        [availabilityFromName],
                        availabilityRarityNames,
                    ),
                ),
            }));
        }

        return MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS.map((rarityName) => ({
            name: rarityName,
            available: setHasAny(
                contextUnitIds,
                this.getMegaMekAvailabilityCandidateUnitIds(
                    scope,
                    availabilityFromNames,
                    [rarityName],
                ),
            ),
        }));
    }

    private buildMegaMekEraDropdownOptions(
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        state: FilterState,
    ): { name: string; img?: string; displayName?: string; available: boolean }[] {
        const { factionNames } = this.getAvailabilitySelectionScopeParts(state);
        const extinctFactionName = this.dataService.getFactionById(MULFACTION_EXTINCT)?.name;
        if (!extinctFactionName || !factionNames.includes(extinctFactionName)) {
            const optimizedAvailableEraIds = this.collectFastMegaMekAvailableOptionIds(contextUnits, state, 'era');
            if (optimizedAvailableEraIds) {
                const options = this.dataService.getDropdownOptionUniverse(conf.key).map((option) => ({
                    name: option.name,
                    ...(option.img ? { img: option.img } : {}),
                    available: optimizedAvailableEraIds.has(this.dataService.getEraByName(option.name)?.id ?? -1),
                }));

                return sortDropdownOptionObjects(options, conf.sortOptions);
            }
        }
        const { availabilityFromNames } = this.getAvailabilitySelectionScopeParts(state);
        const contextUnitIds = new Set(contextUnits.map((unit) => unit.name));

        const options = this.dataService.getDropdownOptionUniverse(conf.key).map((option) => {
            const candidateScope: AvailabilityFilterScope = {
                eraNames: [option.name],
                ...(factionNames.length > 0 ? { factionNames } : {}),
                ...(availabilityFromNames.length > 0 ? { availabilityFromNames } : {}),
            };

            return {
                name: option.name,
                ...(option.img ? { img: option.img } : {}),
                available: setHasAny(contextUnitIds, this.getMegaMekOptionScopeUnitIds(candidateScope, state)),
            };
        });

        return sortDropdownOptionObjects(options, conf.sortOptions);
    }

    private buildMegaMekFactionDropdownOptions(
        conf: AdvFilterConfig,
        contextUnits: Unit[],
        state: FilterState,
    ): { name: string; img?: string; displayName?: string; available: boolean }[] {
        const optimizedAvailableFactionIds = this.collectFastMegaMekAvailableOptionIds(contextUnits, state, 'faction');
        if (optimizedAvailableFactionIds) {
            const { eraNames, availabilityFromNames } = this.getAvailabilitySelectionScopeParts(state);
            const contextUnitIds = new Set(contextUnits.map((unit) => unit.name));
            const extinctFactionName = this.dataService.getFactionById(MULFACTION_EXTINCT)?.name;
            const options = this.dataService.getDropdownOptionUniverse(conf.key).map((option) => ({
                name: option.name,
                ...(option.img ? { img: option.img } : {}),
                available: extinctFactionName && option.name === extinctFactionName
                    ? setHasAny(contextUnitIds, this.getMegaMekOptionScopeUnitIds({
                        ...(eraNames.length > 0 ? { eraNames } : {}),
                        factionNames: [option.name],
                        ...(availabilityFromNames.length > 0 ? { availabilityFromNames } : {}),
                    }, state))
                    : optimizedAvailableFactionIds.has(this.dataService.getFactionByName(option.name)?.id ?? -1),
            }));

            return sortDropdownOptionObjects(options, conf.sortOptions);
        }

        const { eraNames, availabilityFromNames } = this.getAvailabilitySelectionScopeParts(state);
        const contextUnitIds = new Set(contextUnits.map((unit) => unit.name));

        const options = this.dataService.getDropdownOptionUniverse(conf.key).map((option) => {
            const candidateScope: AvailabilityFilterScope = {
                ...(eraNames.length > 0 ? { eraNames } : {}),
                factionNames: [option.name],
                ...(availabilityFromNames.length > 0 ? { availabilityFromNames } : {}),
            };

            return {
                name: option.name,
                ...(option.img ? { img: option.img } : {}),
                available: setHasAny(contextUnitIds, this.getMegaMekOptionScopeUnitIds(candidateScope, state)),
            };
        });

        return sortDropdownOptionObjects(options, conf.sortOptions);
    }

    private getMegaMekOptionScopeUnitIds(
        scope: AvailabilityFilterScope,
        state: FilterState,
    ): ReadonlySet<string> {
        const { availabilityFromNames, availabilityRarityNames } = this.getAvailabilitySelectionScopeParts(state);
        return this.getMegaMekAvailabilityCandidateUnitIds(
            scope,
            scope.availabilityFromNames ?? availabilityFromNames,
            availabilityRarityNames,
        );
    }

    private getMegaMekAvailabilityCandidateUnitIds(
        scope: AvailabilityFilterScope,
        availabilityFromNames: readonly string[],
        availabilityRarityNames: readonly MegaMekAvailabilityRarity[],
    ): ReadonlySet<string> {
        const baseScope: AvailabilityFilterScope = {
            ...(scope.eraNames !== undefined ? { eraNames: scope.eraNames } : {}),
            ...(scope.factionNames !== undefined ? { factionNames: scope.factionNames } : {}),
            ...(scope.bridgeThroughMulMembership ? { bridgeThroughMulMembership: true } : {}),
        };
        const baseContext = this.buildAvailabilityFilterContext(baseScope);
        if (baseContext === null) {
            return new Set<string>();
        }

        const selectedPositiveSources = availabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Production' || value === 'Salvage'
        ));
        const includesUnknownSource = availabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const hasSourceFilter = availabilityFromNames.length > 0;
        const hasRarityFilter = availabilityRarityNames.length > 0;

        if (!hasSourceFilter && !hasRarityFilter) {
            return this.unitAvailabilitySource.getMegaMekMembershipUnitIds(baseContext);
        }

        const unitIds = new Set<string>();

        if (!hasRarityFilter) {
            if (includesUnknownSource) {
                for (const unitId of this.unitAvailabilitySource.getMegaMekUnknownUnitIds(baseContext)) {
                    unitIds.add(unitId);
                }
            }

            if (selectedPositiveSources.length > 0) {
                const sourceContext = {
                    ...baseContext,
                    availabilityFrom: new Set(selectedPositiveSources),
                };
                for (const unitId of this.unitAvailabilitySource.getMegaMekAvailabilityUnitIds(sourceContext)) {
                    unitIds.add(unitId);
                }
            }

            return hasSourceFilter
                ? unitIds
                : this.unitAvailabilitySource.getMegaMekMembershipUnitIds(baseContext);
        }

        if (!hasSourceFilter) {
            for (const rarityName of availabilityRarityNames) {
                for (const unitId of this.unitAvailabilitySource.getMegaMekRarityUnitIds(rarityName, baseContext)) {
                    unitIds.add(unitId);
                }
            }

            return unitIds;
        }

        if (includesUnknownSource && availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN)) {
            for (const unitId of this.unitAvailabilitySource.getMegaMekUnknownUnitIds(baseContext)) {
                unitIds.add(unitId);
            }
        }

        if (selectedPositiveSources.length > 0) {
            const sourceContext = {
                ...baseContext,
                availabilityFrom: new Set(selectedPositiveSources),
            };
            for (const rarityName of availabilityRarityNames) {
                if (rarityName === MEGAMEK_AVAILABILITY_UNKNOWN) {
                    continue;
                }

                for (const unitId of this.unitAvailabilitySource.getMegaMekRarityUnitIds(rarityName, sourceContext)) {
                    unitIds.add(unitId);
                }
            }
        }

        return unitIds;
    }

    private collectFastMegaMekAvailableOptionIds(
        contextUnits: readonly Unit[],
        state: FilterState,
        target: 'era' | 'faction',
    ): ReadonlySet<number> | null {
        const { eraNames, factionNames, availabilityFromNames, availabilityRarityNames } = this.getAvailabilitySelectionScopeParts(state);
        const includesUnknownAvailabilityFrom = availabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const includesUnknownRarity = availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const includesNotAvailable = availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_NOT_AVAILABLE);
        if (includesNotAvailable) {
            return null;
        }

        const selectedSources = availabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Production' || value === 'Salvage'
        ));
        const useMegaMekAvailability = this.unitAvailabilitySource.useMegaMekAvailability();
        const selectedEraIds = target === 'faction'
            ? this.resolveAvailabilityScopeIds(eraNames, 'era')
            : undefined;
        const selectedFactionIds = target === 'era'
            ? this.resolveAvailabilityScopeIds(factionNames, 'faction')
            : undefined;

        const pureUnknownAvailabilityFrom = includesUnknownAvailabilityFrom
            && availabilityFromNames.length === 1
            && availabilityRarityNames.length === 0;
        const pureUnknownRarity = includesUnknownRarity
            && availabilityRarityNames.length === 1
            && availabilityFromNames.length === 0;
        if (!useMegaMekAvailability && (pureUnknownAvailabilityFrom || pureUnknownRarity)) {
            return this.collectFastMulUnknownOptionIds(contextUnits, target, selectedEraIds, selectedFactionIds);
        }

        if (includesUnknownAvailabilityFrom || includesUnknownRarity) {
            return null;
        }

        const activeSources = selectedSources.length > 0
            ? selectedSources
            : [...MEGAMEK_AVAILABILITY_FROM_OPTIONS];
        const selectedRarityNames = availabilityRarityNames as Array<Exclude<MegaMekAvailabilityRarity, typeof MEGAMEK_AVAILABILITY_UNKNOWN | typeof MEGAMEK_AVAILABILITY_NOT_AVAILABLE>>;
        const selectedRarities = selectedRarityNames.length > 0
            ? new Set(selectedRarityNames)
            : null;

        if (!useMegaMekAvailability && selectedSources.length === 0 && !selectedRarities) {
            return this.collectMulMembershipOptionIds(contextUnits, target, selectedEraIds, selectedFactionIds);
        }

        const availableIds = new Set<number>();

        for (const unit of contextUnits) {
            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            const maxScoresByOptionId = new Map<number, Record<MegaMekAvailabilityFrom, number>>();

            for (const eraIdText in availabilityRecord.e) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId) || (selectedEraIds && !selectedEraIds.has(eraId))) {
                    continue;
                }

                const eraAvailability = availabilityRecord.e[eraIdText];
                for (const factionIdText in eraAvailability) {
                    const factionId = Number(factionIdText);
                    if (Number.isNaN(factionId) || (selectedFactionIds && !selectedFactionIds.has(factionId))) {
                        continue;
                    }

                    if (!useMegaMekAvailability && !this.unitBelongsToMulFactionInEra(unit, factionId, eraId)) {
                        continue;
                    }

                    const candidateId = target === 'faction' ? factionId : eraId;
                    const value = eraAvailability[factionIdText];
                    let maxScores = maxScoresByOptionId.get(candidateId);
                    if (!maxScores) {
                        maxScores = {
                            Production: 0,
                            Salvage: 0,
                        };
                        maxScoresByOptionId.set(candidateId, maxScores);
                    }

                    for (const source of activeSources) {
                        const score = getMegaMekAvailabilityValueForSource(value, source);
                        if (score > maxScores[source]) {
                            maxScores[source] = score;
                        }
                    }
                }
            }

            if (!selectedRarities) {
                for (const [optionId, maxScores] of maxScoresByOptionId.entries()) {
                    if (activeSources.some((source) => maxScores[source] > 0)) {
                        availableIds.add(optionId);
                    }
                }
                continue;
            }

            for (const [optionId, maxScores] of maxScoresByOptionId.entries()) {
                const matchesSelectedRarity = activeSources.some((source) => {
                    const maxScore = maxScores[source];
                    if (maxScore <= 0) {
                        return false;
                    }

                    const rarity = getMegaMekAvailabilityRarityForScore(maxScore);
                    return rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE && selectedRarities.has(rarity);
                });

                if (matchesSelectedRarity) {
                    availableIds.add(optionId);
                }
            }
        }

        return availableIds;
    }

    private collectFastMulUnknownOptionIds(
        contextUnits: readonly Unit[],
        target: 'era' | 'faction',
        selectedEraIds?: ReadonlySet<number>,
        selectedFactionIds?: ReadonlySet<number>,
    ): ReadonlySet<number> {
        const availableIds = new Set<number>();
        const allFactions = this.dataService.getFactions();

        for (const unit of contextUnits) {
            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            const scopedEntryKeys = new Set<string>();

            if (availabilityRecord) {
                for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                    const eraId = Number(eraIdText);
                    if (Number.isNaN(eraId)) {
                        continue;
                    }

                    for (const factionIdText of Object.keys(eraAvailability)) {
                        const factionId = Number(factionIdText);
                        if (!Number.isNaN(factionId)) {
                            scopedEntryKeys.add(`${eraId}:${factionId}`);
                        }
                    }
                }
            }

            for (const faction of allFactions) {
                if (faction.id === MULFACTION_EXTINCT) {
                    continue;
                }

                if (selectedFactionIds && !selectedFactionIds.has(faction.id)) {
                    continue;
                }

                for (const [eraIdText, membership] of Object.entries(faction.eras) as Array<[string, Set<number> | number[]]>) {
                    const eraId = Number(eraIdText);
                    if (Number.isNaN(eraId) || (selectedEraIds && !selectedEraIds.has(eraId))) {
                        continue;
                    }

                    if (!this.membershipContainsUnitId(membership, unit.id)) {
                        continue;
                    }

                    if (scopedEntryKeys.has(`${eraId}:${faction.id}`)) {
                        continue;
                    }

                    availableIds.add(target === 'era' ? eraId : faction.id);
                    if (target === 'faction') {
                        break;
                    }
                }
            }
        }

        return availableIds;
    }

    private resolveAvailabilityScopeIds(
        names: readonly string[],
        kind: 'era' | 'faction',
    ): ReadonlySet<number> | undefined {
        if (names.length === 0) {
            return undefined;
        }

        const ids = new Set(
            names
                .map((name) => kind === 'era'
                    ? this.dataService.getEraByName(name)?.id
                    : this.dataService.getFactionByName(name)?.id)
                .filter((id): id is number => id !== undefined),
        );

        return ids.size > 0 ? ids : new Set<number>();
    }

    private collectMulMembershipOptionIds(
        contextUnits: readonly Unit[],
        target: 'era' | 'faction',
        selectedEraIds?: ReadonlySet<number>,
        selectedFactionIds?: ReadonlySet<number>,
    ): ReadonlySet<number> {
        const availableIds = new Set<number>();
        const allFactions = this.dataService.getFactions();

        for (const unit of contextUnits) {
            if (target === 'faction') {
                for (const faction of allFactions) {
                    if (selectedEraIds) {
                        for (const eraId of selectedEraIds) {
                            if (this.unitBelongsToMulFactionInEra(unit, faction.id, eraId)) {
                                availableIds.add(faction.id);
                            }
                        }
                        continue;
                    }

                    for (const [eraIdText, membership] of Object.entries(faction.eras) as Array<[string, Set<number> | number[]]>) {
                        const eraId = Number(eraIdText);
                        if (!Number.isNaN(eraId) && this.membershipContainsUnitId(membership, unit.id)) {
                            availableIds.add(faction.id);
                            break;
                        }
                    }
                }

                continue;
            }

            const factions = selectedFactionIds
                ? [...selectedFactionIds].map((factionId) => this.dataService.getFactionById(factionId)).filter((faction): faction is NonNullable<typeof faction> => !!faction)
                : allFactions;

            for (const faction of factions) {
                for (const [eraIdText, membership] of Object.entries(faction.eras) as Array<[string, Set<number> | number[]]>) {
                    const eraId = Number(eraIdText);
                    if (!Number.isNaN(eraId) && this.membershipContainsUnitId(membership, unit.id)) {
                        availableIds.add(eraId);
                    }
                }
            }
        }

        return availableIds;
    }

    private unitBelongsToMulFactionInEra(unit: Pick<Unit, 'id'>, factionId: number, eraId: number): boolean {
        return this.membershipContainsUnitId(this.dataService.getFactionById(factionId)?.eras[eraId] as Set<number> | number[] | undefined, unit.id);
    }

    private membershipContainsUnitId(
        membership: Set<number> | number[] | undefined,
        unitId: number,
    ): boolean {
        if (!membership) {
            return false;
        }

        return membership instanceof Set
            ? membership.has(unitId)
            : membership.includes(unitId);
    }

    public setSearchText(rawText: string): string {
        const next = buildPromotedSearchText({
            rawText,
            gameSystem: this.gameService.currentGameSystem(),
            manualState: this.filterState(),
            totalRanges: this.totalRangesCache,
            ...this.getSemanticStateDependencies(),
        });

        this.searchText.set(next.text);
        if (next.promotedKeys.length > 0) {
            this.filterState.update(current => {
                const updated = { ...current };
                for (const key of next.promotedKeys) {
                    delete updated[key];
                }
                return updated;
            });
        }

        return next.text;
    }

    /**
     * Semantic filter state derived from parsed tokens in the search text.
     * Uses AST parser to properly handle brackets and boolean operators.
     * This is ALWAYS computed - semantic text is the source of truth for filters it contains.
     */
    private readonly semanticFilterState = computed((): FilterState => {
        const parsed = this.semanticParsedAST();
        if (parsed.tokens.length === 0) return {};

        return canonicalizeSemanticFilterState(
            tokensToFilterState(
                getCommittedSemanticTokens(parsed.tokens),
                this.gameService.currentGameSystem(),
                this.totalRangesCache
            ),
            this.getSemanticStateDependencies(),
        );
    });

    /**
     * Effective filter state - combines manual filterState with semantic filters.
     * - For filters in semantic text: semantic state is used (it's the source of truth)
     * - For filters only in UI: filterState is used
     * - UI filterState for linked filters is kept in sync for display purposes
     */
    readonly effectiveFilterState = computed((): FilterState => {
        const manual = this.filterState();
        const semantic = this.semanticFilterState();
        const semanticKeys = this.semanticFilterKeys();

        // Start with manual filters that are NOT in semantic text
        const result: FilterState = {};

        for (const [key, state] of Object.entries(manual)) {
            if (!semanticKeys.has(key)) {
                // This filter is UI-only, use it as-is
                result[key] = state;
            }
        }

        // Add all semantic filters - they take precedence
        for (const [key, state] of Object.entries(semantic)) {
            result[key] = state;
        }

        return result;
    });

    private canUseSearchWorker(): boolean {
        return typeof this.searchWorkerFactory === 'function';
    }

    private disableWorkerSearch(message: string): void {
        if (!this.workerSearchEnabled()) {
            return;
        }

        this.workerSearchEnabled.set(false);
        this.searchWorkerClient?.dispose();
        this.searchWorkerClient = null;
        this.workerResultRevision.set(this.workerRequestRevision());
        this.logger.warn(`Unit search worker disabled, falling back to main-thread execution: ${message}`);
    }

    private getWorkerCorpusVersion(): string {
        return getUnitSearchWorkerCorpusVersion(this.dataService.searchCorpusVersion(), this.tagsVersion());
    }

    private getWorkerCorpusSnapshot(corpusVersion: string): UnitSearchWorkerCorpusSnapshot {
        const result = getCachedWorkerCorpusSnapshot(
            {
                version: this.cachedWorkerCorpusVersion,
                snapshot: this.cachedWorkerCorpusSnapshot,
            },
            corpusVersion,
            this.units,
            this.dataService.getSearchWorkerIndexSnapshot(),
            this.dataService.getSearchWorkerFactionEraSnapshot(),
        );

        this.cachedWorkerCorpusVersion = result.cache.version;
        this.cachedWorkerCorpusSnapshot = result.cache.snapshot;
        return result.snapshot;
    }

    private getUiOnlyFilterState(manualState: FilterState, semanticKeys: Set<string>): FilterState {
        const result: FilterState = {};

        for (const [key, state] of Object.entries(manualState)) {
            if (!semanticKeys.has(key) && state.interactedWith) {
                result[key] = state;
            }
        }

        return result;
    }

    private buildWorkerSearchRequest(corpusVersion: string): UnitSearchWorkerQueryRequest {
        const gameSystem = this.gameService.currentGameSystem();
        const workerFilterState = this.getWorkerFilterState(this.getApplicableFilterState(this.effectiveFilterState()));
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: workerFilterState,
            effectiveTextSearch: this.effectiveTextSearch(),
            gameSystem,
            totalRangesCache: this.totalRangesCache,
        });

        this.searchRequestRevision += 1;

        return buildUnitSearchWorkerRequest({
            revision: this.searchRequestRevision,
            corpusVersion,
            executionQuery,
            telemetryQuery: this.searchText().trim(),
            gameSystem,
            sortKey: this.getWorkerSortKey(),
            sortDirection: this.selectedSortDirection(),
            bvPvLimit: 0,
            forceTotalBvPv: 0,
            pilotGunnerySkill: this.pilotGunnerySkill(),
            pilotPilotingSkill: this.pilotPilotingSkill(),
        });
    }

    private applyRemainingBudgetLimit(units: readonly Unit[], telemetryStages?: SearchTelemetryStage[]): Unit[] {
        const budgetLimit = this.bvPvLimit();
        if (budgetLimit <= 0) {
            return units as Unit[];
        }

        const remainingBudget = budgetLimit - this.forceTotalBvPv();
        if (remainingBudget < 0) {
            return [];
        }

        const filterUnits = () => {
            const isAlphaStrike = this.gameService.currentGameSystem() === GameSystem.ALPHA_STRIKE;
            return units.filter((unit) => {
                const unitValue = isAlphaStrike ? this.getAdjustedPV(unit) : this.getAdjustedBV(unit);
                return unitValue <= remainingBudget;
            });
        };

        if (!telemetryStages) {
            return filterUnits();
        }

        return measureStage(
            telemetryStages,
            'budget-filter',
            units.length,
            filterUnits,
            (value) => value.length,
        );
    }

    private applyWorkerSearchResult(result: UnitSearchWorkerResultMessage): void {
        if (!this.workerSearchActive()) {
            return;
        }

        const hydratedResults = hydrateWorkerResultUnits(result, unitName => this.dataService.getUnitByName(unitName));
        const telemetryStages = [...result.stages];
        const stageCountBeforePostProcessing = telemetryStages.length;
        const postFilteredResults = this.applyWorkerPostFilters(hydratedResults, telemetryStages);
        const sortedResults = this.sortHydratedWorkerResults(postFilteredResults, telemetryStages);
        const cappedResults = this.applyRemainingBudgetLimit(sortedResults, telemetryStages);
        const addedTelemetryMs = telemetryStages
            .slice(stageCountBeforePostProcessing)
            .reduce((totalMs, stage) => totalMs + stage.durationMs, 0);

        this.uncappedWorkerFilteredUnitsState.set(sortedResults);
        this.workerResultRevision.set(result.revision);
        this.updateSearchTelemetry(buildWorkerSearchTelemetrySnapshot(result, {
            timestamp: Date.now(),
            gameSystem: this.gameService.currentGameSystem(),
            sortKey: this.selectedSort(),
            sortDirection: this.selectedSortDirection(),
            resultCount: cappedResults.length,
            stages: telemetryStages,
            totalMs: result.totalMs + addedTelemetryMs,
        }));
    }

    private applyWorkerPostFilters(units: Unit[], telemetryStages?: SearchTelemetryStage[]): Unit[] {
        const postFilterState = this.getWorkerPostFilterState(this.getApplicableFilterState(this.effectiveFilterState()));
        if (Object.keys(postFilterState).length === 0) {
            return units;
        }

        const applyPostFilters = () => applyFilterStateToUnits({
            units,
            state: postFilterState,
            dependencies: this.getUnitFilterKernelDependencies(),
        });

        if (!telemetryStages) {
            return applyPostFilters();
        }

        return measureStage(
            telemetryStages,
            'megamek-post-filter',
            units.length,
            applyPostFilters,
            (value) => value.length,
        );
    }

    private getPendingWorkerFallbackUnits(): Unit[] | null {
        if (this.isSearchSettled()) {
            return null;
        }

        const postFilterState = this.getWorkerPostFilterState(
            this.getApplicableFilterState(this.effectiveFilterState()),
        );
        if (Object.keys(postFilterState).length === 0) {
            return null;
        }

        return this.uncappedSyncSearch().execution.results;
    }

    private sortHydratedWorkerResults(units: Unit[], telemetryStages?: SearchTelemetryStage[]): Unit[] {
        if (!isMegaMekRaritySortKey(this.selectedSort())) {
            return units;
        }

        const context = this.megaMekRaritySortContext();
        if (context === null) {
            return units;
        }

        const scoreResolver = this.unitAvailabilitySource.getMegaMekAvailabilityScoreResolver(context);
        const scores = new Map<string, number>();
        for (const unit of units) {
            scores.set(unit.name, scoreResolver(unit));
        }

        const sortResults = () => {
            const sorted = [...units];
            sorted.sort((left, right) => {
                let comparison = (scores.get(left.name) ?? 0) - (scores.get(right.name) ?? 0);
                if (comparison === 0) {
                    comparison = compareUnitsByName(left, right);
                }

                return this.selectedSortDirection() === 'desc' ? -comparison : comparison;
            });

            return sorted;
        };

        if (!telemetryStages) {
            return sortResults();
        }

        return measureStage(
            telemetryStages,
            'megamek-post-sort',
            units.length,
            sortResults,
            (value) => value.length,
        );
    }

    private setupWorkerSearchExecution(): void {
        effect(() => {
            if (!this.workerSearchActive()) {
                return;
            }

            if (!this.isDataReady()) {
                this.uncappedWorkerFilteredUnitsState.set([]);
                return;
            }

            this.dataService.searchCorpusVersion();
            this.tagsVersion();
            if (
                this.optionsService.options().availabilitySource === 'megamek'
                || isMegaMekRaritySortKey(this.selectedSort())
            ) {
                this.dataService.megaMekAvailabilityVersion();
            }

            const corpusVersion = this.getWorkerCorpusVersion();
            const request = this.buildWorkerSearchRequest(corpusVersion);
            const snapshot = this.getWorkerCorpusSnapshot(corpusVersion);

            untracked(() => {
                try {
                    this.workerRequestRevision.set(request.revision);
                    this.searchWorkerClient?.submit(snapshot, request);
                } catch (error) {
                    this.disableWorkerSearch(error instanceof Error ? error.message : 'Search worker submission failed');
                }
            });
        });
    }

    constructor() {
        // Register as a URL state consumer - must call markConsumerReady when done reading URL
        this.urlStateService.registerConsumer('unit-search-filters');

        if (this.workerSearchEnabled()) {
            this.logger.info('Unit search worker startup: enabled');
            this.searchWorkerClient = new UnitSearchWorkerClient({
                createWorker: () => this.searchWorkerFactory!(),
                onResult: result => this.applyWorkerSearchResult(result),
                onError: message => this.disableWorkerSearch(message),
                onReady: corpusVersion => this.logger.info(`Unit search worker ready (corpus ${corpusVersion})`),
            });
        } else {
            this.logger.info('Unit search worker startup: disabled');
        }
        inject(DestroyRef).onDestroy(() => {
            this.searchWorkerClient?.dispose();
        });

        effect(() => {
            this.dataService.searchCorpusVersion();
            if (this.isDataReady()) {
                this.invalidateCorpusCaches();
                this.calculateTotalRanges();
            }
        });
        effect(() => {
            this.dataService.tagsVersion(); // depend on tags version
            this.invalidateIndexedDropdownUniverseCache();
            this.invalidateTagsCache();
        });
        effect(() => {
            const gunnery = this.pilotGunnerySkill();
            const piloting = this.pilotPilotingSkill();

            if (this.isDataReady()) {
                if (this.advOptions()['bv']) {
                    this.recalculateBVRange();
                }
                if (this.advOptions()['as.PV']) {
                    this.recalculatePVRange();
                }
            }
        });
        // Reset sort when game system changes (sort options differ between CBT and AS)
        let previousGameSystem: GameSystem | null = null;
        effect(() => {
            const currentGameSystem = this.gameService.currentGameSystem();
            if (previousGameSystem !== null && previousGameSystem !== currentGameSystem) {
                // Game system changed, reset sort to relevance
                untracked(() => {
                    this.selectedSort.set('');
                });
            }
            previousGameSystem = currentGameSystem;
        });
        // When query becomes complex, convert UI-only filters to semantic text
        // This ensures filters aren't silently applied without being visible
        this.setupComplexQueryFilterConversion();
        this.setupWorkerSearchExecution();
        this.loadFiltersFromUrlOnStartup();
        this.updateUrlOnFiltersChange();
    }

    /**
     * When the query becomes complex (OR, nested brackets), UI filter controls are disabled.
     * This effect converts any UI-only filters (not in semantic text) to semantic form
     * and appends them to the search text, then clears the UI filter state.
     * This ensures all active filters are visible in the query.
     */
    private setupComplexQueryFilterConversion(): void {
        let wasComplex = false;

        effect(() => {
            const isComplex = this.isComplexQuery();
            const semanticKeys = this.semanticFilterKeys();
            const manualFilters = this.filterState();

            // Only act when transitioning TO complex mode
            if (isComplex && !wasComplex) {
                // Find UI-only filters that need conversion
                const uiOnlyFilters: FilterState = {};
                for (const [key, state] of Object.entries(manualFilters)) {
                    if (!semanticKeys.has(key) && state.interactedWith) {
                        uiOnlyFilters[key] = state;
                    }
                }

                if (Object.keys(uiOnlyFilters).length > 0) {
                    // Convert UI-only filters to semantic text
                    const uiFiltersText = filterStateToSemanticText(
                        uiOnlyFilters,
                        '', // No text search - we're just converting filters
                        this.gameService.currentGameSystem(),
                        this.totalRangesCache
                    );

                    if (uiFiltersText.trim()) {
                        // Append to current search text (wrapped in parens for clarity)
                        const currentText = this.searchText().trim();
                        const newText = currentText
                            ? `${currentText} (${uiFiltersText.trim()})`
                            : uiFiltersText.trim();

                        this.isSyncingToText = true;
                        try {
                            this.searchText.set(newText);
                        } finally {
                            this.isSyncingToText = false;
                        }

                        // Clear the UI-only filters from filterState
                        const updatedFilters = { ...manualFilters };
                        for (const key of Object.keys(uiOnlyFilters)) {
                            delete updatedFilters[key];
                        }
                        this.filterState.set(updatedFilters);
                    }
                }
            }

            wasComplex = isComplex;
        });
    }

    dynamicInternalLabel = computed(() => {
        const units = this.filteredUnits();
        if (units.length === 0) return 'Structure / Squad Size';
        const hasInfantry = units.some(u => u.type === 'Infantry');
        const hasNonInfantry = units.some(u => u.type !== 'Infantry');
        if (hasInfantry && !hasNonInfantry) return 'Squad Size';
        if (!hasInfantry) return 'Structure';
        return 'Structure / Squad Size';
    });

    searchTokens = computed((): SearchTokensGroup[] => {
        return parseSearchQuery(this.effectiveTextSearch());
    });

    private recalculateBVRange() {
        const units = this.units;
        if (units.length === 0) return;

        let min = Infinity, max = -Infinity;
        for (const u of units) {
            const bv = this.getAdjustedBV(u);
            if (bv > 0) {
                if (bv < min) min = bv;
                if (bv > max) max = bv;
            }
        }

        if (min > max) return; // No valid values

        // Update the totalRangesCache which the computed signal depends on
        this.totalRangesCache['bv'] = [min, max];

        // Adjust current filter value to fit within new range if it exists
        const currentFilter = this.filterState()['bv'];
        if (currentFilter?.interactedWith) {
            const currentValue = currentFilter.value as [number, number];
            const adjustedValue: [number, number] = [
                Math.max(min, currentValue[0]),
                Math.min(max, currentValue[1])
            ];

            // Only update if the value actually changed
            if (adjustedValue[0] !== currentValue[0] || adjustedValue[1] !== currentValue[1]) {
                this.setFilter('bv', adjustedValue);
            }
        }
    }

    private recalculatePVRange() {
        const units = this.units;
        if (units.length === 0) return;

        let min = Infinity, max = -Infinity;
        for (const u of units) {
            const pv = this.getAdjustedPV(u);
            if (pv > 0) {
                if (pv < min) min = pv;
                if (pv > max) max = pv;
            }
        }

        if (min > max) return; // No valid values

        // Update the totalRangesCache which the computed signal depends on
        this.totalRangesCache['as.PV'] = [min, max];
        // Adjust current filter value to fit within new range if it exists
        const currentFilter = this.filterState()['as.PV'];
        if (currentFilter?.interactedWith) {
            const currentValue = currentFilter.value as [number, number];
            const adjustedValue: [number, number] = [
                Math.max(min, currentValue[0]),
                Math.min(max, currentValue[1])
            ];

            // Only update if the value actually changed
            if (adjustedValue[0] !== currentValue[0] || adjustedValue[1] !== currentValue[1]) {
                this.setFilter('as.PV', adjustedValue);
            }
        }
    }

    private calculateTotalRanges() {
        const rangeFilters = ADVANCED_FILTERS.filter(f => f.type === AdvFilterType.RANGE);
        for (const conf of rangeFilters) {
            if (conf.key === 'bv') {
                // Special handling for BV to use adjusted values
                let min = Infinity, max = -Infinity;
                for (const u of this.units) {
                    const bv = this.getAdjustedBV(u);
                    if (bv > 0) {
                        if (bv < min) min = bv;
                        if (bv > max) max = bv;
                    }
                }
                this.totalRangesCache['bv'] = min <= max ? [min, max] : [0, 0];
            } else if (conf.key === 'as.PV') {
                // Special handling for PV to use adjusted values
                let min = Infinity, max = -Infinity;
                for (const u of this.units) {
                    const pv = this.getAdjustedPV(u);
                    if (pv > 0) {
                        if (pv < min) min = pv;
                        if (pv > max) max = pv;
                    }
                }
                this.totalRangesCache['as.PV'] = min <= max ? [min, max] : [0, 0];
            } else if (conf.key === 'as._mv') {
                // Special handling for AS movement - collect ALL values from MVm
                let min = Infinity, max = -Infinity;
                for (const u of this.units) {
                    const mvm = u.as?.MVm;
                    if (mvm) {
                        for (const v of Object.values(mvm) as number[]) {
                            if (v < min) min = v;
                            if (v > max) max = v;
                        }
                    }
                }
                this.totalRangesCache['as._mv'] = min <= max ? [min, max] : [0, 0];
            } else {
                const allValues = this.getValidFilterValues(this.units, conf);
                if (allValues.length > 0) {
                    let min = allValues[0], max = allValues[0];
                    for (let i = 1; i < allValues.length; i++) {
                        const v = allValues[i];
                        if (v < min) min = v;
                        if (v > max) max = v;
                    }
                    this.totalRangesCache[conf.key] = [min, max];
                } else {
                    this.totalRangesCache[conf.key] = [0, 0];
                }
            }
        }
    }

    get isDataReady() { return this.dataService.isDataReady; }
    get units() { return this.isDataReady() ? this.dataService.getUnits() : []; }

    public setSortOrder(key: string) {
        this.selectedSort.set(key);
    }

    public setSortDirection(direction: 'asc' | 'desc') {
        this.selectedSortDirection.set(direction);
    }

    private updateSearchTelemetry(snapshot: SearchTelemetrySnapshot): void {
        const logKey = `${snapshot.query}|${snapshot.unitCount}|${snapshot.resultCount}|${snapshot.sortKey}|${snapshot.sortDirection}`;
        const shouldLog = snapshot.totalMs >= this.slowSearchTelemetryThresholdMs && logKey !== this.lastSearchTelemetryLogKey;

        if (shouldLog) {
            this.lastSearchTelemetryLogKey = logKey;
        }

        queueMicrotask(() => {
            this.searchTelemetryState.set(snapshot);

            if (shouldLog && this.lastSearchTelemetryLogKey === logKey) {
                const stageSummary = snapshot.stages
                    .map(stage => `${stage.name}=${stage.durationMs.toFixed(1)}ms`)
                    .join(', ');
                const message = `Unit search telemetry: units=${snapshot.unitCount}, results=${snapshot.resultCount}, total=${snapshot.totalMs.toFixed(1)}ms, query="${snapshot.query}" [${stageSummary}]`;
                this.logger.info(message);
            }
        });
    }

    private getIndexedUniverseNames(filterKey: string): string[] {
        return this.dataService.getDropdownOptionUniverse(filterKey).map(option => option.name);
    }

    private getSortedIndexedUniverseNames(conf: AdvFilterConfig): string[] {
        const cacheVersion = conf.key === '_tags'
            ? this.dataService.tagsVersion()
            : this.dataService.searchCorpusVersion();
        const cacheKey = `${conf.key}|${conf.sortOptions?.join('\u0001') ?? ''}|${cacheVersion}`;
        let cached = this.indexedUniverseNamesCache.get(cacheKey);
        if (!cached) {
            const optionNames = this.getIndexedUniverseNames(conf.key);
            cached = conf.key === 'era' && (!conf.sortOptions || conf.sortOptions.length === 0)
                ? optionNames
                : sortAvailableDropdownOptions(optionNames, conf.sortOptions);
            this.indexedUniverseNamesCache.set(cacheKey, cached);
        }
        return cached;
    }

    private collectIndexedAvailabilityNames(
        filterKey: string,
        optionNames: readonly string[],
        contextUnitIds: ReadonlySet<string>,
        isComponentFilter: boolean,
    ): Set<string> {
        const availableNames = new Set<string>();

        for (const optionName of optionNames) {
            const indexedIds = this.dataService.getIndexedUnitIds(filterKey, optionName);
            if (indexedIds && setHasAny(indexedIds, contextUnitIds)) {
                availableNames.add(isComponentFilter ? optionName.toLowerCase() : optionName);
            }
        }

        return availableNames;
    }

    private collectConstrainedMultistateAvailabilityNames(
        filterKey: string,
        units: Unit[],
        selection: MultiStateSelection,
        isComponentFilter: boolean,
    ): Set<string> | null {
        const andEntries = Object.entries(selection).filter(([, sel]) => sel.state === 'and');
        if (andEntries.length === 0) {
            return null;
        }

        const andMap = new Map(andEntries.map(([name, sel]) => [
            name.toLowerCase(),
            sel.count,
        ]));
        const notSet = new Set(
            Object.entries(selection)
                .filter(([, sel]) => sel.state === 'not')
                .map(([name]) => name.toLowerCase()),
        );
        const availableNames = new Set<string>();

        if (!isComponentFilter) {
            const universeNames = this.getIndexedUniverseNames(filterKey);
            if (universeNames.length > 0) {
                const contextUnitIds = new Set(units.map(unit => unit.name));
                let constrainedUnitIds: Set<string> | null = null;

                for (const [selectedName] of andEntries) {
                    const indexedIds = this.dataService.getIndexedUnitIds(filterKey, selectedName);
                    const matchingContextIds = new Set<string>();

                    if (indexedIds) {
                        for (const unitId of indexedIds) {
                            if (contextUnitIds.has(unitId)) {
                                matchingContextIds.add(unitId);
                            }
                        }
                    }

                    if (constrainedUnitIds === null) {
                        constrainedUnitIds = matchingContextIds;
                    } else {
                        for (const unitId of Array.from(constrainedUnitIds)) {
                            if (!matchingContextIds.has(unitId)) {
                                constrainedUnitIds.delete(unitId);
                            }
                        }
                    }
                }

                if (!constrainedUnitIds || constrainedUnitIds.size === 0) {
                    return availableNames;
                }

                for (const excludedName of notSet) {
                    const universeMatch = universeNames.find(name => name.toLowerCase() === excludedName);
                    if (!universeMatch) {
                        continue;
                    }
                    const excludedIds = this.dataService.getIndexedUnitIds(filterKey, universeMatch);
                    if (!excludedIds) {
                        continue;
                    }
                    for (const unitId of Array.from(constrainedUnitIds)) {
                        if (excludedIds.has(unitId)) {
                            constrainedUnitIds.delete(unitId);
                        }
                    }
                }

                if (constrainedUnitIds.size === 0) {
                    return availableNames;
                }

                for (const optionName of universeNames) {
                    const indexedIds = this.dataService.getIndexedUnitIds(filterKey, optionName);
                    if (indexedIds && setHasAny(indexedIds, constrainedUnitIds)) {
                        availableNames.add(optionName);
                    }
                }

                return availableNames;
            }
        }

        for (const unit of units) {
            if (isComponentFilter) {
                const cached = getUnitComponentData(unit);

                let excluded = false;
                for (const notName of notSet) {
                    if (cached.names.has(notName)) {
                        excluded = true;
                        break;
                    }
                }
                if (excluded) {
                    continue;
                }

                let matchesAllAnd = true;
                for (const [name, requiredCount] of andMap) {
                    if ((cached.counts.get(name) || 0) < requiredCount) {
                        matchesAllAnd = false;
                        break;
                    }
                }
                if (!matchesAllAnd) {
                    continue;
                }

                for (const componentName of cached.names) {
                    availableNames.add(componentName);
                }
                continue;
            }

            const propValue = getProperty(unit, filterKey);
            const values = Array.isArray(propValue) ? propValue : [propValue];
            const normalizedToOriginal = new Map<string, string>();

            for (const value of values) {
                if (value == null || value === '') {
                    continue;
                }

                const stringValue = String(value);
                const normalizedValue = stringValue.toLowerCase();
                if (!normalizedToOriginal.has(normalizedValue)) {
                    normalizedToOriginal.set(normalizedValue, stringValue);
                }
            }

            let excluded = false;
            for (const notName of notSet) {
                if (normalizedToOriginal.has(notName)) {
                    excluded = true;
                    break;
                }
            }
            if (excluded) {
                continue;
            }

            let matchesAllAnd = true;
            for (const [name] of andMap) {
                if (!normalizedToOriginal.has(name)) {
                    matchesAllAnd = false;
                    break;
                }
            }
            if (!matchesAllAnd) {
                continue;
            }

            for (const originalValue of normalizedToOriginal.values()) {
                availableNames.add(originalValue);
            }
        }

        return availableNames;
    }

    private buildForcePackDropdownOptions(snapshot: AdvOptionsContextSnapshot, contextUnits: Unit[]): { name: string; available: boolean }[] {
        const availablePackNames = getSnapshotForcePackNames(
            snapshot,
            contextUnits,
            unit => this.dataService.getForcePacksForUnit(unit),
        );

        return FORCE_PACK_OPTION_UNIVERSE.map(option => ({
            name: option.name,
            available: availablePackNames.has(option.name),
        }));
    }

    private getAvailableRangeForUnits(
        units: Unit[],
        conf: AdvFilterConfig,
        fallbackRange: [number, number],
    ): [number, number] {
        let min = Infinity;
        let max = -Infinity;

        const includeValue = (value: number) => {
            if (value < min) min = value;
            if (value > max) max = value;
        };

        if (conf.key === 'bv') {
            for (const unit of units) {
                const adjustedBV = this.getAdjustedBV(unit);
                if (adjustedBV > 0) {
                    includeValue(adjustedBV);
                }
            }
        } else if (conf.key === 'as.PV') {
            for (const unit of units) {
                const adjustedPV = this.getAdjustedPV(unit);
                if (adjustedPV > 0) {
                    includeValue(adjustedPV);
                }
            }
        } else if (conf.key === 'as._mv') {
            for (const unit of units) {
                const movementValues = unit.as?.MVm;
                if (!movementValues) {
                    continue;
                }

                for (const value of Object.values(movementValues) as number[]) {
                    includeValue(value);
                }
            }
        } else {
            const ignoreSet = conf.ignoreValues ? new Set(conf.ignoreValues) : null;
            for (const unit of units) {
                const value = getProperty(unit, conf.key);
                if (typeof value !== 'number') {
                    continue;
                }
                if (ignoreSet?.has(value)) {
                    continue;
                }

                includeValue(value);
            }
        }

        return min <= max ? [min, max] : fallbackRange;
    }

    /**
     * Check if a unit belongs to a specific era by name.
     * Used for external filter evaluation in AST.
     */
    public unitBelongsToEra(unit: Unit, eraName: string, scope?: AvailabilityFilterScope): boolean {
        const era = this.dataService.getEraByName(eraName);
        if (!era) return false;

        return this.unitBelongsToEraInScope(unit, era, scope);
    }

    /**
     * Check if a unit belongs to a specific faction by name.
     * Used for external filter evaluation in AST.
     */
    public unitBelongsToFaction(unit: Unit, factionName: string, eraNames?: readonly string[]): boolean {
        const faction = this.dataService.getFactionByName(factionName);
        if (!faction) return false;

        if (eraNames !== undefined) {
            if (eraNames.length === 0) {
                return false;
            }

            const contextEraIds = new Set(
                eraNames
                    .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                    .filter((eraId): eraId is number => eraId !== undefined),
            );
            return this.unitAvailabilitySource.unitBelongsToFaction(unit, faction, contextEraIds);
        }

        return this.unitAvailabilitySource.unitBelongsToFaction(unit, faction);
    }

    private getUnitIdsForEraInFactionScope(eraName: string, factionNames: readonly string[]): Set<string> {
        const era = this.dataService.getEraByName(eraName);
        if (!era || factionNames.length === 0) {
            return new Set<string>();
        }

        const contextEraIds = new Set([era.id]);
        const unitIds = new Set<string>();
        for (const factionName of factionNames) {
            for (const unitId of this.getUnitIdsForFaction(factionName, contextEraIds)) {
                unitIds.add(unitId);
            }
        }

        return unitIds;
    }

    private unitBelongsToEraInScope(unit: Unit, era: Era, scope?: AvailabilityFilterScope): boolean {
        if (scope?.factionNames === undefined) {
            return this.unitAvailabilitySource.unitBelongsToEra(unit, era);
        }

        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            return this.getUnitIdsForEraInFactionScope(era.name, scope.factionNames)
                .has(this.unitAvailabilitySource.getUnitAvailabilityKey(unit));
        }

        const context = this.buildAvailabilityFilterContext({
            eraNames: [era.name],
            factionNames: scope.factionNames,
        });
        if (context === null) {
            return false;
        }

        if (!context.factionIds) {
            return this.unitAvailabilitySource.unitBelongsToEra(unit, era);
        }

        return this.unitAvailabilitySource.getMegaMekMembershipUnitIds(context)
            .has(this.unitAvailabilitySource.getUnitAvailabilityKey(unit));
    }

    /**
     * Check if a unit belongs to a specific force pack by name.
     * Used for external filter evaluation in AST.
     * Matches by chassis+type+subtype combination.
     */
    public unitBelongsToForcePack(unit: Unit, packName: string): boolean {
        return this.dataService.unitBelongsToForcePack(unit, packName);
    }

    private combineResolvedUnitIds(
        resolved: ResolvedDropdownNames,
        getUnitIds: (name: string) => ReadonlySet<string>,
        getBaseUnitIds: () => ReadonlySet<string>,
    ): Set<string> | null {
        if (!this.hasResolvedDropdownNames(resolved)) {
            return null;
        }

        let resultSet: Set<string> | null = null;

        if (resolved.or.length > 0) {
            resultSet = new Set<string>();
            for (const name of resolved.or) {
                for (const unitId of getUnitIds(name)) {
                    resultSet.add(unitId);
                }
            }
        }

        for (const name of resolved.and) {
            const unitIds = getUnitIds(name);
            if (resultSet === null) {
                resultSet = new Set(unitIds);
                continue;
            }

            for (const unitId of Array.from(resultSet)) {
                if (!unitIds.has(unitId)) {
                    resultSet.delete(unitId);
                }
            }
        }

        if (resolved.not.length > 0) {
            if (resultSet === null) {
                resultSet = new Set(getBaseUnitIds());
            }

            for (const name of resolved.not) {
                for (const unitId of getUnitIds(name)) {
                    resultSet.delete(unitId);
                }
            }
        }

        return resultSet;
    }

    private getUnitIdsForEraNames(selectedEraNames: string[]): Set<string> | null {
        if (!selectedEraNames || selectedEraNames.length === 0) return null;
        const unitIds = new Set<string>();

        for (const eraName of selectedEraNames) {
            const era = this.dataService.getEraByName(eraName);
            if (era) {
                this.unitAvailabilitySource.getVisibleEraUnitIds(era).forEach((id) => unitIds.add(id));
            }
        }
        return unitIds;
    }

    private getUnitIdsForSelectedEras(filterStateEntry?: FilterState[string]): Set<string> | null {
        const resolvedEras = this.resolveEraNamesFromFilter(filterStateEntry);
        return this.combineResolvedUnitIds(
            resolvedEras,
            (eraName) => {
                const era = this.dataService.getEraByName(eraName);
                return era
                    ? this.unitAvailabilitySource.getVisibleEraUnitIds(era)
                    : new Set<string>();
            },
            () => this.getAllUnitIdsInContext(),
        );
    }

    private getUnitIdsForFaction(factionName: string, contextEraIds?: Set<number>): Set<string> {
        const faction = this.dataService.getFactionByName(factionName);
        return faction
            ? this.unitAvailabilitySource.getFactionUnitIds(faction, contextEraIds)
            : new Set<string>();
    }

    private getSemanticIndexedUnitIds(
        filterKey: string,
        value: string,
        scope?: AvailabilityFilterScope,
    ): ReadonlySet<string> | undefined {
        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            if (filterKey === 'era' && scope?.factionNames !== undefined) {
                return this.getUnitIdsForEraInFactionScope(value, scope.factionNames);
            }

            if (filterKey === 'faction' && scope?.eraNames !== undefined) {
                const faction = this.dataService.getFactionByName(value);
                if (!faction) {
                    return undefined;
                }

                const contextEraIds = new Set(
                    scope.eraNames
                        .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                        .filter((eraId): eraId is number => eraId !== undefined),
                );
                return contextEraIds.size === 0
                    ? new Set<string>()
                    : this.unitAvailabilitySource.getFactionUnitIds(faction, contextEraIds);
            }

            return this.dataService.getIndexedUnitIds(filterKey, value);
        }

        if (filterKey === 'era') {
            const era = this.dataService.getEraByName(value);
            if (!era) {
                return undefined;
            }

            if (scope?.factionNames === undefined) {
                return this.unitAvailabilitySource.getVisibleEraUnitIds(era);
            }

            const context = this.buildAvailabilityFilterContext({
                eraNames: [era.name],
                factionNames: scope.factionNames,
            });
            return context === null
                ? new Set<string>()
                : this.unitAvailabilitySource.getMegaMekMembershipUnitIds(context);
        }

        if (filterKey === 'faction') {
            const faction = this.dataService.getFactionByName(value);
            if (!faction) {
                return undefined;
            }

            if (scope?.eraNames === undefined) {
                return this.unitAvailabilitySource.getFactionUnitIds(faction);
            }

            const contextEraIds = new Set(
                scope.eraNames
                    .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                    .filter((eraId): eraId is number => eraId !== undefined),
            );
            return contextEraIds.size === 0
                ? new Set<string>()
                : this.unitAvailabilitySource.getFactionUnitIds(faction, contextEraIds);
        }

        if (filterKey === 'availabilityFrom') {
            const context = this.buildAvailabilityFilterContext(scope);
            if (context === null) {
                return new Set<string>();
            }

            if (value === MEGAMEK_AVAILABILITY_UNKNOWN) {
                return this.unitAvailabilitySource.getMegaMekUnknownUnitIds(context);
            }

            return this.unitAvailabilitySource.getMegaMekAvailabilityUnitIds({
                ...context,
                availabilityFrom: new Set([value as MegaMekAvailabilityFrom]),
            });
        }

        if (filterKey === 'availabilityRarity') {
            const context = this.buildAvailabilityFilterContext(scope);
            if (context === null) {
                return new Set<string>();
            }

            return value === MEGAMEK_AVAILABILITY_UNKNOWN
                ? this.unitAvailabilitySource.getMegaMekUnknownUnitIds(context)
                : this.unitAvailabilitySource.getMegaMekRarityUnitIds(value as MegaMekAvailabilityRarity, context);
        }

        return this.dataService.getIndexedUnitIds(filterKey, value);
    }

    private getSemanticIndexedFilterValues(filterKey: string): readonly string[] {
        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            return this.dataService.getIndexedFilterValues(filterKey);
        }

        if (filterKey === 'era') {
            return this.dataService.getEras().map((era) => era.name);
        }

        if (filterKey === 'faction') {
            return this.dataService.getFactions().map((faction) => faction.name);
        }

        if (filterKey === 'availabilityFrom') {
            return [...MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS];
        }

        if (filterKey === 'availabilityRarity') {
            return [...MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS];
        }

        return this.dataService.getIndexedFilterValues(filterKey);
    }

    private getAllUnitIdsInContext(contextEraIds?: Set<number>): Set<string> {
        if (!contextEraIds || contextEraIds.size === 0) {
            if (this.unitAvailabilitySource.useMegaMekAvailability()) {
                return new Set(
                    this.units
                        .filter(unit => this.unitAvailabilitySource.unitHasMegaMekAvailability(unit))
                        .map(unit => this.unitAvailabilitySource.getUnitAvailabilityKey(unit)),
                );
            }

            return new Set(this.units.map(unit => this.unitAvailabilitySource.getUnitAvailabilityKey(unit)));
        }

        // Era filter is present. We can reuse the logic from getUnitIdsForSelectedEras
        const contextEraNames = this.dataService.getEras()
            .filter(e => contextEraIds.has(e.id))
            .map(e => e.name);

        return this.getUnitIdsForEraNames(contextEraNames) || new Set<string>();
    }

    private getUnitIdsForSelectedFactions(selectedFactionEntries: MultiStateSelection, contextEraNames?: string[], wildcardPatterns?: WildcardPattern[]): Set<string> | null {
        const allFactionNames = this.dataService.getFactions().map(f => f.name);
        const { or: orFactions, and: andFactions, not: notFactions } = resolveDropdownNamesFromFilter(
            selectedFactionEntries, allFactionNames, wildcardPatterns
        );
        if (orFactions.length === 0 && andFactions.length === 0 && notFactions.length === 0) {
            return null;
        }

        const contextEraIds = contextEraNames && contextEraNames.length > 0
            ? new Set(
                contextEraNames
                    .map(name => this.dataService.getEraByName(name)?.id)
                    .filter((id): id is number => id !== undefined)
            )
            : undefined;

        let resultSet: Set<string> | null = null;

        // Handle OR selections to create the base set of unit IDs.
        if (orFactions.length > 0) {
            resultSet = new Set<string>();
            for (const factionName of orFactions) {
                this.getUnitIdsForFaction(factionName, contextEraIds)
                    .forEach(id => resultSet!.add(id));
            }
        }

        // Intersect with AND selections.
        for (const factionName of andFactions) {
            const factionUnitIds = this.getUnitIdsForFaction(factionName, contextEraIds);
            if (resultSet === null) {
                // If no ORs, the first AND sets the initial list.
                resultSet = new Set(factionUnitIds);
            } else {
                // Intersect with the existing results
                for (const id of resultSet) {
                    if (!factionUnitIds.has(id)) resultSet.delete(id);
                }
            }
        }

        // Subtract NOT selections.
        if (notFactions.length > 0) {
            if (resultSet === null) {
                // If no ORs or ANDs, start with all units in context.
                resultSet = this.getAllUnitIdsInContext(contextEraIds);
            }
            for (const factionName of notFactions) {
                this.getUnitIdsForFaction(factionName, contextEraIds)
                    .forEach(id => resultSet!.delete(id));
            }
        }

        return resultSet;
    }

    private getUnitIdsForExternalFilters(
        eraFilterState?: FilterState[string],
        factionFilterState?: FilterState[string],
    ): Set<string> | null {
        const resolvedEras = this.resolveEraNamesFromFilter(eraFilterState);
        const hasEraFilter = this.hasResolvedDropdownNames(resolvedEras);
        const selectedFactionEntries = normalizeMultiStateSelection(factionFilterState?.value);
        const factionWildcardPatterns = factionFilterState?.wildcardPatterns;
        const allFactionNames = this.dataService.getFactions().map((faction) => faction.name);
        const resolvedFactions = resolveDropdownNamesFromFilter(
            selectedFactionEntries,
            allFactionNames,
            factionWildcardPatterns,
        );
        const hasFactionFilter = this.hasResolvedDropdownNames(resolvedFactions);

        if (!hasEraFilter) {
            if (!hasFactionFilter) {
                return null;
            }

            return this.getUnitIdsForSelectedFactions(
                selectedFactionEntries,
                undefined,
                factionWildcardPatterns,
            );
        }

        if (!hasFactionFilter) {
            return this.getUnitIdsForSelectedEras(eraFilterState);
        }

        const positiveEraNames = [...resolvedEras.or, ...resolvedEras.and];
        const relevantEraNames = positiveEraNames.length > 0
            ? Array.from(new Set([...positiveEraNames, ...resolvedEras.not]))
            : this.dataService.getEras().map((era) => era.name);
        const perEraFactionUnitIds = new Map<string, Set<string>>();

        for (const eraName of relevantEraNames) {
            perEraFactionUnitIds.set(
                eraName,
                this.getUnitIdsForSelectedFactions(
                    selectedFactionEntries,
                    [eraName],
                    factionWildcardPatterns,
                ) ?? new Set<string>(),
            );
        }

        return this.combineResolvedUnitIds(
            resolvedEras,
            (eraName) => perEraFactionUnitIds.get(eraName) ?? new Set<string>(),
            () => {
                const unitIds = new Set<string>();
                for (const ids of perEraFactionUnitIds.values()) {
                    for (const unitId of ids) {
                        unitIds.add(unitId);
                    }
                }
                return unitIds;
            },
        );
    }

    private getUnitFilterKernelDependencies(): UnitFilterKernelDependencies {
        return {
            getProperty,
            getAdjustedBV: (unit: Unit) => this.getAdjustedBV(unit),
            getAdjustedPV: (unit: Unit) => this.getAdjustedPV(unit),
            getUnitIdsForExternalFilters: (eraFilterState, factionFilterState) =>
                this.getUnitIdsForExternalFilters(eraFilterState, factionFilterState),
            getPositiveFactionNames: (selectedFactionEntries, wildcardPatterns) => {
                const allFactionNames = this.dataService.getFactions().map(faction => faction.name);
                return getPositiveDropdownNamesFromFilter(selectedFactionEntries, allFactionNames, wildcardPatterns);
            },
            getAvailabilityLookupKey: unit => this.unitAvailabilitySource.getUnitAvailabilityKey(unit),
            unitMatchesAvailabilityFrom: (unit, availabilityFromName, scope) =>
                this.unitMatchesAvailabilityFrom(unit, availabilityFromName, scope),
            unitMatchesAvailabilityRarity: (unit, rarityName, scope) =>
                this.unitMatchesAvailabilityRarity(unit, rarityName, scope),
            getForcePackLookupSet: packName => this.dataService.getForcePackLookupSet(packName),
        };
    }

    private executeSyncSearch(): {
        execution: ReturnType<typeof executeUnitSearch>;
        parseTelemetry: SearchTelemetryStage[];
    } {
        this.dataService.searchCorpusVersion();
        if (
            this.optionsService.options().availabilitySource === 'megamek'
            || isMegaMekRaritySortKey(this.selectedSort())
        ) {
            this.dataService.megaMekAvailabilityVersion();
        }

        // Depend on tagsVersion so we recompute when tags change (user tags or public tags)
        // This is needed because unit._tags/_publicTags are mutated in place, not via signals
        this.tagsVersion();

        const parseTelemetry: SearchTelemetryStage[] = [];
        const parsedQuery = measureStage(
            parseTelemetry,
            'parse-query',
            this.units.length,
            () => this.semanticParsedAST(),
        );
        const megaMekRaritySortScope = this.megaMekRaritySortScope();
        const megaMekRaritySortContext = this.megaMekRaritySortContext();
        const megaMekRaritySortScoreResolver = megaMekRaritySortContext === null
            ? null
            : this.unitAvailabilitySource.getMegaMekAvailabilityScoreResolver(megaMekRaritySortContext);

        const execution = executeUnitSearch({
            units: this.units,
            parsedQuery,
            searchTokens: this.searchTokens(),
            uiOnlyFilterState: this.getUiOnlyFilterState(this.getApplicableFilterState(this.filterState()), this.semanticFilterKeys()),
            uiOnlyFilterDependencies: this.getUnitFilterKernelDependencies(),
            gameSystem: this.gameService.currentGameSystem(),
            sortKey: this.selectedSort(),
            sortDirection: this.selectedSortDirection(),
            bvPvLimit: 0,
            forceTotalBvPv: 0,
            getAdjustedBV: (unit: Unit) => this.getAdjustedBV(unit),
            getAdjustedPV: (unit: Unit) => this.getAdjustedPV(unit),
            unitBelongsToEra: (unit: Unit, eraName: string, scope?: AvailabilityFilterScope) => this.unitBelongsToEra(unit, eraName, scope),
            unitBelongsToFaction: (unit: Unit, factionName: string, eraNames?: readonly string[]) => this.unitBelongsToFaction(unit, factionName, eraNames),
            unitMatchesAvailabilityFrom: (unit: Unit, availabilityFromName: string, scope?: AvailabilityFilterScope) => this.unitMatchesAvailabilityFrom(unit, availabilityFromName, scope),
            unitMatchesAvailabilityRarity: (unit: Unit, rarityName: string, scope?: AvailabilityFilterScope) => this.unitMatchesAvailabilityRarity(unit, rarityName, scope),
            unitBelongsToForcePack: (unit: Unit, packName: string) => this.unitBelongsToForcePack(unit, packName),
            getAllEraNames: () => this.dataService.getEras().map(era => era.name),
            getAllFactionNames: () => this.dataService.getFactions().map(faction => faction.name),
            getAllAvailabilityFromNames: () => [...MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS],
            getAllAvailabilityRarityNames: () => [...MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS],
            getDisplayName: (filterKey: string, value: string) => {
                const conf = getAdvancedFilterConfigByKey(filterKey);
                const fn = conf?.displayNameFn ?? this.displayNameFns[filterKey];
                return fn?.(value);
            },
            getIndexedUnitIds: (filterKey: string, value: string, scope?: AvailabilityFilterScope) => this.getSemanticIndexedUnitIds(filterKey, value, scope),
            getIndexedFilterValues: (filterKey: string) => this.getSemanticIndexedFilterValues(filterKey),
            availabilitySortScope: megaMekRaritySortScope,
            getMegaMekRaritySortScore: megaMekRaritySortScoreResolver
                ? (unit: Unit) => megaMekRaritySortScoreResolver(unit)
                : undefined,
        });

        return {
            execution,
            parseTelemetry,
        };
    }

    private readonly uncappedSyncSearch = computed(() => this.executeSyncSearch());

    syncFilteredUnits = computed(() => {
        const { execution, parseTelemetry } = this.uncappedSyncSearch();
        const budgetTelemetry: SearchTelemetryStage[] = [];
        const cappedResults = this.applyRemainingBudgetLimit(execution.results, budgetTelemetry);

        this.updateSearchTelemetry({
            timestamp: Date.now(),
            query: this.searchText().trim(),
            gameSystem: this.gameService.currentGameSystem(),
            unitCount: execution.unitCount,
            resultCount: cappedResults.length,
            sortKey: this.selectedSort(),
            sortDirection: this.selectedSortDirection(),
            isComplex: execution.isComplex,
            stages: [...parseTelemetry, ...execution.telemetryStages, ...budgetTelemetry],
            totalMs: execution.totalMs,
        });

        return cappedResults;
    });

    /** Force generator eligibility uses the active search criteria but ignores the remaining BV/PV cap from unit search. */
    readonly forceGeneratorEligibleUnits = computed(() => {
        if (this.workerSearchActive()) {
            const pendingFallback = this.getPendingWorkerFallbackUnits();
            if (pendingFallback) {
                return pendingFallback;
            }

            return this.uncappedWorkerFilteredUnitsState();
        }

        return this.uncappedSyncSearch().execution.results;
    });

    filteredUnits = computed(() => {
        if (!this.workerSearchActive()) {
            return this.syncFilteredUnits();
        }

        const pendingFallback = this.getPendingWorkerFallbackUnits();
        if (pendingFallback) {
            return this.applyRemainingBudgetLimit(pendingFallback);
        }

        return this.applyRemainingBudgetLimit(this.uncappedWorkerFilteredUnitsState());
    });

    // Advanced filter options
    advOptions = computed(() => {
        if (!this.isDataReady()) return {};
        const state = this.getApplicableFilterState(this.effectiveFilterState());
        this.tagsVersion();

        const advOptionsResult = buildUnitSearchAdvOptions({
            advancedFilters: ADVANCED_FILTERS.filter((filter) => (
                isFilterAvailableForAvailabilitySource(filter, this.optionsService.options().availabilitySource)
            )),
            state,
            units: this.units,
            queryText: this.searchText(),
            textSearch: this.effectiveTextSearch(),
            isComplexQuery: this.isComplexQuery(),
            totalRanges: this.totalRangesCache,
            dynamicInternalLabel: this.dynamicInternalLabel(),
            gameSystem: this.gameService.currentGameSystem(),
            getUnitFilterKernelDependencies: () => this.getUnitFilterKernelDependencies(),
            buildIndexedDropdownOptions: (conf, contextUnits, displayNameFn, contextUnitIds) =>
                this.buildIndexedDropdownOptions(conf, contextUnits, displayNameFn, contextUnitIds),
            buildForcePackDropdownOptions: (snapshot, contextUnits) => this.buildForcePackDropdownOptions(snapshot, contextUnits),
            buildCustomDropdownOptions: (conf, contextUnits, currentState) =>
                this.buildMegaMekAvailabilityDropdownOptions(conf, contextUnits, currentState),
            getIndexedUniverseNames: filterKey => this.getIndexedUniverseNames(filterKey),
            getSortedIndexedUniverseNames: conf => this.getSortedIndexedUniverseNames(conf),
            collectIndexedAvailabilityNames: (filterKey, optionNames, contextUnitIds, isComponentFilter) =>
                this.collectIndexedAvailabilityNames(filterKey, optionNames, contextUnitIds, isComponentFilter),
            collectConstrainedMultistateAvailabilityNames: (filterKey, units, selection, isComponentFilter) =>
                this.collectConstrainedMultistateAvailabilityNames(filterKey, units, selection, isComponentFilter),
            getAvailableRangeForUnits: (units, conf, fallbackRange) => this.getAvailableRangeForUnits(units, conf, fallbackRange),
            getDisplayName: (filterKey, value) => {
                const conf = getAdvancedFilterConfigByKey(filterKey);
                const fn = conf?.displayNameFn ?? this.displayNameFns[filterKey];
                return fn?.(value);
            },
        });

        const advOptionsSnapshot = advOptionsResult.telemetry;
        const publishVersion = ++this.advOptionsTelemetryPublishVersion;
        queueMicrotask(() => {
            if (this.advOptionsTelemetryPublishVersion !== publishVersion) {
                return;
            }
            this.advOptionsTelemetryState.set(advOptionsSnapshot);
        });

        return advOptionsResult.options;
    });


    private getValidFilterValues(units: Unit[], conf: AdvFilterConfig): number[] {
        const ignoreSet = conf.ignoreValues ? new Set(conf.ignoreValues) : null;
        const vals: number[] = [];
        for (const u of units) {
            const v = getProperty(u, conf.key);
            if (typeof v === 'number' && (!ignoreSet || !ignoreSet.has(v))) {
                vals.push(v);
            }
        }
        return vals;
    }

    private loadFiltersFromUrlOnStartup() {
        effect(() => {
            const isDataReady = this.dataService.isDataReady();
            if (isDataReady && !this.urlStateInitialized()) {
                this.applyParamsCore(this.urlStateService.initialState.params);
                this.urlStateInitialized.set(true);
                this.urlStateService.markConsumerReady('unit-search-filters');
            }
        });
    }

    /**
     * Apply search/filter parameters from a URLSearchParams object.
     * Used for in-app URL handling when the PWA receives a captured link
     * while already open. Resets current filters before applying new ones.
     *
     * @param params The URLSearchParams to read from
     * @param opts Options controlling behavior
     */
    public applySearchParamsFromUrl(params: URLSearchParams, opts: { expandView?: boolean } = {}): void {
        this.clearFilters();
        this.applyParamsCore(params, opts);
        this.processPendingForeignTags();
    }

    /**
     * Core logic for applying search/filter params from a URLSearchParams.
     * Shared between startup initialization and in-app URL handling.
     */
    private applyParamsCore(params: URLSearchParams, opts: { expandView?: boolean } = {}): void {
        const scalarState = parseUnitSearchScalarUrlState(params, opts);
        const searchParam = scalarState.searchText;

        if (scalarState.searchText) {
            this.searchText.set(scalarState.searchText);
        }

        if (scalarState.sortKey) {
            this.selectedSort.set(scalarState.sortKey);
        }

        if (scalarState.sortDirection) {
            this.selectedSortDirection.set(scalarState.sortDirection);
        }

        // UI filters (separate from semantic filters in q)
        const filtersParam = params.get('filters');
        let parsedFilterState: FilterState = {};
        if (filtersParam) {
            try {
                parsedFilterState = parseAndValidateCompactFiltersFromUrl(filtersParam, this.getDropdownValuesDependencies());
                this.filterState.set(parsedFilterState);
            } catch (error) {
                this.logger.warn('Failed to parse filters from URL: ' + error);
            }
        }

        // Public tags mapping (format: publicId1:tag1,publicId2:tag2)
        const ptParam = params.get('pt');
        const foreignTags = parsePublicTagsParam({
            ptParam,
            searchText: searchParam,
            filterState: parsedFilterState,
            gameSystem: this.gameService.currentGameSystem(),
            myPublicId: this.userStateService.publicId(),
            subscribedTags: this.publicTagsService.getSubscribedTags(),
        });
        if (foreignTags.length > 0) {
            this.pendingForeignTags.set(mergePublicTagReferences(this.pendingForeignTags(), foreignTags));
        }

        if (scalarState.expanded) {
            this.expandedView.set(true);
        }

        if (scalarState.gunnery !== null) {
            this.pilotGunnerySkill.set(scalarState.gunnery);
        }

        if (scalarState.piloting !== null) {
            this.pilotPilotingSkill.set(scalarState.piloting);
        }

        if (scalarState.bvLimit !== null) {
            this.bvPvLimit.set(scalarState.bvLimit);
        }
    }

    queryParameters = computed(() => {
        return buildUnitSearchQueryParameters({
            searchText: this.searchText(),
            filterState: this.getApplicableFilterState(this.filterState()),
            semanticKeys: this.semanticFilterKeys(),
            selectedSort: this.selectedSort(),
            selectedSortDirection: this.selectedSortDirection(),
            expanded: this.expandedView(),
            gunnery: this.pilotGunnerySkill(),
            piloting: this.pilotPilotingSkill(),
            bvLimit: this.bvPvLimit(),
            publicTagsParam: this.publicTagsParam(),
        });
    });


    private updateUrlOnFiltersChange() {
        effect(() => {
            const queryParameters = this.queryParameters();
            if (!this.urlStateInitialized()) {
                return;
            }
            // Use centralized URL state service to avoid race conditions
            this.urlStateService.setParams(queryParameters);
        });
    }

    setFilter(key: string, value: any) {
        const conf = getAdvancedFilterConfigByKey(key);
        if (!conf) return;

        if (conf.type === AdvFilterType.DROPDOWN && conf.multistate) {
            value = normalizeMultiStateSelection(value);
        }

        let interacted = true;
        let atLeftBoundary = false;
        let atRightBoundary = false;

        if (conf.type === AdvFilterType.RANGE) {
            // For range filters, check which boundaries the value matches.
            const availableRange = this.advOptions()[key]?.options;
            if (availableRange) {
                atLeftBoundary = value[0] === availableRange[0];
                atRightBoundary = value[1] === availableRange[1];
                // Only "not interacted" if BOTH boundaries match
                if (atLeftBoundary && atRightBoundary) {
                    interacted = false;
                }
            }
        } else if (conf.type === AdvFilterType.DROPDOWN) {
            if (conf.multistate) {
                // For multistate dropdowns, check if all states are false or object is empty
                if (!value || typeof value !== 'object' || Object.keys(value).length === 0 ||
                    Object.values(value).every((selectionValue: any) => selectionValue.state === false)) {
                    interacted = false;
                }
            } else {
                // For regular dropdowns, if the value is an empty array, it's not interacted.
                if (Array.isArray(value) && value.length === 0) {
                    interacted = false;
                }
            }
        }

        // Determine if we should sync this filter to semantic text:
        // 1. If autoConvertToSemantic is enabled: always sync
        // 2. If this filter already exists in semantic text: sync to keep them linked
        const shouldSyncToText = this.autoConvertToSemantic() || this.semanticFilterKeys().has(key);

        if (shouldSyncToText) {
            // Update the semantic text for this specific filter
            this.updateSemanticTextForFilter(key, value, interacted, conf);
        } else {
            // Just update filterState (UI-only filter)
            this.filterState.update(current => ({
                ...current,
                [key]: { value, interactedWith: interacted }
            }));
        }
    }

    /**
     * Explicitly unset a filter, removing it from the filter state regardless
     * of boundary matching. Used when the user explicitly clears a range filter.
     */
    unsetFilter(key: string) {
        const conf = getAdvancedFilterConfigByKey(key);
        if (!conf) return;

        const shouldSyncToText = this.autoConvertToSemantic() || this.semanticFilterKeys().has(key);

        if (shouldSyncToText) {
            // Remove the semantic token for this filter by passing non-interacted.
            // Use the available range as the value so boundary checks produce no token text.
            const availableRange = this.advOptions()[key]?.options as [number, number] | undefined;
            const resetValue = conf.type === AdvFilterType.RANGE
                ? (availableRange || this.totalRangesCache[key] || [0, 0])
                : [];
            this.updateSemanticTextForFilter(key, resetValue, false, conf);
        } else {
            // Remove from filterState
            this.filterState.update(current => {
                const updated = { ...current };
                delete updated[key];
                return updated;
            });
        }
    }

    /**
     * Update the semantic text to reflect a filter value change.
     * This replaces/adds/removes the token for the specified filter key.
     */
    private updateSemanticTextForFilter(key: string, value: any, interacted: boolean, conf: AdvFilterConfig): void {
        if (this.isSyncingToText) return; // Prevent re-entry

        this.isSyncingToText = true;
        try {
            const currentText = this.searchText();
            const gameSystem = this.gameService.currentGameSystem();

            // Parse current query using AST parser to get text search and existing tokens
            const parsed = parseSemanticQueryAST(currentText, gameSystem);

            const nextSemanticState = {
                ...tokensToFilterState(
                    parsed.tokens,
                    gameSystem,
                    this.totalRangesCache,
                ),
            } as FilterState;

            if (interacted) {
                nextSemanticState[key] = {
                    value,
                    interactedWith: true,
                };
            } else {
                delete nextSemanticState[key];
            }

            this.searchText.set(
                filterStateToSemanticText(
                    nextSemanticState,
                    parsed.textSearch,
                    gameSystem,
                    this.totalRangesCache,
                ).trim()
            );

            // Also clear the filterState for this key since semantic is now the source of truth
            this.filterState.update(current => {
                const updated = { ...current };
                delete updated[key];
                return updated;
            });
        } finally {
            this.isSyncingToText = false;
        }
    }

    public resetFilters() {
        this.clearFilters();
    }

    private clearFilters() {
        this.searchText.set('');
        this.filterState.set({});
        this.selectedSort.set('');
        this.selectedSortDirection.set('asc');
        this.pilotGunnerySkill.set(4);
        this.pilotPilotingSkill.set(5);
        this.bvPvLimit.set(0);
    }

    /**
     * Get the total ranges cache for semantic filter conversion.
     */
    public getTotalRanges(): Record<string, [number, number]> {
        return this.totalRangesCache;
    }

    public invalidateTagsCache(): void {
        // Increment version to trigger recomputation of tag-dependent computed signals
        this.tagsVersion.update(v => v + 1);
    }

    /**
     * Process pending foreign tags detected from URL.
     * Groups tags by publicId and shows import dialog for each group.
     * Must be called after the UI is ready and the dialog callback is set.
     */
    public async processPendingForeignTags(): Promise<void> {
        const pending = this.pendingForeignTags();
        if (pending.length === 0 || !this.showForeignTagDialogCallback) {
            return;
        }

        // Separate already-subscribed tags from those needing user action
        const alreadySubscribed: Array<{ publicId: string; tagName: string }> = [];
        const needsDialog: Array<{ publicId: string; tagName: string }> = [];

        for (const tag of pending) {
            if (this.publicTagsService.isTagSubscribed(tag.publicId, tag.tagName)) {
                alreadySubscribed.push(tag);
            } else {
                needsDialog.push(tag);
            }
        }

        // Add already-subscribed tags to filter state immediately
        if (alreadySubscribed.length > 0) {
            this.filterState.update(current => {
                const currentTags = current['_tags'];
                const currentSelection = (currentTags?.interactedWith ? currentTags.value : {}) as MultiStateSelection;
                const newSelection = { ...currentSelection };

                for (const { tagName } of alreadySubscribed) {
                    if (!newSelection[tagName]) {
                        newSelection[tagName] = { name: tagName, state: 'or', count: 1 };
                    }
                }

                return {
                    ...current,
                    ['_tags']: {
                        value: newSelection,
                        interactedWith: true
                    }
                };
            });
        }

        // If no tags need dialog, we're done
        if (needsDialog.length === 0) {
            this.pendingForeignTags.set([]);
            return;
        }

        // Group by publicId
        const byPublicId = new Map<string, string[]>();
        for (const { publicId, tagName } of needsDialog) {
            let tags = byPublicId.get(publicId);
            if (!tags) {
                tags = [];
                byPublicId.set(publicId, tags);
            }
            tags.push(tagName);
        }

        // Collect tags that were successfully imported
        const importedTags: string[] = [];

        // Process each group
        for (const [publicId, tagNames] of byPublicId) {
            try {
                const choice = await this.showForeignTagDialogCallback(publicId, tagNames);

                if (choice === 'ignore') {
                    // Do nothing
                    continue;
                } else if (choice === 'temporary') {
                    const success = await this.publicTagsService.importTemporary(publicId, tagNames);
                    if (success) {
                        importedTags.push(...tagNames);
                    }
                } else if (choice === 'subscribe') {
                    // Subscribe to each tag
                    for (const tagName of tagNames) {
                        const success = await this.publicTagsService.subscribe(publicId, tagName);
                        if (success) {
                            importedTags.push(tagName);
                        }
                    }
                }
            } catch (err) {
                this.logger.error('Failed to process foreign tags: ' + err);
            }
        }

        // Add imported tags to the filter state so they get evaluated
        if (importedTags.length > 0) {
            this.filterState.update(current => {
                const currentTags = current['_tags'];
                const currentSelection = (currentTags?.interactedWith ? currentTags.value : {}) as MultiStateSelection;
                const newSelection = { ...currentSelection };

                for (const tagName of importedTags) {
                    if (!newSelection[tagName]) {
                        newSelection[tagName] = { name: tagName, state: 'or', count: 1 };
                    }
                }

                return {
                    ...current,
                    ['_tags']: {
                        value: newSelection,
                        interactedWith: true
                    }
                };
            });
        }

        // Clear pending
        this.pendingForeignTags.set([]);

        // Refresh to apply the imported tags
        this.invalidateTagsCache();
    }

    setPilotSkills(gunnery: number, piloting: number) {
        this.pilotGunnerySkill.set(gunnery);
        this.pilotPilotingSkill.set(piloting);
    }

    getAdjustedBV(unit: Unit): number {
        const gunnery = this.pilotGunnerySkill();
        const piloting = getEffectivePilotingSkill(unit, this.pilotPilotingSkill());
        // Use default skills - no adjustment needed
        if (gunnery === DEFAULT_GUNNERY_SKILL && piloting === DEFAULT_PILOTING_SKILL) {
            return unit.bv;
        }

        return BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
    }

    getAdjustedPV(unit: Unit): number {
        let skill = this.pilotGunnerySkill();
        // Use default skill - no adjustment needed
        if (skill === DEFAULT_GUNNERY_SKILL) {
            return unit.as.PV;
        }

        return PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, skill);
    }


    public serializeCurrentSearchFilter(id: string, name: string, gameSystem: 'cbt' | 'as'): SerializedSearchFilter {
        const filter: SerializedSearchFilter = {
            id,
            name,
            timestamp: Date.now()
        };

        const q = this.searchText();
        if (q && q.trim().length > 0) filter.q = q.trim();

        const sort = this.selectedSort();
        if (sort && sort !== '') filter.sort = sort;

        const sortDir = this.selectedSortDirection();
        if (sortDir && sortDir !== 'asc') filter.sortDir = sortDir;

        const g = this.pilotGunnerySkill();
        if (typeof g === 'number' && g !== 4) filter.gunnery = g;

        const p = this.pilotPilotingSkill();
        if (typeof p === 'number' && p !== 5) filter.piloting = p;

        // Save only interacted filters (UI filters, not from semantic text)
        const state = this.getApplicableFilterState(this.filterState());
        const savedFilters: Record<string, any> = {};
        for (const [key, val] of Object.entries(state)) {
            if (val.interactedWith) {
                savedFilters[key] = val.value;
            }
        }
        if (Object.keys(savedFilters).length > 0) {
            filter.filters = savedFilters;
        }

        // Determine if the search is game-specific by checking UI filters and sort
        // Semantic searches are game-agnostic (they support cross-game searching)
        const isGameSpecific = this.isSearchGameSpecific(savedFilters, sort);
        if (isGameSpecific) {
            filter.gameSystem = gameSystem;
        }

        return filter;
    }

    /**
     * Determine if a search filter configuration is specific to a game system.
     * Only UI filters (not semantic text) are considered game-specific.
     * Returns true if any filter or sort key is specific to a game mode.
     */
    private isSearchGameSpecific(savedFilters: Record<string, any>, sortKey?: string): boolean {
        // Check if sort key is game-specific
        if (sortKey) {
            const sortConfig = getAdvancedFilterConfigByKey(sortKey);
            if (sortConfig?.game) return true;
        }

        // Check if any saved filter is game-specific
        for (const filterKey of Object.keys(savedFilters)) {
            const filterConfig = getAdvancedFilterConfigByKey(filterKey);
            if (filterConfig?.game) return true;
        }

        return false;
    }

    public applySerializedSearchFilter(filter: SerializedSearchFilter): void {
        // Reset all filters first
        this.clearFilters();
        // Apply search text
        if (filter.q) {
            this.searchText.set(filter.q);
        }
        // Apply filters
        if (filter.filters) {
            for (const [key, value] of Object.entries(filter.filters)) {
                this.setFilter(key, value);
            }
        }
        // Apply sort
        if (filter.sort) this.setSortOrder(filter.sort);
        if (filter.sortDir) this.setSortDirection(filter.sortDir);

        // Apply pilot skills if provided
        if (typeof filter.gunnery === 'number' || typeof filter.piloting === 'number') {
            const g = typeof filter.gunnery === 'number' ? filter.gunnery : this.pilotGunnerySkill();
            const p = typeof filter.piloting === 'number' ? filter.piloting : this.pilotPilotingSkill();
            this.setPilotSkills(g, p);
        }
    }
}
