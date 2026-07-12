import type {
    PipPoint,
    PipRenderOptions,
} from './pip-renderer.types';
import {
    SVG_NAMESPACE,
    PipRendererShared,
} from './pip-renderer.shared';

interface FillBoundary {
    readonly points: readonly PipPoint[];
    readonly spacing: number;
    readonly cellSize: number;
    readonly buckets: ReadonlyMap<string, readonly PipPoint[]>;
    readonly maxRing: number;
}

interface FillCandidate extends PipPoint {
    readonly clearance: number;
}

interface FillAreaSamples {
    readonly points: readonly PipPoint[];
    readonly candidates: readonly FillCandidate[];
    readonly centroid: PipPoint;
    readonly area: number;
    readonly boundary: FillBoundary;
    readonly maxRadius: number;
    readonly samplingRoot: SVGSVGElement;
    readonly transform: string | null;
}

interface FillPipPlacement {
    readonly point: PipPoint;
    readonly transform: string | null;
}

export class FillPipRenderer {

    public static createPips(
        areas: SVGGeometryElement | readonly SVGGeometryElement[],
        count: number,
        options: PipRenderOptions = {},
        type = 'fill',
        location = '',
    ): SVGGElement | null {
        if (!Number.isFinite(count) || count <= 0) {
            return null;
        }

        const pipCount = Math.floor(count);
        if (pipCount <= 0) {
            return null;
        }

        const geometries = Array.isArray(areas) ? areas : [areas];
        const areaSamples = geometries
            .map(area => this.sampleArea(area))
            .filter((sample): sample is FillAreaSamples => sample !== null);
        if (areaSamples.length === 0) {
            return null;
        }

        const totalArea = areaSamples.reduce((sum, sample) => sum + sample.area, 0);
        if (!Number.isFinite(totalArea) || totalArea <= 0) {
            return null;
        }
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const requestedRadius = PipRendererShared.getRequestedPipRadius(options);
        if (requestedRadius <= 0) {
            return null;
        }
        const maximumRadius = Math.min(...areaSamples.map(sample => sample.maxRadius));
        const minimumRadius = Math.min(PipRendererShared.getMinimumPipRadius(options), requestedRadius);
        const radius = Math.min(requestedRadius, Math.max(minimumRadius, maximumRadius));
        if (radius <= 0) {
            return null;
        }
        const inset = PipRendererShared.getInset(options);
        const pipGap = PipRendererShared.getPipGap(options);

        try {
            const findCenters = (candidateRadius: number): FillPipPlacement[] | null => {
                const footprintRadius = PipRendererShared.getPipFootprintRadius(candidateRadius, strokeWidthRatio);
                const minimumClearance = footprintRadius + inset;
                const candidates = areaSamples.map(sample => sample.candidates
                    .filter(candidate => candidate.clearance >= minimumClearance));
                return this.findCenters(
                    areaSamples,
                    candidates,
                    pipCount,
                    footprintRadius * 2 + pipGap,
                );
            };

            const initialCenters = findCenters(radius);
            if (initialCenters) {
                return this.createPipGroup(initialCenters, radius, options, type, location, pipCount, strokeWidthRatio);
            }

            let bestCenters: FillPipPlacement[] | null = null;
            let bestRadius = minimumRadius;
            const minimumCenters = findCenters(minimumRadius);
            if (minimumCenters) {
                bestCenters = minimumCenters;
            }

            let lowerRadius = minimumRadius;
            let upperRadius = radius;
            for (let attempt = 0; attempt < 16 && upperRadius > lowerRadius; attempt++) {
                const candidateRadius = (lowerRadius + upperRadius) / 2;
                const centers = findCenters(candidateRadius);
                if (centers) {
                    bestCenters = centers;
                    bestRadius = candidateRadius;
                    lowerRadius = candidateRadius;
                } else {
                    upperRadius = candidateRadius;
                }
            }

            if (bestCenters) {
                return this.createPipGroup(bestCenters, bestRadius, options, type, location, pipCount, strokeWidthRatio);
            }

            const fallbackCenters = this.findCenters(
                areaSamples,
                areaSamples.map(sample => sample.points),
                pipCount,
                0,
            );
            if (fallbackCenters) {
                return this.createPipGroup(
                    fallbackCenters,
                    minimumRadius,
                    options,
                    type,
                    location,
                    pipCount,
                    strokeWidthRatio,
                );
            }
        } finally {
            areaSamples.forEach(sample => sample.samplingRoot.remove());
        }

        return null;
    }

    private static sampleArea(area: SVGGeometryElement): FillAreaSamples | null {
        const samplingRoot = document.createElementNS(SVG_NAMESPACE, 'svg');
        const samplingGeometry = area.cloneNode(true) as SVGGeometryElement;
        samplingRoot.setAttribute('width', '1');
        samplingRoot.setAttribute('height', '1');
        samplingRoot.style.setProperty('position', 'fixed');
        samplingRoot.style.setProperty('left', '-10000px');
        samplingRoot.style.setProperty('top', '-10000px');
        samplingRoot.style.setProperty('visibility', 'hidden');
        samplingRoot.style.setProperty('pointer-events', 'none');
        samplingRoot.appendChild(samplingGeometry);
        document.body.appendChild(samplingRoot);

        let bounds: DOMRect;
        try {
            bounds = samplingGeometry.getBBox();
        } catch {
            samplingRoot.remove();
            return null;
        }
        if (!Number.isFinite(bounds.x)
            || !Number.isFinite(bounds.y)
            || !Number.isFinite(bounds.width)
            || !Number.isFinite(bounds.height)
            || bounds.width <= 0
            || bounds.height <= 0) {
            samplingRoot.remove();
            return null;
        }

        const boundary = this.sampleBoundary(samplingGeometry, bounds);
        if (!boundary) {
            samplingRoot.remove();
            return null;
        }
        const longestSide = Math.max(bounds.width, bounds.height);
        const columns = Math.max(24, Math.min(96, Math.round(96 * bounds.width / longestSide)));
        const rows = Math.max(24, Math.min(96, Math.round(96 * bounds.height / longestSide)));
        const cellWidth = bounds.width / columns;
        const cellHeight = bounds.height / rows;
        const points: PipPoint[] = [];
        const candidates: FillCandidate[] = [];
        let centerX = 0;
        let centerY = 0;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const point = {
                    x: bounds.x + (column + 0.5) * cellWidth,
                    y: bounds.y + (row + 0.5) * cellHeight,
                };
                if (!this.isPointInFill(samplingGeometry, point)) {
                    continue;
                }
                points.push(point);
                const clearance = this.getBoundaryClearance(point, boundary);
                if (clearance > 0) {
                    candidates.push({ ...point, clearance });
                }
                centerX += point.x;
                centerY += point.y;
            }
        }
        if (points.length === 0) {
            samplingRoot.remove();
            return null;
        }

        return {
            points,
            candidates,
            centroid: {
                x: centerX / points.length,
                y: centerY / points.length,
            },
            area: bounds.width * bounds.height * points.length / (columns * rows),
            boundary,
            maxRadius: Math.min(bounds.width, bounds.height) * 0.45,
            samplingRoot,
            transform: area.getAttribute('transform'),
        };
    }

    private static sampleBoundary(area: SVGGeometryElement, bounds: DOMRect): FillBoundary | null {
        let length: number;
        try {
            length = area.getTotalLength();
        } catch {
            return null;
        }
        if (!Number.isFinite(length) || length <= 0) {
            return null;
        }

        const targetSpacing = Math.max(Math.min(bounds.width, bounds.height) / 128, 0.05);
        const sampleCount = Math.min(16384, Math.max(128, Math.ceil(length / targetSpacing)));
        const points: PipPoint[] = [];
        for (let index = 0; index < sampleCount; index++) {
            try {
                const point = area.getPointAtLength(length * index / sampleCount);
                points.push({ x: point.x, y: point.y });
            } catch {
                return null;
            }
        }
        if (points.length === 0) {
            return null;
        }

        const spacing = length / sampleCount;
        const longestSide = Math.max(bounds.width, bounds.height);
        const shortestSide = Math.min(bounds.width, bounds.height);
        const cellSize = Math.max(shortestSide / 24, longestSide / 96, spacing * 4, 0.25);
        const buckets = new Map<string, PipPoint[]>();
        for (const point of points) {
            const key = this.getBoundaryBucketKey(point, cellSize);
            const bucket = buckets.get(key);
            if (bucket) {
                bucket.push(point);
            } else {
                buckets.set(key, [point]);
            }
        }
        return {
            points,
            spacing,
            cellSize,
            buckets,
            maxRing: Math.ceil(Math.max(bounds.width, bounds.height) / cellSize) + 2,
        };
    }

    private static isPointInFill(area: SVGGeometryElement, point: PipPoint): boolean {
        const fillGeometry = area as SVGGeometryElement & {
            isPointInFill?: (point: { x: number; y: number }) => boolean;
        };
        if (typeof fillGeometry.isPointInFill !== 'function') {
            return false;
        }
        try {
            return fillGeometry.isPointInFill({ x: point.x, y: point.y });
        } catch {
            return false;
        }
    }

    private static getBoundaryClearance(point: PipPoint, boundary: FillBoundary): number {
        const cellX = Math.floor(point.x / boundary.cellSize);
        const cellY = Math.floor(point.y / boundary.cellSize);
        let minimumDistanceSquared = Number.POSITIVE_INFINITY;

        for (let ring = 0; ring <= boundary.maxRing; ring++) {
            const minimumX = cellX - ring;
            const maximumX = cellX + ring;
            const minimumY = cellY - ring;
            const maximumY = cellY + ring;
            if (ring === 0) {
                minimumDistanceSquared = this.getMinimumBoundaryDistanceSquared(
                    point,
                    boundary,
                    cellX,
                    cellY,
                    minimumDistanceSquared,
                );
            } else {
                for (let x = minimumX; x <= maximumX; x++) {
                    minimumDistanceSquared = this.getMinimumBoundaryDistanceSquared(
                        point,
                        boundary,
                        x,
                        minimumY,
                        minimumDistanceSquared,
                    );
                    minimumDistanceSquared = this.getMinimumBoundaryDistanceSquared(
                        point,
                        boundary,
                        x,
                        maximumY,
                        minimumDistanceSquared,
                    );
                }
                for (let y = minimumY + 1; y < maximumY; y++) {
                    minimumDistanceSquared = this.getMinimumBoundaryDistanceSquared(
                        point,
                        boundary,
                        minimumX,
                        y,
                        minimumDistanceSquared,
                    );
                    minimumDistanceSquared = this.getMinimumBoundaryDistanceSquared(
                        point,
                        boundary,
                        maximumX,
                        y,
                        minimumDistanceSquared,
                    );
                }
            }

            if (minimumDistanceSquared <= (ring * boundary.cellSize) ** 2) {
                break;
            }
        }

        if (!Number.isFinite(minimumDistanceSquared)) {
            for (const boundaryPoint of boundary.points) {
                minimumDistanceSquared = Math.min(
                    minimumDistanceSquared,
                    PipRendererShared.getDistanceSquared(point, boundaryPoint),
                );
            }
        }
        return Math.max(0, Math.sqrt(minimumDistanceSquared) - boundary.spacing);
    }

    private static getMinimumBoundaryDistanceSquared(
        point: PipPoint,
        boundary: FillBoundary,
        cellX: number,
        cellY: number,
        currentMinimum: number,
    ): number {
        const bucket = boundary.buckets.get(`${cellX},${cellY}`);
        if (!bucket) {
            return currentMinimum;
        }
        let minimum = currentMinimum;
        for (const boundaryPoint of bucket) {
            minimum = Math.min(minimum, PipRendererShared.getDistanceSquared(point, boundaryPoint));
        }
        return minimum;
    }

    private static getBoundaryBucketKey(point: PipPoint, cellSize: number): string {
        return `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`;
    }

    private static findCenters(
        areaSamples: readonly FillAreaSamples[],
        candidates: readonly (readonly PipPoint[])[],
        count: number,
        minimumDistance: number,
    ): FillPipPlacement[] | null {
        const totalArea = areaSamples.reduce((sum, sample) => sum + sample.area, 0);
        if (totalArea <= 0 || candidates.length !== areaSamples.length) {
            return null;
        }

        const allocations = areaSamples.map(sample => Math.floor(count * sample.area / totalArea));
        let allocated = allocations.reduce((sum, allocation) => sum + allocation, 0);
        const remainderOrder = areaSamples
            .map((sample, index) => ({
                index,
                remainder: count * sample.area / totalArea - allocations[index],
            }))
            .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
        let remainderIndex = 0;
        while (allocated < count) {
            allocations[remainderOrder[remainderIndex % remainderOrder.length].index]++;
            allocated++;
            remainderIndex++;
        }

        const placements: FillPipPlacement[] = [];
        for (let areaIndex = 0; areaIndex < areaSamples.length; areaIndex++) {
            const centers = this.findCentersInArea(
                areaSamples[areaIndex],
                candidates[areaIndex],
                allocations[areaIndex],
                minimumDistance,
            );
            if (!centers) {
                return null;
            }
            placements.push(...centers.map(point => ({
                point,
                transform: areaSamples[areaIndex].transform,
            })));
        }
        const minimumDistanceSquared = minimumDistance * minimumDistance;
        for (let firstIndex = 0; firstIndex < placements.length; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex++) {
                if (placements[firstIndex].transform !== placements[secondIndex].transform) {
                    continue;
                }
                if (PipRendererShared.getDistanceSquared(placements[firstIndex].point, placements[secondIndex].point)
                    < minimumDistanceSquared) {
                    return null;
                }
            }
        }
        return placements;
    }

    private static findCentersInArea(
        areaSamples: FillAreaSamples,
        candidates: readonly PipPoint[],
        count: number,
        minimumDistance: number,
    ): PipPoint[] | null {
        if (count === 0) {
            return [];
        }
        if (candidates.length < count) {
            return null;
        }

        const centers: PipPoint[] = [];
        const first = candidates.reduce((closest, point) => {
            const pointDistance = PipRendererShared.getDistanceSquared(point, areaSamples.centroid);
            const closestDistance = PipRendererShared.getDistanceSquared(closest, areaSamples.centroid);
            return pointDistance < closestDistance ? point : closest;
        });
        centers.push(first);

        const minimumDistanceSquared = minimumDistance * minimumDistance;
        const nearestDistances = candidates.map(candidate =>
            PipRendererShared.getDistanceSquared(candidate, first));
        while (centers.length < count) {
            let farthestIndex = -1;
            let farthestDistanceSquared = -1;
            for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
                const nearestDistanceSquared = nearestDistances[candidateIndex];
                if (nearestDistanceSquared >= minimumDistanceSquared
                    && nearestDistanceSquared > farthestDistanceSquared) {
                    farthestIndex = candidateIndex;
                    farthestDistanceSquared = nearestDistanceSquared;
                }
            }
            if (farthestIndex < 0) {
                return null;
            }
            const farthest = candidates[farthestIndex];
            centers.push(farthest);
            for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
                nearestDistances[candidateIndex] = Math.min(
                    nearestDistances[candidateIndex],
                    PipRendererShared.getDistanceSquared(candidates[candidateIndex], farthest),
                );
            }
        }

        if (count > 1) {
            for (let iteration = 0; iteration < 6; iteration++) {
                const sums = centers.map(() => ({ x: 0, y: 0, count: 0 }));
                for (const sample of areaSamples.points) {
                    let closestIndex = 0;
                    let closestDistance = PipRendererShared.getDistanceSquared(sample, centers[0]);
                    for (let index = 1; index < centers.length; index++) {
                        const distance = PipRendererShared.getDistanceSquared(sample, centers[index]);
                        if (distance < closestDistance) {
                            closestIndex = index;
                            closestDistance = distance;
                        }
                    }
                    sums[closestIndex].x += sample.x;
                    sums[closestIndex].y += sample.y;
                    sums[closestIndex].count++;
                }

                const relaxed: PipPoint[] = [];
                for (let index = 0; index < centers.length; index++) {
                    const desired = sums[index].count > 0
                        ? {
                            x: sums[index].x / sums[index].count,
                            y: sums[index].y / sums[index].count,
                        }
                        : centers[index];
                    const replacement = candidates.reduce<PipPoint | null>((closest, candidate) => {
                        const occupied = relaxed.some(center =>
                            PipRendererShared.getDistanceSquared(center, candidate) < minimumDistanceSquared)
                            || centers.some((center, centerIndex) => centerIndex > index
                                && PipRendererShared.getDistanceSquared(center, candidate) < minimumDistanceSquared);
                        if (occupied) {
                            return closest;
                        }
                        if (!closest
                            || PipRendererShared.getDistanceSquared(candidate, desired)
                                < PipRendererShared.getDistanceSquared(closest, desired)) {
                            return candidate;
                        }
                        return closest;
                    }, null);
                    relaxed.push(replacement ?? centers[index]);
                }
                centers.splice(0, centers.length, ...relaxed);
            }
        }

        for (let firstIndex = 0; firstIndex < centers.length; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < centers.length; secondIndex++) {
                if (PipRendererShared.getDistanceSquared(centers[firstIndex], centers[secondIndex]) < minimumDistanceSquared) {
                    return null;
                }
            }
        }
        return centers;
    }

    private static createPipGroup(
        placements: readonly FillPipPlacement[],
        radius: number,
        options: PipRenderOptions,
        type: string,
        location: string,
        value: number,
        strokeWidthRatio: number,
    ): SVGGElement {
        const group = PipRendererShared.createGroup(options, type, location, value, 'fill');
        const strokeWidth = radius * strokeWidthRatio;
        const transformedGroups = new Map<string, SVGGElement>();
        for (const placement of placements) {
            let pipParent: SVGGElement = group;
            if (placement.transform) {
                pipParent = transformedGroups.get(placement.transform) ?? document.createElementNS(SVG_NAMESPACE, 'g');
                if (!transformedGroups.has(placement.transform)) {
                    pipParent.setAttribute('transform', placement.transform);
                    transformedGroups.set(placement.transform, pipParent);
                    group.appendChild(pipParent);
                }
            }
            pipParent.appendChild(PipRendererShared.createPipElement(
                placement.point,
                radius,
                options,
                strokeWidth,
            ));
        }
        return group;
    }
}