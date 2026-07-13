import type {
    PipPoint,
    PipRenderOptions,
    PipRow,
} from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';

interface DistributedPipLayout {
    readonly points: readonly PipPoint[];
    readonly maximumRadius: number;
}

interface DistributedPipRow {
    left: number;
    top: number;
    right: number;
    count: number;
}

export class DistributedPipRenderer {

    public static createPips(
        rows: readonly PipRow[],
        count: number,
        options: PipRenderOptions = {},
        type = 'shield',
        location = '',
    ): SVGGElement | null {
        if (!Number.isFinite(count) || count <= 0 || rows.length === 0) {
            return null;
        }

        const pipCount = Math.floor(count);
        const sortedRows = rows
            .filter(row => row.width > 0 && row.height > 0)
            .slice()
            .sort((left, right) => left.y - right.y);
        if (pipCount <= 0 || sortedRows.length === 0) {
            return null;
        }

        const minX = Math.min(...sortedRows.map(row => row.x));
        const minY = Math.min(...sortedRows.map(row => row.y));
        const maxX = Math.max(...sortedRows.map(row => row.x + row.width));
        const maxY = Math.max(...sortedRows.map(row => row.y + row.height));
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        const averageHeight = sortedRows.reduce((sum, row) => sum + row.height, 0) / sortedRows.length;
        const averageWidth = sortedRows.reduce((sum, row) => sum + row.width, 0) / sortedRows.length;
        if (boundsWidth <= 0 || boundsHeight <= 0 || averageHeight <= 0 || averageWidth <= 0) {
            return null;
        }

        const requestedRadius = PipRendererShared.getRequestedPipRadius(options);
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const pipGap = PipRendererShared.getPipGap(options);
        const layout = this.getBestLayout(
            sortedRows,
            pipCount,
            minX,
            minY,
            maxX,
            maxY,
            boundsHeight,
            averageHeight,
            averageWidth,
            PipRendererShared.getInset(options),
            pipGap,
            strokeWidthRatio,
        );
        if (!layout) {
            return null;
        }
        const radius = PipRendererShared.getPipRadiusWithinBounds(
            requestedRadius,
            options,
            layout.maximumRadius,
        );

        const group = PipRendererShared.createGroup(options, type, location, pipCount, 'distributed');
        const strokeWidth = radius * strokeWidthRatio;
        for (const point of layout.points) {
            group.appendChild(PipRendererShared.createPipElement(
                point,
                radius,
                options,
                strokeWidth,
            ));
        }
        return group;
    }

    private static getBestLayout(
        sortedRows: readonly PipRow[],
        pipCount: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        boundsHeight: number,
        averageHeight: number,
        averageWidth: number,
        inset: number,
        pipGap: number,
        strokeWidthRatio: number,
    ): DistributedPipLayout | null {
        const availableHeight = boundsHeight - inset * 2;
        const availableAverageWidth = averageWidth - inset * 2;
        if (availableHeight <= 0 || availableAverageWidth <= 0) {
            return null;
        }
        const availableMinY = minY + inset;
        let bestLayout: DistributedPipLayout | null = null;
        for (let rowCount = 1; rowCount <= pipCount; rowCount++) {
            const columnCount = Math.max(1, Math.ceil(pipCount / rowCount));
            const initialSpacing = Math.min(averageHeight, availableHeight / rowCount);
            const staggered = initialSpacing < averageHeight;
            let spacing = initialSpacing;
            spacing = Math.sqrt(spacing * rowCount / availableHeight) * availableHeight / rowCount;

            const layoutRows: DistributedPipRow[] = [];
            let yPosition = Math.max(
                availableMinY,
                availableMinY + (availableHeight - spacing * rowCount) / 2 + spacing * 0.5,
            );
            let shift = 0;
            let parity = columnCount % 2;
            for (let index = 0; index < rowCount; index++) {
                let upperIndex = 0;
                for (let rowIndex = 0; rowIndex < sortedRows.length; rowIndex++) {
                    if (sortedRows[rowIndex].y <= yPosition) {
                        upperIndex = rowIndex;
                    }
                }
                const lowerIndex = sortedRows.findIndex(row => row.y >= yPosition);
                const upper = sortedRows[upperIndex];
                const lower = sortedRows[lowerIndex === -1 ? upperIndex : lowerIndex];
                const left = Math.max(upper.x, lower.x) + inset;
                const right = Math.min(upper.x + upper.width, lower.x + lower.width) - inset;
                const rowWidth = Math.max(right - left, 0);
                let currentCount = staggered
                    ? Math.floor(columnCount * rowWidth / availableAverageWidth * 0.5)
                    : Math.floor(columnCount * rowWidth / availableAverageWidth);
                if (rowWidth > 0 && currentCount % 2 !== parity) {
                    if (shift <= 0 || currentCount === 0) {
                        currentCount++;
                        shift--;
                    } else {
                        currentCount--;
                        shift++;
                    }
                    if (currentCount * spacing * 2 > right - left && currentCount >= 2) {
                        currentCount -= 2;
                    }
                }
                layoutRows.push({ left, top: yPosition, right, count: currentCount });
                yPosition += spacing;
                if (staggered) {
                    parity = 1 - parity;
                }
            }

            spacing = this.adjustCount(pipCount, layoutRows, staggered, spacing);

            const horizontalSpacing = staggered ? spacing * 2 : spacing;
            const density = layoutRows
                .filter(row => row.count > 1 && row.right > row.left)
                .reduce((maximum, row) => Math.max(maximum, horizontalSpacing * row.count / (row.right - row.left)), 0);
            const xSpacing = density > 1
                ? horizontalSpacing / density
                : density > 0
                    ? horizontalSpacing / Math.sqrt(density)
                    : horizontalSpacing;
            const points = this.getCenters(layoutRows, xSpacing);
            if (points.length !== pipCount) {
                continue;
            }
            const maximumRadius = PipRendererShared.getMaximumRadiusForPoints(
                points,
                {
                    left: minX,
                    top: minY,
                    right: maxX,
                    bottom: maxY,
                },
                strokeWidthRatio,
                inset,
                pipGap,
            );
            if (!Number.isFinite(maximumRadius)) {
                continue;
            }
            const candidate: DistributedPipLayout = {
                points,
                maximumRadius,
            };
            if (!bestLayout
                || candidate.maximumRadius > bestLayout.maximumRadius
                || candidate.maximumRadius === bestLayout.maximumRadius) {
                bestLayout = candidate;
            }
        }
        return bestLayout;
    }

    private static adjustCount(
        pipCount: number,
        rows: DistributedPipRow[],
        staggered: boolean,
        spacing: number,
    ): number {
        let allocated = rows.reduce((sum, row) => sum + row.count, 0);
        if (allocated === pipCount) {
            return spacing;
        }

        const rowOrder = rows
            .map((_row, index) => index)
            .filter(index => rows[index].right > rows[index].left)
            .sort((left, right) => {
                const leftRow = rows[left];
                const rightRow = rows[right];
                return leftRow.count / Math.max(leftRow.right - leftRow.left, 1)
                    - rightRow.count / Math.max(rightRow.right - rightRow.left, 1);
            });
        if (rowOrder.length === 0) {
            return spacing;
        }

        const rowDelta = staggered ? 2 : 1;
        let rowIndex = 0;
        let minimum = true;
        let skipped: number;
        do {
            skipped = 0;
            while (allocated !== pipCount && skipped < rowOrder.length) {
                const index = rowOrder[rowIndex % rowOrder.length];
                const row = rows[index];
                const availableWidth = row.right - row.left;
                if (pipCount > allocated) {
                    const change = pipCount - allocated === 1 ? 1 : rowDelta;
                    if (spacing * (row.count + change) <= availableWidth) {
                        row.count += change;
                        allocated += change;
                    } else {
                        skipped++;
                    }
                } else {
                    let change = allocated - pipCount === 1 ? 1 : rowDelta;
                    if (minimum && row.count - change <= 0) {
                        change = 0;
                    } else {
                        change = Math.min(change, row.count);
                    }
                    if (change > 0) {
                        row.count -= change;
                        allocated -= change;
                    } else {
                        skipped++;
                    }
                }
                rowIndex++;
            }
            if (skipped === rowOrder.length) {
                if (allocated < pipCount) {
                    spacing *= 0.95;
                } else {
                    minimum = false;
                }
            }
        } while (skipped === rowOrder.length);
        return spacing;
    }

    private static getCenters(
        rows: readonly DistributedPipRow[],
        xSpacing: number,
    ): PipPoint[] {
        const points: PipPoint[] = [];
        for (const row of rows) {
            if (row.count <= 0 || row.right <= row.left) {
                continue;
            }
            const centerX = (row.left + row.right) / 2;
            const firstX = centerX - xSpacing * (row.count - 1) / 2;
            for (let index = 0; index < row.count; index++) {
                points.push({
                    x: firstX + xSpacing * index,
                    y: row.top,
                });
            }
        }
        return points;
    }
}