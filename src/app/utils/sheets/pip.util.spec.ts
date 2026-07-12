import { CanonPipRenderer } from './canon-pip-renderer';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { FillPipRenderer } from './fill-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
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

    it('places a single pip near the weighted center of a fill area', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = FillPipRenderer.createPips(path, 1);

        expect(pips).not.toBeNull();
        if (!pips) {
            return;
        }
        const circle = pips.querySelector('circle');
        expect(circle).not.toBeNull();
        expect(Number(circle?.getAttribute('cx'))).toBeGreaterThan(48);
        expect(Number(circle?.getAttribute('cx'))).toBeLessThan(52);
        expect(Number(circle?.getAttribute('cy'))).toBeGreaterThan(28);
        expect(Number(circle?.getAttribute('cy'))).toBeLessThan(32);
        expect(pips.getAttribute('data-pip-layout')).toBe('fill');
        expect(pips.getAttribute('data-pip-value')).toBe('1');
    });

    it('uses the default radius for a sparse fill area', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = FillPipRenderer.createPips(path, 1);

        expect(pips?.querySelector('circle')?.getAttribute('r')).toBe('3');
    });

    it('uses one pip radius override for fill and rail layouts', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const fillPips = FillPipRenderer.createPips(path, 1, { pipRadius: 4 });
        const rail = document.createElementNS(SVG_NAMESPACE, 'path');
        rail.setAttribute('d', 'M 0 0 L 100 0');
        const railPips = RailPipRenderer.createPips(rail, 1, { pipRadius: 4 }, 'armor', 'CT', 5);

        expect(Number(fillPips?.querySelector('circle')?.getAttribute('r'))).toBe(4);
        expect(Number(railPips?.querySelector('circle')?.getAttribute('r'))).toBe(4);
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

    it('applies inset to fill boundaries but not rail sizing', () => {
        const path = createPath('M 0 0 H 100 V 40 H 0 Z', 110, 50);
        const insetPips = FillPipRenderer.createPips(path, 1, { inset: 15, pipRadius: 8 });
        const rail = document.createElementNS(SVG_NAMESPACE, 'path');
        rail.setAttribute('d', 'M 0 0 L 100 0');
        const railPips = RailPipRenderer.createPips(rail, 1, { inset: 8 });
        const defaultRailPips = RailPipRenderer.createPips(rail, 1);

        expect(insetPips).not.toBeNull();
        expect(Number(insetPips?.querySelector('circle')?.getAttribute('r'))).toBeLessThan(8);
        expect(Number(railPips?.querySelector('circle')?.getAttribute('r')))
            .toBe(Number(defaultRailPips?.querySelector('circle')?.getAttribute('r')));
    });

    it('shrinks all fill pips together when the requested radius collides', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = FillPipRenderer.createPips(path, 2, {
            minPipRadius: 2,
            pipGap: 1,
            pipRadius: 25,
        });

        expect(pips).not.toBeNull();
        const radii = Array.from(pips?.querySelectorAll('circle') ?? [])
            .map(circle => Number(circle.getAttribute('r')));
        expect(radii.length).toBe(2);
        expect(radii[0]).toBeLessThan(25);
        expect(radii[0]).toBeGreaterThanOrEqual(2);
        expect(radii[1]).toBe(radii[0]);
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
        expect(getMinimumCenterDistance(positiveGapPips)).toBeCloseTo(2 * positiveGapRadius + positiveGapStrokeWidth + 1, 6);
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

    it('keeps fill pips at the minimum radius when the gap cannot fit', () => {
        const path = createPath('M 0 0 H 10 V 10 H 0 Z', 20, 20);
        const pips = FillPipRenderer.createPips(path, 2, {
            minPipRadius: 2,
            pipGap: 100,
            pipRadius: 25,
        });

        expect(pips).not.toBeNull();
        expect(Array.from(pips?.querySelectorAll('circle') ?? [])
            .map(circle => Number(circle.getAttribute('r'))))
            .toEqual([2, 2]);
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

    it('balances two pips into two regions of one area', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = FillPipRenderer.createPips(path, 2);

        expect(pips).not.toBeNull();
        if (!pips) {
            return;
        }
        const centers = Array.from(pips.querySelectorAll('circle'))
            .map(circle => Number(circle.getAttribute('cx')))
            .sort((left, right) => left - right);
        expect(centers.length).toBe(2);
        expect(centers[0]).toBeCloseTo(25.5, 0);
        expect(centers[1]).toBeCloseTo(75.5, 0);
    });

    it('keeps every pip footprint inside a concave fill area', () => {
        const path = createPath('M 0 0 H 100 V 40 H 40 V 100 H 0 Z', 110, 110);
        const pips = FillPipRenderer.createPips(path, 6, { strokeWidthRatio: 0.2 });

        expect(pips).not.toBeNull();
        if (!pips) {
            return;
        }
        const circles = Array.from(pips.querySelectorAll('circle'));
        expect(circles.length).toBe(6);
        const geometry = path as SVGPathElement & {
            isPointInFill(point: { x: number; y: number }): boolean;
        };
        for (const circle of circles) {
            const x = Number(circle.getAttribute('cx'));
            const y = Number(circle.getAttribute('cy'));
            const radius = Number(circle.getAttribute('r'));
            const strokeWidth = Number(circle.getAttribute('stroke-width'));
            const footprintRadius = radius + strokeWidth / 2;
            for (let index = 0; index < 48; index++) {
                const angle = 2 * Math.PI * index / 48;
                expect(geometry.isPointInFill({
                    x: x + Math.cos(angle) * footprintRadius,
                    y: y + Math.sin(angle) * footprintRadius,
                })).toBeTrue();
            }
        }
    });

    it('allocates pips between multiple fill areas by area', () => {
        const largeArea = createPath('M 0 0 H 100 V 50 H 0 Z', 180, 70);
        const smallArea = document.createElementNS(SVG_NAMESPACE, 'path');
        smallArea.setAttribute('d', 'M 120 0 H 170 V 50 H 120 Z');
        largeArea.parentElement?.appendChild(smallArea);

        const pips = FillPipRenderer.createPips([largeArea, smallArea], 6);

        expect(pips).not.toBeNull();
        if (!pips) {
            return;
        }
        const circles = Array.from(pips.querySelectorAll('circle'));
        expect(circles.length).toBe(6);
        expect(circles.filter(circle => Number(circle.getAttribute('cx')) < 100).length).toBe(4);
        expect(circles.filter(circle => Number(circle.getAttribute('cx')) > 120).length).toBe(2);
        expect(pips.getAttribute('data-pip-value')).toBe('6');
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
