import type { PipPoint, PipRenderOptions, PipRow } from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { PipRowGenerator } from './pip-row-generator';

interface GenericPipLayout {
    readonly points: readonly PipPoint[];
    readonly maximumRadius: number;
    readonly rowCount: number;
}

function isPipRows(value: SVGGeometryElement | readonly PipRow[]): value is readonly PipRow[] {
    return Array.isArray(value);
}

export class GenericPipRenderer {

    public static createPips(
        shape: SVGGeometryElement | readonly PipRow[],
        count: number,
        options?: PipRenderOptions,
        type?: string,
        location?: string,
    ): SVGGElement | null;

    public static createPips(
        count: number,
        containerWidth: number,
        containerHeight: number,
        options?: PipRenderOptions,
        type?: string,
        location?: string,
    ): SVGGElement | null;

    public static createPips(
        countOrShape: number | SVGGeometryElement | readonly PipRow[],
        containerWidthOrCount: number,
        containerHeightOrOptions: number | PipRenderOptions = {},
        optionsOrType: PipRenderOptions | string = {},
        typeOrLocation = '',
        location = '',
    ): SVGGElement | null {
        if (typeof countOrShape !== 'number') {
            const options = typeof containerHeightOrOptions === 'number' ? {} : containerHeightOrOptions;
            const type = typeof optionsOrType === 'string' ? optionsOrType : 'generic';
            const location = typeof optionsOrType === 'string' ? typeOrLocation : '';
            if (isPipRows(countOrShape)) {
                return this.createRowPips(countOrShape, containerWidthOrCount, options, type, location);
            }
            const generated = PipRowGenerator.createRows(countOrShape, options.rowHeight);
            if (!generated) {
                return null;
            }
            const group = this.createRowPips(generated.rows, containerWidthOrCount, options, type, location);
            if (group && generated.transform) {
                group.setAttribute('transform', generated.transform);
            }
            return group;
        }
        const count = countOrShape;
        const containerWidth = containerWidthOrCount;
        const containerHeight = typeof containerHeightOrOptions === 'number'
            ? containerHeightOrOptions
            : 0;
        const options = typeof optionsOrType === 'string' ? {} : optionsOrType;
        const type = typeof typeOrLocation === 'string' && typeOrLocation.length > 0
            ? typeOrLocation
            : 'generic';
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

    private static createRowPips(
        rows: readonly PipRow[],
        count: number,
        options: PipRenderOptions = {},
        type = 'generic',
        location = '',
    ): SVGGElement | null {
        const group = DistributedPipRenderer.createPips(rows, count, options, type, location);
        group?.setAttribute('data-pip-layout', 'generic');
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