// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    PipPoint,
    PipRenderOptions,
    PipShapeSpan,
} from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';
import type { PipShapeProfile } from './pip-shape-profile';

interface CBTRow {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly gap: CBTGap;
    count: number;
}

interface CBTGap {
    readonly left: number;
    readonly right: number;
}

interface CBTLayout {
    readonly points: readonly PipPoint[];
    readonly radius: number;
}

const DEFAULT_PIP_SIZE = 0.38;
const DEFAULT_STROKE_WIDTH = 0.5;
const PRECISION = 0.01;

/**
 * Ports MegaMekLab's ArmorPipLayout geometry. Unlike the maximum-radius
 * distributed layout, this preserves the authored template's row rhythm so a
 * generated paperdoll overlays the classic sheet.
 */
export class CBTPipRenderer {
    public static createPips(
        shapeProfile: PipShapeProfile,
        count: number,
        options: PipRenderOptions = {},
        type = 'armor',
        location = '',
        dataLayout: 'classic' | 'distributed' = 'classic',
    ): SVGGElement | null {
        const pipCount = Math.floor(count);
        if (!Number.isFinite(count) || pipCount <= 0) return null;

        const layout = this.createLayout(shapeProfile, pipCount, options);
        if (!layout) return null;

        const group = PipRendererShared.createGroup(options, type, location, pipCount, dataLayout);
        const strokeWidth = Number.isFinite(options.strokeWidth)
            ? Math.max(options.strokeWidth ?? DEFAULT_STROKE_WIDTH, 0)
            : DEFAULT_STROKE_WIDTH;
        for (const point of layout.points) {
            group.appendChild(PipRendererShared.createPipElement(
                point,
                layout.radius,
                options,
                strokeWidth,
            ));
        }
        return group;
    }

    private static createLayout(
        profile: PipShapeProfile,
        pipCount: number,
        options: PipRenderOptions,
    ): CBTLayout | null {
        const spans = profile.spans;
        const { left, top, right, bottom } = profile.bounds;
        const width = right - left;
        const height = bottom - top;
        const averageHeight = profile.averageSpanHeight;
        const averageWidth = spans.reduce(
            (sum, span) => sum + span.width - this.gapWidth(span),
            0,
        ) / spans.length;
        if (width <= 0 || height <= 0 || averageHeight <= 0 || averageWidth <= 0) return null;

        let rowTarget = Math.max(1, Math.round(Math.sqrt(pipCount * height / width)));
        rowTarget = Math.min(rowTarget, pipCount);
        let columnTarget = Math.min(
            Math.floor(pipCount / rowTarget),
            Math.floor(averageWidth / averageHeight),
        );
        while (columnTarget * rowTarget < pipCount && rowTarget <= pipCount) {
            if (averageWidth / columnTarget > height / rowTarget) columnTarget++;
            else rowTarget++;
        }

        let radius = averageHeight * DEFAULT_PIP_SIZE;
        let spacing = Math.min(averageHeight, height / rowTarget);
        const staggered = spacing < averageHeight;
        if (staggered) radius = Math.min(radius, spacing * 0.5);

        spacing = Math.sqrt(spacing * rowTarget / height) * height / rowTarget;
        let yPosition = Math.max(
            top,
            top + (height - spacing * rowTarget) / 2 + spacing * 0.5 - radius,
        );
        const rows: CBTRow[] = [];
        let shift = 0;
        let parity = columnTarget % 2;
        for (let index = 0; index < rowTarget; index++) {
            const upper = this.floorSpan(spans, yPosition);
            const lower = this.ceilingSpan(spans, yPosition) ?? upper;
            const rowLeft = Math.max(upper.x, lower.x);
            const rowRight = Math.min(upper.x + upper.width, lower.x + lower.width);
            const gap = this.mergeGaps(rowLeft, rowRight, upper.gap, lower.gap);
            if (gap.right > gap.left
                && gap.left <= rowLeft + PRECISION
                && gap.right >= rowRight - PRECISION) {
                yPosition += spacing;
                continue;
            }

            const usableWidth = Math.max(0, rowRight - rowLeft - (gap.right - gap.left));
            let rowCount = staggered
                ? Math.floor(columnTarget * usableWidth / averageWidth * 0.5)
                : Math.floor(columnTarget * usableWidth / averageWidth);
            const mirror = gap.right > gap.left
                && Math.abs((gap.left - rowLeft) - (rowRight - gap.right)) < spacing;
            if (mirror && rowCount % 2 === 1 || !mirror && rowCount % 2 !== parity) {
                if (shift <= 0 || rowCount === 0) {
                    rowCount++;
                    shift--;
                } else {
                    rowCount--;
                    shift++;
                }
                if (rowCount * spacing * 2 > rowRight - rowLeft && rowCount >= 2) rowCount -= 2;
            }
            rows.push({ left: rowLeft, top: yPosition, right: rowRight, gap, count: rowCount });
            yPosition += spacing;
            if (staggered) parity = 1 - parity;
        }
        if (rows.length === 0) return null;

        const xSpacing = this.adjustCount(pipCount, rows, staggered, spacing);
        radius = Math.min(radius, xSpacing * 0.4);
        const requestedRadius = PipRendererShared.getRequestedPipRadius(options);
        if (Number.isFinite(requestedRadius) && requestedRadius > 0) {
            radius = Math.min(radius, requestedRadius);
        }
        return { points: this.drawPoints(rows, staggered, radius, xSpacing), radius };
    }

    private static adjustCount(
        pipCount: number,
        rows: CBTRow[],
        staggered: boolean,
        initialSpacing: number,
    ): number {
        let spacing = initialSpacing;
        let current = rows.reduce((sum, row) => sum + row.count, 0);
        if (current === pipCount) return spacing;

        const indices = rows.map((_row, index) => index).sort((first, second) => {
            const firstWidth = this.usableWidth(rows[first]);
            const secondWidth = this.usableWidth(rows[second]);
            return rows[first].count / Math.max(firstWidth, Number.EPSILON)
                - rows[second].count / Math.max(secondWidth, Number.EPSILON);
        });
        const mirrored = rows.map(row => this.isMirrored(row, spacing));
        const allMirrored = mirrored.every(Boolean);
        const rowDelta = staggered ? 2 : 1;
        let rowCursor = 0;
        let minimum = true;
        let safety = 0;
        do {
            let skipped = 0;
            while (current !== pipCount && skipped < rows.length) {
                const index = indices[rowCursor % indices.length];
                const row = rows[index];
                const mirror = mirrored[index] && (!allMirrored || Math.abs(pipCount - current) > 1);
                if (pipCount > current) {
                    const change = pipCount - current === 1
                        ? mirror ? 0 : 1
                        : mirror ? 2 : rowDelta;
                    if (change > 0 && spacing * (row.count + change) <= this.usableWidth(row)) {
                        row.count += change;
                        current += change;
                    } else skipped++;
                } else {
                    let change = current - pipCount === 1
                        ? mirror && minimum ? 0 : 1
                        : mirror ? 2 : rowDelta;
                    if (minimum && row.count - change <= 0) change = 0;
                    else change = Math.min(change, row.count);
                    if (change > 0) {
                        row.count -= change;
                        current -= change;
                    } else skipped++;
                }
                rowCursor++;
            }
            if (current === pipCount) break;
            if (skipped === rows.length) {
                if (current < pipCount) spacing *= 0.95;
                else minimum = false;
            }
            safety++;
        } while (safety < 10_000);
        return spacing;
    }

    private static drawPoints(
        rows: readonly CBTRow[],
        staggered: boolean,
        radius: number,
        xSpacing: number,
    ): PipPoint[] {
        let dx = staggered ? xSpacing * 2 : xSpacing;
        let density = 0;
        for (const row of rows) {
            const sections = row.gap.right > row.gap.left ? 2 : 1;
            if (row.count > sections) {
                density = Math.max(density, dx * row.count / this.usableWidth(row));
            }
        }
        if (density > 1) dx /= density;
        else if (density > 0) dx /= Math.sqrt(density);

        let centerX = (rows[0].left + rows[0].right) / 2;
        const xPadding = dx * 0.5 - radius;
        const points: PipPoint[] = [];
        for (const row of rows) {
            if (row.gap.right > row.gap.left) {
                const leftWidth = row.gap.left - row.left;
                const rightWidth = row.right - row.gap.right;
                const leftCount = Math.round(row.count * leftWidth / (leftWidth + rightWidth));
                this.drawRowPoints(points, row.left, row.gap.left, row.top, leftCount, radius, dx, centerX, xPadding);
                this.drawRowPoints(points, row.gap.right, row.right, row.top, row.count - leftCount,
                    radius, dx, centerX, xPadding);
                centerX = (row.left + row.right) / 2;
            } else {
                centerX = this.drawRowPoints(
                    points, row.left, row.right, row.top, row.count, radius, dx, centerX, xPadding);
            }
        }
        return points;
    }

    private static drawRowPoints(
        points: PipPoint[],
        left: number,
        right: number,
        y: number,
        count: number,
        _radius: number,
        dx: number,
        centerX: number,
        xPadding: number,
    ): number {
        if (count <= 0) return centerX;
        let xPosition = centerX - dx * (count / 2) + xPadding;
        while (xPosition < left) xPosition += dx;
        while (xPosition + dx * count > right) xPosition -= dx;
        if (xPosition < left || count === 1) {
            centerX = (left + right) / 2;
            xPosition = centerX - dx * (count / 2) + xPadding;
        }
        for (let index = 0; index < count; index++) {
            // ArmorPipLayout passes the cell's top-left coordinate to
            // PrintRecordSheet.createPip(), which stores the circle center one
            // radius inward on each axis.
            points.push({ x: xPosition + _radius, y: y + _radius });
            xPosition += dx;
        }
        return centerX;
    }

    private static floorSpan(spans: readonly PipShapeSpan[], y: number): PipShapeSpan {
        let result = spans[0];
        for (const span of spans) {
            if (span.y <= y) result = span;
            else break;
        }
        return result;
    }

    private static ceilingSpan(spans: readonly PipShapeSpan[], y: number): PipShapeSpan | null {
        return spans.find(span => span.y >= y) ?? null;
    }

    private static mergeGaps(
        rowLeft: number,
        rowRight: number,
        first: PipShapeSpan['gap'],
        second: PipShapeSpan['gap'],
    ): CBTGap {
        if (!first && !second) return { left: 0, right: 0 };
        const left = first && second ? Math.min(first.left, second.left) : (first ?? second)!.left;
        const right = first && second ? Math.max(first.right, second.right) : (first ?? second)!.right;
        return {
            left: Math.max(left, rowLeft),
            right: Math.min(right, rowRight),
        };
    }

    private static gapWidth(span: PipShapeSpan): number {
        return span.gap ? Math.max(0, span.gap.right - span.gap.left) : 0;
    }

    private static usableWidth(row: CBTRow): number {
        return row.right - row.left - Math.max(0, row.gap.right - row.gap.left);
    }

    private static isMirrored(row: CBTRow, spacing: number): boolean {
        return row.gap.right > row.gap.left
            && Math.abs((row.gap.left - row.left) - (row.right - row.gap.right)) < spacing;
    }
}
