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

import { Component, ChangeDetectionStrategy, input, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit, UnitComponent } from '../../../models/units.model';
import { weaponTypes, getWeaponTypeCSSClass } from '../../../utils/equipment.util';
import { DataService } from '../../../services/data.service';
import { LayoutService } from '../../../services/layout.service';
import { StatBarSpecsPipe } from '../../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../../pipes/filter-ammo.pipe';
import { UnitComponentItemComponent } from '../../unit-component-item/unit-component-item.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import { BVCalculatorUtil } from '../../../utils/bv-calculator.util';

// Matrix layout types
type SlotSpec = string | string[];
type MatrixSpec = SlotSpec[][];

// Matrix layouts by unit type
// '~' = if no content, expand the area from above
// '^' = if no content, borrow content from above (cannot move past anchor)
// '!' prefix = anchor (content cannot move upward, area cannot expand downward)
const MATRIX_ALIGNMENT: Record<string, MatrixSpec> = {
    Mek: [
        [['LA', 'FLL'], 'HD', ['RA', 'FRL']],
        ['LT', 'CT', 'RT'],
        [['LL', 'RLL'], ['CL', '~'], ['RL', 'RRL']],
    ],
    Aero: [
        ['FLS', 'NOS', 'FRS'],
        [['LBS', 'LWG', 'LS'], ['HULL', 'FSLG', '~'], ['RBS', 'RWG', 'RS']],
        ['~', 'WNG', '~'],
        [['ALS', '~'], 'AFT', ['ARS', '~']],
    ],
    Tank: [
        [['!FRLS', '^'], ['FR', '^'], ['!FRRS', 'FT', '^']],
        ['RS', ['BD', 'GUN'], ['LS', '^']],
        [['!RRLS', '~'], ['RR', '~'], ['!RRRS', '^', '~']],
        ['~', '~', ['TU', '~']]
    ],
    Naval: [
        [['!FRLS', '^'], ['FR', '^'], ['!FRRS', 'FT', '^']],
        ['RS', ['BD', 'GUN'], ['LS', '^']],
        [['!RRLS', '~'], ['RR', '~'], ['!RRRS', '^', '~']],
        ['~', '~', ['TU', '~']]
    ],
    VTOL: [
        ['RS', ['FR', '^'], ['RO', '^']],
        ['~', 'BD', ['LS', '^']],
        ['~', ['RR', '~'], ['TU', '~']],
    ],
};

@Component({
    selector: 'unit-details-general-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitComponentItemComponent, StatBarSpecsPipe, FilterAmmoPipe, TooltipDirective],
    templateUrl: './unit-details-general-tab.component.html',
    styleUrls: ['./unit-details-general-tab.component.css']
})
export class UnitDetailsGeneralTabComponent {
    private dataService = inject(DataService);
    private layoutService = inject(LayoutService);

    // Inputs
    unit = input.required<Unit>();
    gunnerySkill = input<number | undefined>(undefined);
    pilotingSkill = input<number | undefined>(undefined);

    // Computed state
    groupedBays: Array<{ l: string, p: number, bays: UnitComponent[] }> = [];
    components: UnitComponent[] = [];
    componentsForMatrix: UnitComponent[] = [];

    // Matrix layout state
    useMatrixLayout = signal(false);
    gridAreas = '';
    matrixAreaCodes: string[] = [];
    private areaNameToCodes = new Map<string, string[]>();
    private baysByLocCache = new Map<string, UnitComponent[]>();
    private baysForArea = new Map<string, UnitComponent[]>();
    private compsForArea = new Map<string, UnitComponent[]>();

    get weaponTypes() {
        return weaponTypes;
    }

    constructor() {
        effect(() => {
            this.unit();
            this.updateCachedData();
        });
        effect(() => {
            this.layoutService.windowWidth();
            this.updateUseMatrixLayout();
        });
    }

    get adjustedBV(): number | null {
        const gunnery = this.gunnerySkill();
        const piloting = this.pilotingSkill();
        if (gunnery === undefined || piloting === undefined) {
            return null;
        }
        return BVCalculatorUtil.calculateAdjustedBV(this.unit().bv, gunnery, piloting);
    }

    trackByBay = (bay: UnitComponent) => `${bay.n}|${bay.t}|${bay.l}`;
    trackByComp = (comp: UnitComponent) => `${comp.n}|${comp.t}|${comp.l}`;

    private updateCachedData() {
        this.groupedBays = this.getGroupedBaysByLocation();
        this.components = this.getComponents(false);
        this.componentsForMatrix = this.getComponents(true);
        this.baysByLocCache.clear();
        this.buildMatrixLayout();
    }

    formatThousands(value: number): string {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    getTypeCount(typeCode: string): number {
        const u = this.unit();
        if (!u?.comp) return 0;
        return u.comp.filter(w => w.t === typeCode).reduce((sum, w) => sum + (w.q || 1), 0);
    }

    getTypeColor(typeCode: string): string {
        const found = weaponTypes.find(t => t.code === typeCode);
        return found ? found.color : '#ccc';
    }

    getTypeClass(typeCode: string): string {
        return getWeaponTypeCSSClass(typeCode);
    }

    getTypeIcon(typeCode: string): string {
        const found = weaponTypes.find(t => t.code === typeCode);
        return found ? found.img : '/images/crate.svg';
    }

    hasBays(): boolean {
        return this.unit()?.comp.some(c => c.bay && c.bay.length > 0) ?? false;
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

    getAreaLabel(areaName: string): string {
        const present = this.getPresentAreaCodes(areaName);
        if (present.length === 0) return '';
        const display = present.map(c => c === 'ALL' ? '*' : c);
        return display.join('/');
    }

    getComponentsForArea(areaName: string): UnitComponent[] {
        return this.compsForArea.get(areaName) ?? [];
    }

    getBaysForArea(areaName: string): UnitComponent[] {
        return this.baysForArea.get(areaName) ?? [];
    }

    areaHasBays(areaName: string): boolean {
        return (this.baysForArea.get(areaName)?.length || 0) > 0;
    }

    // Matrix layout methods
    private normalizeLoc(loc: string): string {
        if (!loc) return 'UNK';
        let norm = (loc === '*') ? 'ALL' : loc.trim();
        norm = norm.replace(/[^A-Za-z0-9_-]/g, '');
        if (/^[0-9]/.test(norm)) norm = 'L' + norm;
        if (!norm) norm = 'UNK';
        return norm;
    }

    private buildMatrixLayout() {
        const matrix = this.getMatrixForUnit();
        if (!matrix) {
            this.gridAreas = '';
            this.matrixAreaCodes = [];
            this.areaNameToCodes.clear();
            this.useMatrixLayout.set(false);
            this.baysForArea.clear();
            this.compsForArea.clear();
            return;
        }

        const { names, areaCodes } = this.normalizeMatrix(matrix);
        const filteredNames = names.filter(row => row.some(name => name !== '.'));

        const matrixDeclaredCodes = new Set<string>();
        for (const codes of areaCodes.values()) {
            for (const c of codes) matrixDeclaredCodes.add(c);
        }

        const allUnitLocs = new Set<string>();
        for (const comp of this.componentsForMatrix) {
            if (comp.l) allUnitLocs.add(this.normalizeLoc(comp.l));
        }
        for (const g of this.groupedBays) {
            if (g.l) allUnitLocs.add(this.normalizeLoc(g.l));
        }

        const extraCodes: string[] = [];
        for (const loc of allUnitLocs) {
            if (!matrixDeclaredCodes.has(loc)) {
                extraCodes.push(loc);
            }
        }

        if (extraCodes.length) {
            const cols = matrix[0].length;
            let i = 0;
            while (i < extraCodes.length) {
                const row: string[] = Array(cols).fill('.');
                for (let c = 0; c < cols && i < extraCodes.length; c++, i++) {
                    const code = extraCodes[i];
                    row[c] = code;
                    if (!areaCodes.has(code)) {
                        areaCodes.set(code, [code]);
                    }
                }
                filteredNames.push(row);
            }
        }

        if (!filteredNames.length) {
            this.gridAreas = '';
            this.matrixAreaCodes = [];
            this.areaNameToCodes.clear();
            this.useMatrixLayout.set(false);
            return;
        }

        this.areaNameToCodes = areaCodes;
        this.gridAreas = this.computeGridAreas(filteredNames);

        const seen = new Set<string>();
        const unique: string[] = [];
        for (const row of filteredNames) {
            for (const name of row) {
                if (name === '.') continue;
                if (!seen.has(name)) {
                    seen.add(name);
                    unique.push(name);
                }
            }
        }
        this.matrixAreaCodes = unique;
        this.buildAreaCaches();
        this.updateUseMatrixLayout();
    }

    private parseSlotSpec(slot: SlotSpec): {
        codes: string[];
        hasFallback: boolean;
        hasBorrowUp: boolean;
        anchorCodes: string[];
    } {
        const arr = Array.isArray(slot) ? slot : [slot];
        const codes: string[] = [];
        const anchorCodes: string[] = [];
        let hasFallback = false;
        let hasBorrowUp = false;
        for (let raw of arr) {
            if (raw === '~') {
                hasFallback = true;
                continue;
            }
            if (raw === '^') {
                hasBorrowUp = true;
                continue;
            }
            if (raw.startsWith('!')) {
                raw = raw.substring(1);
                anchorCodes.push(raw);
            }
            codes.push(raw);
        }
        return { codes, hasFallback, hasBorrowUp, anchorCodes };
    }

    private normalizeMatrix(matrix: MatrixSpec): { names: string[][]; areaCodes: Map<string, string[]> } {
        interface CellMeta {
            codes: string[];
            anchorCodes: string[];
            hasFallback: boolean;
            hasBorrowUp: boolean;
            hasContent: boolean;
            borrowUpActive: boolean;
            contentCodes: string[];
            anchorActive: boolean;
        }

        const expectedCols = matrix[0]?.length || 0;
        if (!expectedCols) return { names: [], areaCodes: new Map() };

        const codeHasContent = (code: string): boolean =>
            this.getBaysByLocation(code).length > 0 ||
            this.getComponentsForLocation(code).length > 0;

        const meta: CellMeta[][] = [];
        for (let r = 0; r < matrix.length; r++) {
            const row = matrix[r];
            const metaRow: CellMeta[] = [];
            for (let c = 0; c < expectedCols; c++) {
                const spec = row[c];
                const { codes, hasFallback, hasBorrowUp, anchorCodes } = this.parseSlotSpec(spec);
                const contentCodes = codes.filter(codeHasContent);
                const anchorActive = contentCodes.some(cc => anchorCodes.includes(cc));
                metaRow.push({
                    codes,
                    anchorCodes,
                    hasFallback,
                    hasBorrowUp,
                    hasContent: contentCodes.length > 0,
                    borrowUpActive: false,
                    contentCodes,
                    anchorActive
                });
            }
            meta.push(metaRow);
        }

        for (let r = 0; r < meta.length; r++) {
            for (let c = 0; c < expectedCols; c++) {
                const cell = meta[r][c];
                if (cell.hasBorrowUp && !cell.hasContent) {
                    cell.borrowUpActive = true;
                }
            }
        }

        for (let c = 0; c < expectedCols; c++) {
            let changed = true;
            while (changed) {
                changed = false;
                for (let r = meta.length - 1; r >= 0; r--) {
                    const src = meta[r][c];
                    if (!src.hasContent) continue;
                    if (src.anchorActive) continue;
                    let top = r - 1;
                    if (top < 0) continue;
                    if (!meta[top][c].borrowUpActive) continue;
                    while (top - 1 >= 0 && meta[top - 1][c].borrowUpActive) top--;
                    const dest = meta[top][c];
                    if (dest.anchorActive) continue;
                    dest.codes = [...src.codes];
                    dest.contentCodes = [...src.contentCodes];
                    dest.hasContent = true;
                    src.hasContent = false;
                    src.hasFallback = true;
                    src.contentCodes = [];
                    src.anchorActive = false;
                    for (let rr = top + 1; rr < r; rr++) {
                        meta[rr][c].hasContent = false;
                        meta[rr][c].contentCodes = [];
                        meta[rr][c].hasFallback = true;
                        meta[rr][c].anchorActive = false;
                    }
                    changed = true;
                    break;
                }
            }
        }

        const metaForNaming = meta.filter(row => row.some(c => c.hasContent));
        if (!metaForNaming.length) {
            return { names: [], areaCodes: new Map() };
        }

        const names: string[][] = [];
        const areaCodes = new Map<string, string[]>();
        const usedAreaNames = new Set<string>();

        const makeUnique = (base: string): string => {
            if (!base) base = 'A';
            if (!usedAreaNames.has(base)) {
                usedAreaNames.add(base);
                return base;
            }
            let i = 2;
            while (usedAreaNames.has(`${base}_${i}`)) i++;
            const u = `${base}_${i}`;
            usedAreaNames.add(u);
            return u;
        };

        for (let r = 0; r < metaForNaming.length; r++) {
            const row = metaForNaming[r];
            const rowNames: string[] = [];
            for (let c = 0; c < expectedCols; c++) {
                const cell = row[c];
                if (!cell) {
                    rowNames.push('.');
                    continue;
                }
                const aboveName = r > 0 ? names[r - 1][c] : undefined;
                const aboveMeta = r > 0 ? metaForNaming[r - 1][c] : undefined;
                let areaName = '.';

                if (cell.hasContent) {
                    const base = (cell.contentCodes[0] || cell.codes[0] || '').trim();
                    if (aboveName && aboveName === base && !(aboveMeta?.anchorActive)) {
                        areaName = aboveName;
                    } else {
                        areaName = makeUnique(base);
                        if (!areaCodes.has(areaName)) areaCodes.set(areaName, []);
                        const list = areaCodes.get(areaName)!;
                        for (const cc of cell.contentCodes) {
                            if (!list.includes(cc)) list.push(cc);
                        }
                    }
                } else if (
                    cell.hasFallback &&
                    aboveName &&
                    aboveName !== '.' &&
                    !(aboveMeta?.anchorActive)
                ) {
                    areaName = aboveName;
                } else {
                    areaName = '.';
                }

                rowNames.push(areaName);
            }
            names.push(rowNames);
        }

        return { names, areaCodes };
    }

    private getAreaCodes(areaName: string): string[] {
        return this.areaNameToCodes.get(areaName) ?? [areaName];
    }

    private getPresentAreaCodes(areaName: string): string[] {
        const codes = this.getAreaCodes(areaName);
        const present = new Set<string>();
        for (const code of codes) {
            if (this.getBaysByLocation(code).length > 0) present.add(code);
            if (this.getComponentsForLocation(code).length > 0) present.add(code);
        }
        return Array.from(present);
    }

    private getMatrixForUnit(): MatrixSpec | null {
        const matrix = MATRIX_ALIGNMENT[this.unit()?.type];
        return Array.isArray(matrix) ? matrix : null;
    }

    private computeGridAreas(names: string[][]): string {
        if (!names.length) return '';
        const cols = names[0].length;
        const sanitized = names.map(row => {
            if (row.length < cols) return [...row, ...Array(cols - row.length).fill('.')];
            if (row.length > cols) return row.slice(0, cols);
            return row;
        });
        return sanitized.map(row => `"${row.join(' ')}"`).join(' ');
    }

    private canHaveThreeCols(): boolean {
        return window.innerWidth >= 780;
    }

    private updateUseMatrixLayout() {
        const hasMatrix = !!this.getMatrixForUnit();
        this.useMatrixLayout.set(hasMatrix && this.canHaveThreeCols());
    }

    private buildAreaCaches() {
        this.baysForArea.clear();
        this.compsForArea.clear();
        for (const area of this.matrixAreaCodes) {
            const codes = this.getAreaCodes(area);
            const merged = new Map<string, UnitComponent>();
            for (const code of codes) {
                for (const bay of this.getBaysByLocation(code)) {
                    const key = bay.n ?? '';
                    if (!merged.has(key)) merged.set(key, { ...bay });
                    else {
                        const agg = merged.get(key)!;
                        agg.q = (agg.q || 1) + (bay.q || 1);
                    }
                }
            }
            const bays = Array.from(merged.values()).sort((a, b) => {
                if (a.n === b.n) return 0;
                if (a.n === undefined) return 1;
                if (b.n === undefined) return -1;
                return a.n!.localeCompare(b.n!);
            });
            this.baysForArea.set(area, bays);

            const comps = codes
                .flatMap(code => this.getComponentsForLocation(code))
                .sort((a, b) => {
                    if (a.l === b.l) {
                        if (a.n === b.n) return 0;
                        if (a.n === undefined) return 1;
                        if (b.n === undefined) return -1;
                        return a.n!.localeCompare(b.n!);
                    }
                    return a.l.localeCompare(b.l);
                });
            this.compsForArea.set(area, comps);
        }
    }

    getBaysByLocation(loc: string): UnitComponent[] {
        const target = loc;
        if (this.baysByLocCache.has(target)) return this.baysByLocCache.get(target)!;
        const matched = this.groupedBays.filter(g => this.normalizeLoc(g.l) === target);

        if (!matched.length) {
            this.baysByLocCache.set(loc, []);
            return [];
        }
        const byName = new Map<string, UnitComponent>();
        for (const g of matched) {
            for (const bay of g.bays) {
                const key = bay.n ?? '';
                if (!byName.has(key)) byName.set(key, { ...bay });
                else {
                    const agg = byName.get(key)!;
                    agg.q = (agg.q || 1) + (bay.q || 1);
                }
            }
        }
        const arr = Array.from(byName.values()).sort((a, b) => {
            if (a.n === b.n) return 0;
            if (a.n === undefined) return 1;
            if (b.n === undefined) return -1;
            return a.n!.localeCompare(b.n!);
        });
        this.baysByLocCache.set(loc, arr);
        return arr;
    }

    getComponentsForLocation(loc: string): UnitComponent[] {
        return this.componentsForMatrix.filter(c => this.normalizeLoc(c.l) === loc);
    }

    getComponents(isForMatrix: boolean): UnitComponent[] {
        const u = this.unit();
        if (!u?.comp) return [];
        const expanded: UnitComponent[] = [];
        const equipmentList = this.dataService.getEquipment(u.type);
        for (const original of u.comp) {
            if (!isForMatrix && original.t === 'X') continue;
            if (original.t === 'HIDDEN') continue;
            if (original.eq === undefined) {
                original.eq = equipmentList[original.id] ?? null;
            }
            if (isForMatrix && original.l && original.l.includes('/')) {
                const locs = original.l.split('/').map(s => s.trim()).filter(Boolean);
                for (const loc of locs) {
                    expanded.push({
                        ...original,
                        l: loc,
                        n: original.n ? `${original.n} (split)` : original.n
                    });
                }
            } else {
                expanded.push({ ...original });
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
}
