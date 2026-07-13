import type { PipBounds, PipShapeSpan } from './pip-renderer.types';

export class PipShapeProfile {

    private constructor(
        public readonly spans: readonly PipShapeSpan[],
        public readonly bounds: PipBounds,
        public readonly normalizedSpans: readonly PipShapeSpan[],
        public readonly averageSpanWidth: number,
        public readonly averageSpanHeight: number,
    ) {
    }

    public static create(spans: readonly PipShapeSpan[]): PipShapeProfile | null {
        const validSpans = spans.filter(span =>
            Number.isFinite(span.x)
            && Number.isFinite(span.y)
            && Number.isFinite(span.width)
            && Number.isFinite(span.height)
            && span.width > 0
            && span.height > 0)
            .slice()
            .sort((left, right) => left.y - right.y || left.x - right.x);
        if (validSpans.length === 0) {
            return null;
        }

        const bounds = {
            left: Math.min(...validSpans.map(span => span.x)),
            top: Math.min(...validSpans.map(span => span.y)),
            right: Math.max(...validSpans.map(span => span.x + span.width)),
            bottom: Math.max(...validSpans.map(span => span.y + span.height)),
        };
        const normalizedSpans = bounds.left === 0 && bounds.top === 0
            ? validSpans
            : validSpans.map(span => ({
                x: span.x - bounds.left,
                y: span.y - bounds.top,
                width: span.width,
                height: span.height,
            }));
        const totals = validSpans.reduce((result, span) => ({
            width: result.width + span.width,
            height: result.height + span.height,
        }), { width: 0, height: 0 });
        return new PipShapeProfile(
            validSpans,
            bounds,
            normalizedSpans,
            totals.width / validSpans.length,
            totals.height / validSpans.length,
        );
    }

    public static rectangle(
        x: number,
        y: number,
        width: number,
        height: number,
    ): PipShapeProfile | null {
        return this.create([{ x, y, width, height }]);
    }

}
