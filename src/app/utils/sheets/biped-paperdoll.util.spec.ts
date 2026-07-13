import { BipedPaperdollUtil } from './biped-paperdoll.util';
import { CanonPipRenderer } from './canon-pip-renderer';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
import { RailPipRenderer } from './rail-pip-renderer';

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
        expect(paperdoll.querySelectorAll('[data-canon]').length).toBe(0);
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
        expect(headZone?.querySelectorAll('circle').length).toBe(CanonPipRenderer.getStructurePipCount(10, 'HD'));
        expect(centerTorsoZone?.querySelectorAll('circle').length).toBe(CanonPipRenderer.getStructurePipCount(20, 'CT'));
    });

    it('does not fall back when a canon amount is unavailable by default', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect data-canon="armor" data-location="HD" x="0" y="0" width="100" height="20" />
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
                    <rect data-canon="armor" data-location="HD" x="0" y="0" width="100" height="20" />
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

    it('does not implicitly use canon for rail mode', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect data-canon="armor" data-location="HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const railLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
        });
        const fallbackLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
            fallbackPipLayout: 'canon',
        });

        expect(railLayer.querySelector('[data-location="HD"][data-zone-type="armor"]')).toBeNull();
        expect(fallbackLayer.querySelector('[data-pip-layout="canon"]')).not.toBeNull();
    });

    it('supports distributed placement as an explicit paperdoll mode', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect data-fill="armor" data-canon="armor" data-location="HD" x="0" y="0" width="100" height="20" />
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

    it('routes data-fill geometry through distributed and generic layouts', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
                <g id="paperdoll-art-armor">
                    <path data-fill="armor" data-location="LT" d="M 0 0 H 80 V 50 H 0 Z" />
                </g>
            </svg>
        `);

        for (const pipLayout of ['distributed', 'generic'] as const) {
            const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 60, {
                LT: 4,
            }, {
                assetUrl: `data:image/svg+xml,${source}`,
                pipLayout,
            });

            const zone = armorLayer.querySelector('[data-location="LT"][data-zone-type="armor"]');
            expect(zone?.querySelector(`[data-pip-layout="${pipLayout}"]`)).not.toBeNull();
            expect(zone?.getAttribute('data-layout')).not.toBe('fill');
            expect(zone?.querySelectorAll('circle').length).toBe(4);
        }
    });

    it('keeps multiple standalone fill areas in active shape layouts', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50">
                <g id="paperdoll-art-armor">
                    <path data-fill="armor" data-location="CT" d="M 0 0 H 80 V 50 H 0 Z" />
                    <path data-fill="armor" data-location="CT" d="M 80 0 H 120 V 50 H 80 Z" />
                </g>
            </svg>
        `);

        for (const pipLayout of ['distributed', 'generic'] as const) {
            const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(120, 50, {
                CT: 6,
            }, {
                assetUrl: `data:image/svg+xml,${source}`,
                pipLayout,
            });

            const zone = armorLayer.querySelector('[data-location="CT"][data-zone-type="armor"]');
            expect(zone?.querySelector(`[data-pip-layout="${pipLayout}"]`)).not.toBeNull();
            expect(zone?.querySelectorAll('circle').length).toBe(6);
        }
    });

    it('renders production limb fill shapes in active shape layouts', async () => {
        const locations = ['LT', 'RT', 'LA', 'RA', 'LL', 'RL'] as const;
        const values = Object.fromEntries(locations.map(location => [location, 12]));

        for (const pipLayout of ['distributed', 'generic'] as const) {
            const armorLayer = await BipedPaperdollUtil.createArmorPaperdoll(84.68, 238, values, {
                pipLayout,
            });

            for (const location of locations) {
                const zone = armorLayer.querySelector(
                    `[data-location="${location}"][data-zone-type="armor"]`,
                );
                expect(zone?.querySelector(`[data-pip-layout="${pipLayout}"]`)).not.toBeNull();
                expect(zone?.querySelectorAll('circle').length).toBe(12);
            }
        }
    });

    it('routes canon and fill markers independently and supports overlapping markers', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
                <g id="paperdoll-art-armor">
                    <rect data-canon="armor" data-location="HD" x="0" y="0" width="30" height="20" />
                    <rect data-fill="armor" data-canon="armor" data-location="CT" x="35" y="0" width="60" height="50" />
                    <rect data-fill="shield-dc" data-location="RA" x="0" y="30" width="30" height="6" />
                    <rect data-fill="shield-dc" data-location="RA" x="0" y="38" width="30" height="6" />
                </g>
            </svg>
        `);
        const canonLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 60, {
            HD: 2,
            CT: 4,
        }, {
            assetUrl: `data:image/svg+xml,${source}`,
            shieldValues: { RA: { dc: 2 } },
            pipLayout: 'canon',
        });
        const distributedLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 60, {
            HD: 2,
            CT: 4,
        }, {
            assetUrl: `data:image/svg+xml,${source}`,
            shieldValues: { RA: { dc: 2 } },
            pipLayout: 'distributed',
        });
        expect(canonLayer.querySelector('[data-location="HD"] [data-pip-layout="canon"]')).not.toBeNull();
        expect(canonLayer.querySelector('[data-location="CT"] [data-pip-layout="canon"]')).not.toBeNull();
        expect(canonLayer.querySelector('[data-pip-type="shield-dc"]')?.querySelectorAll('circle').length).toBe(2);
        expect(distributedLayer.querySelector('[data-location="HD"][data-zone-type="armor"]')).toBeNull();
        expect(distributedLayer.querySelector('[data-location="CT"] [data-pip-layout="distributed"]')).not.toBeNull();
    });

    it('places active renderers on aligned grid points inside non-rectangular geometry', () => {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', 'M 0 0 H 100 V 80 H 60 V 30 H 0 Z');
        const options = {
            inset: 1,
            minPipRadius: 0,
            pipGap: 0,
        };
        const renderers = [
            GenericPipRenderer.createPips(shape, 8, options, 'armor', 'CT'),
            DistributedPipRenderer.createPips(shape, 8, options, 'armor', 'CT'),
        ];

        for (const pips of renderers) {
            expect(pips).not.toBeNull();
            const circles = Array.from(pips?.querySelectorAll('circle') ?? []);
            expect(circles.length).toBe(8);
            expect(new Set(circles.map(circle => circle.getAttribute('cy'))).size).toBeGreaterThan(1);
            for (const circle of circles) {
                const x = Number(circle.getAttribute('cx'));
                const y = Number(circle.getAttribute('cy'));
                expect(x < 60 && y > 30).toBeFalse();
            }
        }
    });

    it('prefers rail capacity attributes and falls back to durable SVG IDs', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <g data-rail="armor" data-location="CT">
                        <path data-rail-index="1" data-rail-capacity="1" d="M 0 16 L 30 16" />
                        <path data-rail-index="0" data-rail-capacity="3" d="M 0 4 L 30 4" />
                    </g>
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
                    <path data-rail="armor" data-location="CT" data-rail-index="0" data-rail-capacity="5" d="M 0 10 L 100 10" />
                    <path data-rail="armor" data-location="CT" data-rail-index="1" data-rail-capacity="5" d="M 0 4 L 2 4" />
                    <path data-rail="armor" data-location="CT" data-rail-index="2" data-rail-capacity="5" d="M 0 16 L 2 16" />
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

    it('shows generated fill rows as outlined placeholders when requested', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
                <g id="paperdoll-art-armor">
                    <path data-fill="armor" data-location="CT" transform="translate(4 3)" d="M 0 0 H 100 V 60 H 0 Z" />
                </g>
            </svg>
        `);
        const options = {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'distributed' as const,
            pipOptions: { rowHeight: 5 },
            showFillPlaceholders: true,
        };
        const debugLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 60, { CT: 4 }, options);
        const rows = Array.from(debugLayer.querySelectorAll<SVGRectElement>('[data-fill-placeholder-row="true"]'));
        const placeholderGroup = debugLayer.querySelector('[data-fill-placeholder="true"]');

        expect(placeholderGroup).not.toBeNull();
        expect(placeholderGroup?.getAttribute('data-fill-location')).toBe('CT');
        expect(placeholderGroup?.getAttribute('transform')).toBe('translate(4 3)');
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.every(row => Number(row.getAttribute('width')) > Number(row.getAttribute('height')))).toBeTrue();
        expect(rows.every(row => Number(row.getAttribute('height')) <= 5)).toBeTrue();
        expect(rows.every(row => row.getAttribute('fill') === 'none')).toBeTrue();
        expect(rows.every(row => row.getAttribute('stroke'))).toBeTrue();

        const defaultLayer = await BipedPaperdollUtil.createArmorPaperdoll(100, 60, { CT: 4 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'distributed',
        });
        expect(defaultLayer.querySelector('[data-fill-placeholder]')).toBeNull();
    });

    it('places rail diamonds along curved SVG geometry', () => {
        const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rail.setAttribute('d', 'M 0 0 C 10 0 20 20 30 20');

        const pips = RailPipRenderer.createPips(rail, 5, { shape: 'diamond' }, 'shield-da', 'RA', 5);

        expect(pips).not.toBeNull();
        expect(pips?.querySelectorAll('polygon').length).toBe(5);
        expect(pips?.querySelector('polygon')?.getAttribute('transform')).toContain('rotate(');
    });

    it('places partial rails in their full-capacity slots', () => {
        const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rail.setAttribute('d', 'M 0 0 L 100 0');

        const pips = RailPipRenderer.createPips(rail, 2, {}, 'armor', 'CT', 5);
        const circles = pips?.querySelectorAll('circle');

        expect(circles?.length).toBe(2);
        expect(Number(circles?.[0].getAttribute('cx'))).toBeCloseTo(10);
        expect(Number(circles?.[1].getAttribute('cx'))).toBeCloseTo(30);
    });

    it('keeps editable SVG metadata in explicit attributes', async () => {
        const assets = await Promise.all([
            fetch('/images/paperdolls/biped-armor.svg').then(response => response.text()),
            fetch('/images/paperdolls/biped-structure.svg').then(response => response.text()),
        ]);
        const [armor, structure] = assets.map(source => new DOMParser().parseFromString(source, 'image/svg+xml'));

        expect(armor.querySelectorAll('[data-canon], [data-fill]').length).toBeGreaterThan(0);
        expect(structure.querySelectorAll('[data-canon], [data-fill]').length).toBeGreaterThan(0);
        expect(armor.querySelector('#paperdoll-art-armor')).not.toBeNull();
        expect(structure.querySelector('#paperdoll-art-structure')).not.toBeNull();
        expect(armor.querySelector('#paperdoll-art-armor-RT-armorRT')).not.toBeNull();
        expect(structure.querySelector('#paperdoll-art-structure-RT-isRT')).not.toBeNull();
        expect(armor.querySelector('[data-canon="armor"][data-location="RT"]')).not.toBeNull();
        expect(structure.querySelector('[data-canon="structure"][data-location="RT"]')).not.toBeNull();
        expect(armor.querySelectorAll('[data-fill="shield-dc"][data-location="RA"]')).toHaveSize(8);
        expect(armor.querySelector('[data-fill="shield-da"][data-location="LA"]')).not.toBeNull();
        expect(armor.querySelector('[data-fill="armor"][data-canon="armor"][data-location="CT"]')).not.toBeNull();
        expect(armor.querySelectorAll('[id^="placeholder-"]')).toHaveSize(0);
        expect(structure.querySelectorAll('[id^="placeholder-"]')).toHaveSize(0);
    });
});