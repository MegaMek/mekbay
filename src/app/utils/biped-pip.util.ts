import {
    BIPED_ARMOR_PIP_LAYOUTS,
    BIPED_STRUCTURE_PIP_LAYOUTS,
    type BipedPipLayout,
} from '../data/biped-pip-layouts.generated';

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