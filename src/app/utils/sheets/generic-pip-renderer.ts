import type { PipPoint, PipRenderOptions, PipRow } from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';

interface GenericPipLayout {
    readonly points: readonly PipPoint[];
    readonly maximumRadius: number;
    readonly rowCount: number;
}

export class GenericPipRenderer {

    public static createPips(
        count: number,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions = {},
        type = 'generic',
        location = '',
        rows: readonly PipRow[] = [],
    ): SVGGElement | null {
        if (!Number.isFinite(count) || count <= 0 || containerWidth <= 0 || containerHeight <= 0) {
            return null;
        }

        const pipCount = Math.floor(count);
        if (pipCount <= 0) {
            return null;
        }
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const requestedRadius = PipRendererShared.getRequestedPipRadius(options);
        const layout = this.getBestLayout(
            pipCount,
            containerWidth,
            containerHeight,
            PipRendererShared.getInset(options),
            PipRendererShared.getPipGap(options),
            strokeWidthRatio,
            requestedRadius,
            this.normalizeRows(rows),
        );
        if (!layout) {
            return null;
        }

        const group = PipRendererShared.createGroup(options, type, location, pipCount, 'generic');
        const radius = PipRendererShared.getPipRadiusWithinBounds(
            PipRendererShared.getRequestedPipRadius(options),
            options,
            layout.maximumRadius,
        );
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
        pipCount: number,
        containerWidth: number,
        containerHeight: number,
        inset: number,
        pipGap: number,
        strokeWidthRatio: number,
        requestedRadius: number,
        rows: readonly PipRow[],
    ): GenericPipLayout | null {
        const availableWidth = containerWidth - inset * 2;
        const availableHeight = containerHeight - inset * 2;
        if (availableWidth <= 0 || availableHeight <= 0) {
            return null;
        }

        if (rows.length > 0) {
            const unrestrictedLayout = this.getBestLayout(
                pipCount,
                containerWidth,
                containerHeight,
                inset,
                pipGap,
                strokeWidthRatio,
                requestedRadius,
                [],
            );
            const placementRadius = Math.min(
                requestedRadius,
                unrestrictedLayout?.maximumRadius ?? requestedRadius,
            );
            const rowLayout = this.getBestRowLayout(
                pipCount,
                containerWidth,
                containerHeight,
                inset,
                pipGap,
                strokeWidthRatio,
                placementRadius,
                rows,
            );
            if (rowLayout) {
                return rowLayout;
            }
            return unrestrictedLayout;
        }

        let bestLayout: GenericPipLayout | null = null;
        for (let rowCount = 1; rowCount <= pipCount; rowCount++) {
            const rowPipCounts = this.getInterleavedRowCounts(pipCount, rowCount);
            const maximumRowPipCount = Math.max(...rowPipCounts);
            const horizontalSpacing = availableWidth / maximumRowPipCount;
            const verticalSpacing = availableHeight / rowCount;
            const points: PipPoint[] = [];
            for (let row = 0; row < rowCount; row++) {
                const rowPipCount = rowPipCounts[row];
                const rowWidth = (rowPipCount - 1) * horizontalSpacing;
                const firstX = inset + (availableWidth - rowWidth) / 2;
                const y = inset + (row + 0.5) * verticalSpacing;
                for (let column = 0; column < rowPipCount; column++) {
                    points.push({
                        x: firstX + column * horizontalSpacing,
                        y,
                    });
                }
            }

            const maximumRadius = PipRendererShared.getMaximumRadiusForPoints(
                points,
                {
                    left: 0,
                    top: 0,
                    right: containerWidth,
                    bottom: containerHeight,
                },
                strokeWidthRatio,
                inset,
                pipGap,
            );
            if (!bestLayout
                || maximumRadius > bestLayout.maximumRadius
                || maximumRadius === bestLayout.maximumRadius && rowCount > bestLayout.rowCount) {
                bestLayout = { points, maximumRadius, rowCount };
            }
        }
        return bestLayout;
    }

    private static getBestRowLayout(
        pipCount: number,
        containerWidth: number,
        containerHeight: number,
        inset: number,
        pipGap: number,
        strokeWidthRatio: number,
        requestedRadius: number,
        rows: readonly PipRow[],
    ): GenericPipLayout | null {
        const usableRows = rows.filter(row =>
            row.width > inset * 2 && row.height > 0)
            .slice()
            .sort((left, right) => left.y - right.y || left.x - right.x);
        if (usableRows.length === 0) {
            return null;
        }

        let bestLayout: GenericPipLayout | null = null;
        const maximumRowCount = Math.min(pipCount, usableRows.length);
        for (let rowCount = 1; rowCount <= maximumRowCount; rowCount++) {
            const selectedRows = this.selectRows(usableRows, rowCount, containerHeight, inset);
            const rowPipCounts = this.getWeightedRowCounts(selectedRows, pipCount, inset);
            const horizontalSpacing = this.getSharedHorizontalSpacing(
                selectedRows,
                rowPipCounts,
                inset,
                PipRendererShared.getPipFootprintRadius(
                    requestedRadius,
                    strokeWidthRatio,
                ),
            );
            if (!Number.isFinite(horizontalSpacing) || horizontalSpacing <= 0) {
                continue;
            }
            const points: PipPoint[] = [];
            const footprintMargin = PipRendererShared.getPipFootprintRadius(
                requestedRadius,
                strokeWidthRatio,
            );
            for (let rowIndex = 0; rowIndex < selectedRows.length; rowIndex++) {
                const row = selectedRows[rowIndex];
                const rowPipCount = rowPipCounts[rowIndex];
                if (rowPipCount <= 0) {
                    continue;
                }
                for (let column = 0; column < rowPipCount; column++) {
                    const point = {
                        x: this.getRowPointX(
                            row,
                            rowCount,
                            rowPipCount,
                            column,
                            containerWidth,
                            inset,
                            horizontalSpacing,
                            footprintMargin,
                        ),
                        y: this.getRowPointY(row, rowIndex, rowCount, containerHeight, inset),
                    };
                    points.push(point);
                }
            }

            if (points.length !== pipCount) {
                continue;
            }
            const maximumRadius = PipRendererShared.getMaximumRadiusForPoints(
                points,
                {
                    left: 0,
                    top: 0,
                    right: containerWidth,
                    bottom: containerHeight,
                },
                strokeWidthRatio,
                inset,
                pipGap,
            );
            if (!bestLayout
                || maximumRadius > bestLayout.maximumRadius
                || maximumRadius === bestLayout.maximumRadius
                    && rowCount > bestLayout.rowCount) {
                bestLayout = {
                    points,
                    maximumRadius,
                    rowCount,
                };
            }
        }
        return bestLayout;
    }

    private static getSharedHorizontalSpacing(
        rows: readonly PipRow[],
        rowPipCounts: readonly number[],
        inset: number,
        footprintMargin: number,
    ): number {
        return rows.reduce((spacing, row, index) => {
            const rowPipCount = rowPipCounts[index];
            if (rowPipCount <= 0) {
                return spacing;
            }
            const availableWidth = row.width - inset * 2;
            const safeWidth = availableWidth - footprintMargin * 2;
            const rowSpacing = rowPipCount > 1
                ? safeWidth / (rowPipCount - 1)
                : Infinity;
            return Math.min(spacing, availableWidth / rowPipCount, rowSpacing);
        }, Infinity);
    }

    private static getRowPointX(
        row: PipRow,
        rowCount: number,
        rowPipCount: number,
        column: number,
        containerWidth: number,
        inset: number,
        horizontalSpacing: number,
        footprintMargin: number,
    ): number {
        const safeLeft = row.x + inset + footprintMargin;
        const safeRight = row.x + row.width - inset - footprintMargin;
        const availableRowWidth = Math.max(safeRight - safeLeft, 0);
        const boxCenter = containerWidth / 2;
        if (rowCount === 1
            && rowPipCount === 1
            && boxCenter >= safeLeft
            && boxCenter <= safeRight) {
            return boxCenter;
        }
        const pipRowWidth = (rowPipCount - 1) * horizontalSpacing;
        const firstX = safeLeft + (availableRowWidth - pipRowWidth) / 2;
        return firstX + column * horizontalSpacing;
    }

    private static getRowPointY(
        row: PipRow,
        rowIndex: number,
        rowCount: number,
        containerHeight: number,
        inset: number,
    ): number {
        const targetY = inset
            + (rowIndex + 0.5) * (containerHeight - inset * 2) / rowCount;
        return targetY >= row.y && targetY <= row.y + row.height
            ? targetY
            : row.y + row.height / 2;
    }

    private static normalizeRows(rows: readonly PipRow[]): PipRow[] {
        const validRows = rows.filter(row =>
            Number.isFinite(row.x)
            && Number.isFinite(row.y)
            && Number.isFinite(row.width)
            && Number.isFinite(row.height)
            && row.width > 0
            && row.height > 0);
        if (validRows.length === 0) {
            return [];
        }
        const minX = Math.min(...validRows.map(row => row.x));
        const minY = Math.min(...validRows.map(row => row.y));
        return validRows.map(row => ({
            x: row.x - minX,
            y: row.y - minY,
            width: row.width,
            height: row.height,
        }));
    }

    private static selectRows(
        rows: readonly PipRow[],
        rowCount: number,
        containerHeight: number,
        inset: number,
    ): PipRow[] {
        const usedRows = new Set<number>();
        return Array.from({ length: rowCount }, (_value, index) => {
            const targetY = inset
                + (index + 0.5) * (containerHeight - inset * 2) / rowCount;
            let selectedIndex = -1;
            let selectedScore: readonly [number, number, number] | undefined;
            for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                if (usedRows.has(rowIndex)) {
                    continue;
                }
                const row = rows[rowIndex];
                const containsTarget = targetY >= row.y && targetY <= row.y + row.height;
                const score: readonly [number, number, number] = [
                    containsTarget ? 0 : 1,
                    Math.abs(targetY - (row.y + row.height / 2)),
                    rowIndex,
                ];
                if (!selectedScore || this.compareRowScores(score, selectedScore) < 0) {
                    selectedIndex = rowIndex;
                    selectedScore = score;
                }
            }
            if (selectedIndex < 0) {
                return rows[Math.min(index, rows.length - 1)];
            }
            usedRows.add(selectedIndex);
            return rows[selectedIndex];
        });
    }

    private static compareRowScores(
        left: readonly [number, number, number],
        right: readonly [number, number, number],
    ): number {
        return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    }

    private static getWeightedRowCounts(
        rows: readonly PipRow[],
        pipCount: number,
        inset: number,
    ): number[] {
        const weights = rows.map(row =>
            Math.max(row.width - inset * 2, 0) * Math.max(row.height - inset * 2, 0));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        if (totalWeight <= 0) {
            return Array.from({ length: rows.length }, () => 0);
        }

        const counts = Array.from({ length: rows.length }, () => 0);
        for (let index = 0; index < pipCount; index++) {
            const target = (index + 0.5) * totalWeight / pipCount;
            let accumulatedWeight = 0;
            for (let rowIndex = 0; rowIndex < weights.length; rowIndex++) {
                accumulatedWeight += weights[rowIndex];
                if (target <= accumulatedWeight || rowIndex === weights.length - 1) {
                    counts[rowIndex]++;
                    break;
                }
            }
        }
        return counts;
    }

    private static getInterleavedRowCounts(pipCount: number, rowCount: number): number[] {
        const basePipCount = Math.floor(pipCount / rowCount);
        const remainder = pipCount % rowCount;
        const rowPipCounts = Array.from({ length: rowCount }, () => basePipCount);
        const rowOrder = [
            ...Array.from({ length: rowCount }, (_value, index) => index).filter(index => index % 2 === 0),
            ...Array.from({ length: rowCount }, (_value, index) => index).filter(index => index % 2 !== 0),
        ];
        for (let index = 0; index < remainder; index++) {
            rowPipCounts[rowOrder[index]]++;
        }
        return rowPipCounts;
    }
}