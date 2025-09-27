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

import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, signal, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { Unit, UnitComponent } from '../../models/units.model';
import { FloatingCompInfoComponent } from '../floating-comp-info/floating-comp-info.component';
import { weaponTypes, getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { DataService, UnitTypeMaxStats, DOES_NOT_TRACK } from '../../services/data.service';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

/*
 * Author: Drake
 */
export interface UnitDetailsDialogData {
    unitList: Unit[];
    unitIndex: number;
    hideAddButton: boolean;
}

// Define the matrix layouts by unit type.
// Each slot can be a string (single location code) or an array of codes.
// '~' in a slot means: if none of the provided codes has content, expand the area from the slot above.
// '^' in a slot means: if the slot has no content, borrow content from the area above (cannot move up past an anchored area).
// '!' prefix on a code marks the cell as an ANCHOR: content cannot move upward via '^', and area cannot expand downward.
type SlotSpec = string | string[];
type MatrixSpec = SlotSpec[][];

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
        ['RS', ['BD','GUN'], ['LS', '^']],
        [['!RRLS', '~'], ['RR', '~'], ['!RRRS', '^', '~']],
        ['~', '~', ['TU', '~']]
    ],
    Naval: [ // TODO: this is a copy of Tank, could be optimized for naval units only
        [['!FRLS', '^'], ['FR', '^'], ['!FRRS', 'FT', '^']],
        ['RS', ['BD','GUN'], ['LS', '^']],
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
    selector: 'unit-details-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, FloatingCompInfoComponent],
    templateUrl: './unit-details-dialog.component.html',
    styleUrls: ['./unit-details-dialog.component.css']
})
export class UnitDetailsDialogComponent {
    private dataService = inject(DataService);
    private dialogRef = inject(DialogRef<UnitDetailsDialogComponent>);
    private data = inject(DIALOG_DATA) as UnitDetailsDialogData;
    @Output() add = new EventEmitter<Unit>();

    unitList: Unit[] = this.data.unitList;
    hideAddButton = this.data.hideAddButton;
    unitIndex = this.data.unitIndex;

    maxStats: UnitTypeMaxStats[string] = {
        armor: [0, 0],
        internal: [0, 0],
        heat: [0, 0],
        dissipation: [0, 0],
        runMP: [0, 0],
        jumpMP: [0, 0],
        alphaNoPhysical: [0, 0],
        alphaNoPhysicalNoOneshots: [0, 0],
        maxRange: [0, 0],
        dpt: [0, 0]
    };
    statBarSpecs: Array<{ key: string, label: string, value: number, max: number }> = [];
    groupedBays: Array<{ l: string, p: number, bays: UnitComponent[] }> = [];
    components: UnitComponent[] = [];
    componentsForMatrix: UnitComponent[] = [];

    // For hover info
    hoveredComp = signal<UnitComponent | null>(null);
    hoverRect = signal<DOMRect | null>(null);
    private isCompHovered = false;
    private isFloatingHovered = false;
    

    get unit(): Unit {
        return this.unitList[this.unitIndex];
    }

    get weaponTypes() {
        return weaponTypes;
    }

    // Matrix layout state
    useMatrixLayout = false;
    gridAreas = '';
    matrixAreaCodes: string[] = [];
    private areaNameToCodes = new Map<string, string[]>();

    constructor() {
        this.updateStats();
        this.updateUseMatrixLayout();
    }

    private baysByLocCache = new Map<string, UnitComponent[]>();
    private baysForArea = new Map<string, UnitComponent[]>();
    private compsForArea = new Map<string, UnitComponent[]>();

    trackByBay = (i: number, bay: UnitComponent) => `${bay.n}|${bay.t}|${bay.l}`;
    trackByComp = (i: number, comp: UnitComponent) => `${comp.n}|${comp.t}|${comp.l}`;

    updateStats() {
        this.maxStats = this.dataService.getUnitTypeMaxStats(this.unit.type);

        const statDefs = [
            { key: 'armor', label: 'Armor', value: this.unit.armor, max: this.maxStats.armor[1] },
            { key: 'internal', label: this.unit.type === 'Infantry' ? 'Squad size' : 'Structure', value: this.unit.internal, max: this.maxStats.internal[1] },
            // Here we use _mdSumNoPhysicalNoOneshots for max so that the stat bar reflects the max without oneshots even if we are counting them anyway
            // This allows to have a decent stat bar even if the unit has no oneshot weapons (TODO: maybe we should not consider oneshots at all even in the filters?)
            { key: 'alphaNoPhysical', label: 'Firepower', value: this.unit._mdSumNoPhysical, max: this.maxStats.alphaNoPhysicalNoOneshots[1] },
            { key: 'dpt', label: 'Damage/Turn', value: this.unit.dpt, max: this.maxStats.dpt[1] },
            { key: 'maxRange', label: 'Range', value: this.unit._maxRange, max: this.maxStats.maxRange[1] },
            { key: 'heat', label: 'Heat', value: this.unit.heat, max: this.maxStats.heat[1] },
            { key: 'dissipation', label: 'Dissipation', value: this.unit.dissipation, max: this.maxStats.dissipation[1] },
            { key: 'runMP', label: 'Speed', value: this.unit.run, max: this.maxStats.runMP[1] },
            { key: 'jumpMP', label: 'Jump', value: this.unit.jump, max: this.maxStats.jumpMP[1] },
        ];
        this.statBarSpecs = statDefs.filter((def, idx) => {
            const statMaxArr = this.maxStats[def.key as keyof typeof this.maxStats] as [number, number];
            if (def.value === undefined || def.value === null || def.value == -1) return false; // Skip if value is not defined
            if (!statMaxArr) return false;
            if (statMaxArr[0] == statMaxArr[1]) return false;// If min/max are the same, don't show
            if (statMaxArr[0] == 0 && DOES_NOT_TRACK == statMaxArr[1] && DOES_NOT_TRACK == def.value) return false; // Special case for stats that don't track
            return true;
        });

        this.groupedBays = this.getGroupedBaysByLocation();
        this.components = this.getComponents(false);
        this.componentsForMatrix = this.getComponents(true);
        this.baysByLocCache.clear();
        this.buildMatrixLayout();
    }
        
    private normalizeLoc(loc: string): string {
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
            this.useMatrixLayout = false;
            this.baysForArea.clear();
            this.compsForArea.clear();
            return;
        }

        // Normalize with content-aware fallback expansion ('~'), borrow-up ('^'), and anchoring ('!').
        const { names, areaCodes } = this.normalizeMatrix(matrix);
        // Drop rows that resolve to fully empty ('.') after normalization
        const filteredNames = names.filter(row => row.some(name => name !== '.'));

        // We collect all area codes used and we check if some components are outside the matrix spec.
        const matrixDeclaredCodes = new Set<string>();
        for (const codes of areaCodes.values()) {
            for (const c of codes) matrixDeclaredCodes.add(c);
        }
        const allUnitLocs = new Set<string>();
        // Components
        for (const comp of this.componentsForMatrix) {
            if (comp.l) allUnitLocs.add(this.normalizeLoc(comp.l));
        }
        // Bays (groupedBays already built in updateStats -> getGroupedBaysByLocation)
        for (const g of this.groupedBays) {
            if (g.l) allUnitLocs.add(this.normalizeLoc(g.l)); 
        }
        const extraCodes: string[] = [];
        for (const loc of allUnitLocs) {
            if (!matrixDeclaredCodes.has(loc)) {
                extraCodes.push(loc); // These codes are not in the matrix spec, will be added as extra rows
            }
        }

        // Append extra codes as new rows
        if (extraCodes.length) {
            // If we currently have no rows (all original rows empty), we still need column count
            const cols = matrix[0].length;
            let i = 0;
            while (i < extraCodes.length) {
                const row: string[] = Array(cols).fill('.');
                for (let c = 0; c < cols && i < extraCodes.length; c++, i++) {
                    const code = extraCodes[i];
                    const areaName = code;
                    row[c] = areaName;
                    if (!areaCodes.has(areaName)) {
                        areaCodes.set(areaName, [code]);
                    }
                }
                filteredNames.push(row);
            }
        }
        if (!filteredNames.length) {
            this.gridAreas = '';
            this.matrixAreaCodes = [];
            this.areaNameToCodes.clear();
            this.useMatrixLayout = false;
            return;
        }

        this.areaNameToCodes = areaCodes;

        // Compute CSS grid-template-areas from canonical names
        this.gridAreas = this.computeGridAreas(filteredNames);

        // Unique area names in first-appearance order (skip '.')
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

    // Parse a slot spec into codes (excluding '~' and '^').
    // '!' prefix on a code marks the cell as an ANCHOR:
    //  - '!' is stripped from the code name for lookups/labels.
    //  - Anchor content cannot MOVE upward via '^'.
    //  - Anchor area cannot expand downward (no fallback / implicit vertical merge below).
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
                raw = raw.substring(1); // removing '!'
                anchorCodes.push(raw);
            }
            codes.push(raw);
        }
        return { codes, hasFallback, hasBorrowUp, anchorCodes };
    }

    // Normalize matrix into canonical area names and map of area -> codes.
    // Rules:
    // - Prefer contiguity with the area above when its name is included in current slot's codes.
    // - If no content for slot codes and slot has '~', expand the area above (use above's name).
    // - If no content and no fallback, emit an empty cell '.'.
    // - '^' (borrow-up): If the cell has no content, but some other cell in the same row DOES have content,
    //       then pull the area name from the cell directly below (if that below cell resolves to an area).
    //       This creates an upward expansion (vertical span) analogous to a '~' downward expansion.
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

        // Build metadata
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

        // Determine row-level content (before borrow)
        const rowHasOtherContent: boolean[] = meta.map(row => row.some(c => c.hasContent));

        // Activate borrow ONLY if row already has some other content (spec) and cell empty
        for (let r = 0; r < meta.length; r++) {
            for (let c = 0; c < expectedCols; c++) {
                const cell = meta[r][c];
                if (cell.hasBorrowUp && !cell.hasContent) {
                    cell.borrowUpActive = true;
                }
            }
        }

        // Phase: Borrow MOVE (column-wise). We move content upward.
        // For each column, scan bottom-up: find a content source followed by one or more contiguous
        // borrowUpActive rows above it (each of those rows already qualifies via rowHasOtherContent).
        // Move the source content to the HIGHEST borrow row; clear source & intermediate cells.
        for (let c = 0; c < expectedCols; c++) {
            // We do multiple passes to catch cascades after earlier moves.
            let changed = true;
            while (changed) {
                changed = false;
                // Walk from bottom to top to find first movable chain
                for (let r = meta.length - 1; r >= 0; r--) {
                    const src = meta[r][c];
                    if (!src.hasContent) continue;
                    if (src.anchorActive) continue; // anchor content cannot move upward
                    // Look upward for contiguous borrowUpActive cells
                    let top = r - 1;
                    if (top < 0) continue;
                    if (!meta[top][c].borrowUpActive) continue;
                    // Collect chain upward
                    while (top - 1 >= 0 && meta[top - 1][c].borrowUpActive) top--;
                    // Move to highest eligible row 'top'
                    const dest = meta[top][c];
                    if (dest.anchorActive) continue;
                    // Copy content codes
                    dest.codes = [...src.codes];
                    dest.contentCodes = [...src.contentCodes];
                    dest.hasContent = true;
                    // Clear source
                    src.hasContent = false;
                    src.hasFallback = true; // It become fallback cell
                    src.contentCodes = [];
                    src.anchorActive = false;
                    // Clear any intermediate borrow cells below dest (they remain empty; still borrowUpActive and becomes fallback cells)
                    for (let rr = top + 1; rr < r; rr++) {
                        meta[rr][c].hasContent = false;
                        meta[rr][c].contentCodes = [];
                        meta[rr][c].hasFallback = true;
                        meta[rr][c].anchorActive = false;
                    }
                    changed = true;
                    break; // restart scan after a move
                }
            }
        }

        // After moves, recompute rowHasOtherContent (some moved rows became empty)
        for (let r = 0; r < meta.length; r++) {
            rowHasOtherContent[r] = meta[r].some(c => c.hasContent);
        }

        // IMPORTANT: remove all rows that now have NO content after borrow MOVE.
        // (This collapses the vertical space the content climbed through, so TU (or any other)
        // ends up on the highest row it reached instead of leaving empty spacer rows that
        // would later create extra grid-template-areas lines.)
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

        // Assign area names (top -> bottom) AFTER row collapse.
        // Rules:
        //  - Content cells choose a base code (first content code) and try to vertically merge
        //    only if the area name above equals that base code (prevents unrelated merges).
        //  - Fallback '~' cells copy the area name directly above if any.
        //  - No borrowing logic here; borrow already converted into actual upward MOVE + row removal.
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

    // For a given canonical area, return all codes assigned to it
    private getAreaCodes(areaName: string): string[] {
        return this.areaNameToCodes.get(areaName) ?? [areaName];
    }

    // Which codes (within this area) actually have content for current unit
    private getPresentAreaCodes(areaName: string): string[] {
        const codes = this.getAreaCodes(areaName);
        const present = new Set<string>();
        for (const code of codes) {
            if (this.getBaysByLocation(code).length > 0) present.add(code);
            if (this.getComponentsForLocation(code).length > 0) present.add(code);
        }
        return Array.from(present);
    }

    areaHasContent(areaName: string): boolean {
        if (areaName === '.' || !areaName) return false;
        return this.getPresentAreaCodes(areaName).length > 0;
    }

    getAreaLabel(areaName: string): string {
        const present = this.getPresentAreaCodes(areaName);
        if (present.length === 0) return '';
        // Convert internal 'ALL' back to visual '*'
        const display = present.map(c => c === 'ALL' ? '*' : c);
        return display.join('/');
    }

    private getMatrixForUnit(): MatrixSpec | null {
        const matrix = MATRIX_ALIGNMENT[this.unit?.type];
        return Array.isArray(matrix) ? matrix : null;
    }

    private computeGridAreas(names: string[][]): string {
        if (!names.length) return '';
        const cols = names[0].length;
        // Ensure every row has exactly cols entries
        const sanitized = names.map(row => {
            if (row.length < cols) return [...row, ...Array(cols - row.length).fill('.')];
            if (row.length > cols) return row.slice(0, cols);
            return row;
        });
        return sanitized.map(row => `"${row.join(' ')}"`).join(' ');
    }

    private canHaveThreeCols(): boolean {
        return window.innerWidth >= 900;
    }

    private updateUseMatrixLayout() {
        const hasMatrix = !!this.getMatrixForUnit();
        this.useMatrixLayout = hasMatrix && this.canHaveThreeCols();
    }
        private buildAreaCaches() {
        this.baysForArea.clear();
        this.compsForArea.clear();
        for (const area of this.matrixAreaCodes) {
            const codes = this.getAreaCodes(area);
            // Bays (merged)
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

            // Components
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

    getComponentsForArea(areaName: string): UnitComponent[] {
        return this.compsForArea.get(areaName) ?? [];
    }

    getBaysForArea(areaName: string): UnitComponent[] {
        return this.baysForArea.get(areaName) ?? [];
    }

    areaHasBays(areaName: string): boolean {
        return (this.baysForArea.get(areaName)?.length || 0) > 0;
    }

    @HostListener('window:resize')
    onWindowResize() {
        this.updateUseMatrixLayout();
    }

    // Keyboard navigation (Left/Right)
    @HostListener('window:keydown', ['$event'])
    onWindowKeyDown(event: KeyboardEvent) {
        // Ignore if typing in an input/textarea/contentEditable
        const target = event.target as HTMLElement | null;
        if (target) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
        }
        // Ignore with modifiers
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        if (event.key === 'ArrowLeft') {
            if (this.hasPrev) {
                this.onPrev();
                event.preventDefault();
            }
        } else if (event.key === 'ArrowRight') {
            if (this.hasNext) {
                this.onNext();
                event.preventDefault();
            }
        }
    }
    
    get hasPrev(): boolean {
        return this.unitList && this.unitIndex > 0;
    }
    get hasNext(): boolean {
        return this.unitList && this.unitIndex < this.unitList.length - 1;
    }

    onPrev() {
        if (this.hasPrev) {
            this.unitIndex--;
            this.updateStats();
        }
    }
    onNext() {
        if (this.hasNext) {
            this.unitIndex++;
            this.updateStats();
        }
    }

    onAdd() {
        this.add.emit(this.unit);
    }

    onClose() {
        this.dialogRef.close();
    }

    getUnitDisplayName(unit: any): string {
        return `${unit.chassis} ${unit.model}`;
    }

    getEraImg(unit: Unit): string | undefined {
        return unit._era?.img;
    }

    getUnitImg(unit: Unit): string | undefined {
        return `https://db.mekbay.com/images/units/${unit.icon}`;
    }

    getTypeCount(typeCode: string): number {
        if (!this.unit?.comp) return 0;
        return this.unit.comp.filter(w => w.t === typeCode).reduce((sum, w) => sum + (w.q || 1), 0);
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

    getComponents(splitMultiloc: boolean): UnitComponent[] {
        if (!this.unit?.comp) return [];
        const expanded: UnitComponent[] = [];
        const equipmentList = this.dataService.getEquipment(this.unit.type);
        for (const original of this.unit.comp) {
            if (original.t === 'HIDDEN') continue;
            if (original.eq === undefined) {
                original.eq = equipmentList[original.id] ?? null;
            }
            // Split multi-location components (e.g., "LA/LT")
            if (splitMultiloc && original.l && original.l.includes('/')) {
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
                // Same position, sort by location alphabetically (solves multi-loc split ordering)
                if (a.l && b.l) {
                    return a.l.localeCompare(b.l);
                }
            }
            return a.p - b.p;
        });
    }

    hasBays(): boolean {
        return this.unit?.comp.some(c => c.bay && c.bay.length > 0);
    }

    trackByBayLoc(index: number, group: { l: string }) {
        return group.l;
    }

    getGroupedBaysByLocation(): Array<{ l: string, p: number, bays: UnitComponent[] }> {
        if (!this.unit?.comp) return [];
        const groupMap = new Map<string, { l: string, p: number, comps: UnitComponent[] }>();
        this.unit?.comp.forEach(comp => {
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

    getStatPercent(val: number, max: number): number {
        if (!max) return 0;
        return Math.max(0, Math.min(100, Math.round((val / max) * 100)));
    }

    formatThousands(value: number): string {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

        onCompMouseEnter(comp: UnitComponent, event: MouseEvent) {
        this.isCompHovered = true;
        if (this.hoveredComp() !== comp) {
            this.hoveredComp.set(comp);
            const container = event.currentTarget as HTMLElement;
            this.hoverRect.set(container.getBoundingClientRect());
        }
    }

    onCompMouseLeave() {
        this.isCompHovered = false;
        // Defer to next tick to allow floating window mouseenter to fire first if moving to it
        setTimeout(() => this.updateFloatingVisibility(), 0);
    }

    onFloatingMouseEnter() {
        this.isFloatingHovered = true;
    }

    onFloatingMouseLeave() {
        this.isFloatingHovered = false;
        // Defer to next tick to allow comp mouseenter to fire first if moving to it
        setTimeout(() => this.updateFloatingVisibility(), 0);
    }

    private updateFloatingVisibility() {
        if (!this.isCompHovered && !this.isFloatingHovered) {
            this.hoveredComp.set(null);
            this.hoverRect.set(null);
        }
    }

    onShare() {
        const domain = window.location.origin + window.location.pathname;
        const unitName = encodeURIComponent(this.unit.name);
        const shareUrl = `${domain}?shareUnit=${unitName}`;
        const shareText = `${this.unit.chassis} ${this.unit.model}`;
        if (navigator.share) {
            navigator.share({
                title: shareText,
                url: shareUrl
            }).catch(() => {
                // fallback if user cancels or error
                this.copyToClipboard(shareText);
            });
        } else {
            this.copyToClipboard(shareText);
            alert('Unit info copied to clipboard!');
        }
    }

    copyToClipboard(text: string) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            // fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
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

    // Swipe handling for mobile (prev/next)
    
    private touch: { startX: number; startY: number; endX: number; endY: number } = {
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    };
    private swipeThreshold: number = 60;

    @HostListener('touchstart', ['$event'])
    onTouchStart(event: TouchEvent) {
        if (event.touches.length === 1) {
            this.touch.startX = event.touches[0].clientX;
            this.touch.startY = event.touches[0].clientY;
            this.touch.endX = event.touches[0].clientX;
            this.touch.endY = event.touches[0].clientY;
        }
    }

    @HostListener('touchmove', ['$event'])
    onTouchMove(event: TouchEvent) {
        if (event.touches.length === 1) {
            this.touch.endX = event.touches[0].clientX;
            this.touch.endY = event.touches[0].clientY;
        }
    }

    @HostListener('touchend', ['$event'])
    onTouchEnd(event: TouchEvent) {
        const deltaX = this.touch.endX - this.touch.startX;
        const deltaY = this.touch.endY - this.touch.startY;
        // Only trigger swipe if X movement is at least minAxisRatio times Y movement
        if (Math.abs(deltaX) > this.swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
            if (deltaX < 0 && this.hasNext) {
                this.onNext();
            } else if (deltaX > 0 && this.hasPrev) {
                this.onPrev();
            }
        }
        this.touch = { startX: 0, startY: 0, endX: 0, endY: 0 };
    }
}