import type { PipBounds, PipShapeSpan } from './pip-renderer.types';

export interface PipShapeProfile {
    readonly spans: readonly PipShapeSpan[];
    readonly bounds: PipBounds;
    readonly normalizedSpans: readonly PipShapeSpan[];
    readonly averageSpanWidth: number;
    readonly averageSpanHeight: number;
}

export function createPipShapeProfile(spans: readonly PipShapeSpan[]): PipShapeProfile | null {
    const validSpans = spans.filter(span =>
        Number.isFinite(span.x)
        && Number.isFinite(span.y)
        && Number.isFinite(span.width)
        && Number.isFinite(span.height)
        && span.width > 0
        && span.height > 0)
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
            gap: span.gap ? {
                left: span.gap.left - bounds.left,
                right: span.gap.right - bounds.left,
            } : undefined,
        }));
    const totals = validSpans.reduce((result, span) => ({
        width: result.width + span.width,
        height: result.height + span.height,
    }), { width: 0, height: 0 });
    return {
        spans: validSpans,
        bounds,
        normalizedSpans,
        averageSpanWidth: totals.width / validSpans.length,
        averageSpanHeight: totals.height / validSpans.length,
    };
}
