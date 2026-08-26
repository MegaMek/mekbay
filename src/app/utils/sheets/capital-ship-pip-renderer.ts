// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PipRenderOptions } from './pip-renderer.types';
import { PipRendererShared, SVG_NAMESPACE } from './pip-renderer.shared';

type CapitalShipPipType = 'armor' | 'structure';

const ARMOR_PIP_SIZE = 4.5;
const STRUCTURE_PIP_SIZE = 4;
const PIPS_PER_ROW = 10;
const MAX_PIP_ROWS = 10;
const PIPS_PER_ARMOR_BLOCK = PIPS_PER_ROW * MAX_PIP_ROWS;
const ARMOR_SHADOW_OFFSET = 0.3;
const ARMOR_SHADOW_FILL = '#c7c7c7';

/**
 * Reproduces MegaMekLab's compact square grids for capital-vessel armor and
 * structure. Geometry is relative to the authored placeholder rectangle.
 */
export class CapitalShipPipRenderer {

    public static createPips(
        count: number,
        containerWidth: number,
        containerHeight: number,
        type: CapitalShipPipType,
        location: string,
        options: PipRenderOptions = {},
    ): SVGGElement | null {
        if (!Number.isFinite(count)
            || count <= 0
            || !Number.isFinite(containerWidth)
            || containerWidth <= 0
            || !Number.isFinite(containerHeight)
            || containerHeight <= 0) {
            return null;
        }

        const pipCount = Math.floor(count);
        const group = PipRendererShared.createGroup(
            options,
            type,
            location,
            pipCount,
            'capital-grid',
        );
        if (type === 'armor') {
            this.appendArmorPips(group, pipCount, containerWidth, containerHeight, location, options);
        } else {
            this.appendStructurePips(group, pipCount, containerWidth, location, options);
        }
        return group;
    }

    private static appendArmorPips(
        group: SVGGElement,
        count: number,
        containerWidth: number,
        containerHeight: number,
        location: string,
        options: PipRenderOptions,
    ): void {
        let pipWidth = ARMOR_PIP_SIZE;
        let pipHeight = ARMOR_PIP_SIZE;
        let blockWidth = (PIPS_PER_ROW + 1) * pipWidth;
        let blockHeight = (MAX_PIP_ROWS + 1) * pipHeight;
        const blockCount = Math.ceil(count / PIPS_PER_ARMOR_BLOCK);
        let rows = 1;
        let columns = 1;

        if (containerWidth > containerHeight) {
            columns = blockCount;
            if (blockCount * blockWidth > containerWidth) {
                rows = 2;
                columns = Math.ceil(blockCount / 2);
            }
        } else {
            rows = blockCount;
            if (blockCount * blockHeight > containerHeight) {
                columns = 2;
                rows = Math.ceil(blockCount / 2);
            }
        }

        const ratio = Math.max(
            rows * blockHeight / containerHeight,
            columns * blockWidth / containerWidth,
        );
        if (ratio > 1) {
            pipWidth /= ratio;
            pipHeight /= ratio;
            blockWidth /= ratio;
            blockHeight /= ratio;
        }

        const startX = (containerWidth - (blockWidth * columns - ARMOR_PIP_SIZE)) / 2;
        const leftOver = count % PIPS_PER_ARMOR_BLOCK;
        let actualHeight = blockHeight * rows;
        if (leftOver > 0 && (columns === 1 || blockCount % columns === 1)) {
            const missingRows = MAX_PIP_ROWS - Math.floor(leftOver / PIPS_PER_ROW) - 1;
            actualHeight -= ARMOR_PIP_SIZE * missingRows;
        }
        const startY = (containerHeight - actualHeight) / 2;

        let remaining = count;
        let remainingBlocks = blockCount;
        let y = startY;
        let x = startX;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns && remaining > 0; column++) {
                remaining = this.appendPipBlock(
                    group,
                    x,
                    y,
                    remaining,
                    pipWidth,
                    pipHeight,
                    'armor',
                    location,
                    options,
                    true,
                );
                remainingBlocks--;
                x += blockWidth;
            }
            y += blockWidth;
            x = startX;
            if (remainingBlocks > 0 && remainingBlocks < columns) {
                x += blockWidth / 2;
            }
        }
    }

    private static appendStructurePips(
        group: SVGGElement,
        count: number,
        containerWidth: number,
        location: string,
        options: PipRenderOptions,
    ): void {
        const blockWidth = PIPS_PER_ROW * STRUCTURE_PIP_SIZE;
        const pipsPerBlock = this.structurePipsPerBlock(location);
        const firstBlockCount = count > pipsPerBlock ? Math.floor(count / 2) : count;
        const startX = count > pipsPerBlock
            ? containerWidth / 2 - blockWidth - STRUCTURE_PIP_SIZE * 0.5
            : containerWidth / 2 - blockWidth * 0.5;
        this.appendPipBlock(
            group,
            startX,
            0,
            firstBlockCount,
            STRUCTURE_PIP_SIZE,
            STRUCTURE_PIP_SIZE,
            'structure',
            location,
            options,
            false,
        );
        if (count > firstBlockCount) {
            this.appendPipBlock(
                group,
                startX + blockWidth + STRUCTURE_PIP_SIZE,
                0,
                count - firstBlockCount,
                STRUCTURE_PIP_SIZE,
                STRUCTURE_PIP_SIZE,
                'structure',
                location,
                options,
                false,
            );
        }
    }

    private static appendPipBlock(
        group: SVGGElement,
        startX: number,
        startY: number,
        count: number,
        pipWidth: number,
        pipHeight: number,
        type: CapitalShipPipType,
        location: string,
        options: PipRenderOptions,
        shadow: boolean,
    ): number {
        let remaining = count;
        let y = startY;
        for (let row = 0; row < MAX_PIP_ROWS && remaining > 0; row++) {
            const rowPips = Math.min(remaining, PIPS_PER_ROW);
            let x = startX + (PIPS_PER_ROW - rowPips) / 2 * pipWidth + 0.5;
            for (let column = 0; column < rowPips; column++) {
                if (shadow) {
                    group.appendChild(this.createSquare(
                        x + pipWidth * ARMOR_SHADOW_OFFSET,
                        y + pipHeight * ARMOR_SHADOW_OFFSET,
                        pipWidth,
                        pipHeight,
                        ARMOR_SHADOW_FILL,
                        null,
                        null,
                        true,
                    ));
                }
                group.appendChild(this.createSquare(
                    x,
                    y,
                    pipWidth,
                    pipHeight,
                    options.fill ?? '#fff',
                    options.stroke ?? '#000',
                    0.5,
                    false,
                    type,
                    location,
                ));
                x += pipWidth;
                remaining--;
            }
            y += pipHeight;
        }
        return remaining;
    }

    private static createSquare(
        x: number,
        y: number,
        width: number,
        height: number,
        fill: string,
        stroke: string | null,
        strokeWidth: number | null,
        shadow: boolean,
        type?: CapitalShipPipType,
        location?: string,
    ): SVGRectElement {
        const square = document.createElementNS(SVG_NAMESPACE, 'rect');
        square.setAttribute('x', x.toString());
        square.setAttribute('y', y.toString());
        square.setAttribute('width', width.toString());
        square.setAttribute('height', height.toString());
        square.setAttribute('fill', fill);
        if (shadow) {
            square.setAttribute('data-pip-shadow', '1');
            square.style.setProperty('pointer-events', 'none');
        } else {
            square.classList.add('square');
            if (type) square.classList.add(type);
            if (location) square.setAttribute('loc', location);
        }
        if (stroke !== null) square.setAttribute('stroke', stroke);
        if (strokeWidth !== null) square.setAttribute('stroke-width', strokeWidth.toString());
        return square;
    }

    private static structurePipsPerBlock(location: string): number {
        switch (location.toUpperCase()) {
            case 'KF': return 30;
            case 'SAIL':
            case 'DC': return 10;
            case 'SI':
            default: return 100;
        }
    }
}
