import type { PipPoint, PipRenderOptions } from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';

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
        const aspectRatio = containerWidth / containerHeight;
        const columns = Math.max(1, Math.min(pipCount, Math.ceil(Math.sqrt(pipCount * aspectRatio))));
        const rows = Math.ceil(pipCount / columns);
        const cellWidth = containerWidth / columns;
        const cellHeight = containerHeight / rows;
        const points: PipPoint[] = [];
        for (let index = 0; index < pipCount; index++) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            points.push({
                x: (column + 0.5) * cellWidth,
                y: (row + 0.5) * cellHeight,
            });
        }

        const group = PipRendererShared.createGroup(options, type, location, pipCount, 'generic');
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const radius = PipRendererShared.getPipRadiusWithinBounds(
            PipRendererShared.getRequestedPipRadius(options),
            options,
            PipRendererShared.getMaximumRadiusForPoints(
                points,
                {
                    left: 0,
                    top: 0,
                    right: containerWidth,
                    bottom: containerHeight,
                },
                strokeWidthRatio,
                PipRendererShared.getInset(options),
                PipRendererShared.getPipGap(options),
            ),
        );
        const strokeWidth = radius * strokeWidthRatio;
        for (const point of points) {
            group.appendChild(PipRendererShared.createPipElement(
                point,
                radius,
                options,
                strokeWidth,
            ));
        }
        return group;
    }
}