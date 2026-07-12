import {
    BIPED_ARMOR_PIP_LAYOUTS,
    BIPED_STRUCTURE_PIP_LAYOUTS,
} from '../../data/biped-canon-pip-layouts.generated';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_STROKE_WIDTH_RATIO = 0.21;
const DEFAULT_PIP_RADIUS = 3;
const DEFAULT_MIN_PIP_RADIUS = 2.29;
const DEFAULT_PIP_GAP = 1;
const DEFAULT_INSET = 0;
const DEFAULT_USE_CANON_PIP_RADIUS = false;

export interface PipRenderOptions {
    className?: string;
    fill?: string;
    inset?: number;
    minPipRadius?: number;
    pipGap?: number;
    pipRadius?: number;
    useCanonPipRadius?: boolean;
    stroke?: string;
    strokeWidthRatio?: number;
    shape?: 'circle' | 'diamond';
}

export interface PipRow {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface FillPoint {
    readonly x: number;
    readonly y: number;
}

interface PipBounds {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

interface FillBoundary {
    readonly points: readonly FillPoint[];
    readonly spacing: number;
}

interface FillAreaSamples {
    readonly points: readonly FillPoint[];
    readonly centroid: FillPoint;
    readonly area: number;
    readonly boundary: FillBoundary;
    readonly geometry: SVGGeometryElement;
    readonly maxRadius: number;
    readonly samplingRoot: SVGSVGElement;
    readonly transform: string | null;
}

interface FillPipPlacement {
    readonly point: FillPoint;
    readonly transform: string | null;
}

interface PipGroupLayout {
    readonly width: number;
    readonly height: number;
    readonly radius?: number;
    readonly stroke?: number;
    readonly points: readonly (readonly [number, number])[];
}

interface DistributedPipLayout {
    readonly points: readonly FillPoint[];
    readonly maximumRadius: number;
}

export class PipUtil {

    /** Renders only generated canon armor layouts. */
    public static createCanonArmorPips(
        location: string,
        armorPipCount: number,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions = {},
    ): SVGGElement | null {
        const locationLayout = BIPED_ARMOR_PIP_LAYOUTS[location];
        const amountLayout = locationLayout?.amount[armorPipCount];
        return amountLayout
            ? this.createPipGroup(
                { ...locationLayout.info, ...amountLayout },
                containerWidth,
                containerHeight,
                options,
                'armor',
                location,
                armorPipCount,
            )
            : null;
    }

    /** Renders only generated canon structure layouts. */
    public static createCanonStructurePips(
        tonnage: number,
        location: string,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions = {},
    ): SVGGElement | null {
        const locationLayout = BIPED_STRUCTURE_PIP_LAYOUTS[location];
        const amountLayout = locationLayout?.amount[tonnage];
        return amountLayout
            ? this.createPipGroup(
                { ...locationLayout.info, ...amountLayout },
                containerWidth,
                containerHeight,
                options,
                'structure',
                location,
                tonnage,
            )
            : null;
    }

    public static getCanonStructurePipCount(tonnage: number, location: string): number {
        return BIPED_STRUCTURE_PIP_LAYOUTS[location]?.amount[tonnage]?.points.length ?? 0;
    }

    public static createGenericPips(
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
        const points: Array<readonly [number, number]> = [];
        for (let index = 0; index < pipCount; index++) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            points.push([(column + 0.5) * cellWidth, (row + 0.5) * cellHeight]);
        }

        return this.createPipGroup({
            width: containerWidth,
            height: containerHeight,
            points,
        }, containerWidth, containerHeight, options, type, location, pipCount);
    }

    public static createFillPips(
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
            .map(area => this.sampleFillArea(area))
            .filter((sample): sample is FillAreaSamples => sample !== null);
        if (areaSamples.length === 0) {
            return null;
        }

        const totalArea = areaSamples.reduce((sum, sample) => sum + sample.area, 0);
        if (!Number.isFinite(totalArea) || totalArea <= 0) {
            return null;
        }
        const strokeWidthRatio = Number.isFinite(options.strokeWidthRatio)
            ? Math.max(options.strokeWidthRatio ?? DEFAULT_STROKE_WIDTH_RATIO, 0)
            : DEFAULT_STROKE_WIDTH_RATIO;
        const requestedRadius = this.getRequestedPipRadius(options);
        if (requestedRadius <= 0) {
            return null;
        }
        const maximumRadius = Math.min(...areaSamples.map(sample => sample.maxRadius));
        const minimumRadius = Math.min(this.getMinimumPipRadius(options), requestedRadius);
        const radius = Math.min(requestedRadius, Math.max(minimumRadius, maximumRadius));
        if (radius <= 0) {
            return null;
        }
        const inset = this.getInset(options);
        const pipGap = this.getPipGap(options);

        try {
            const findCenters = (candidateRadius: number): FillPipPlacement[] | null => {
                const footprintRadius = this.getPipFootprintRadius(candidateRadius, strokeWidthRatio);
                const candidates = areaSamples.map(sample => sample.points.filter(point => this.isFillPointUsable(
                    sample.geometry,
                    point,
                    sample.boundary,
                    footprintRadius,
                    inset,
                )));
                return this.findFillPipCenters(
                    areaSamples,
                    candidates,
                    pipCount,
                    footprintRadius * 2 + pipGap,
                );
            };

            const initialCenters = findCenters(radius);
            if (initialCenters) {
                return this.createFillPipGroup(initialCenters, radius, options, type, location, pipCount, strokeWidthRatio);
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
                return this.createFillPipGroup(bestCenters, bestRadius, options, type, location, pipCount, strokeWidthRatio);
            }

            const fallbackCenters = this.findFillPipCenters(
                areaSamples,
                areaSamples.map(sample => sample.points),
                pipCount,
                0,
            );
            if (fallbackCenters) {
                return this.createFillPipGroup(
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

    /** Renders a generic distributed layout; this is not canon geometry. */
    public static createDistributedPips(
        rows: readonly PipRow[],
        count: number,
        options: PipRenderOptions = {},
        type = 'shield',
        location = '',
    ): SVGGElement | null {
        if (!Number.isFinite(count) || count <= 0 || rows.length === 0) {
            return null;
        }

        const pipCount = Math.floor(count);
        const sortedRows = rows
            .filter(row => row.width > 0 && row.height > 0)
            .slice()
            .sort((left, right) => left.y - right.y);
        if (pipCount <= 0 || sortedRows.length === 0) {
            return null;
        }

        const minX = Math.min(...sortedRows.map(row => row.x));
        const minY = Math.min(...sortedRows.map(row => row.y));
        const maxX = Math.max(...sortedRows.map(row => row.x + row.width));
        const maxY = Math.max(...sortedRows.map(row => row.y + row.height));
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        const averageHeight = sortedRows.reduce((sum, row) => sum + row.height, 0) / sortedRows.length;
        const averageWidth = sortedRows.reduce((sum, row) => sum + row.width, 0) / sortedRows.length;
        if (boundsWidth <= 0 || boundsHeight <= 0 || averageHeight <= 0 || averageWidth <= 0) {
            return null;
        }

        const requestedRadius = this.getRequestedPipRadius(options);
        const strokeWidthRatio = this.getStrokeWidthRatio(options);
        const pipGap = this.getPipGap(options);
        const layout = this.getBestDistributedPipLayout(
            sortedRows,
            pipCount,
            minX,
            minY,
            maxX,
            maxY,
            boundsHeight,
            averageHeight,
            averageWidth,
            this.getInset(options),
            pipGap,
            strokeWidthRatio,
        );
        if (!layout) {
            return null;
        }
        const radius = this.getPipRadiusWithinBounds(
            requestedRadius,
            options,
            layout.maximumRadius,
        );

        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        if (type === 'shield' || type.startsWith('shield-')) {
            group.classList.add('shield');
        }
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', pipCount.toString());
        group.setAttribute('data-pip-layout', 'distributed');

        const strokeWidth = radius * strokeWidthRatio;
        for (const point of layout.points) {
            group.appendChild(this.createPipElement(
                point,
                radius,
                options,
                strokeWidth,
            ));
        }

        return group;
    }

    private static getBestDistributedPipLayout(
        sortedRows: readonly PipRow[],
        pipCount: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        boundsHeight: number,
        averageHeight: number,
        averageWidth: number,
        inset: number,
        pipGap: number,
        strokeWidthRatio: number,
    ): DistributedPipLayout | null {
        const availableHeight = boundsHeight - inset * 2;
        const availableAverageWidth = averageWidth - inset * 2;
        if (availableHeight <= 0 || availableAverageWidth <= 0) {
            return null;
        }
        const availableMinY = minY + inset;
        let bestLayout: DistributedPipLayout | null = null;
        for (let rowCount = 1; rowCount <= pipCount; rowCount++) {
            const columnCount = Math.max(1, Math.ceil(pipCount / rowCount));
            let spacing = Math.min(averageHeight, availableHeight / rowCount);
            spacing = Math.sqrt(spacing * rowCount / availableHeight) * availableHeight / rowCount;

            const layoutRows: Array<{ left: number; top: number; right: number; count: number }> = [];
            let yPosition = Math.max(
                availableMinY,
                availableMinY + (availableHeight - spacing * rowCount) / 2 + spacing * 0.5,
            );
            let shift = 0;
            const parity = columnCount % 2;
            for (let index = 0; index < rowCount; index++) {
                let upperIndex = 0;
                for (let rowIndex = 0; rowIndex < sortedRows.length; rowIndex++) {
                    if (sortedRows[rowIndex].y <= yPosition) {
                        upperIndex = rowIndex;
                    }
                }
                const lowerIndex = sortedRows.findIndex(row => row.y >= yPosition);
                const upper = sortedRows[upperIndex];
                const lower = sortedRows[lowerIndex === -1 ? upperIndex : lowerIndex];
                const left = Math.max(upper.x, lower.x) + inset;
                const right = Math.min(upper.x + upper.width, lower.x + lower.width) - inset;
                let currentCount = Math.max(0, Math.floor(columnCount * Math.max(right - left, 0) / availableAverageWidth));
                if (currentCount % 2 !== parity) {
                    if (shift <= 0 || currentCount === 0) {
                        currentCount++;
                        shift--;
                    } else {
                        currentCount--;
                        shift++;
                    }
                    if (currentCount * spacing * 2 > right - left && currentCount >= 2) {
                        currentCount -= 2;
                    }
                }
                layoutRows.push({ left, top: yPosition, right, count: currentCount });
                yPosition += spacing;
            }

            let allocated = layoutRows.reduce((sum, row) => sum + row.count, 0);
            const rowOrder = layoutRows
                .map((_row, index) => index)
                .sort((left, right) => {
                    const leftRow = layoutRows[left];
                    const rightRow = layoutRows[right];
                    return leftRow.count / Math.max(leftRow.right - leftRow.left, 1)
                        - rightRow.count / Math.max(rightRow.right - rightRow.left, 1);
                });
            let rowIndex = 0;
            while (allocated < pipCount) {
                const index = rowOrder[rowIndex % rowOrder.length];
                layoutRows[index].count++;
                allocated++;
                rowIndex++;
            }
            rowIndex = 0;
            while (allocated > pipCount && rowIndex < rowOrder.length * pipCount) {
                const index = rowOrder[rowIndex % rowOrder.length];
                if (layoutRows[index].count > 1) {
                    layoutRows[index].count--;
                    allocated--;
                }
                rowIndex++;
            }

            const density = layoutRows
                .filter(row => row.count > 1 && row.right > row.left)
                .reduce((maximum, row) => Math.max(maximum, spacing * row.count / (row.right - row.left)), 0);
            const xSpacing = density > 1 ? spacing / density : density > 0 ? spacing / Math.sqrt(density) : spacing;
            const points = this.getDistributedPipCenters(layoutRows, xSpacing);
            const maximumRadius = this.getMaximumRadiusForPoints(
                points,
                {
                    left: minX,
                    top: minY,
                    right: maxX,
                    bottom: maxY,
                },
                strokeWidthRatio,
                inset,
                pipGap,
            );
            const candidate: DistributedPipLayout = {
                points,
                maximumRadius,
            };
            if (!bestLayout
                || candidate.maximumRadius > bestLayout.maximumRadius
                || candidate.maximumRadius === bestLayout.maximumRadius) {
                bestLayout = candidate;
            }
        }
        return bestLayout;
    }

    private static getDistributedPipCenters(
        rows: readonly { left: number; top: number; right: number; count: number }[],
        xSpacing: number,
    ): FillPoint[] {
        const points: FillPoint[] = [];
        for (const row of rows) {
            if (row.count <= 0 || row.right <= row.left) {
                continue;
            }
            const centerX = (row.left + row.right) / 2;
            const firstX = centerX - xSpacing * (row.count - 1) / 2;
            for (let index = 0; index < row.count; index++) {
                points.push({
                    x: firstX + xSpacing * index,
                    y: row.top,
                });
            }
        }
        return points;
    }

    public static createRailPips(
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
        const strokeWidthRatio = this.getStrokeWidthRatio(options);
        const radius = this.getRailPipRadius(length, capacity, options);
        if (radius <= 0) {
            return null;
        }

        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        if (type === 'shield' || type.startsWith('shield-')) {
            group.classList.add('shield');
        }
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', pipCount.toString());
        group.setAttribute('data-pip-layout', 'rail');

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
            group.appendChild(this.createPipElement(
                { x: point.x, y: point.y },
                radius,
                options,
                strokeWidth,
                transform,
            ));
        }

        return group;
    }

    public static getRailPipRadius(
        length: number,
        capacity: number,
        options: PipRenderOptions = {},
        strokeWidthRatio = this.getStrokeWidthRatio(options),
    ): number {
        const spacing = length / Math.floor(capacity);
        const maximumRadius = (spacing - this.getPipGap(options))
            / (2 * this.getPipFootprintFactor(strokeWidthRatio));
        return this.getPipRadiusWithinBounds(
            this.getRequestedPipRadius(options),
            options,
            Math.max(maximumRadius, 0),
        );
    }

    private static createPipGroup(
        layout: PipGroupLayout,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions,
        type: string,
        location: string,
        value: number,
    ): SVGGElement {
        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', value.toString());
        group.setAttribute('data-pip-layout', 'canon');

        const inset = this.getInset(options);
        const availableWidth = Math.max(containerWidth - inset * 2, 0);
        const availableHeight = Math.max(containerHeight - inset * 2, 0);
        const initialScale = Math.min(availableWidth / layout.width, availableHeight / layout.height);
        const strokeWidthRatio = this.getStrokeWidthRatio(options);
        const useCanonPipRadius = (options.useCanonPipRadius ?? DEFAULT_USE_CANON_PIP_RADIUS)
            && Number.isFinite(layout.radius)
            && Number.isFinite(layout.stroke);
        const scale = useCanonPipRadius
            ? initialScale
            : this.getCanonScale(
                layout,
                availableWidth,
                availableHeight,
                initialScale,
                this.getRequestedPipRadius(options),
                strokeWidthRatio,
                this.getPipGap(options),
            );
        const renderedWidth = layout.width * scale;
        const renderedHeight = layout.height * scale;
        const offsetX = inset + (availableWidth - renderedWidth) / 2;
        const offsetY = inset + (availableHeight - renderedHeight) / 2;
        group.setAttribute('transform', `translate(${offsetX} ${offsetY}) scale(${scale})`);

        const renderedPoints = layout.points.map(([x, y]) => ({
            x: offsetX + x * scale,
            y: offsetY + y * scale,
        }));
        const bakedRadius = layout.radius ?? 0;
        const bakedStrokeRatio = bakedRadius > 0
            ? (layout.stroke ?? 0) / bakedRadius
            : strokeWidthRatio;
        const localRadius = useCanonPipRadius
            ? bakedRadius
            : (() => {
                const maximumRadius = this.getMaximumRadiusForPoints(
                    renderedPoints,
                    {
                        left: 0,
                        top: 0,
                        right: containerWidth,
                        bottom: containerHeight,
                    },
                    strokeWidthRatio,
                    inset,
                    this.getPipGap(options),
                );
                const radius = Math.max(
                    0,
                    Math.min(this.getRequestedPipRadius(options), maximumRadius),
                );
                return scale > 0 ? radius / scale : 0;
            })();
        const strokeWidth = useCanonPipRadius
            ? localRadius * bakedStrokeRatio
            : localRadius * strokeWidthRatio;
        for (const [x, y] of layout.points) {
            group.appendChild(this.createPipElement(
                { x, y },
                localRadius,
                options,
                strokeWidth,
            ));
        }

        return group;
    }

    private static getCanonScale(
        layout: Pick<PipGroupLayout, 'width' | 'height' | 'points'>,
        availableWidth: number,
        availableHeight: number,
        initialScale: number,
        requestedRadius: number,
        strokeWidthRatio: number,
        pipGap: number,
    ): number {
        const baseScale = initialScale;
        if (!Number.isFinite(initialScale)
            || initialScale <= 0
            || requestedRadius <= 0
            || layout.points.length <= 1) {
            return initialScale;
        }

        const footprintRadius = this.getPipFootprintRadius(requestedRadius, strokeWidthRatio);
        let minimumScale = 0;
        for (let firstIndex = 0; firstIndex < layout.points.length; firstIndex++) {
            const [firstX, firstY] = layout.points[firstIndex];
            const maximumHorizontalScale = this.getMaximumScaleForEdge(
                availableWidth,
                layout.width,
                firstX,
                footprintRadius,
            );
            const maximumVerticalScale = this.getMaximumScaleForEdge(
                availableHeight,
                layout.height,
                firstY,
                footprintRadius,
            );
            if (maximumHorizontalScale < 0 || maximumVerticalScale < 0) {
                return baseScale;
            }
            initialScale = Math.min(initialScale, maximumHorizontalScale, maximumVerticalScale);

            for (let secondIndex = firstIndex + 1; secondIndex < layout.points.length; secondIndex++) {
                const [secondX, secondY] = layout.points[secondIndex];
                const distance = Math.hypot(firstX - secondX, firstY - secondY);
                if (distance <= 0) {
                    return baseScale;
                }
                minimumScale = Math.max(
                    minimumScale,
                    (footprintRadius * 2 + pipGap) / distance,
                );
            }
        }

        return minimumScale <= initialScale ? initialScale : baseScale;
    }

    private static getMaximumScaleForEdge(
        availableDimension: number,
        layoutDimension: number,
        coordinate: number,
        footprintRadius: number,
    ): number {
        const distanceFromLayoutCenter = Math.abs(coordinate - layoutDimension / 2);
        if (distanceFromLayoutCenter === 0) {
            return Number.POSITIVE_INFINITY;
        }
        return (availableDimension / 2 - footprintRadius) / distanceFromLayoutCenter;
    }

    private static sampleFillArea(area: SVGGeometryElement): FillAreaSamples | null {
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

        const boundary = this.sampleFillBoundary(samplingGeometry, bounds);
        if (!boundary) {
            samplingRoot.remove();
            return null;
        }
        const longestSide = Math.max(bounds.width, bounds.height);
        const columns = Math.max(24, Math.min(96, Math.round(96 * bounds.width / longestSide)));
        const rows = Math.max(24, Math.min(96, Math.round(96 * bounds.height / longestSide)));
        const cellWidth = bounds.width / columns;
        const cellHeight = bounds.height / rows;
        const points: FillPoint[] = [];
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
            centroid: {
                x: centerX / points.length,
                y: centerY / points.length,
            },
            area: bounds.width * bounds.height * points.length / (columns * rows),
            boundary,
            geometry: samplingGeometry,
            maxRadius: Math.min(bounds.width, bounds.height) * 0.45,
            samplingRoot,
            transform: area.getAttribute('transform'),
        };
    }

    private static sampleFillBoundary(area: SVGGeometryElement, bounds: DOMRect): FillBoundary | null {
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
        const points: FillPoint[] = [];
        for (let index = 0; index < sampleCount; index++) {
            try {
                const point = area.getPointAtLength(length * index / sampleCount);
                points.push({ x: point.x, y: point.y });
            } catch {
                return null;
            }
        }
        return points.length > 0
            ? { points, spacing: length / sampleCount }
            : null;
    }

    private static isPointInFill(area: SVGGeometryElement, point: FillPoint): boolean {
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

    private static isFillPointUsable(
        area: SVGGeometryElement,
        point: FillPoint,
        boundary: FillBoundary,
        footprintRadius: number,
        inset: number,
    ): boolean {
        if (!this.isPointInFill(area, point)) {
            return false;
        }

        const boundaryDistance = boundary.points.reduce(
            (minimum, boundaryPoint) => Math.min(minimum, this.getDistance(point, boundaryPoint)),
            Number.POSITIVE_INFINITY,
        );
        if (boundaryDistance < footprintRadius + inset + boundary.spacing) {
            return false;
        }

        const perimeterCount = Math.max(
            16,
            Math.ceil(2 * Math.PI * footprintRadius / Math.max(boundary.spacing, footprintRadius * 0.25)),
        );
        for (let index = 0; index < perimeterCount; index++) {
            const angle = 2 * Math.PI * index / perimeterCount;
            if (!this.isPointInFill(area, {
                x: point.x + Math.cos(angle) * footprintRadius,
                y: point.y + Math.sin(angle) * footprintRadius,
            })) {
                return false;
            }
        }
        return true;
    }

    private static findFillPipCenters(
        areaSamples: readonly FillAreaSamples[],
        candidates: readonly (readonly FillPoint[])[],
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
            const centers = this.findFillPipCentersInArea(
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
        for (let firstIndex = 0; firstIndex < placements.length; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex++) {
                if (placements[firstIndex].transform !== placements[secondIndex].transform) {
                    continue;
                }
                if (this.getDistance(placements[firstIndex].point, placements[secondIndex].point) < minimumDistance) {
                    return null;
                }
            }
        }
        return placements;
    }

    private static findFillPipCentersInArea(
        areaSamples: FillAreaSamples,
        candidates: readonly FillPoint[],
        count: number,
        minimumDistance: number,
    ): FillPoint[] | null {
        if (count === 0) {
            return [];
        }
        if (candidates.length < count) {
            return null;
        }

        const centers: FillPoint[] = [];
        const first = candidates.reduce((closest, point) =>
            this.getDistanceSquared(point, areaSamples.centroid) < this.getDistanceSquared(closest, areaSamples.centroid)
                ? point
                : closest,
        );
        centers.push(first);

        while (centers.length < count) {
            let farthest: FillPoint | null = null;
            let farthestDistance = -1;
            for (const candidate of candidates) {
                const nearestDistance = centers.reduce(
                    (minimum, center) => Math.min(minimum, this.getDistance(candidate, center)),
                    Number.POSITIVE_INFINITY,
                );
                if (nearestDistance >= minimumDistance && nearestDistance > farthestDistance) {
                    farthest = candidate;
                    farthestDistance = nearestDistance;
                }
            }
            if (!farthest) {
                return null;
            }
            centers.push(farthest);
        }

        if (count > 1) {
            for (let iteration = 0; iteration < 6; iteration++) {
                const sums = centers.map(() => ({ x: 0, y: 0, count: 0 }));
                for (const sample of areaSamples.points) {
                    let closestIndex = 0;
                    let closestDistance = this.getDistanceSquared(sample, centers[0]);
                    for (let index = 1; index < centers.length; index++) {
                        const distance = this.getDistanceSquared(sample, centers[index]);
                        if (distance < closestDistance) {
                            closestIndex = index;
                            closestDistance = distance;
                        }
                    }
                    sums[closestIndex].x += sample.x;
                    sums[closestIndex].y += sample.y;
                    sums[closestIndex].count++;
                }

                const relaxed: FillPoint[] = [];
                for (let index = 0; index < centers.length; index++) {
                    const desired = sums[index].count > 0
                        ? {
                            x: sums[index].x / sums[index].count,
                            y: sums[index].y / sums[index].count,
                        }
                        : centers[index];
                    const replacement = candidates.reduce<FillPoint | null>((closest, candidate) => {
                        const occupied = relaxed.some(center => this.getDistance(center, candidate) < minimumDistance)
                            || centers.some((center, centerIndex) => centerIndex > index
                                && this.getDistance(center, candidate) < minimumDistance);
                        if (occupied) {
                            return closest;
                        }
                        if (!closest || this.getDistanceSquared(candidate, desired) < this.getDistanceSquared(closest, desired)) {
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
                if (this.getDistance(centers[firstIndex], centers[secondIndex]) < minimumDistance) {
                    return null;
                }
            }
        }
        return centers;
    }

    private static createFillPipGroup(
        placements: readonly FillPipPlacement[],
        radius: number,
        options: PipRenderOptions,
        type: string,
        location: string,
        value: number,
        strokeWidthRatio: number,
    ): SVGGElement {
        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        if (type === 'shield' || type.startsWith('shield-')) {
            group.classList.add('shield');
        }
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', value.toString());
        group.setAttribute('data-pip-layout', 'fill');

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
            const { point } = placement;
            pipParent.appendChild(this.createPipElement(point, radius, options, strokeWidth));
        }
        return group;
    }

    private static createPipElement(
        point: FillPoint,
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

    private static getPipRadiusWithinBounds(
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

    private static getMaximumRadiusForPoints(
        points: readonly FillPoint[],
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
        for (let firstIndex = 0; firstIndex < points.length; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex++) {
                maximumRadius = Math.min(
                    maximumRadius,
                    (this.getDistance(points[firstIndex], points[secondIndex]) - pipGap)
                        / (2 * footprintFactor),
                );
            }
        }
        return Math.max(maximumRadius, 0);
    }

    private static getRequestedPipRadius(options: PipRenderOptions): number {
        const radius = options.pipRadius;
        return Number.isFinite(radius)
            ? Math.max(radius ?? 0, 0)
            : DEFAULT_PIP_RADIUS;
    }

    private static getMinimumPipRadius(options: PipRenderOptions): number {
        return Number.isFinite(options.minPipRadius)
            ? Math.max(options.minPipRadius ?? 0, 0)
            : DEFAULT_MIN_PIP_RADIUS;
    }

    private static getPipGap(options: PipRenderOptions): number {
        return Number.isFinite(options.pipGap)
            ? Math.max(options.pipGap ?? 0, 0)
            : DEFAULT_PIP_GAP;
    }

    private static getInset(options: PipRenderOptions): number {
        return Number.isFinite(options.inset)
            ? Math.max(options.inset ?? 0, 0)
            : DEFAULT_INSET;
    }

    private static getStrokeWidthRatio(options: PipRenderOptions): number {
        return Number.isFinite(options.strokeWidthRatio)
            ? Math.max(options.strokeWidthRatio ?? DEFAULT_STROKE_WIDTH_RATIO, 0)
            : DEFAULT_STROKE_WIDTH_RATIO;
    }

    private static getPipFootprintRadius(radius: number, strokeWidthRatio: number): number {
        return radius * this.getPipFootprintFactor(strokeWidthRatio);
    }

    private static getPipFootprintFactor(strokeWidthRatio: number): number {
        return 1 + strokeWidthRatio / 2;
    }

    private static getDistance(first: FillPoint, second: FillPoint): number {
        return Math.hypot(first.x - second.x, first.y - second.y);
    }

    private static getDistanceSquared(first: FillPoint, second: FillPoint): number {
        const xDistance = first.x - second.x;
        const yDistance = first.y - second.y;
        return xDistance * xDistance + yDistance * yDistance;
    }
}