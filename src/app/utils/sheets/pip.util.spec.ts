import { CanonPipRenderer } from './canon-pip-renderer';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
import { PipRowGenerator } from './pip-row-generator';
import { RailPipRenderer } from './rail-pip-renderer';
import {
    BIPED_ARMOR_PIP_LAYOUTS,
    BIPED_STRUCTURE_PIP_LAYOUTS,
} from '../../data/biped-canon-pip-layouts.generated';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

describe('Pip renderers', () => {
    const svgRoots: SVGSVGElement[] = [];

    afterEach(() => {
        svgRoots.forEach(root => root.remove());
        svgRoots.length = 0;
    });

    it('keeps the rendered canon radius stable as a location gains pips', () => {
        const onePip = CanonPipRenderer.createArmorPips('CT', 1, 29.063, 85.873, { inset: 1.8 });
        const threePips = CanonPipRenderer.createArmorPips('CT', 3, 29.063, 85.873, { inset: 1.8 });

        const getRenderedRadius = (group: SVGGElement | null): number => {
            const scale = Number(/scale\(([^)]+)\)/u.exec(group?.getAttribute('transform') ?? '')?.[1]);
            const radius = Number(group?.querySelector('circle')?.getAttribute('r'));
            return radius * scale;
        };

        expect(getRenderedRadius(onePip)).toBeCloseTo(3, 6);
        expect(getRenderedRadius(threePips)).toBeCloseTo(3, 6);
    });

    it('does not apply minimum radius clamping to default canon pips', () => {
        const getRenderedRadius = (group: SVGGElement | null): number => {
            const scale = Number(/scale\(([^)]+)\)/u.exec(group?.getAttribute('transform') ?? '')?.[1]);
            return Number(group?.querySelector('circle')?.getAttribute('r')) * scale;
        };
        const defaultMinimum = CanonPipRenderer.createArmorPips('CT', 3, 29.063, 85.873, {
            inset: 1.8,
            minPipRadius: 0,
        });
        const oversizedMinimum = CanonPipRenderer.createArmorPips('CT', 3, 29.063, 85.873, {
            inset: 1.8,
            minPipRadius: 100,
        });

        expect(getRenderedRadius(oversizedMinimum)).toBeCloseTo(getRenderedRadius(defaultMinimum), 6);
    });

    it('applies pipGap to canon pip spacing', () => {
        const getRenderedRadius = (group: SVGGElement | null): number => {
            const scale = Number(/scale\(([^)]+)\)/u.exec(group?.getAttribute('transform') ?? '')?.[1]);
            return Number(group?.querySelector('circle')?.getAttribute('r')) * scale;
        };
        const noGap = CanonPipRenderer.createArmorPips('HD', 9, 17.088, 21.553, {
            inset: 1.8,
            pipGap: 0,
            minPipRadius: 0,
            pipRadius: 3,
        });
        const withGap = CanonPipRenderer.createArmorPips('HD', 9, 17.088, 21.553, {
            inset: 1.8,
            pipGap: 1,
            minPipRadius: 0,
            pipRadius: 3,
        });

        expect(getRenderedRadius(withGap)).toBeLessThan(getRenderedRadius(noGap));
    });

    it('scales generic pips to fit their cells and pipGap', () => {
        const options = {
            minPipRadius: 0,
            pipGap: 2,
            pipRadius: 100,
            strokeWidthRatio: 0.2,
        };
        const pips = GenericPipRenderer.createPips(4, 20, 20, options);

        expect(pips).not.toBeNull();
        const circles = Array.from(pips?.querySelectorAll('circle') ?? []);
        expect(circles.length).toBe(4);
        const radius = Number(circles[0]?.getAttribute('r'));
        const strokeWidth = Number(circles[0]?.getAttribute('stroke-width'));
        const centerDistance = Math.hypot(
            Number(circles[0]?.getAttribute('cx')) - Number(circles[1]?.getAttribute('cx')),
            Number(circles[0]?.getAttribute('cy')) - Number(circles[1]?.getAttribute('cy')),
        );

        expect(radius).toBeCloseTo((10 - options.pipGap) / (2 * (1 + options.strokeWidthRatio / 2)), 6);
        expect(centerDistance).toBeCloseTo(2 * radius + strokeWidth + options.pipGap, 6);
    });

    it('decomposes tall rectangles into horizontal shape rows', () => {
        const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
        rectangle.setAttribute('x', '0');
        rectangle.setAttribute('y', '0');
        rectangle.setAttribute('width', '30');
        rectangle.setAttribute('height', '90');

        const generated = PipRowGenerator.createRows(rectangle);

        expect(generated).not.toBeNull();
        expect(generated?.rows.length).toBeGreaterThan(1);
        expect(generated?.rows.every(row => row.width >= row.height)).toBeTrue();
    });

    it('samples each geometry row within its own vertical band', () => {
        const path = createPath('M 0 0 H 30 V 10 H 10 V 30 H 0 Z', 30, 30);

        const generated = PipRowGenerator.createRows(path);
        const upperRow = generated?.rows[0];

        expect(upperRow).toBeDefined();
        expect(upperRow?.x).toBeCloseTo(0, 3);
        expect(upperRow?.width).toBeGreaterThan(20);
    });

    it('overrides row height and preserves shape transforms', () => {
        const path = createPath('M 0 0 H 40 V 30 H 0 Z', 50, 40);
        path.setAttribute('transform', 'translate(12 4)');

        const generated = PipRowGenerator.createRows(path, 3);
        const pips = generated
            ? DistributedPipRenderer.createPips(generated.rows, 3, { rowHeight: 3 })
            : null;
        if (pips && generated?.transform) {
            pips.setAttribute('transform', generated.transform);
        }

        expect(generated?.transform).toBe('matrix(1 0 0 1 12 4)');
        expect(generated?.rows.every(row => row.height <= 3 && row.width >= row.height)).toBeTrue();
        expect(pips?.getAttribute('transform')).toBe('matrix(1 0 0 1 12 4)');
    });

    it('preserves transform origins when generating transformed rectangle rows', () => {
        const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
        svg.setAttribute('width', '100');
        svg.setAttribute('height', '320');
        const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
        rectangle.setAttribute('x', '29.384');
        rectangle.setAttribute('y', '191.485');
        rectangle.setAttribute('width', '18.945');
        rectangle.setAttribute('height', '115.741');
        rectangle.setAttribute('transform', 'matrix(0.974593 0.223983 -0.223983 0.974593 14.056866 -32.599451)');
        rectangle.style.setProperty('transform-box', 'fill-box');
        rectangle.style.setProperty('transform-origin', '50% 50%');
        svg.appendChild(rectangle);
        document.body.appendChild(svg);
        svgRoots.push(svg);

        const generated = PipRowGenerator.createRows(rectangle, 6);
        const pips = generated
            ? DistributedPipRenderer.createPips(generated.rows, 3, { rowHeight: 6 })
            : null;
        if (pips && generated?.transform) {
            pips.setAttribute('transform', generated.transform);
        }
        const sourceMatrix = rectangle.getCTM();
        svg.appendChild(pips as SVGGElement);
        const generatedMatrix = pips?.getCTM();

        expect(pips).not.toBeNull();
        expect(generatedMatrix?.a).toBeCloseTo(sourceMatrix?.a ?? 0, 5);
        expect(generatedMatrix?.b).toBeCloseTo(sourceMatrix?.b ?? 0, 5);
        expect(generatedMatrix?.c).toBeCloseTo(sourceMatrix?.c ?? 0, 5);
        expect(generatedMatrix?.d).toBeCloseTo(sourceMatrix?.d ?? 0, 5);
        expect(generatedMatrix?.e).toBeCloseTo(sourceMatrix?.e ?? 0, 5);
        expect(generatedMatrix?.f).toBeCloseTo(sourceMatrix?.f ?? 0, 5);
    });

    it('interleaves generic rows when a staggered layout packs better', () => {
        const pips = GenericPipRenderer.createPips(8, 20, 20, {
            minPipRadius: 0,
            pipGap: 1,
            pipRadius: 100,
            strokeWidthRatio: 0,
        });

        const rows = Array.from(pips?.querySelectorAll('circle') ?? [])
            .reduce((counts, circle) => {
                const y = circle.getAttribute('cy') ?? '';
                counts.set(y, (counts.get(y) ?? 0) + 1);
                return counts;
            }, new Map<string, number>());
        const rowCounts = Array.from(rows.values());
        expect(rowCounts).toEqual([3, 2, 3]);

        const rowCenters = Array.from(rows.keys());
        const firstRow = Array.from(pips?.querySelectorAll(`circle[cy="${rowCenters[0]}"]`) ?? [], circle => Number(circle.getAttribute('cx')));
        const middleRow = Array.from(pips?.querySelectorAll(`circle[cy="${rowCenters[1]}"]`) ?? [], circle => Number(circle.getAttribute('cx')));
        expect(middleRow[0]).toBeGreaterThan(firstRow[0]);
        expect(middleRow[0]).toBeLessThan(firstRow[1]);
    });

    it('uses baked canon radii when explicitly requested', () => {
        const options = {
            useCanonPipRadius: true,
            pipRadius: 100,
            minPipRadius: 100,
        };
        const armorPips = CanonPipRenderer.createArmorPips('CT', 3, 29.063, 85.873, options);
        const structurePips = CanonPipRenderer.createStructurePips(15, 'CT', 29.063, 85.873, options);
        const armorLayout = BIPED_ARMOR_PIP_LAYOUTS['CT'].amount[3];
        const structureLayout = BIPED_STRUCTURE_PIP_LAYOUTS['CT'].amount[15];

        expect(new Set(Array.from(armorPips?.querySelectorAll('circle') ?? [], circle => Number(circle.getAttribute('r')))))
            .toEqual(new Set([armorLayout.radius]));
        expect(new Set(Array.from(armorPips?.querySelectorAll('circle') ?? [], circle => Number(circle.getAttribute('stroke-width')))))
            .toEqual(new Set([armorLayout.stroke]));
        expect(new Set(Array.from(structurePips?.querySelectorAll('circle') ?? [], circle => Number(circle.getAttribute('r')))))
            .toEqual(new Set([structureLayout.radius]));
        expect(new Set(Array.from(structurePips?.querySelectorAll('circle') ?? [], circle => Number(circle.getAttribute('stroke-width')))))
            .toEqual(new Set([structureLayout.stroke]));
    });

    it('does not apply pipGap to baked canon pips', () => {
        const noGap = CanonPipRenderer.createArmorPips('HD', 9, 17.088, 21.553, {
            useCanonPipRadius: true,
            pipGap: 0,
        });
        const withGap = CanonPipRenderer.createArmorPips('HD', 9, 17.088, 21.553, {
            useCanonPipRadius: true,
            pipGap: 1,
        });

        const getRenderedRadius = (group: SVGGElement | null): number => {
            const scale = Number(/scale\(([^)]+)\)/u.exec(group?.getAttribute('transform') ?? '')?.[1]);
            return Number(group?.querySelector('circle')?.getAttribute('r')) * scale;
        };

        expect(getRenderedRadius(withGap)).toBeCloseTo(getRenderedRadius(noGap), 6);
        expect(Array.from(withGap?.querySelectorAll('circle') ?? [])
            .map(circle => Number(circle.getAttribute('r'))))
            .toEqual(Array.from(noGap?.querySelectorAll('circle') ?? [])
                .map(circle => Number(circle.getAttribute('r'))));
    });

    it('uses the baked canon radius without collision resizing', () => {
        const pips = CanonPipRenderer.createArmorPips('HD', 9, 17.088, 21.553, {
            useCanonPipRadius: true,
            pipGap: 100,
            minPipRadius: 0,
            pipRadius: 0,
        });
        const bakedRadius = BIPED_ARMOR_PIP_LAYOUTS['HD'].amount[9].radius;

        expect(Array.from(pips?.querySelectorAll('circle') ?? [])
            .map(circle => Number(circle.getAttribute('r'))))
            .toEqual(Array(9).fill(bakedRadius));
    });

    it('uses one shared normalized box for all amounts in a canon location', () => {
        const onePip = CanonPipRenderer.createArmorPips(
            'CT',
            1,
            29.063,
            85.873,
            { useCanonPipRadius: true },
        );
        const threePips = CanonPipRenderer.createArmorPips(
            'CT',
            3,
            29.063,
            85.873,
            { useCanonPipRadius: true },
        );

        expect(onePip?.getAttribute('transform')).toBe(threePips?.getAttribute('transform'));
        expect(BIPED_ARMOR_PIP_LAYOUTS['CT'].info).toEqual({ width: 0.299, height: 1 });
    });

    it('chooses a larger distributed layout when zero gap fits another row arrangement', () => {
        const options = { inset: 1.8, minPipRadius: 0, pipGap: 0, pipRadius: 3 };
        const zeroGapPips = DistributedPipRenderer.createPips(
            [{ x: 0, y: 0, width: 17.088, height: 21.553 }],
            5,
            options,
            'armor',
            'HD',
        );
        const positiveGapPips = DistributedPipRenderer.createPips(
            [{ x: 0, y: 0, width: 17.088, height: 21.553 }],
            5,
            { ...options, pipGap: 1 },
            'armor',
            'HD',
        );

        expect(zeroGapPips?.querySelectorAll('circle').length).toBe(5);
        const zeroGapRadius = Number(zeroGapPips?.querySelector('circle')?.getAttribute('r'));
        const positiveGapRadius = Number(positiveGapPips?.querySelector('circle')?.getAttribute('r'));
        expect(zeroGapRadius).toBeGreaterThan(2);
        expect(positiveGapRadius).toBeLessThan(zeroGapRadius);

        const getMinimumCenterDistance = (group: SVGGElement | null): number => {
            const circles = Array.from(group?.querySelectorAll('circle') ?? []);
            return Math.min(...circles.flatMap((first, firstIndex) =>
                circles.slice(firstIndex + 1).map(second => Math.hypot(
                Number(first.getAttribute('cx')) - Number(second.getAttribute('cx')),
                Number(first.getAttribute('cy')) - Number(second.getAttribute('cy')),
                ))));
        };
        const zeroGapStrokeWidth = Number(zeroGapPips?.querySelector('circle')?.getAttribute('stroke-width'));
        const positiveGapStrokeWidth = Number(positiveGapPips?.querySelector('circle')?.getAttribute('stroke-width'));
        expect(getMinimumCenterDistance(zeroGapPips)).toBeCloseTo(2 * zeroGapRadius + zeroGapStrokeWidth, 6);
        expect(getMinimumCenterDistance(positiveGapPips))
            .toBeGreaterThanOrEqual(2 * positiveGapRadius + positiveGapStrokeWidth + 1);
    });

    it('uses pipGap when sizing rail pips', () => {
        const options = { pipRadius: 100 };
        const noGapRadius = RailPipRenderer.getPipRadius(100, 5, { ...options, pipGap: 0 });
        const positiveGapRadius = RailPipRenderer.getPipRadius(100, 5, { ...options, pipGap: 10 });

        expect(positiveGapRadius).toBeLessThan(noGapRadius);
    });

    it('hard-caps collision shrinkage at the minimum pip radius', () => {
        const radius = RailPipRenderer.getPipRadius(1, 1, {
            pipRadius: 100,
            pipGap: 100,
        });

        expect(radius).toBeCloseTo(2.29, 6);
    });

    it('balances many distributed pips across more rows', () => {
        const pips = DistributedPipRenderer.createPips(
            [{ x: 0, y: 0, width: 17.088, height: 21.553 }],
            18,
            { inset: 1.8, pipGap: 0, pipRadius: 3 },
            'armor',
            'HD',
        );
        const circles = Array.from(pips?.querySelectorAll('circle') ?? []);
        const rowCounts = Array.from(
            circles.reduce((counts, circle) => {
                const y = circle.getAttribute('cy') ?? '';
                counts.set(y, (counts.get(y) ?? 0) + 1);
                return counts;
            }, new Map<string, number>()).values(),
        );

        expect(rowCounts.length).toBe(5);
        expect(Math.min(...rowCounts)).toBe(3);
        expect(Math.max(...rowCounts)).toBe(4);
        expect(Number(circles[0]?.getAttribute('r'))).toBeGreaterThan(1.4);
    });

    it('alternates row parity for dense distributed layouts', () => {
        const pips = DistributedPipRenderer.createPips(
            [{ x: 0, y: 0, width: 40, height: 20 }],
            9,
            { minPipRadius: 0, pipGap: 1, pipRadius: 100, strokeWidthRatio: 0 },
            'armor',
            'CT',
        );
        const rowCounts = Array.from(
            pips?.querySelectorAll('circle') ?? [],
        ).reduce((counts, circle) => {
            const y = circle.getAttribute('cy') ?? '';
            counts.set(y, (counts.get(y) ?? 0) + 1);
            return counts;
        }, new Map<string, number>());

        expect(pips).not.toBeNull();
        const counts = Array.from(rowCounts.values());
        expect(counts.length).toBe(2);
        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(9);
        expect(counts[0] % 2).not.toBe(counts[1] % 2);
        expect(Number(pips?.querySelector('circle')?.getAttribute('r'))).toBeCloseTo(3.5, 6);
    });

    function createPath(d: string, width: number, height: number): SVGPathElement {
        const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
        svg.setAttribute('width', width.toString());
        svg.setAttribute('height', height.toString());
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const path = document.createElementNS(SVG_NAMESPACE, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
        document.body.appendChild(svg);
        svgRoots.push(svg);
        return path;
    }
});
