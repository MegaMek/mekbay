// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PipRenderOptions } from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';
import {
    appendCapitalPipBlock,
    capitalPipGridCapacity,
    renderCapitalPipGridDamage,
    type CapitalPipType,
} from './capital-ship-pip-block';

const ARMOR_PIP_SIZE = 4.5;
const STRUCTURE_PIP_SIZE = 4;
const PIPS_PER_ROW = 10;
const MAX_PIP_ROWS = 10;
const PIPS_PER_ARMOR_BLOCK = PIPS_PER_ROW * MAX_PIP_ROWS;

/**
 * Reproduces MegaMekLab's compact square grids for capital-vessel armor and
 * structure using aggregate block paths.
 */
export class CapitalShipPipRenderer {

    public static createPips(
        count: number,
        containerWidth: number,
        containerHeight: number,
        type: CapitalPipType,
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
        group.classList.add('capital-pip-grid', type);
        group.setAttribute('loc', location);
        group.setAttribute('data-pip-capacity', String(pipCount));
        group.setAttribute('data-rendered-visible-pips', String(pipCount));
        if (type === 'armor') {
            this.appendArmorPips(group, pipCount, containerWidth, containerHeight, location, options);
        } else {
            this.appendStructurePips(group, pipCount, containerWidth, location, options);
        }
        return group;
    }

    public static capacity(grids: readonly SVGElement[]): number {
        return capitalPipGridCapacity(grids);
    }

    public static renderDamage(
        grids: readonly SVGElement[],
        maximum: number,
        committedRemaining: number,
        previewRemaining: number,
        markChanges = false,
    ): void {
        renderCapitalPipGridDamage(
            grids,
            maximum,
            committedRemaining,
            previewRemaining,
            markChanges,
        );
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
        type: CapitalPipType,
        location: string,
        options: PipRenderOptions,
    ): number {
        return appendCapitalPipBlock(
            group,
            startX,
            startY,
            count,
            pipWidth,
            pipHeight,
            type,
            location,
            options.fill,
            options.stroke,
            options.strokeWidth,
        );
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
