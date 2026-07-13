import type { PipShapeSpan } from './pip-renderer.types';
import { SVG_NAMESPACE } from './pip-renderer.shared';
import { PipShapeProfile } from './pip-shape-profile';

export const DEFAULT_PIP_ROW_HEIGHT = 6.1515198;

const DEFAULT_PIP_ROW_STEP = 5.3271999;
const ROW_STEP_RATIO = DEFAULT_PIP_ROW_STEP / DEFAULT_PIP_ROW_HEIGHT;
const BOUNDARY_SEARCH_ITERATIONS = 12;
const MAX_SCAN_COLUMNS = 512;

export interface GeneratedPipShapeProfile {
    readonly profile: PipShapeProfile;
    readonly transform: string | null;
}

export class PipShapeProfileGenerator {

    public static createDebugRows(
        geometry: SVGGeometryElement,
        requestedRowHeight = DEFAULT_PIP_ROW_HEIGHT,
    ): SVGGElement | null {
        const generated = this.createProfile(geometry, requestedRowHeight);
        if (!generated) {
            return null;
        }

        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', 'biped-paperdoll-fill-placeholder');
        group.setAttribute('data-fill-placeholder', 'true');
        if (generated.transform) {
            group.setAttribute('transform', generated.transform);
        }
        for (const span of generated.profile.spans) {
            const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
            rectangle.setAttribute('class', 'biped-paperdoll-fill-placeholder-row');
            rectangle.setAttribute('data-fill-placeholder-row', 'true');
            rectangle.setAttribute('x', span.x.toString());
            rectangle.setAttribute('y', span.y.toString());
            rectangle.setAttribute('width', span.width.toString());
            rectangle.setAttribute('height', span.height.toString());
            rectangle.setAttribute('fill', 'none');
            rectangle.setAttribute('stroke', '#0f0');
            rectangle.setAttribute('stroke-width', '0.5');
            rectangle.setAttribute('vector-effect', 'non-scaling-stroke');
            rectangle.setAttribute('pointer-events', 'none');
            group.appendChild(rectangle);
        }
        return group;
    }

    public static getEffectiveTransform(geometry: SVGGeometryElement): string | null {
        return this.withSamplingGeometry(geometry, samplingGeometry =>
            this.readEffectiveTransform(samplingGeometry));
    }

    public static createProfile(
        geometry: SVGGeometryElement,
        requestedRowHeight = DEFAULT_PIP_ROW_HEIGHT,
    ): GeneratedPipShapeProfile | null {
        return this.withSamplingGeometry(geometry, samplingGeometry => {
            const transform = this.readEffectiveTransform(samplingGeometry);
            samplingGeometry.removeAttribute('transform');

            try {
                const bounds = samplingGeometry.getBBox();
                if (!Number.isFinite(bounds.x)
                    || !Number.isFinite(bounds.y)
                    || !Number.isFinite(bounds.width)
                    || !Number.isFinite(bounds.height)
                    || bounds.width <= 0
                    || bounds.height <= 0) {
                    return null;
                }

                const rowHeight = Math.min(
                    this.normalizeRowHeight(requestedRowHeight),
                    bounds.width,
                );
                const spans = this.isPlainRectangle(samplingGeometry)
                    ? this.createRectangleRows(bounds, rowHeight)
                    : this.createGeometryRows(samplingGeometry, bounds, rowHeight);
                const profile = PipShapeProfile.create(spans);
                return profile ? { profile, transform } : null;
            } catch {
                return null;
            }
        });
    }

    private static withSamplingGeometry<T>(
        geometry: SVGGeometryElement,
        callback: (samplingGeometry: SVGGeometryElement) => T,
    ): T {
        const samplingRoot = document.createElementNS(SVG_NAMESPACE, 'svg');
        const samplingGeometry = geometry.cloneNode(true) as SVGGeometryElement;
        samplingRoot.setAttribute('width', '1');
        samplingRoot.setAttribute('height', '1');
        samplingRoot.style.setProperty('position', 'fixed');
        samplingRoot.style.setProperty('left', '-10000px');
        samplingRoot.style.setProperty('top', '-10000px');
        samplingRoot.style.setProperty('visibility', 'hidden');
        samplingRoot.style.setProperty('pointer-events', 'none');
        samplingRoot.appendChild(samplingGeometry);
        document.body.appendChild(samplingRoot);
        try {
            return callback(samplingGeometry);
        } finally {
            samplingRoot.remove();
        }
    }

    private static normalizeRowHeight(value: number): number {
        return Number.isFinite(value) && value > 0
            ? value
            : DEFAULT_PIP_ROW_HEIGHT;
    }

    private static readEffectiveTransform(geometry: SVGGeometryElement): string | null {
        const sourceTransform = geometry.getAttribute('transform') || null;
        if (!sourceTransform) {
            return null;
        }
        const matrix = geometry.getCTM();
        if (!matrix) {
            return sourceTransform;
        }
        return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
    }

    private static isPlainRectangle(geometry: SVGGeometryElement): geometry is SVGRectElement {
        return geometry instanceof SVGRectElement
            && (!geometry.getAttribute('rx') || geometry.getAttribute('rx') === '0')
            && (!geometry.getAttribute('ry') || geometry.getAttribute('ry') === '0');
    }

    private static createRectangleRows(bounds: DOMRect, rowHeight: number): PipShapeSpan[] {
        const rows: PipShapeSpan[] = [];
        const rowStep = Math.min(rowHeight, rowHeight * ROW_STEP_RATIO);
        for (let top = bounds.y; top < bounds.y + bounds.height; top += rowStep) {
            const height = Math.min(rowHeight, bounds.y + bounds.height - top);
            if (height > 0 && bounds.width >= height) {
                rows.push({ x: bounds.x, y: top, width: bounds.width, height });
            }
        }
        return rows;
    }

    private static createGeometryRows(
        geometry: SVGGeometryElement,
        bounds: DOMRect,
        rowHeight: number,
    ): PipShapeSpan[] {
        const contains = this.createFillTester(geometry);

        const rows: PipShapeSpan[] = [];
        const rowStep = Math.min(rowHeight, rowHeight * ROW_STEP_RATIO);
        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;
        for (let top = bounds.y; top < bottom; top += rowStep) {
            const height = Math.min(rowHeight, bottom - top);
            const rowBottom = top + height;
            const probeInset = Math.min(height * 0.2, 0.25);
            const probeYs = [
                top + probeInset,
                top + height / 2,
                rowBottom - Math.min(probeInset, height / 2),
            ];
            const containsAcrossBand = (x: number): boolean =>
                probeYs.every(y => contains(x, y));
            const scanColumns = Math.min(
                MAX_SCAN_COLUMNS,
                Math.max(1, Math.ceil(bounds.width / Math.max(rowHeight / 2, 0.5))),
            );
            const scanStep = bounds.width / scanColumns;
            let previousX = bounds.x;
            let previousInside = false;
            let runStart: number | undefined;
            for (let index = 0; index <= scanColumns; index++) {
                const x = index === scanColumns
                    ? right
                    : bounds.x + (index + 0.5) * scanStep;
                const inside = index < scanColumns && containsAcrossBand(x);
                if (inside && !previousInside) {
                    runStart = this.findBoundary(containsAcrossBand, previousX, x);
                } else if (!inside && previousInside && runStart !== undefined) {
                    this.addRow(rows, runStart, this.findBoundary(containsAcrossBand, x, previousX), top, height);
                    runStart = undefined;
                }
                previousX = x;
                previousInside = inside;
            }
        }
        return rows;
    }

    private static createFillTester(
        geometry: SVGGeometryElement,
    ): (x: number, y: number) => boolean {
        if (geometry instanceof SVGPathElement) {
            try {
                const context = document.createElement('canvas').getContext('2d');
                const path = new Path2D(geometry.getAttribute('d') ?? '');
                if (context) {
                    const fillRule = getComputedStyle(geometry).fillRule === 'evenodd'
                        ? 'evenodd'
                        : 'nonzero';
                    return (x, y) => context.isPointInPath(path, x, y, fillRule);
                }
            } catch {
            }
        }

        const fillGeometry = geometry as SVGGeometryElement & {
            isPointInFill?: (point: { x: number; y: number }) => boolean;
        };
        if (typeof fillGeometry.isPointInFill !== 'function') {
            return () => false;
        }
        const point = { x: 0, y: 0 };
        return (x, y) => {
            point.x = x;
            point.y = y;
            try {
                return fillGeometry.isPointInFill?.(point) ?? false;
            } catch {
                return false;
            }
        };
    }

    private static findBoundary(
        contains: (x: number) => boolean,
        outsideX: number,
        insideX: number,
    ): number {
        let outside = outsideX;
        let inside = insideX;
        for (let attempt = 0; attempt < BOUNDARY_SEARCH_ITERATIONS; attempt++) {
            const midpoint = (outside + inside) / 2;
            if (contains(midpoint)) {
                inside = midpoint;
            } else {
                outside = midpoint;
            }
        }
        return inside;
    }

    private static addRow(
        rows: PipShapeSpan[],
        left: number,
        right: number,
        top: number,
        height: number,
    ): void {
        const width = right - left;
        if (width <= 0) {
            return;
        }
        const safeHeight = Math.min(height, width);
        rows.push({
            x: left,
            y: top + (height - safeHeight) / 2,
            width,
            height: safeHeight,
        });
    }
}