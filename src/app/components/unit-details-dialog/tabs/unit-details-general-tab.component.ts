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

import { Component, ChangeDetectionStrategy, input, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Unit, UnitComponent } from '../../../models/units.model';
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

const ADDITIONAL_COMPONENT_FLAGS = ['F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_JUMP_JET'];
const CASE_COMPONENT_FLAGS = ['F_CASE', 'F_CASE_II'];
const WEAPON_MODE_MISC_COMPONENT_FLAGS = ['F_CLUB', 'F_HAND_WEAPON'];

@Component({
    selector: 'unit-details-general-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitComponentItemComponent, ModeSwitchComponent, StatBarSpecsPipe, FilterAmmoPipe, TooltipDirective],
    templateUrl: './unit-details-general-tab.component.html',
    styleUrls: ['./unit-details-general-tab.component.css']
})
export class UnitDetailsGeneralTabComponent {
    private dataService = inject(DataService);
    private dialogsService = inject(DialogsService);
    private layoutService = inject(LayoutService);
    private optionsService = inject(OptionsService);

    // Inputs
    unit = input.required<Unit>();
    gunnerySkill = input<number | undefined>(undefined);
    pilotingSkill = input<number | undefined>(undefined);

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
            let label: string | undefined;
            if (comp.eq.hasFlag('F_CASE_II')) label = '[CASE II]';
            else if (comp.eq.hasFlag('F_CASE') || comp.eq.hasFlag('F_CASE_P')) label = '[CASE]';
            if (label) result.set(normalizeComponentLocation(comp.l), label);
        }
        return result;
    });

    /** Force packs that contain the current unit's chassis|type|subtype */
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
                return leftTitle.localeCompare(rightTitle) || left.abbrev.localeCompare(right.abbrev);
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
        const EXCLUDE_FLAGS = ['F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_CASE', 'F_CASE_II', 'F_JUMP_JET'];
        const counts: Record<string, number> = {};
        if (u?.comp) {
            for (const comp of u.comp) {
                let code = comp.t;
                if (code === 'C' && !comp.eq?.hasAnyFlag(EXCLUDE_FLAGS)) {
                    code = 'O';
                }
                counts[code] = (counts[code] || 0) + (comp.q || 1);
            }
        }
        return weaponTypes.map(wt => ({ ...wt, count: counts[wt.code] ?? 0 }));
    });

    adjustedBV = computed(() => {
        const gunnery = this.gunnerySkill();
        const piloting = this.pilotingSkill();
        const unit = this.unit();
        if (gunnery === undefined || piloting === undefined) {
            return null;
        }
        return BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
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

        sourcebooks.sort((left, right) => left.title.localeCompare(right.title));
        unknownSources.sort((left, right) => left.abbrev.localeCompare(right.abbrev));
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

    private getPublishedSourceKeys(unit: Unit): Set<string> {
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
        return comp?.t === 'C' && !!comp.eq?.hasAnyFlag(ADDITIONAL_COMPONENT_FLAGS);
    }

    private isWeaponModeMiscComponent(comp: UnitComponent | null | undefined): boolean {
        return comp?.t === 'C' && !!comp.eq?.hasAnyFlag(WEAPON_MODE_MISC_COMPONENT_FLAGS);
    }

    private isWeaponModeSummaryComponent(comp: UnitComponent | null | undefined): boolean {
        return comp?.t === 'C'
            && (comp.p ?? -1) >= 0
            && !comp.eq?.hasAnyFlag(CASE_COMPONENT_FLAGS)
            && !this.isAdditionalComponent(comp)
            && !this.isWeaponModeMiscComponent(comp);
    }

    private hasDetailOnlyComponents(): boolean {
        for (const component of this.getHydratedComponents()) {
            if (component.t === 'X') return true;
            if (component.t !== 'C' || component.p < 0) continue;
            if (component.eq?.hasAnyFlag(CASE_COMPONENT_FLAGS)) continue;
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
                if (component.eq?.hasAnyFlag(CASE_COMPONENT_FLAGS)) continue; // Hide CASE components
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
        const equipmentList = this.dataService.getEquipments();
        return u.comp.map(component => ({
            ...component,
            eq: component.eq ?? equipmentList[component.id] ?? null
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
    formatStructureType(structureType: string | undefined): string {
        if (!structureType) return '';
        return structureType.endsWith(' Structure') ? structureType.slice(0, -10) : structureType;
    }
}
