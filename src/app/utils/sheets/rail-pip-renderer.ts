import type { PipRenderOptions } from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';

export class RailPipRenderer {

    public static createPips(
        rail: SVGGeometryElement,
        count: number,
        options: PipRenderOptions = {},
        type = 'rail',
        location = '',
        maxPipsPerRail = 5,
    ): SVGGElement | null {
        if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(maxPipsPerRail) || maxPipsPerRail < 1) {
            return null;
        }

        const pipCount = Math.floor(count);
        const capacity = Math.floor(maxPipsPerRail);
        if (pipCount <= 0 || pipCount > capacity) {
            return null;
        }

        const length = rail.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) {
            return null;
        }

        const spacing = length / capacity;
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const radius = this.getPipRadius(length, capacity, options);
        if (radius <= 0) {
            return null;
        }

        const group = PipRendererShared.createGroup(options, type, location, pipCount, 'rail');
        const strokeWidth = radius * strokeWidthRatio;
        const tangentDistance = Math.min(spacing * 0.25, Math.max(length * 0.001, 0.001));
        for (let index = 0; index < pipCount; index++) {
            const distance = spacing * (index + 0.5);
            const point = rail.getPointAtLength(distance);
            let transform: string | undefined;
            if (options.shape === 'diamond') {
                const before = rail.getPointAtLength(Math.max(0, distance - tangentDistance));
                const after = rail.getPointAtLength(Math.min(length, distance + tangentDistance));
                const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
                transform = `rotate(${angle} ${point.x} ${point.y})`;
            }
            group.appendChild(PipRendererShared.createPipElement(
                { x: point.x, y: point.y },
                radius,
                options,
                strokeWidth,
                transform,
            ));
        }

        return group;
    }

    public static getPipRadius(
        length: number,
        capacity: number,
        options: PipRenderOptions = {},
        strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options),
    ): number {
        const spacing = length / Math.floor(capacity);
        const maximumRadius = (spacing - PipRendererShared.getPipGap(options))
            / (2 * PipRendererShared.getPipFootprintFactor(strokeWidthRatio));
        return PipRendererShared.getPipRadiusWithinBounds(
            PipRendererShared.getRequestedPipRadius(options),
            options,
            Math.max(maximumRadius, 0),
        );
    }
}