import { BipedPaperdollUtil } from './biped-paperdoll.util';
import { PipUtil } from './pip.util';

describe('BipedPaperdollUtil', () => {
    it('renders armor and structure silhouettes with location pip layers', async () => {
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(84.68, 238, {
            HD: 5,
            CT: 15,
            LT: 12,
            RT: 12,
            LA: 10,
            RA: 10,
            LL: 16,
            RL: 16,
            CT_R: 10,
            LT_R: 8,
            RT_R: 8,
        }, {
            shieldValues: {
                LA: { dc: 8, da: 1 },
                RA: { dc: 8, da: 1 },
            },
            pipLayout: 'canon',
            pipOptions: { inset: 1.8, stroke: '#b4492f' },
        });
        const rearArmorLayer = await BipedPaperdollUtil.createArmorRearPaperdoll(84.68, 238, {
            CT_R: 10,
            LT_R: 8,
            RT_R: 8,
        }, {
            pipOptions: { inset: 1.8, stroke: '#b4492f' },
        });
        const structureLayer = await BipedPaperdollUtil.createStructurePaperdoll(55.32, 238, 50, {
            pipOptions: { inset: 1.8, stroke: '#356a8a' },
        });
        armorLayer.setAttribute('transform', 'translate(2 2)');
        rearArmorLayer.setAttribute('transform', 'translate(2 2)');
        structureLayer.setAttribute('transform', 'translate(96.68 2)');
        const paperdoll = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        paperdoll.append(armorLayer, rearArmorLayer, structureLayer);

            expect(paperdoll.querySelector('#paperdoll-art-armor')).not.toBeNull();
            expect(paperdoll.querySelector('#paperdoll-art-structure')).not.toBeNull();
        expect(paperdoll.querySelectorAll('[data-type="armor"]').length).toBe(2);
        expect(paperdoll.querySelectorAll('[data-type="structure"]').length).toBe(1);
        expect(armorLayer.getAttribute('transform')).toBe('translate(2 2)');
        expect(structureLayer.getAttribute('transform')).toBe('translate(96.68 2)');
        expect(armorLayer.querySelector('[data-location="CT_R"]')).toBeNull();
        expect(armorLayer.querySelector('[data-location="LT_R"]')).toBeNull();
        expect(armorLayer.querySelector('[data-location="RT_R"]')).toBeNull();
        expect(paperdoll.querySelectorAll('.biped-paperdoll-zone').length).toBe(23);
        expect(paperdoll.querySelectorAll('[data-location="CT_R"]').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('[data-pip-type="shield-dc"] circle').length).toBe(16);
        expect(paperdoll.querySelectorAll('[data-pip-type="shield-da"] polygon').length).toBe(2);
        expect(paperdoll.querySelector('[data-zone-type="shield-dc"]')?.parentElement?.parentElement?.getAttribute('transform')).toContain('translate');
        expect(paperdoll.querySelectorAll('.shield').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('path').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('circle').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('[id^="placeholder-rail-"]').length).toBe(0);
        expect(paperdoll.querySelectorAll('[data-placeholder]').length).toBe(0);
        expect(paperdoll.querySelectorAll('rect').length).toBe(0);
    });

    it('fits a standalone paperdoll into the requested dimensions', async () => {
        const paperdoll = await BipedPaperdollUtil.createStructurePaperdoll(80, 120, 50);
        const fitGroup = paperdoll.firstElementChild as SVGGElement;
        const scaleGroup = fitGroup.firstElementChild as SVGGElement;

        expect(paperdoll.getAttribute('data-width')).toBe('80');
        expect(paperdoll.getAttribute('data-height')).toBe('120');
        expect(fitGroup.getAttribute('transform')).toContain('translate(');
        expect(scaleGroup.getAttribute('transform')).toContain('scale(');
    });

    it('scales by default and can render paperdoll geometry at native size', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path d="M 0 0 H 100 V 20 H 0 Z" />
                </g>
            </svg>
        `);
        const scaledLayer = await BipedPaperdollUtil.createArmorPaperdoll(50, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
        });
        const nativeLayer = await BipedPaperdollUtil.createArmorPaperdoll(50, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
            scale: false,
        });

        const scaledGroup = scaledLayer.firstElementChild?.firstElementChild as SVGGElement;
        const nativeGroup = nativeLayer.firstElementChild?.firstElementChild as SVGGElement;
        expect(scaledGroup.getAttribute('transform')).toBe('scale(0.5)');
        expect(nativeGroup.getAttribute('transform')).toBeNull();
    });

    it('fits layers at the top-left by default and centers each axis independently', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path d="M 0 0 H 100 V 20 H 0 Z" />
                </g>
            </svg>
        `);
        const topLeftLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
        });
        const verticallyCenteredLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
            centeredVertically: true,
        });

        expect((topLeftLayer.firstElementChild as SVGGElement).getAttribute('transform')).toBe('translate(0 0)');
        expect((verticallyCenteredLayer.firstElementChild as SVGGElement).getAttribute('transform')).toBe('translate(0 10)');

        const horizontalSource = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 100">
                <g id="paperdoll-art-armor">
                    <path d="M 0 0 H 20 V 100 H 0 Z" />
                </g>
            </svg>
        `);
        const horizontallyCenteredLayer = await BipedPaperdollUtil.createArmorPaperdoll(40, 100, {}, {
            assetUrl: `data:image/svg+xml,${horizontalSource}`,
            centeredHorizontally: true,
        });

        expect((horizontallyCenteredLayer.firstElementChild as SVGGElement).getAttribute('transform')).toBe('translate(10 0)');
    });

    it('adds an optional outline around the requested layer dimensions', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path d="M 0 0 H 100 V 20 H 0 Z" />
                </g>
            </svg>
        `);
        const unframedLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
        });
        const framedLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
            outline: true,
        });

        expect(unframedLayer.querySelector('.biped-paperdoll-frame')).toBeNull();
        const frame = framedLayer.querySelector<SVGRectElement>('.biped-paperdoll-frame');
        expect(frame).not.toBeNull();
        expect(frame?.getAttribute('x')).toBe('0');
        expect(frame?.getAttribute('y')).toBe('0');
        expect(frame?.getAttribute('width')).toBe('100');
        expect(frame?.getAttribute('height')).toBe('40');
        expect(frame?.getAttribute('fill')).toBe('none');
    });

    it('renders rear armor from the dedicated rear asset', async () => {
        const paperdoll = await BipedPaperdollUtil.createArmorRearPaperdoll(84.68, 238, {
            CT_R: 10,
            LT_R: 8,
            RT_R: 8,
        });

        expect(paperdoll.getAttribute('data-source')).toBe('/images/paperdolls/biped-armor-back.svg');
        expect(paperdoll.querySelector('svg#paperdoll-art-armor')).toBeNull();
        expect(paperdoll.querySelector('g#paperdoll-art-armor')).not.toBeNull();
        expect(paperdoll.querySelector('[data-location="CT_R"][data-zone-type="armor"]')).not.toBeNull();
        expect(paperdoll.querySelector('[data-location="LT_R"][data-zone-type="armor"]')).not.toBeNull();
        expect(paperdoll.querySelector('[data-location="RT_R"][data-zone-type="armor"]')).not.toBeNull();
        expect(paperdoll.querySelector('[data-location="CT"][data-zone-type="armor"]')).toBeNull();
        expect(paperdoll.querySelectorAll('rect').length).toBe(0);
    });

    it('renders independent structure tonnage for each location', async () => {
        const structureTonnage = {
            HD: 10,
            CT: 20,
            LT: 30,
            RT: 40,
            LA: 50,
            RA: 60,
            LL: 70,
            RL: 80,
        } as const;
        const structureLayer = await BipedPaperdollUtil.createStructurePaperdoll(55.32, 238, structureTonnage);

        const headZone = structureLayer.querySelector('[data-location="HD"][data-zone-type="structure"]');
        const centerTorsoZone = structureLayer.querySelector('[data-location="CT"][data-zone-type="structure"]');
        expect(headZone?.querySelectorAll('circle').length).toBe(PipUtil.getCanonStructurePipCount(10, 'HD'));
        expect(centerTorsoZone?.querySelectorAll('circle').length).toBe(PipUtil.getCanonStructurePipCount(20, 'CT'));
    });

    it('does not fall back when a canon amount is unavailable by default', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect id="placeholder-canon-armor-HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 10 }, {
            assetUrl: `data:image/svg+xml,${source}`,
        });

        expect(armorLayer.querySelector('[data-location="HD"][data-zone-type="armor"]')).toBeNull();
    });

    it('uses the explicitly selected fallback when a canon amount is unavailable', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect id="placeholder-canon-armor-HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 10 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            fallbackPipLayout: 'distributed',
        });

        const zone = armorLayer.querySelector('[data-location="HD"][data-zone-type="armor"]');
        expect(zone?.getAttribute('data-layout')).toBeNull();
        expect(zone?.querySelector('g')?.getAttribute('data-pip-layout')).toBe('distributed');
        expect(zone?.querySelectorAll('circle').length).toBe(10);
    });

    it('does not implicitly use canon for rail or fill modes', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect id="placeholder-canon-armor-HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const railLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
        });
        const fillLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'fill',
        });
        const fallbackLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
            fallbackPipLayout: 'canon',
        });

        expect(railLayer.querySelector('[data-location="HD"][data-zone-type="armor"]')).toBeNull();
        expect(fillLayer.querySelector('[data-location="HD"][data-zone-type="armor"]')).toBeNull();
        expect(fallbackLayer.querySelector('[data-pip-layout="canon"]')).not.toBeNull();
    });

    it('supports distributed placement as an explicit paperdoll mode', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect id="placeholder-canon-armor-HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'distributed',
        });

        expect(armorLayer.querySelector('[data-pip-layout="canon"]')).toBeNull();
        expect(armorLayer.querySelector('[data-pip-layout="distributed"]')).not.toBeNull();
    });

    it('prefers rail capacity attributes and falls back to durable SVG IDs', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path id="placeholder-rail-armor-CT-01-capacity-1" d="M 0 16 L 30 16" />
                    <path id="placeholder-rail-armor-CT-00-capacity-1" data-rail-capacity="3" d="M 0 4 L 30 4" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { CT: 4 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
        });

        const zones = armorLayer.querySelectorAll('[data-layout="rail"]');
        expect(zones.length).toBe(2);
        expect(zones[0].querySelector('circle')?.getAttribute('cy')).toBe('4');
        expect(zones[0].querySelectorAll('circle').length).toBe(3);
        expect(zones[1].querySelectorAll('circle').length).toBe(1);
    });

    it('shares a radius per location without unused rails shrinking it', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path id="placeholder-rail-armor-CT-00-capacity-5" d="M 0 10 L 100 10" />
                    <path id="placeholder-rail-armor-CT-01-capacity-5" d="M 0 4 L 2 4" />
                    <path id="placeholder-rail-armor-CT-02-capacity-5" d="M 0 16 L 2 16" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { CT: 5 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
        });

        const circles = armorLayer.querySelectorAll('[data-layout="rail"] circle');
        const radii = new Set(Array.from(circles, circle => circle.getAttribute('r')));
        expect(circles.length).toBe(5);
        expect(radii.size).toBe(1);
        expect(circles[0].getAttribute('r')).toBe('3');
    });

    it('renders fill placeholders from a detached paperdoll layer', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
                <g id="paperdoll-art-armor">
                    <path id="placeholder-fill-armor-CT-00" d="M 0 0 H 100 V 60 H 0 Z" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 60, { CT: 4 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'fill',
        });

        const zone = armorLayer.querySelector('[data-layout="fill"]');
        expect(zone).not.toBeNull();
        expect(zone?.querySelectorAll('circle').length).toBe(4);
    });

    it('renders the real armor fill placeholder', async () => {
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(84.68, 238, {
            LT: 12,
        }, {
            pipLayout: 'fill',
        });

        const zone = armorLayer.querySelector('[data-location="LT"][data-layout="fill"]');
        expect(zone).not.toBeNull();
        expect(zone?.querySelectorAll('circle').length).toBe(12);
    });

    it('balances numbered fill areas for one location by area', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50">
                <g id="paperdoll-art-armor">
                    <path id="placeholder-fill-armor-CT-00" d="M 0 0 H 80 V 50 H 0 Z" />
                    <path id="placeholder-fill-armor-CT-01" d="M 80 0 H 120 V 50 H 80 Z" />
                </g>
            </svg>
        `);
        const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(120, 50, { CT: 6 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'fill',
        });

        const zone = armorLayer.querySelector('[data-location="CT"][data-layout="fill"]');
        const circles = Array.from(zone?.querySelectorAll('circle') ?? []);
        expect(circles.length).toBe(6);
        expect(circles.filter(circle => Number(circle.getAttribute('cx')) < 80).length).toBe(4);
        expect(circles.filter(circle => Number(circle.getAttribute('cx')) > 80).length).toBe(2);
    });

    it('places rail diamonds along curved SVG geometry', () => {
        const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rail.setAttribute('d', 'M 0 0 C 10 0 20 20 30 20');

        const pips = PipUtil.createRailPips(rail, 5, { shape: 'diamond' }, 'shield-da', 'RA', 5);

        expect(pips).not.toBeNull();
        expect(pips?.querySelectorAll('polygon').length).toBe(5);
        expect(pips?.querySelector('polygon')?.getAttribute('transform')).toContain('rotate(');
    });

    it('places partial rails in their full-capacity slots', () => {
        const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rail.setAttribute('d', 'M 0 0 L 100 0');

        const pips = PipUtil.createRailPips(rail, 2, {}, 'armor', 'CT', 5);
        const circles = pips?.querySelectorAll('circle');

        expect(circles?.length).toBe(2);
        expect(Number(circles?.[0].getAttribute('cx'))).toBeCloseTo(10);
        expect(Number(circles?.[1].getAttribute('cx'))).toBeCloseTo(30);
    });

    it('keeps editable SVG metadata in stable IDs', async () => {
        const assets = await Promise.all([
            fetch('/images/paperdolls/biped-armor.svg').then(response => response.text()),
            fetch('/images/paperdolls/biped-structure.svg').then(response => response.text()),
        ]);
        const [armor, structure] = assets.map(source => new DOMParser().parseFromString(source, 'image/svg+xml'));

        expect(armor.querySelectorAll('[data-art], [data-location], [data-placeholder]').length).toBe(0);
        expect(structure.querySelectorAll('[data-art], [data-location], [data-placeholder]').length).toBe(0);
        expect(armor.querySelector('#paperdoll-art-armor')).not.toBeNull();
        expect(structure.querySelector('#paperdoll-art-structure')).not.toBeNull();
        expect(armor.querySelector('#paperdoll-art-armor-RT-armorRT')).not.toBeNull();
        expect(structure.querySelector('#paperdoll-art-structure-RT-isRT')).not.toBeNull();
        expect(armor.querySelector('#placeholder-canon-armor-RT')).not.toBeNull();
        expect(structure.querySelector('#placeholder-canon-structure-RT')).not.toBeNull();
        expect(armor.querySelector('#placeholder-canon-shield-dc-RA-00')).not.toBeNull();
        expect(armor.querySelector('#placeholder-canon-shield-da-LA-00')).not.toBeNull();
    });
});