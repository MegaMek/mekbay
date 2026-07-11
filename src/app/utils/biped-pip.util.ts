import {
    BIPED_ARMOR_PIP_LAYOUTS,
    BIPED_STRUCTURE_PIP_LAYOUTS,
    type BipedPipLayout,
} from '../data/biped-canon-pip-layouts.generated';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_STROKE_WIDTH_RATIO = 0.21;

export interface BipedPipRenderOptions {
    className?: string;
    fill?: string;
    stroke?: string;
    strokeWidthRatio?: number;
    padding?: number;
    shape?: 'circle' | 'diamond';
}

export interface BipedShieldPipRow {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export class BipedPipUtil {

    public static createCanonArmorPips(
        location: string,
        armorPipCount: number,
        containerWidth: number,
        containerHeight: number,
        options: BipedPipRenderOptions = {},
    ): SVGGElement | null {
        const layout = BIPED_ARMOR_PIP_LAYOUTS[location]?.[armorPipCount];
        return layout
            ? this.createPipGroup(layout, containerWidth, containerHeight, options, 'armor', location, armorPipCount)
            : null;
    }

    public static createCanonStructurePips(
        tonnage: number,
        location: string,
        containerWidth: number,
        containerHeight: number,
        options: BipedPipRenderOptions = {},
    ): SVGGElement | null {
        const layout = BIPED_STRUCTURE_PIP_LAYOUTS[tonnage]?.[location];
        return layout
            ? this.createPipGroup(layout, containerWidth, containerHeight, options, 'structure', location, tonnage)
            : null;
    }

    public static createGenericPips(
        count: number,
        containerWidth: number,
        containerHeight: number,
        options: BipedPipRenderOptions = {},
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
        const radius = Math.min(cellWidth, cellHeight) * 0.34;
        const points: Array<readonly [number, number]> = [];
        for (let index = 0; index < pipCount; index++) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            points.push([(column + 0.5) * cellWidth, (row + 0.5) * cellHeight]);
        }

        return this.createPipGroup({
            width: containerWidth,
            height: containerHeight,
            radius,
            points,
        }, containerWidth, containerHeight, options, type, location, pipCount);
    }

    public static createShieldPips(
        rows: readonly BipedShieldPipRow[],
        count: number,
        options: BipedPipRenderOptions = {},
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

        let rowCount = Math.max(1, Math.min(pipCount, Math.round(Math.sqrt(pipCount * boundsHeight / boundsWidth))));
        let columnCount = Math.max(1, Math.min(
            Math.floor(pipCount / rowCount),
            Math.floor(averageWidth / averageHeight),
        ));
        while (columnCount * rowCount < pipCount && rowCount <= pipCount) {
            if (averageWidth / columnCount > boundsHeight / rowCount) {
                columnCount++;
            } else {
                rowCount++;
            }
        }

        let radius = averageHeight * 0.38;
        let spacing = Math.min(averageHeight, boundsHeight / rowCount);
        if (spacing < averageHeight) {
            radius = Math.min(radius, spacing * 0.5);
        }
        spacing = Math.sqrt(spacing * rowCount / boundsHeight) * boundsHeight / rowCount;

        const layoutRows: Array<{ left: number; top: number; right: number; count: number }> = [];
        let yPosition = Math.max(
            minY,
            minY + (boundsHeight - spacing * rowCount) / 2 + spacing * 0.5 - radius,
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
            const left = Math.max(upper.x, lower.x);
            const right = Math.min(upper.x + upper.width, lower.x + lower.width);
            let currentCount = Math.max(0, Math.floor(columnCount * Math.max(right - left, 0) / averageWidth));
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
        radius = Math.min(radius, xSpacing * 0.4);

        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', pipCount.toString());

        const fill = options.fill ?? 'none';
        const stroke = options.stroke ?? '#000';
        const strokeWidthRatio = Number.isFinite(options.strokeWidthRatio)
            ? Math.max(options.strokeWidthRatio ?? DEFAULT_STROKE_WIDTH_RATIO, 0)
            : DEFAULT_STROKE_WIDTH_RATIO;
        const strokeWidth = radius * strokeWidthRatio;
        let centerX = (layoutRows[0].left + layoutRows[0].right) / 2;
        for (const row of layoutRows) {
            if (row.count <= 0 || row.right <= row.left) {
                continue;
            }
            const xPadding = xSpacing * 0.5 - radius;
            let xPosition = centerX - xSpacing * (row.count / 2) + xPadding;
            while (xPosition < row.left) {
                xPosition += xSpacing;
            }
            while (xPosition + xSpacing * row.count > row.right) {
                xPosition -= xSpacing;
            }
            if (xPosition < row.left || row.count === 1) {
                centerX = (row.left + row.right) / 2;
                xPosition = centerX - xSpacing * (row.count / 2) + xPadding;
            }
            for (let index = 0; index < row.count; index++) {
                const pip = options.shape === 'diamond'
                    ? document.createElementNS(SVG_NAMESPACE, 'polygon')
                    : document.createElementNS(SVG_NAMESPACE, 'circle');
                const centerY = row.top + radius;
                if (pip instanceof SVGCircleElement) {
                    pip.setAttribute('cx', (xPosition + radius).toString());
                    pip.setAttribute('cy', centerY.toString());
                    pip.setAttribute('r', radius.toString());
                } else {
                    const center = xPosition + radius;
                    pip.setAttribute('points', `${center},${centerY - radius} ${center + radius},${centerY} ${center},${centerY + radius} ${center - radius},${centerY}`);
                }
                pip.setAttribute('fill', fill);
                pip.setAttribute('stroke', stroke);
                pip.setAttribute('stroke-width', strokeWidth.toString());
                group.appendChild(pip);
                xPosition += xSpacing;
            }
        }

        return group;
    }

    private static createPipGroup(
        layout: BipedPipLayout,
        containerWidth: number,
        containerHeight: number,
        options: BipedPipRenderOptions,
        type: string,
        location: string,
        value: number,
    ): SVGGElement {
        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        group.setAttribute('class', options.className ?? `biped-${type}-pips`);
        group.setAttribute('data-pip-type', type);
        group.setAttribute('data-pip-location', location);
        group.setAttribute('data-pip-value', value.toString());

        const padding = Math.max(options.padding ?? 0, 0);
        const availableWidth = Math.max(containerWidth - padding * 2, 0);
        const availableHeight = Math.max(containerHeight - padding * 2, 0);
        const scale = Math.min(availableWidth / layout.width, availableHeight / layout.height);
        const renderedWidth = layout.width * scale;
        const renderedHeight = layout.height * scale;
        const offsetX = padding + (availableWidth - renderedWidth) / 2;
        const offsetY = padding + (availableHeight - renderedHeight) / 2;
        group.setAttribute('transform', `translate(${offsetX} ${offsetY}) scale(${scale})`);

        const fill = options.fill ?? 'none';
        const stroke = options.stroke ?? '#000';
        const strokeWidthRatio = Number.isFinite(options.strokeWidthRatio)
            ? Math.max(options.strokeWidthRatio ?? DEFAULT_STROKE_WIDTH_RATIO, 0)
            : DEFAULT_STROKE_WIDTH_RATIO;
        const strokeWidth = layout.radius * strokeWidthRatio;
        for (const [x, y] of layout.points) {
            const pip = options.shape === 'diamond'
                ? document.createElementNS(SVG_NAMESPACE, 'polygon')
                : document.createElementNS(SVG_NAMESPACE, 'circle');
            if (pip instanceof SVGCircleElement) {
                pip.setAttribute('cx', x.toString());
                pip.setAttribute('cy', y.toString());
                pip.setAttribute('r', layout.radius.toString());
            } else {
                pip.setAttribute('points', `${x},${y - layout.radius} ${x + layout.radius},${y} ${x},${y + layout.radius} ${x - layout.radius},${y}`);
            }
            pip.setAttribute('fill', fill);
            pip.setAttribute('stroke', stroke);
            pip.setAttribute('stroke-width', strokeWidth.toString());
            group.appendChild(pip);
        }

        return group;
    }
}