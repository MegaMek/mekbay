import { PipUtil } from '../sheets/pip.util';
import {
    BIPED_ARMOR_PIP_LAYOUTS,
    BIPED_STRUCTURE_PIP_LAYOUTS,
} from '../../data/biped-canon-pip-layouts.generated';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

describe('PipUtil', () => {
    const svgRoots: SVGSVGElement[] = [];

    afterEach(() => {
        svgRoots.forEach(root => root.remove());
        svgRoots.length = 0;
    });

    it('places a single pip near the weighted center of a fill area', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = PipUtil.createFillPips(path, 1);

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
        const pips = PipUtil.createFillPips(path, 1);

        expect(pips?.querySelector('circle')?.getAttribute('r')).toBe('3');
    });

    it('uses one pip radius override for fill and rail layouts', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const fillPips = PipUtil.createFillPips(path, 1, { pipRadius: 4 });
        const rail = document.createElementNS(SVG_NAMESPACE, 'path');
        rail.setAttribute('d', 'M 0 0 L 100 0');
        const railPips = PipUtil.createRailPips(rail, 1, { pipRadius: 4 }, 'armor', 'CT', 5);

        expect(Number(fillPips?.querySelector('circle')?.getAttribute('r'))).toBe(4);
        expect(Number(railPips?.querySelector('circle')?.getAttribute('r'))).toBe(4);
    });

    it('keeps the rendered canon radius stable as a location gains pips', () => {
        const onePip = PipUtil.createCanonArmorPips('CT', 1, 29.063, 85.873, { inset: 1.8 });
        const threePips = PipUtil.createCanonArmorPips('CT', 3, 29.063, 85.873, { inset: 1.8 });

        const getRenderedRadius = (group: SVGGElement | null): number => {
            const scale = Number(/scale\(([^)]+)\)/u.exec(group?.getAttribute('transform') ?? '')?.[1]);
            const radius = Number(group?.querySelector('circle')?.getAttribute('r'));
            return radius * scale;
        };

        expect(getRenderedRadius(onePip)).toBeCloseTo(3, 6);
        expect(getRenderedRadius(threePips)).toBeCloseTo(3, 6);
    });

    it('uses baked canon radii when explicitly requested', () => {
        const options = {
            useOriginalPipRadius: true,
            pipRadius: 100,
            minPipRadius: 100,
        };
        const armorPips = PipUtil.createCanonArmorPips('CT', 3, 29.063, 85.873, options);
        const structurePips = PipUtil.createCanonStructurePips(15, 'CT', 29.063, 85.873, options);
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

    it('uses one shared normalized box for all amounts in a canon location', () => {
        const onePip = PipUtil.createCanonArmorPips(
            'CT',
            1,
            29.063,
            85.873,
            { useOriginalPipRadius: true },
        );
        const threePips = PipUtil.createCanonArmorPips(
            'CT',
            3,
            29.063,
            85.873,
            { useOriginalPipRadius: true },
        );

        expect(onePip?.getAttribute('transform')).toBe(threePips?.getAttribute('transform'));
        expect(BIPED_ARMOR_PIP_LAYOUTS['CT'].info).toEqual({ width: 0.299, height: 1 });
    });

    it('applies inset to fill boundaries but not rail sizing', () => {
        const path = createPath('M 0 0 H 100 V 40 H 0 Z', 110, 50);
        const insetPips = PipUtil.createFillPips(path, 1, { inset: 15, pipRadius: 8 });
        const rail = document.createElementNS(SVG_NAMESPACE, 'path');
        rail.setAttribute('d', 'M 0 0 L 100 0');
        const railPips = PipUtil.createRailPips(rail, 1, { inset: 8 });
        const defaultRailPips = PipUtil.createRailPips(rail, 1);

        expect(insetPips).not.toBeNull();
        expect(Number(insetPips?.querySelector('circle')?.getAttribute('r'))).toBeLessThan(8);
        expect(Number(railPips?.querySelector('circle')?.getAttribute('r')))
            .toBe(Number(defaultRailPips?.querySelector('circle')?.getAttribute('r')));
    });

    it('shrinks all fill pips together when the requested radius collides', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = PipUtil.createFillPips(path, 2, {
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

    it('balances two pips into two regions of one area', () => {
        const path = createPath('M 0 0 H 100 V 60 H 0 Z', 110, 70);
        const pips = PipUtil.createFillPips(path, 2);

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
        const pips = PipUtil.createFillPips(path, 6, { strokeWidthRatio: 0.2 });

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

        const pips = PipUtil.createFillPips([largeArea, smallArea], 6);

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
