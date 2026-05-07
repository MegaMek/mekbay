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
import type { UnitComponent } from '../../../models/units.model';

type SlotSpec = string | string[];
type MatrixSpec = SlotSpec[][];
type ComponentCompare = (left: UnitComponent, right: UnitComponent) => number;

export type ComponentBayLocationGroup = { l: string; p: number; bays: UnitComponent[] };
export type ComponentMatrixAreaView = { area: string; label: string; caseLabel: string; bays: UnitComponent[]; components: UnitComponent[] };
export type ComponentMatrixLayoutData = {
    gridAreas: string;
    matrixAreaCodes: string[];
    areaNameToCodes: Map<string, string[]>;
    baysForArea: Map<string, UnitComponent[]>;
    compsForArea: Map<string, UnitComponent[]>;
};

// '~' = if no content, expand the area from above
// '^' = if no content, borrow content from above (cannot move past anchor)
// '!' prefix = anchor (content cannot move upward, area cannot expand downward)
const COMPONENT_MATRIX_ALIGNMENT: Record<string, MatrixSpec> = {
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

export function hasComponentMatrixLayout(unitType: string | undefined): boolean {
    return !!unitType && Array.isArray(COMPONENT_MATRIX_ALIGNMENT[unitType]);
}

export function normalizeComponentLocation(loc: string): string {
    if (!loc) return 'UNK';
    let normalized = (loc === '*') ? 'ALL' : loc.trim();
    normalized = normalized.replace(/[^A-Za-z0-9_-]/g, '');
    if (/^[0-9]/.test(normalized)) normalized = 'L' + normalized;
    return normalized || 'UNK';
}

export function buildComponentMatrixLayout(
    unitType: string | undefined,
    groupedBays: ComponentBayLocationGroup[],
    groupedLayoutComponents: UnitComponent[],
    compareComponents: ComponentCompare
): ComponentMatrixLayoutData {
    const matrix = unitType ? COMPONENT_MATRIX_ALIGNMENT[unitType] : undefined;
    if (!Array.isArray(matrix)) {
        return createEmptyMatrixLayoutData();
    }

    const getBaysByLoc = (loc: string): UnitComponent[] => {
        const matched = groupedBays.filter(group => normalizeComponentLocation(group.l) === loc);
        if (!matched.length) return [];

        const byName = new Map<string, UnitComponent>();
        for (const group of matched) {
            for (const bay of group.bays) {
                const key = bay.n ?? '';
                if (!byName.has(key)) byName.set(key, { ...bay });
                else {
                    const aggregate = byName.get(key)!;
                    aggregate.q = (aggregate.q || 1) + (bay.q || 1);
                }
            }
        }
        return Array.from(byName.values()).sort(compareComponentsByName);
    };

    const getCompsForLoc = (loc: string): UnitComponent[] => {
        return groupedLayoutComponents.filter(component => normalizeComponentLocation(component.l) === loc);
    };

    const { names, areaCodes } = normalizeMatrix(matrix, getBaysByLoc, getCompsForLoc);
    const filteredNames = names.filter(row => row.some(name => name !== '.'));

    const matrixDeclaredCodes = new Set<string>();
    for (const codes of areaCodes.values()) {
        for (const code of codes) matrixDeclaredCodes.add(code);
    }

    const allUnitLocs = new Set<string>();
    for (const component of groupedLayoutComponents) {
        if (component.l) allUnitLocs.add(normalizeComponentLocation(component.l));
    }
    for (const group of groupedBays) {
        if (group.l) allUnitLocs.add(normalizeComponentLocation(group.l));
    }

    const extraCodes = Array.from(allUnitLocs).filter(location => !matrixDeclaredCodes.has(location));
    if (extraCodes.length) {
        const cols = matrix[0]?.length ?? 0;
        let extraIndex = 0;
        while (extraIndex < extraCodes.length) {
            const row: string[] = Array(cols).fill('.');
            for (let col = 0; col < cols && extraIndex < extraCodes.length; col++, extraIndex++) {
                const code = extraCodes[extraIndex];
                row[col] = code;
                if (!areaCodes.has(code)) areaCodes.set(code, [code]);
            }
            filteredNames.push(row);
        }
    }

    if (!filteredNames.length) {
        return createEmptyMatrixLayoutData();
    }

    const matrixAreaCodes = getMatrixAreaCodes(filteredNames);
    const baysForArea = new Map<string, UnitComponent[]>();
    const compsForArea = new Map<string, UnitComponent[]>();

    for (const area of matrixAreaCodes) {
        const codes = areaCodes.get(area) ?? [area];
        baysForArea.set(area, getMergedBaysForCodes(codes, getBaysByLoc));
        compsForArea.set(area, codes
            .flatMap(code => getCompsForLoc(code))
            .sort(compareComponents));
    }

    return {
        gridAreas: computeGridAreas(filteredNames),
        matrixAreaCodes,
        areaNameToCodes: areaCodes,
        baysForArea,
        compsForArea
    };
}

export function createComponentMatrixAreas(
    matrixData: ComponentMatrixLayoutData,
    caseByLocation: Map<string, string>
): ComponentMatrixAreaView[] {
    return matrixData.matrixAreaCodes.map(area => {
        const codes = matrixData.areaNameToCodes.get(area) ?? [area];
        const caseCode = codes.find(code => caseByLocation.has(code));
        return {
            area,
            label: getMatrixAreaLabel(codes, matrixData.baysForArea, matrixData.compsForArea),
            caseLabel: caseCode ? caseByLocation.get(caseCode)! : '',
            bays: matrixData.baysForArea.get(area) ?? [],
            components: matrixData.compsForArea.get(area) ?? []
        };
    });
}

function createEmptyMatrixLayoutData(): ComponentMatrixLayoutData {
    return {
        gridAreas: '',
        matrixAreaCodes: [],
        areaNameToCodes: new Map<string, string[]>(),
        baysForArea: new Map<string, UnitComponent[]>(),
        compsForArea: new Map<string, UnitComponent[]>()
    };
}

function compareComponentsByName(left: UnitComponent, right: UnitComponent): number {
    if (left.n === right.n) return 0;
    if (left.n === undefined) return 1;
    if (right.n === undefined) return -1;
    return left.n.localeCompare(right.n);
}

function getMergedBaysForCodes(codes: string[], getBaysByLoc: (loc: string) => UnitComponent[]): UnitComponent[] {
    const merged = new Map<string, UnitComponent>();
    for (const code of codes) {
        for (const bay of getBaysByLoc(code)) {
            const key = bay.n ?? '';
            if (!merged.has(key)) merged.set(key, { ...bay });
            else {
                const aggregate = merged.get(key)!;
                aggregate.q = (aggregate.q || 1) + (bay.q || 1);
            }
        }
    }
    return Array.from(merged.values()).sort(compareComponentsByName);
}

function getMatrixAreaCodes(names: string[][]): string[] {
    const seen = new Set<string>();
    const matrixAreaCodes: string[] = [];
    for (const row of names) {
        for (const name of row) {
            if (name === '.' || seen.has(name)) continue;
            seen.add(name);
            matrixAreaCodes.push(name);
        }
    }
    return matrixAreaCodes;
}

function getMatrixAreaLabel(
    codes: string[],
    baysForArea: Map<string, UnitComponent[]>,
    compsForArea: Map<string, UnitComponent[]>
): string {
    const present = new Set<string>();
    for (const code of codes) {
        if ((baysForArea.get(code)?.length ?? 0) > 0) present.add(code);
        if ((compsForArea.get(code)?.length ?? 0) > 0) present.add(code);
    }
    if (present.size === 0) return '';
    return Array.from(present).map(code => code === 'ALL' ? '*' : code).join('/');
}

function parseSlotSpec(slot: SlotSpec): {
    codes: string[];
    hasFallback: boolean;
    hasBorrowUp: boolean;
    anchorCodes: string[];
} {
    const specs = Array.isArray(slot) ? slot : [slot];
    const codes: string[] = [];
    const anchorCodes: string[] = [];
    let hasFallback = false;
    let hasBorrowUp = false;

    for (let raw of specs) {
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

function normalizeMatrix(
    matrix: MatrixSpec,
    getBaysByLoc: (loc: string) => UnitComponent[],
    getCompsForLoc: (loc: string) => UnitComponent[]
): { names: string[][]; areaCodes: Map<string, string[]> } {
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
        getBaysByLoc(code).length > 0 ||
        getCompsForLoc(code).length > 0;

    const meta: CellMeta[][] = [];
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
        const row = matrix[rowIndex];
        const metaRow: CellMeta[] = [];
        for (let col = 0; col < expectedCols; col++) {
            const spec = row[col];
            const { codes, hasFallback, hasBorrowUp, anchorCodes } = parseSlotSpec(spec);
            const contentCodes = codes.filter(codeHasContent);
            const anchorActive = contentCodes.some(code => anchorCodes.includes(code));
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

    for (let row = 0; row < meta.length; row++) {
        for (let col = 0; col < expectedCols; col++) {
            const cell = meta[row][col];
            if (cell.hasBorrowUp && !cell.hasContent) cell.borrowUpActive = true;
        }
    }

    moveContentUpIntoBorrowSlots(meta, expectedCols);

    const metaForNaming = meta.filter(row => row.some(cell => cell.hasContent));
    if (!metaForNaming.length) {
        return { names: [], areaCodes: new Map() };
    }

    return nameMatrixAreas(metaForNaming, expectedCols);
}

function moveContentUpIntoBorrowSlots(meta: Array<Array<{
    codes: string[];
    hasFallback: boolean;
    hasContent: boolean;
    borrowUpActive: boolean;
    contentCodes: string[];
    anchorActive: boolean;
}>>, expectedCols: number): void {
    for (let col = 0; col < expectedCols; col++) {
        let changed = true;
        while (changed) {
            changed = false;
            for (let row = meta.length - 1; row >= 0; row--) {
                const source = meta[row][col];
                if (!source.hasContent || source.anchorActive) continue;

                let targetRow = row - 1;
                if (targetRow < 0 || !meta[targetRow][col].borrowUpActive) continue;
                while (targetRow - 1 >= 0 && meta[targetRow - 1][col].borrowUpActive) targetRow--;

                const destination = meta[targetRow][col];
                if (destination.anchorActive) continue;

                destination.codes = [...source.codes];
                destination.contentCodes = [...source.contentCodes];
                destination.hasContent = true;
                source.hasContent = false;
                source.hasFallback = true;
                source.contentCodes = [];
                source.anchorActive = false;
                for (let clearedRow = targetRow + 1; clearedRow < row; clearedRow++) {
                    meta[clearedRow][col].hasContent = false;
                    meta[clearedRow][col].contentCodes = [];
                    meta[clearedRow][col].hasFallback = true;
                    meta[clearedRow][col].anchorActive = false;
                }
                changed = true;
                break;
            }
        }
    }
}

function nameMatrixAreas(meta: Array<Array<{
    codes: string[];
    hasFallback: boolean;
    hasContent: boolean;
    contentCodes: string[];
    anchorActive: boolean;
}>>, expectedCols: number): { names: string[][]; areaCodes: Map<string, string[]> } {
    const names: string[][] = [];
    const areaCodes = new Map<string, string[]>();
    const usedAreaNames = new Set<string>();

    const makeUnique = (baseValue: string): string => {
        const base = baseValue || 'A';
        if (!usedAreaNames.has(base)) {
            usedAreaNames.add(base);
            return base;
        }
        let index = 2;
        while (usedAreaNames.has(`${base}_${index}`)) index++;
        const unique = `${base}_${index}`;
        usedAreaNames.add(unique);
        return unique;
    };

    for (let rowIndex = 0; rowIndex < meta.length; rowIndex++) {
        const row = meta[rowIndex];
        const rowNames: string[] = [];
        for (let col = 0; col < expectedCols; col++) {
            const cell = row[col];
            if (!cell) {
                rowNames.push('.');
                continue;
            }

            const aboveName = rowIndex > 0 ? names[rowIndex - 1][col] : undefined;
            const aboveMeta = rowIndex > 0 ? meta[rowIndex - 1][col] : undefined;
            let areaName = '.';

            if (cell.hasContent) {
                const base = (cell.contentCodes[0] || cell.codes[0] || '').trim();
                if (aboveName && aboveName === base && !(aboveMeta?.anchorActive)) {
                    areaName = aboveName;
                } else {
                    areaName = makeUnique(base);
                    if (!areaCodes.has(areaName)) areaCodes.set(areaName, []);
                    const list = areaCodes.get(areaName)!;
                    for (const code of cell.contentCodes) {
                        if (!list.includes(code)) list.push(code);
                    }
                }
            } else if (cell.hasFallback && aboveName && aboveName !== '.' && !(aboveMeta?.anchorActive)) {
                areaName = aboveName;
            }

            rowNames.push(areaName);
        }
        names.push(rowNames);
    }

    return { names, areaCodes };
}

function computeGridAreas(names: string[][]): string {
    if (!names.length) return '';
    const cols = names[0].length;
    const sanitized = names.map(row => {
        if (row.length < cols) return [...row, ...Array(cols - row.length).fill('.')];
        if (row.length > cols) return row.slice(0, cols);
        return row;
    });
    return sanitized.map(row => `"${row.join(' ')}"`).join(' ');
}