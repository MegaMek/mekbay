// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitNameService } from '../../../services/unit-name.service';
import { Component, ChangeDetectionStrategy, input, inject, computed, signal } from '@angular/core';
import type { UnitSummary, UnitComponent } from '../../../models/unit-summary.model';
import { weaponTypes } from '../../../utils/equipment.util';
import { DataService } from '../../../services/data.service';
import { DialogsService } from '../../../services/dialogs.service';
import { LayoutService } from '../../../services/layout.service';
import { OptionsService } from '../../../services/options.service';
import { StatBarSpecsPipe } from '../../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../../pipes/filter-ammo.pipe';
import { UnitComponentItemComponent } from '../../unit-component-item/unit-component-item.component';
import { ModeSwitchComponent } from '../../mode-switch/mode-switch.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import { BVCalculatorUtil } from '../../../utils/bv-calculator.util';
import { getUnitSourceFilterValues } from '../../../utils/unit-search-shared.util';
import { isJumpJetEquipment } from '../../../models/jump-equipment.model';
import { isHeatSinkEquipment } from '../../../models/heat-equipment.model';
import { caseRecordSheetLabel, isCaseEquipment } from '../../../models/case-equipment.model';
import {
    SourcebookInfoDialogComponent,
    type SourcebookInfoDialogData,
    type SourcebookInfoDialogSource,
    type SourcebookInfoDialogUnknownSource,
} from '../../sourcebook-info-dialog/sourcebook-info-dialog.component';
import type { Sourcebook } from '../../../models/sourcebook.model';
import {
    buildComponentMatrixLayout,
    createComponentMatrixAreas,
    hasComponentMatrixLayout,
    normalizeComponentLocation,
    type ComponentMatrixAreaView,
} from './unit-details-component-matrix.util';
import { naturalCompare } from '../../../utils/sort.util';
import { isClubOrHandWeaponEquipment } from '../../../models/entity/utils/physical-weapon';
import { formatBvPv } from '../../../utils/force-viewer-bv-pv-display.util';
import { adjustPointValueForSkill } from '../../../utils/pv-skill-adjustment.util';
import { GameService } from '../../../services/game.service';
import { BASE_RULES_REFS } from '../../../utils/rules-ref.util';
import { forceMemberAdjustedValue, type ForceMember } from '../../../models/force-member.model';
import { ForceUnitCrewComponent } from '../../force-crew/force-unit-crew.component';

type SourceListEntry = Sourcebook & { sourceAnnotations: string[] };
type ComponentDetailsDisplayStyle = 'normal' | 'additional';
type ComponentLocationGroup = { key: string; l: string; components: UnitComponent[] };
type ComponentListOptions = { includeAmmo: boolean; splitMultiLocation: boolean };
type ComponentLayoutMode = 'matrix' | 'bays' | 'phoneGrouped' | 'default';
type ComponentLayoutState = {
    mode: ComponentLayoutMode;
    includeAmmoInDefaultList: boolean;
    showAmmoSummary: boolean;
    showAdditionalSummary: boolean;
};

const RULES_REF_COLLAPSED_GROUP_LIMIT = 2;

export interface RulesRefBadge {
    label: string;
    isBase: boolean;
}

type BaseRulesRefExpression = string[][];

const compareRulesRefNames = (left: string, right: string): number => left.localeCompare(right);

function normalizeBaseRulesRefExpression(expression: BaseRulesRefExpression): BaseRulesRefExpression {
    return expression
        .map(choice => [...new Set(choice)].sort(compareRulesRefNames))
        .sort((left, right) => compareRulesRefNames(left.join('/'), right.join('/')));
}

function getBaseRulesRefExpressionKey(expression: BaseRulesRefExpression): string {
    return expression.map(choice => choice.join('/')).join('\u0000');
}

function tryMergeBaseRulesRefExpressions(
    left: BaseRulesRefExpression,
    right: BaseRulesRefExpression,
): BaseRulesRefExpression | null {
    if (left.length !== right.length) return null;

    const unmatchedRight = [...right];
    const sharedChoices: string[][] = [];
    const unmatchedLeft: string[][] = [];

    for (const leftChoice of left) {
        const leftChoiceKey = leftChoice.join('/');
        const matchingIndex = unmatchedRight.findIndex(rightChoice => rightChoice.join('/') === leftChoiceKey);
        if (matchingIndex < 0) {
            unmatchedLeft.push(leftChoice);
        } else {
            sharedChoices.push(leftChoice);
            unmatchedRight.splice(matchingIndex, 1);
        }
    }

    if (unmatchedLeft.length !== 1 || unmatchedRight.length !== 1) return null;

    return normalizeBaseRulesRefExpression([
        ...sharedChoices,
        [...unmatchedLeft[0], ...unmatchedRight[0]],
    ]);
}

function factorBaseRulesRefExpressions(baseRefSets: string[][]): BaseRulesRefExpression[] {
    let expressions = baseRefSets.map(baseRefs => normalizeBaseRulesRefExpression(
        baseRefs.map(rulesRef => [rulesRef]),
    ));

    while (true) {
        expressions = [...new Map(
            expressions.map(expression => [getBaseRulesRefExpressionKey(expression), expression]),
        ).values()].sort((left, right) => compareRulesRefNames(
            getBaseRulesRefExpressionKey(left),
            getBaseRulesRefExpressionKey(right),
        ));

        let mergedPair: [number, number, BaseRulesRefExpression] | null = null;
        for (let leftIndex = 0; leftIndex < expressions.length && !mergedPair; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < expressions.length; rightIndex++) {
                const merged = tryMergeBaseRulesRefExpressions(expressions[leftIndex], expressions[rightIndex]);
                if (merged) {
                    mergedPair = [leftIndex, rightIndex, merged];
                    break;
                }
            }
        }

        if (!mergedPair) return expressions;

        const [leftIndex, rightIndex, merged] = mergedPair;
        expressions = expressions.filter((_, index) => index !== leftIndex && index !== rightIndex);
        expressions.push(merged);
    }
}

export function getRulesRefBuckets(
    rulesRefs: readonly (readonly string[])[] | readonly string[] | null | undefined,
): string[][] {
    if (!rulesRefs?.length) return [];

    const rawBuckets: readonly (readonly string[])[] = rulesRefs.every(rulesRef => typeof rulesRef === 'string')
        ? [rulesRefs as readonly string[]]
        : rulesRefs as readonly (readonly string[])[];

    return rawBuckets
        .map(bucket => [...new Set(bucket.map(rulesRef => rulesRef.trim()).filter(Boolean))])
        .filter(bucket => bucket.length > 0);
}

export function getRulesRefBadgeGroups(
    rulesRefs: readonly (readonly string[])[] | readonly string[] | null | undefined,
): RulesRefBadge[][] {
    const groupedByNonBaseRefs = new Map<string, { baseRefSets: string[][]; nonBaseRefs: string[] }>();
    const displayGroups: Array<{
        badges: RulesRefBadge[];
        bookCount: number;
        hasBaseRefs: boolean;
    }> = [];

    for (const bucket of getRulesRefBuckets(rulesRefs)) {
        const baseRefs = bucket.filter(rulesRef => BASE_RULES_REFS.has(rulesRef)).sort(compareRulesRefNames);
        const nonBaseRefs = bucket.filter(rulesRef => !BASE_RULES_REFS.has(rulesRef)).sort(compareRulesRefNames);

        if (baseRefs.length > 0) {
            const groupKey = JSON.stringify(nonBaseRefs);
            const existingGroup = groupedByNonBaseRefs.get(groupKey);
            if (existingGroup) {
                existingGroup.baseRefSets.push(baseRefs);
            } else {
                groupedByNonBaseRefs.set(groupKey, { baseRefSets: [baseRefs], nonBaseRefs });
            }
            continue;
        }

        displayGroups.push({
            badges: nonBaseRefs.map(label => ({ label, isBase: false })),
            bookCount: nonBaseRefs.length,
            hasBaseRefs: false,
        });
    }

    for (const group of groupedByNonBaseRefs.values()) {
        for (const baseExpression of factorBaseRulesRefExpressions(group.baseRefSets)) {
            displayGroups.push({
                badges: [
                    ...baseExpression.map(choice => ({ label: choice.join('/'), isBase: true })),
                    ...group.nonBaseRefs.map(label => ({ label, isBase: false })),
                ],
                bookCount: baseExpression.length + group.nonBaseRefs.length,
                hasBaseRefs: true,
            });
        }
    }

    return displayGroups
        .sort((left, right) => {
            const countOrder = left.bookCount - right.bookCount;
            if (countOrder !== 0) return countOrder;

            const typeOrder = Number(right.hasBaseRefs) - Number(left.hasBaseRefs);
            if (typeOrder !== 0) return typeOrder;

            const leftKey = left.badges.map(badge => badge.label).join('\u0000');
            const rightKey = right.badges.map(badge => badge.label).join('\u0000');
            return compareRulesRefNames(leftKey, rightKey);
        })
        .map(group => group.badges);
}

export function shouldShowAdjustedPilotSkills(
    adjustedBv: number | null,
    baseBv: number,
    gunnery: number | undefined,
    piloting: number | undefined,
): boolean {
    return adjustedBv !== null
        && Number.isFinite(adjustedBv)
        && adjustedBv !== baseBv
        && Number.isFinite(gunnery)
        && Number.isFinite(piloting);
}

@Component({
    selector: 'unit-details-general-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UnitComponentItemComponent, ModeSwitchComponent, StatBarSpecsPipe, FilterAmmoPipe, TooltipDirective, ForceUnitCrewComponent],
    templateUrl: './unit-details-general-tab.component.html',
    styleUrl: './unit-details-general-tab.component.css'
})
export class UnitDetailsGeneralTabComponent {
    readonly unitNames = inject(UnitNameService);
    private dataService = inject(DataService);
    private dialogsService = inject(DialogsService);
    private layoutService = inject(LayoutService);
    private optionsService = inject(OptionsService);
    private gameService = inject(GameService);

    // Inputs
    unit = input.required<UnitSummary>();
    forceMember = input<ForceMember>();
    gunnerySkill = input<number | undefined>(undefined);
    pilotingSkill = input<number | undefined>(undefined);
    adjustedValueOverride = input<number | undefined>(undefined);

    // Computed state - derived from unit
    groupedBays = computed(() => this.getGroupedBaysByLocation());
    hasBays = computed(() => this.unit()?.comp.some(component => component.bay && component.bay.length > 0) ?? false);
    showFilteredComponents = computed(() => this.optionsService.options().showFilteredComponents);
    componentLayout = computed<ComponentLayoutState>(() => {
        const hasBays = this.hasBays();
        const showFilteredComponents = this.showFilteredComponents();
        const matrixAvailable = hasComponentMatrixLayout(this.unit()?.type) && this.layoutService.windowWidth() >= 780;
        let mode: ComponentLayoutMode = 'default';
        if (matrixAvailable) mode = 'matrix';
        else if (hasBays) mode = 'bays';
        else if (this.layoutService.isPhone()) mode = 'phoneGrouped';

        const groupedDetails = showFilteredComponents && (mode === 'matrix' || mode === 'phoneGrouped');
        const includeAmmoInDefaultList = showFilteredComponents && this.layoutService.isMobile() && mode === 'default';
        return {
            mode,
            includeAmmoInDefaultList,
            showAmmoSummary: !groupedDetails && !includeAmmoInDefaultList,
            showAdditionalSummary: !groupedDetails,
        };
    });
    components = computed(() => this.getComponents({ includeAmmo: this.componentLayout().includeAmmoInDefaultList, splitMultiLocation: false }));
    groupedLayoutComponents = computed(() => this.getComponents({ includeAmmo: this.showFilteredComponents(), splitMultiLocation: true }));
    componentLocationGroups = computed(() => this.getComponentLocationGroups());
    additionalComponentEntries = computed(() => this.getAdditionalComponentEntries());
    additionalComponentSummary = computed(() => this.getAdditionalComponentSummary());
    additionalComponentSummaryInteractive = computed(() => !this.showFilteredComponents());
    componentViewModeAvailable = computed(() => this.hasDetailOnlyComponents());
    rulesRefBadgeGroups = computed(() => getRulesRefBadgeGroups(this.unit().rulesRefs));
    private expandedRulesRefUnit = signal<UnitSummary | null>(null);
    rulesRefBadgeGroupsExpanded = computed(() => this.expandedRulesRefUnit() === this.unit());
    visibleRulesRefBadgeGroups = computed(() => {
        const groups = this.rulesRefBadgeGroups();
        return this.rulesRefBadgeGroupsExpanded()
            ? groups
            : groups.slice(0, RULES_REF_COLLAPSED_GROUP_LIMIT);
    });
    hasHiddenRulesRefBadgeGroups = computed(() => !this.rulesRefBadgeGroupsExpanded()
        && this.rulesRefBadgeGroups().length > RULES_REF_COLLAPSED_GROUP_LIMIT);

    showAllRulesRefBadgeGroups(): void {
        this.expandedRulesRefUnit.set(this.unit());
    }

    setComponentViewMode(showDetails: boolean): void {
        if (this.showFilteredComponents() === showDetails) return;
        void this.optionsService.setOption('showFilteredComponents', showDetails);
    }

    /** 
     * Computed matrix layout data - derives all matrix-related state from unit.
     * Returns an object with gridAreas, areaCodes, and lookup Maps.
     */
    private matrixData = computed(() => {
        const unit = this.unit();
        const groupedBays = this.groupedBays();
        const groupedLayoutComponents = this.groupedLayoutComponents();
        return buildComponentMatrixLayout(unit?.type, groupedBays, groupedLayoutComponents, (left, right) => this.compareGroupedComponents(left, right));
    });

    gridAreas = computed(() => this.matrixData().gridAreas);
    matrixAreas = computed<ComponentMatrixAreaView[]>(() => createComponentMatrixAreas(this.matrixData(), this.caseByLocation()));

    /** Map of normalized location code -> '[CASE]' or '[CASE II]' for locations that have CASE equipment */
    caseByLocation = computed<Map<string, string>>(() => {
        const u = this.unit();
        const result = new Map<string, string>();
        if (!u?.comp) return result;
        for (const comp of u.comp) {
            if (!comp.eq || !comp.l) continue;
            const label = caseRecordSheetLabel(comp.eq) ?? undefined;
            if (label) result.set(normalizeComponentLocation(comp.l), label);
        }
        return result;
    });

    /** Force packs that contain the current unit's variants */
    forcePacks = computed<string[]>(() => {
        const u = this.unit();
        if (!u) return [];
        return this.dataService.getForcePacksForUnit(u);
    });

    sourceList = computed<SourceListEntry[]>(() => {
        const unit = this.unit();
        const publishedSourceKeys = this.getPublishedSourceKeys(unit);
        return getUnitSourceFilterValues(unit)
            .map((abbrev, index) => {
                const sourcebook = this.dataService.getSourcebookByAbbrev(abbrev) ?? {
                    id: -index - 1,
                    sku: '',
                    abbrev,
                    title: abbrev,
                    canon: false,
                };
                const sourceAnnotations: string[] = [];
                if (sourcebook.canon === false) sourceAnnotations.push('non-canon');
                if (publishedSourceKeys.has(this.normalizeSourceKey(abbrev))) sourceAnnotations.push('RS');
                return { ...sourcebook, sourceAnnotations };
            })
            .sort((left, right) => {
                const leftTitle = left.title || left.abbrev;
                const rightTitle = right.title || right.abbrev;
                return naturalCompare(leftTitle, rightTitle) || naturalCompare(left.abbrev, right.abbrev);
            });
    });

    sarnaPageTitle = computed(() => {
        this.dataService.sarnaPageTitlesVersion();
        return this.dataService.getSarnaPageTitleForUnit(this.unit());
    });

    sarnaWikiUrl = computed(() => {
        const pageTitle = this.sarnaPageTitle();
        if (!pageTitle) return undefined;
        return `https://www.sarna.net/wiki/${encodeURIComponent(pageTitle).replace(/%20/g, '_')}`;
    });

    typeSummary = computed(() => {
        const u = this.unit();
        const counts: Record<string, number> = {};
        if (u?.comp) {
            for (const comp of u.comp) {
                let code = comp.t;
                if (code === 'C'
                    && !isHeatSinkEquipment(comp.eq)
                    && !isCaseEquipment(comp.eq)
                    && !isJumpJetEquipment(comp.eq)) {
                    code = 'O';
                }
                counts[code] = (counts[code] || 0) + (comp.q || 1);
            }
        }
        return weaponTypes.map(wt => ({ ...wt, count: counts[wt.code] ?? 0 }));
    });

    adjustedValue = computed(() => {
        const member = this.forceMember();
        if (member) {
            return forceMemberAdjustedValue(member, this.optionsService.options().forceViewerBVPVDisplayDamage);
        }
        const override = this.adjustedValueOverride();
        if (override !== undefined) {
            return override;
        }
        const gunnery = this.gunnerySkill();
        const piloting = this.pilotingSkill();
        const unit = this.unit();
        if (gunnery === undefined || piloting === undefined) {
            return null;
        }
        return this.gameService.isAlphaStrike()
            ? adjustPointValueForSkill(unit.as.PV, gunnery)
            : BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
    });

    readonly isAlphaStrike = computed(() => this.forceMember()
        ? this.forceMember()!.force.gameSystem === 'as'
        : this.gameService.isAlphaStrike());

    readonly valueLabel = computed(() => this.isAlphaStrike() ? 'PV' : 'BV');

    displayedValue = computed(() => {
        const unit = this.unit();
        const baseValue = this.isAlphaStrike() ? unit.as.PV : unit.bv;
        return formatBvPv(this.adjustedValue() ?? baseValue, baseValue, 'both');
    });

    showAdjustedPilotSkills = computed(() => {
        return shouldShowAdjustedPilotSkills(
            this.adjustedValue(),
            this.gameService.isAlphaStrike() ? this.unit().as.PV : this.unit().bv,
            this.gunnerySkill(),
            this.pilotingSkill(),
        );
    });

    formatThousands(value: number): string {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    getQuirkClass(quirk: string): string {
        const q = this.dataService.getQuirkByName(quirk);
        if (!q) return '';
        return q.type == 'positive' ? 'positive' : 'negative';
    }

    getQuirkDesc(quirk: string): string {
        const q = this.dataService.getQuirkByName(quirk);
        return q?.description || '';
    }

    openSourcebooksDialog(index: number): void {
        const sources = this.sourceList();
        if (!sources || sources.length === 0) return;
        
        const sourcebooks: SourcebookInfoDialogSource[] = [];
        const unknownSources: SourcebookInfoDialogUnknownSource[] = [];
        let selectedSourcebook: SourcebookInfoDialogSource | undefined;
        
        for (const [sourceIndex, source] of sources.entries()) {
            if (source.title !== source.abbrev) {
                if (sourceIndex === index) {
                    selectedSourcebook = source;
                }
                sourcebooks.push(source);
            } else {
                unknownSources.push({ abbrev: source.abbrev, sourceAnnotations: source.sourceAnnotations });
            }
        }

        sourcebooks.sort((left, right) => naturalCompare(left.title, right.title));
        unknownSources.sort((left, right) => naturalCompare(left.abbrev, right.abbrev));
        const selectedSourcebookIndex = selectedSourcebook
            ? sourcebooks.findIndex(sourcebook => sourcebook.abbrev === selectedSourcebook.abbrev)
            : -1;
        
        this.dialogsService.createDialog<void, SourcebookInfoDialogComponent, SourcebookInfoDialogData>(
            SourcebookInfoDialogComponent,
            { data: { sourcebooks, unknownSources, selectedIndex: selectedSourcebookIndex } }
        );
    }

    private normalizeSourceKey(source: string): string {
        return source.trim().toLowerCase();
    }

    private getPublishedSourceKeys(unit: UnitSummary): Set<string> {
        const keys = new Set<string>();
        for (const source of unit.published ?? []) {
            if (typeof source !== 'string') continue;
            const key = this.normalizeSourceKey(source);
            if (key && key !== 'none') keys.add(key);
        }
        return keys;
    }

    getComponentDisplayStyle(comp: UnitComponent): ComponentDetailsDisplayStyle {
        return this.isAdditionalComponent(comp) ? 'additional' : 'normal';
    }

    isAdditionalComponent(comp: UnitComponent | null | undefined): boolean {
        return comp?.t === 'C'
            && (isHeatSinkEquipment(comp.eq) || isJumpJetEquipment(comp.eq));
    }

    private isWeaponModeMiscComponent(comp: UnitComponent | null | undefined): boolean {
        return comp?.t === 'C' && isClubOrHandWeaponEquipment(comp.eq);
    }

    private isWeaponModeSummaryComponent(comp: UnitComponent | null | undefined): boolean {
        return comp?.t === 'C'
            && (comp.p ?? -1) >= 0
            && !isCaseEquipment(comp.eq)
            && !this.isAdditionalComponent(comp)
            && !this.isWeaponModeMiscComponent(comp);
    }

    private hasDetailOnlyComponents(): boolean {
        for (const component of this.getHydratedComponents()) {
            if (component.t === 'X') return true;
            if (component.t !== 'C' || component.p < 0) continue;
            if (isCaseEquipment(component.eq)) continue;
            if (!this.isWeaponModeMiscComponent(component)) return true;
        }
        return false;
    }

    /** Returns the CASE label for a raw location string */
    getCaseLabel(loc: string): string {
        return this.caseByLocation().get(normalizeComponentLocation(loc)) ?? '';
    }

    features = computed<string[]>(() => {
        const u = this.unit();
        if (!u) return [];
        if (!u.features || u.features.length === 0) return [];
        // We skip Bays, we have dedicated visualization for them
        return u.features.filter(f => f && !f.startsWith("Bay:")).map((value) => value.replaceAll("Chassis Mod:", "")).sort();
    });

    private getComponents(options: ComponentListOptions): UnitComponent[] {
        const expanded: UnitComponent[] = [];
        const showFilteredComponents = this.showFilteredComponents();
        for (const component of this.getHydratedComponents()) {
            if (component.t === 'X' && !options.includeAmmo) continue;
            if (component.t === 'HIDDEN') continue;
            if (component.t === 'S') continue;
            if (component.t === 'C') {
                if (component.p < 0) continue; // Hide non-weapon components that are not in valid location (like HS in engine)
                if (isCaseEquipment(component.eq)) continue; // Hide CASE components
                if (!showFilteredComponents && !this.isWeaponModeMiscComponent(component)) continue;
            };

            if (options.splitMultiLocation && component.l && component.l.includes('/')) {
                const locs = component.l.split('/').map(s => s.trim()).filter(Boolean);
                for (const loc of locs) {
                    expanded.push({
                        ...component,
                        l: loc,
                        n: component.n ? `${component.n} (split)` : component.n
                    });
                }
            } else {
                expanded.push({ ...component });
            }
        }
        return expanded.sort((a, b) => {
            if (a.l === b.l) {
                if (a.n === b.n) return 0;
                if (a.n === undefined) return 1;
                if (b.n === undefined) return -1;
                return a.n.localeCompare(b.n);
            }
            if (a.p === undefined) return 1;
            if (b.p === undefined) return -1;
            if (a.p === b.p) {
                if (a.l && b.l) {
                    return a.l.localeCompare(b.l);
                }
            }
            return a.p - b.p;
        });
    }

    private getComponentLocationGroups(): ComponentLocationGroup[] {
        const groups = new Map<string, ComponentLocationGroup>();
        for (const component of this.groupedLayoutComponents()) {
            const key = normalizeComponentLocation(component.l);
            let group = groups.get(key);
            if (!group) {
                group = { key, l: component.l, components: [] };
                groups.set(key, group);
            }
            group.components.push(component);
        }
        return Array.from(groups.values()).map(group => ({
            ...group,
            components: group.components.sort((left, right) => this.compareGroupedComponents(left, right))
        }));
    }

    private getGroupedComponentOrder(component: UnitComponent): number {
        if (this.isAdditionalComponent(component)) return 3;
        if (component.t === 'X') return 2;
        if (this.isWeaponComponent(component)) return 0;
        return 1;
    }

    private isWeaponComponent(component: UnitComponent): boolean {
        if (this.isWeaponModeMiscComponent(component)) return true;
        return ['E', 'M', 'B', 'A', 'P', 'O'].includes(component.t);
    }

    private compareGroupedComponents(left: UnitComponent, right: UnitComponent): number {
        const leftOrder = this.getGroupedComponentOrder(left);
        const rightOrder = this.getGroupedComponentOrder(right);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        const locationOrder = left.l.localeCompare(right.l);
        if (locationOrder !== 0) return locationOrder;
        return (left.n ?? '').localeCompare(right.n ?? '');
    }

    private getAdditionalComponentEntries(): UnitComponent[] {
        const showFilteredComponents = this.showFilteredComponents();
        return this.getHydratedComponents()
            .filter(comp => showFilteredComponents
                ? comp.p >= 0 && this.isAdditionalComponent(comp)
                : this.isWeaponModeSummaryComponent(comp)
            )
            .sort((a, b) => (a.n ?? '').localeCompare(b.n ?? ''));
    }

    private getHydratedComponents(): UnitComponent[] {
        const u = this.unit();
        if (!u?.comp) return [];
        return u.comp.map(component => ({
            ...component,
            eq: component.eq ?? this.dataService.findEquipment(component.id)
        }));
    }

    private getAdditionalComponentSummary(): UnitComponent[] {
        const byName = new Map<string, UnitComponent>();
        for (const comp of this.additionalComponentEntries()) {
            const key = comp.n ?? '';
            if (!byName.has(key)) {
                byName.set(key, { ...comp });
            } else {
                const existing = byName.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
            }
        }
        return Array.from(byName.values())
            .sort((a, b) => (a.n ?? '').localeCompare(b.n ?? ''));
    }

    getGroupedBaysByLocation(): Array<{ l: string, p: number, bays: UnitComponent[] }> {
        const u = this.unit();
        if (!u?.comp) return [];
        const groupMap = new Map<string, { l: string, p: number, comps: UnitComponent[] }>();
        u.comp.forEach(comp => {
            const loc = comp.l;
            const pos = comp.p ?? 0;
            const key = `${loc}|${pos}`;
            if (!groupMap.has(key)) {
                groupMap.set(key, { l: loc, p: pos, comps: [] });
            }
            groupMap.get(key)!.comps.push(comp);
        });

        const result: Array<{ l: string, p: number, bays: UnitComponent[] }> = [];
        groupMap.forEach(({ l, p, comps }) => {
            const bayMap: { [name: string]: UnitComponent } = {};
            comps.forEach(comp => {
                if (comp.bay && comp.bay.length) {
                    comp.bay.forEach(bayComp => {
                        const key = bayComp.n;
                        if (!bayMap[key]) {
                            bayMap[key] = { ...bayComp };
                        } else {
                            bayMap[key].q = (bayMap[key].q || 1) + (bayComp.q || 1);
                        }
                    });
                }
            });
            if (Object.keys(bayMap).length > 0) {
                const sortedBays = Object.values(bayMap).sort((a, b) => {
                    if (a.n === b.n) return 0;
                    if (a.n === undefined) return 1;
                    if (b.n === undefined) return -1;
                    return a.n.localeCompare(b.n);
                });
                result.push({ l, p, bays: sortedBays });
            }
        });

        result.sort((a, b) => a.p - b.p);
        return result;
    }

    /** Format armor type - removes " Armor" suffix if present */
    formatArmorType(armorType: string | undefined): string {
        if (!armorType) return '';
        return armorType.endsWith(' Armor') ? armorType.slice(0, -6) : armorType;
    }

    /** Format structure type - removes " Structure" suffix if present */
    formatStructureType(structureType: string | null | undefined): string {
        if (!structureType) return '';
        return structureType.endsWith(' Structure') ? structureType.slice(0, -10) : structureType;
    }
}
