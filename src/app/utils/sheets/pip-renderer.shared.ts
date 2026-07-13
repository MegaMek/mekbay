import type {
    PipBounds,
    PipPoint,
    PipRenderOptions,
} from './pip-renderer.types';

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const DEFAULT_STROKE_WIDTH_RATIO = 0.21;
const DEFAULT_PIP_RADIUS = 3;
const DEFAULT_MIN_PIP_RADIUS = 1.5;
const DEFAULT_PIP_GAP = 0.2;
const DEFAULT_INSET = 0;

export class PipRendererShared {

    public static createGroup(
        options: PipRenderOptions,
        type: string,
        location: string,
        value: number,
        layout: string,
    ): SVGGElement {
        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        if (type === 'shield' || type.startsWith('shield-')) {
            group.classList.add('shield');
        }
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', value.toString());
        group.setAttribute('data-pip-layout', layout);
        return group;
    }

    public static createPipElement(
        point: PipPoint,
        radius: number,
        options: PipRenderOptions,
        strokeWidth: number,
        transform?: string,
    ): SVGCircleElement | SVGPolygonElement {
        const pip = options.shape === 'diamond'
            ? document.createElementNS(SVG_NAMESPACE, 'polygon')
            : document.createElementNS(SVG_NAMESPACE, 'circle');
        if (pip instanceof SVGCircleElement) {
            pip.setAttribute('cx', point.x.toString());
            pip.setAttribute('cy', point.y.toString());
            pip.setAttribute('r', radius.toString());
        } else {
            pip.setAttribute('points', `${point.x},${point.y - radius} ${point.x + radius},${point.y} ${point.x},${point.y + radius} ${point.x - radius},${point.y}`);
        }
        pip.setAttribute('fill', options.fill ?? 'none');
        pip.setAttribute('stroke', options.stroke ?? '#000');
        pip.setAttribute('stroke-width', strokeWidth.toString());
        if (transform) {
            pip.setAttribute('transform', transform);
        }
        return pip;
    }

    public static getPipRadiusWithinBounds(
        requestedRadius: number,
        options: PipRenderOptions,
        maximumRadius: number,
    ): number {
        if (requestedRadius <= 0) {
            return 0;
        }
        return Math.min(
            requestedRadius,
            Math.max(this.getMinimumPipRadius(options), maximumRadius),
        );
    }

    public static getMaximumRadiusForPoints(
        points: readonly PipPoint[],
        bounds: PipBounds,
        strokeWidthRatio: number,
        inset: number,
        pipGap: number,
    ): number {
        const footprintFactor = this.getPipFootprintFactor(strokeWidthRatio);
        let maximumRadius = Infinity;
        for (const point of points) {
            maximumRadius = Math.min(
                maximumRadius,
                (point.x - bounds.left - inset) / footprintFactor,
                (bounds.right - point.x - inset) / footprintFactor,
                (point.y - bounds.top - inset) / footprintFactor,
                (bounds.bottom - point.y - inset) / footprintFactor,
            );
        }
        const minimumDistanceSquared = this.getMinimumDistanceSquared(points);
        if (Number.isFinite(minimumDistanceSquared)) {
            maximumRadius = Math.min(
                maximumRadius,
                (Math.sqrt(minimumDistanceSquared) - pipGap) / (2 * footprintFactor),
            );
        }
        return Math.max(maximumRadius, 0);
    }

    private static getMinimumDistanceSquared(points: readonly PipPoint[]): number {
        if (points.length < 2) {
            return Infinity;
        }
        const pointsByY = points.every((point, index) => index === 0
            || point.y > points[index - 1].y
            || point.y === points[index - 1].y && point.x >= points[index - 1].x)
            ? points
            : [...points].sort((left, right) => left.y - right.y || left.x - right.x);
        let minimumDistanceSquared = Infinity;
        for (let firstIndex = 0; firstIndex < pointsByY.length; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < pointsByY.length; secondIndex++) {
                const yDistance = pointsByY[secondIndex].y - pointsByY[firstIndex].y;
                if (yDistance * yDistance >= minimumDistanceSquared) {
                    break;
                }
                minimumDistanceSquared = Math.min(
                    minimumDistanceSquared,
                    this.getDistanceSquared(pointsByY[firstIndex], pointsByY[secondIndex]),
                );
            }
        }
        return minimumDistanceSquared;
    }

    public static getRequestedPipRadius(options: PipRenderOptions): number {
        const radius = options.pipRadius;
        return Number.isFinite(radius)
            ? Math.max(radius ?? 0, 0)
            : DEFAULT_PIP_RADIUS;
    }

    public static getMinimumPipRadius(options: PipRenderOptions): number {
        return Number.isFinite(options.minPipRadius)
            ? Math.max(options.minPipRadius ?? 0, 0)
            : DEFAULT_MIN_PIP_RADIUS;
    }

    public static getPipGap(options: PipRenderOptions): number {
        return Number.isFinite(options.pipGap)
            ? Math.max(options.pipGap ?? 0, 0)
            : DEFAULT_PIP_GAP;
    }

    public static getInset(options: PipRenderOptions): number {
        return Number.isFinite(options.inset)
            ? Math.max(options.inset ?? 0, 0)
            : DEFAULT_INSET;
    }

    public static getStrokeWidthRatio(options: PipRenderOptions): number {
        return Number.isFinite(options.strokeWidthRatio)
            ? Math.max(options.strokeWidthRatio ?? DEFAULT_STROKE_WIDTH_RATIO, 0)
            : DEFAULT_STROKE_WIDTH_RATIO;
    }

    public static getPipFootprintRadius(radius: number, strokeWidthRatio: number): number {
        return radius * this.getPipFootprintFactor(strokeWidthRatio);
    }

    public static getPipFootprintFactor(strokeWidthRatio: number): number {
        return 1 + strokeWidthRatio / 2;
    }

    public static getDistance(first: PipPoint, second: PipPoint): number {
        return Math.hypot(first.x - second.x, first.y - second.y);
    }

    public static getDistanceSquared(first: PipPoint, second: PipPoint): number {
        const xDistance = first.x - second.x;
        const yDistance = first.y - second.y;
        return xDistance * xDistance + yDistance * yDistance;
    }
}