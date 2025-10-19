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

import { Component, inject, ElementRef, signal, HostListener, ChangeDetectionStrategy, output, viewChild, effect, computed, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { Unit, UnitComponent } from '../../models/units.model';
import { FloatingCompInfoComponent } from '../floating-comp-info/floating-comp-info.component';
import { weaponTypes, getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { DataService } from '../../services/data.service';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { ToastService } from '../../services/toast.service';
import { StatBarSpecsPipe } from '../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../pipes/filter-ammo.pipe';
import { ForceUnit } from '../../models/force-unit.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Router } from '@angular/router';
import { SvgViewerLiteComponent } from '../svg-viewer-lite/svg-viewer-lite.component';

/*
 * Author: Drake
 */
export interface UnitDetailsDialogData {
    unitList: Unit[] | ForceUnit[];
    unitIndex: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
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
        ['RS', ['BD', 'GUN'], ['LS', '^']],
        [['!RRLS', '~'], ['RR', '~'], ['!RRRS', '^', '~']],
        ['~', '~', ['TU', '~']]
    ],
    Naval: [ // TODO: this is a copy of Tank, could be optimized for naval units only
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

interface ManufacturerInfo {
    manufacturer: string;
    factory: string;
}

@Component({
    selector: 'unit-details-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, FloatingCompInfoComponent, StatBarSpecsPipe, FilterAmmoPipe, SvgViewerLiteComponent],
    templateUrl: './unit-details-dialog.component.html',
    styleUrls: ['./unit-details-dialog.component.css']
})
export class UnitDetailsDialogComponent {
    dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    dialogRef = inject(DialogRef<UnitDetailsDialogComponent>);
    data = inject(DIALOG_DATA) as UnitDetailsDialogData;
    toastService = inject(ToastService);
    router = inject(Router);
    add = output<Unit>();
    baseDialogRef = viewChild('baseDialog', { read: ElementRef });

    tabs = ['General', 'Intel', 'Factions', 'Sheet'];
    activeTab = signal(this.tabs[0]);

    unitList: Unit[] | ForceUnit[] = this.data.unitList;
    unitIndex = signal(this.data.unitIndex);
    gunnerySkill = computed<number | undefined>(() => {
        const currentUnit = this.unitList[this.unitIndex()]
        if (currentUnit instanceof ForceUnit) {
            return currentUnit.getCrewMember(0).getSkill('gunnery');
        }
        return this.data.gunnerySkill;
    });
    pilotingSkill = computed<number | undefined>(() => {
        const currentUnit = this.unitList[this.unitIndex()]
        if (currentUnit instanceof ForceUnit) {
            return currentUnit.getCrewMember(0).getSkill('piloting');
        }
        return this.data.pilotingSkill;
    });

    groupedBays: Array<{ l: string, p: number, bays: UnitComponent[] }> = [];
    components: UnitComponent[] = [];
    componentsForMatrix: UnitComponent[] = [];
    factionAvailability: { eraName: string, eraImg?: string, factions: { name: string, img: string }[] }[] = [];
    fluffImageUrl = signal<string | null>(null);

    // For hover info
    hoveredComp = signal<UnitComponent | null>(null);
    hoverRect = signal<DOMRect | null>(null);
    private isCompHovered = false;
    private isFloatingHovered = false;

    get unit(): Unit {
        const currentUnit = this.unitList[this.unitIndex()]
        if (currentUnit instanceof ForceUnit) {
            return currentUnit.getUnit();
        }
        return currentUnit;
    }

    getAdjustedBV = computed<number | null>(() => {
        const gunnery = this.gunnerySkill();
        const piloting = this.pilotingSkill();
        if (gunnery === undefined || piloting === undefined) {
            return null;
        }
        return BVCalculatorUtil.calculateAdjustedBV(this.unit.bv, gunnery, piloting);
    });

    hasNonDefaultSkills = computed<boolean>(() => {
        return this.gunnerySkill() !== 4 || this.pilotingSkill() !== 5;
    });

    get weaponTypes() {
        return weaponTypes;
    }

    // Matrix layout state
    useMatrixLayout = signal(false);
    gridAreas = '';
    matrixAreaCodes: string[] = [];
    private areaNameToCodes = new Map<string, string[]>();

    @HostBinding('class.fluff-background')
    get hostHasFluff(): boolean {
        return !!this.fluffImageUrl();
    }

    @HostBinding('style.--fluff-bg')
    get hostFluffBg(): string | null {
        const url = this.fluffImageUrl();
        return url ? `url("${url}")` : null;
    }
    
    constructor() {
        effect(() => {
            this.unit; // Re-run when unit changes
            this.canHaveThreeCols(); // Re-run when window size changes
            this.updateCachedData();
        });
        effect(() => {
            this.unit;
            this.activeTab()
            this.router.navigate([], {
                queryParams: {
                    shareUnit: this.unit.name,
                    tab: this.activeTab(),
                },
                queryParamsHandling: 'merge'
            });
        });
        this.dialogRef.closed.subscribe(() => {
            this.router.navigate([], {
                queryParams: {
                    shareUnit: null,
                    tab: null,
                },
                queryParamsHandling: 'merge'
            });
        });
    }

    private baysByLocCache = new Map<string, UnitComponent[]>();
    private baysForArea = new Map<string, UnitComponent[]>();
    private compsForArea = new Map<string, UnitComponent[]>();

    trackByBay = (bay: UnitComponent) => `${bay.n}|${bay.t}|${bay.l}`;
    trackByComp = (comp: UnitComponent) => `${comp.n}|${comp.t}|${comp.l}`;

    updateCachedData() {
        this.groupedBays = this.getGroupedBaysByLocation();
        this.components = this.getComponents(false);
        this.componentsForMatrix = this.getComponents(true);
        this.baysByLocCache.clear();
        this.buildMatrixLayout();
        this.updateFactionAvailability();
        this.updateFluffImage();
    }

    private updateFluffImage() {
        this.fluffImageUrl.set(null);

        if (this.unit?.fluff?.img) {
            if (this.unit.fluff.img.endsWith('hud.png')) return; // Ignore HUD images
            this.fluffImageUrl.set(`https://db.mekbay.com/images/fluff/${this.unit.fluff.img}`);
        }
    }

    onFluffImageError() {
        this.fluffImageUrl.set(null);
    }

    private updateFactionAvailability() {
        if (!this.unit) {
            this.factionAvailability = [];
            return;
        }

        const unitId = this.unit.id;
        const allEras = this.dataService.getEras().sort((a, b) => (a.years.from || 0) - (b.years.from || 0));
        const allFactions = this.dataService.getFactions();
        const availability: { eraName: string, eraImg?: string, factions: { name: string, img: string }[] }[] = [];

        for (const era of allEras) {
            const factionsInEra: { name: string, img: string }[] = [];
            for (const faction of allFactions) {
                const factionEras = faction.eras[era.id];
                if (factionEras && (factionEras as Set<number>).has(unitId)) {
                    factionsInEra.push({ name: faction.name, img: faction.img });
                }
            }

            if (factionsInEra.length > 0) {
                factionsInEra.sort((a, b) => a.name.localeCompare(b.name));
                availability.push({
                    eraName: era.name,
                    eraImg: era.img,
                    factions: factionsInEra
                });
            }
        }
        this.factionAvailability = availability;
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
            this.useMatrixLayout.set(false);
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
            this.useMatrixLayout.set(false);
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
        const modal = this.baseDialogRef()?.nativeElement.querySelector('.modal') as HTMLElement | null;
        return modal ? modal.clientWidth >= 780 : window.innerWidth >= 780;
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
        return this.unitList && this.unitIndex() > 0;
    }

    get hasNext(): boolean {
        return this.unitList && this.unitIndex() < this.unitList.length - 1;
    }

    onPrev() {
        if (this.hasPrev) {
            this.onFloatingMouseLeave();
            this.unitIndex.set(this.unitIndex() - 1);
        }
    }

    onNext() {
        if (this.hasNext) {
            this.onFloatingMouseLeave();
            this.unitIndex.set(this.unitIndex() + 1);
        }
    }

    onAdd() {
        const selectedUnit = (this.unit instanceof ForceUnit) ? this.unit.getUnit() : this.unit;
        let gunnery;
        let piloting;
        if (this.unit instanceof ForceUnit) {
            gunnery = this.unit.getCrewMember(0).getSkill('gunnery');
            piloting = this.unit.getCrewMember(0).getSkill('piloting');
        } else {
            gunnery = this.gunnerySkill();
            piloting = this.pilotingSkill();
        }
        this.forceBuilderService.addUnit(
            selectedUnit,
            gunnery,
            piloting,
        );
        this.toastService.show(`${selectedUnit.chassis} ${selectedUnit.model} added to the force.`, 'success');
        this.add.emit(selectedUnit);
        this.onClose();
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

    getComponents(isForMatrix: boolean): UnitComponent[] {
        if (!this.unit?.comp) return [];
        const expanded: UnitComponent[] = [];
        const equipmentList = this.dataService.getEquipment(this.unit.type);
        for (const original of this.unit.comp) {
            if (!isForMatrix && original.t === 'X') continue; // Exclude Ammo for normal view
            if (original.t === 'HIDDEN') continue;
            if (original.eq === undefined) {
                original.eq = equipmentList[original.id] ?? null;
            }
            // Split multi-location components (e.g., "LA/LT")
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
        const tab = encodeURIComponent(this.activeTab());
        const shareUrl = `${domain}?shareUnit=${unitName}&tab=${tab}`;
        const shareText = `${this.unit.chassis} ${this.unit.model}`;
        if (navigator.share) {
            navigator.share({
                title: shareText,
                url: shareUrl
            }).catch(() => {
                // fallback if user cancels or error
                navigator.clipboard.writeText(shareText);
            });
        } else {
            navigator.clipboard.writeText(shareText);
            this.toastService.show('Unit link copied to clipboard.', 'success');
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

    getManufacturerFactoryPairs(): ManufacturerInfo[] {
        if (!this.unit.fluff) return [];

        const manufacturers = this.unit.fluff.manufacturer?.split(',').map(m => m.trim()) || [];
        const factories = this.unit.fluff.primaryFactory?.split(',').map(f => f.trim()) || [];

        const manufacturerMap = new Map<string, string[]>();
        const maxLen = Math.max(manufacturers.length, factories.length);

        // Build map of manufacturer -> factories
        for (let i = 0; i < maxLen; i++) {
            const mfg = manufacturers[i] || '';
            const factory = factories[i] || '';

            if (mfg) {
                if (!manufacturerMap.has(mfg)) {
                    manufacturerMap.set(mfg, []);
                }
                if (factory) {
                    manufacturerMap.get(mfg)!.push(factory);
                }
            } else if (factory) {
                // Factory without manufacturer
                if (!manufacturerMap.has('')) {
                    manufacturerMap.set('', []);
                }
                manufacturerMap.get('')!.push(factory);
            }
        }

        const pairs: ManufacturerInfo[] = [];
        manufacturerMap.forEach((factoryList, mfg) => {
            pairs.push({
                manufacturer: mfg,
                factory: factoryList.join(', ')
            });
        });

        return pairs;
    }

    public sanitizeFluffHtml(text: string | undefined): string {
        if (!text) return '';

        // Replace <p> tags with double newlines for paragraph breaks
        let sanitized = text.replace(/<p>/gi, '\n\n');
        sanitized = sanitized.replace(/<\/p>/gi, '');

        // Strip all remaining HTML tags
        sanitized = sanitized.replace(/<[^>]*>/g, '');

        // Decode common HTML entities
        sanitized = sanitized
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Clean up excessive whitespace and newlines
        sanitized = sanitized
            .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
            .replace(/[ \t]+/g, ' ')     // Normalize spaces
            .trim();

        return sanitized;
    }
}