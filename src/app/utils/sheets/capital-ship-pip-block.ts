// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { SVG_NAMESPACE } from './pip-renderer.shared';

export type CapitalPipType = 'armor' | 'structure';

interface BlockGeometry {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly count: number;
}

interface PipRange {
    readonly start: number;
    readonly end: number;
}

const PIPS_PER_ROW = 10;
const PIPS_PER_BLOCK = 100;
const SHADOW_OFFSET = 0.3;
const BLOCK_SELECTOR = ':scope > .capital-pip-block';
const STATE_CLASSES = Object.freeze({
    damaged: 'capital-pip-state-damaged',
    pendingDamage: 'capital-pip-state-pending-damage',
    freshDamage: 'capital-pip-state-fresh-damage',
    pendingRepair: 'capital-pip-state-pending-repair',
    freshRepair: 'capital-pip-state-fresh-repair',
});

/** Appends one layered, independently clickable block of at most 100 points. */
export function appendCapitalPipBlock(
    parent: SVGGElement,
    startX: number,
    startY: number,
    count: number,
    cellWidth: number,
    cellHeight: number,
    type: CapitalPipType,
    location: string,
    fill = '#fff',
    stroke = '#000',
    strokeWidth = 0.5,
): number {
    const blockCount = Math.min(nonNegativeFloor(count), PIPS_PER_BLOCK);
    const geometry: BlockGeometry = {
        x: startX + 0.5,
        y: startY,
        width: cellWidth,
        height: cellHeight,
        count: blockCount,
    };
    const block = document.createElementNS(SVG_NAMESPACE, 'g');
    block.setAttribute('class', 'capital-pip-block');
    writeGeometry(block, geometry);
    const all = [{ start: 0, end: blockCount }];

    block.appendChild(path(
        'capital-pip-shadow no-autocolor',
        fillPath(geometry, all, cellWidth * SHADOW_OFFSET, cellHeight * SHADOW_OFFSET),
        '#c7c7c7',
    ));
    block.appendChild(path('capital-pip-backdrop', fillPath(geometry, all), fill));
    block.appendChild(path(`capital-pip-state ${STATE_CLASSES.damaged} no-autocolor`, '', '#111'));
    block.appendChild(path(`capital-pip-state ${STATE_CLASSES.pendingDamage} no-autocolor`, '', 'orange'));
    block.appendChild(path(`capital-pip-state ${STATE_CLASSES.pendingRepair} no-autocolor`, '', '#03a9f4'));
    block.appendChild(path(`capital-pip-state ${STATE_CLASSES.freshDamage} no-autocolor`, '', '#ff0'));
    block.appendChild(path(`capital-pip-state ${STATE_CLASSES.freshRepair} no-autocolor`, '', '#80deea'));

    const lines = path('capital-pip-grid-lines', gridPath(geometry, blockCount), 'none');
    lines.setAttribute('stroke', stroke);
    lines.setAttribute('stroke-width', String(strokeWidth));
    lines.setAttribute('stroke-linecap', 'square');
    lines.setAttribute('vector-effect', 'non-scaling-stroke');
    block.appendChild(lines);

    const target = path(
        `capital-pip-interaction pip-hit-area no-autocolor ${type}`,
        fillPath(geometry, all),
        'transparent',
    );
    target.setAttribute('loc', location);
    target.setAttribute('stroke', 'transparent');
    target.setAttribute('pointer-events', 'all');
    target.style.setProperty('fill', 'transparent', 'important');
    target.style.setProperty('stroke', 'transparent', 'important');
    target.style.setProperty('pointer-events', 'all');
    block.appendChild(target);
    parent.appendChild(block);
    return count - blockCount;
}

export function capitalPipGridCapacity(grids: readonly SVGElement[]): number {
    return grids.reduce((sum, grid) => sum + readInteger(grid.getAttribute('data-pip-capacity')), 0);
}

/** Updates aggregate state paths while retaining classic one-render freshness. */
export function renderCapitalPipGridDamage(
    grids: readonly SVGElement[],
    maximum: number,
    committedRemaining: number,
    previewRemaining: number,
    markChanges = false,
): void {
    const safeMaximum = nonNegativeFloor(maximum);
    const committedDamage = Math.max(0, safeMaximum - nonNegativeFloor(committedRemaining));
    const previewDamage = Math.max(0, safeMaximum - nonNegativeFloor(previewRemaining));
    let gridStart = 0;
    grids.forEach(grid => {
        const capacity = readInteger(grid.getAttribute('data-pip-capacity'));
        const visible = clamp(safeMaximum - gridStart, 0, capacity);
        const committed = clamp(committedDamage - gridStart, 0, visible);
        const preview = clamp(previewDamage - gridStart, 0, visible);
        const previous = markChanges
            ? clamp(readInteger(grid.getAttribute('data-rendered-preview-damage')), 0, visible)
            : preview;
        const previousVisible = grid.getAttribute('data-rendered-visible-pips');
        renderGrid(
            grid,
            visible,
            committed,
            preview,
            previous,
            markChanges,
            previousVisible === null || readInteger(previousVisible) !== visible,
        );
        grid.setAttribute('data-rendered-preview-damage', String(preview));
        grid.setAttribute('data-rendered-visible-pips', String(visible));
        gridStart += capacity;
    });
}

function renderGrid(
    grid: SVGElement,
    visible: number,
    committed: number,
    preview: number,
    previous: number,
    markChanges: boolean,
    updateVisiblePaths: boolean,
): void {
    const freshDamage: PipRange[] = markChanges && preview > previous
        ? [{ start: previous, end: preview }]
        : [];
    const freshRepair: PipRange[] = markChanges && preview < previous
        ? [{ start: preview, end: previous }]
        : [];
    const pendingDamage = preview > committed
        ? subtract([{ start: committed, end: preview }], freshDamage)
        : [];
    const pendingRepair = preview < committed
        ? subtract([{ start: preview, end: committed }], freshRepair)
        : [];
    const states: Readonly<Record<string, readonly PipRange[]>> = {
        [STATE_CLASSES.damaged]: [{ start: 0, end: preview }],
        [STATE_CLASSES.pendingDamage]: pendingDamage,
        [STATE_CLASSES.pendingRepair]: pendingRepair,
        [STATE_CLASSES.freshDamage]: freshDamage,
        [STATE_CLASSES.freshRepair]: freshRepair,
    };

    let blockStart = 0;
    grid.querySelectorAll<SVGGElement>(BLOCK_SELECTOR).forEach(block => {
        const geometry = readGeometry(block);
        if (!geometry) return;
        const blockVisible = clamp(visible - blockStart, 0, geometry.count);
        if (updateVisiblePaths) {
            const visibleRanges = blockVisible > 0 ? [{ start: 0, end: blockVisible }] : [];
            setPath(block, '.capital-pip-shadow', fillPath(
                geometry,
                visibleRanges,
                geometry.width * SHADOW_OFFSET,
                geometry.height * SHADOW_OFFSET,
            ));
            setPath(block, '.capital-pip-backdrop', fillPath(geometry, visibleRanges));
            setPath(block, '.capital-pip-grid-lines', gridPath(geometry, blockVisible));
            setPath(block, '.capital-pip-interaction', fillPath(geometry, visibleRanges));
        }
        Object.entries(states).forEach(([className, ranges]) => {
            const local = ranges.map(range => ({
                start: clamp(range.start - blockStart, 0, blockVisible),
                end: clamp(range.end - blockStart, 0, blockVisible),
            })).filter(range => range.end > range.start);
            setPath(block, `.${className}`, fillPath(geometry, local));
        });
        blockStart += geometry.count;
    });
}

function subtract(source: readonly PipRange[], exclusions: readonly PipRange[]): PipRange[] {
    let result = [...source];
    exclusions.forEach(exclusion => {
        result = result.flatMap(range => {
            if (exclusion.end <= range.start || exclusion.start >= range.end) return [range];
            const pieces: PipRange[] = [];
            if (exclusion.start > range.start) {
                pieces.push({ start: range.start, end: Math.min(exclusion.start, range.end) });
            }
            if (exclusion.end < range.end) {
                pieces.push({ start: Math.max(exclusion.end, range.start), end: range.end });
            }
            return pieces;
        });
    });
    return result;
}

function path(className: string, d: string, fill: string): SVGPathElement {
    const element = document.createElementNS(SVG_NAMESPACE, 'path');
    element.setAttribute('class', className);
    element.setAttribute('d', d);
    element.setAttribute('fill', fill);
    element.setAttribute('pointer-events', 'none');
    return element;
}

function writeGeometry(block: SVGGElement, geometry: BlockGeometry): void {
    block.setAttribute('data-pip-block-x', format(geometry.x));
    block.setAttribute('data-pip-block-y', format(geometry.y));
    block.setAttribute('data-pip-cell-width', format(geometry.width));
    block.setAttribute('data-pip-cell-height', format(geometry.height));
    block.setAttribute('data-pip-block-count', String(geometry.count));
}

function readGeometry(block: SVGGElement): BlockGeometry | null {
    const x = Number(block.getAttribute('data-pip-block-x'));
    const y = Number(block.getAttribute('data-pip-block-y'));
    const width = Number(block.getAttribute('data-pip-cell-width'));
    const height = Number(block.getAttribute('data-pip-cell-height'));
    const count = readInteger(block.getAttribute('data-pip-block-count'));
    return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 && count > 0
        ? { x, y, width, height, count }
        : null;
}

function fillPath(
    geometry: BlockGeometry,
    ranges: readonly PipRange[],
    offsetX = 0,
    offsetY = 0,
): string {
    if (geometry.count === 0 || ranges.length === 0) return '';
    const selected = Array<boolean>(geometry.count).fill(false);
    ranges.forEach(range => {
        const start = clamp(Math.floor(range.start), 0, geometry.count);
        const end = clamp(Math.ceil(range.end), 0, geometry.count);
        for (let index = start; index < end; index++) selected[index] = true;
    });
    const commands: string[] = [];
    for (let row = 0; row < Math.ceil(geometry.count / PIPS_PER_ROW); row++) {
        const rowCount = Math.min(PIPS_PER_ROW, geometry.count - row * PIPS_PER_ROW);
        const rowX = geometry.x + (PIPS_PER_ROW - rowCount) / 2 * geometry.width;
        let runStart = -1;
        for (let column = 0; column <= rowCount; column++) {
            const active = column < rowCount && selected[row * PIPS_PER_ROW + column] === true;
            if (active && runStart < 0) runStart = column;
            if (!active && runStart >= 0) {
                commands.push(rectanglePath(
                    rowX + runStart * geometry.width + offsetX,
                    geometry.y + row * geometry.height + offsetY,
                    (column - runStart) * geometry.width,
                    geometry.height,
                ));
                runStart = -1;
            }
        }
    }
    return commands.join(' ');
}

function gridPath(geometry: BlockGeometry, visible: number): string {
    const count = clamp(visible, 0, geometry.count);
    const commands: string[] = [];
    for (let row = 0; row < Math.ceil(count / PIPS_PER_ROW); row++) {
        const rowCount = Math.min(PIPS_PER_ROW, count - row * PIPS_PER_ROW);
        const x = geometry.x + (PIPS_PER_ROW - rowCount) / 2 * geometry.width;
        const y = geometry.y + row * geometry.height;
        commands.push(rectanglePath(x, y, rowCount * geometry.width, geometry.height));
        for (let column = 1; column < rowCount; column++) {
            commands.push(`M${format(x + column * geometry.width)} ${format(y)}V${format(y + geometry.height)}`);
        }
    }
    return commands.join(' ');
}

function rectanglePath(x: number, y: number, width: number, height: number): string {
    return `M${format(x)} ${format(y)}H${format(x + width)}V${format(y + height)}H${format(x)}Z`;
}

function setPath(block: SVGGElement, selector: string, d: string): void {
    block.querySelector<SVGPathElement>(selector)?.setAttribute('d', d);
}

function nonNegativeFloor(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function readInteger(value: string | null): number {
    return nonNegativeFloor(Number(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function format(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1_000_000) / 1_000_000);
}
