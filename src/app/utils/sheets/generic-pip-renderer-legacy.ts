import type { PipPoint, PipRenderOptions } from './pip-renderer.types';
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
    ): SVGGElement | null {
        if (!Number.isFinite(count) || count <= 0 || containerWidth <= 0 || containerHeight <= 0) {
            return null;
        }

        const pipCount = Math.floor(count);
        if (pipCount <= 0) {
            return null;
        }
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const layout = this.getBestLayout(
            pipCount,
            containerWidth,
            containerHeight,
            PipRendererShared.getInset(options),
            PipRendererShared.getPipGap(options),
            strokeWidthRatio,
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
    ): GenericPipLayout | null {
        const availableWidth = containerWidth - inset * 2;
        const availableHeight = containerHeight - inset * 2;
        if (availableWidth <= 0 || availableHeight <= 0) {
            return null;
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