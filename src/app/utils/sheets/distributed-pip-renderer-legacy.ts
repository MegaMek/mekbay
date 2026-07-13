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
            let spacing = Math.min(averageHeight, availableHeight / rowCount);
            spacing = Math.sqrt(spacing * rowCount / availableHeight) * availableHeight / rowCount;

            const layoutRows: Array<{ left: number; top: number; right: number; count: number }> = [];
            let yPosition = Math.max(
                availableMinY,
                availableMinY + (availableHeight - spacing * rowCount) / 2 + spacing * 0.5,
            );
            let shift = 0;
            const parity = columnCount % 2;
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
                let currentCount = Math.max(0, Math.floor(columnCount * Math.max(right - left, 0) / availableAverageWidth));
                if (currentCount % 2 !== parity) {
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
            }

            let allocated = layoutRows.reduce((sum, row) => sum + row.count, 0);
            const rowOrder = layoutRows
                .map((_row, index) => index)
                .sort((left, right) => {
                    const leftRow = layoutRows[left];
                    const rightRow = layoutRows[right];
                    return leftRow.count / Math.max(leftRow.right - leftRow.left, 1)
                        - rightRow.count / Math.max(rightRow.right - rightRow.left, 1);
                });
            let rowIndex = 0;
            while (allocated < pipCount) {
                const index = rowOrder[rowIndex % rowOrder.length];
                layoutRows[index].count++;
                allocated++;
                rowIndex++;
            }
            rowIndex = 0;
            while (allocated > pipCount && rowIndex < rowOrder.length * pipCount) {
                const index = rowOrder[rowIndex % rowOrder.length];
                if (layoutRows[index].count > 1) {
                    layoutRows[index].count--;
                    allocated--;
                }
                rowIndex++;
            }

            const density = layoutRows
                .filter(row => row.count > 1 && row.right > row.left)
                .reduce((maximum, row) => Math.max(maximum, spacing * row.count / (row.right - row.left)), 0);
            const xSpacing = density > 1 ? spacing / density : density > 0 ? spacing / Math.sqrt(density) : spacing;
            const points = this.getCenters(layoutRows, xSpacing);
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

    private static getCenters(
        rows: readonly { left: number; top: number; right: number; count: number }[],
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