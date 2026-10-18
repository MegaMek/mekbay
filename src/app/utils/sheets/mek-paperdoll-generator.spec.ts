import { PaperdollGenerator } from './paperdoll-generator';
import { MekPaperdollGenerator } from './mek-paperdoll-generator';
import { CanonPipRenderer } from './canon-pip-renderer';
import { PipShapeProfileGenerator } from './pip-shape-profile-generator';
import { RailPipRenderer } from './rail-pip-renderer';

describe('MekPaperdollGenerator', () => {
    it('shares failures and retries a rejected paperdoll asset', async () => {
        const assetUrl = 'https://example.test/retry-paperdoll.svg';
        const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="paperdoll-art-armor" /></svg>';
        let attempts = 0;
        const fetcher = spyOn(globalThis, 'fetch').and.callFake(async () => {
            attempts++;
            return attempts === 1
                ? new Response('', { status: 503 })
                : new Response(source, { status: 200 });
        });

        const first = MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl });
        const second = MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl });
        await expectAsync(Promise.all([first, second])).toBeRejectedWithError(/503/u);
        expect(fetcher).toHaveBeenCalledTimes(1);

        await expectAsync(MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl })).toBeResolved();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('bounds settled custom paperdoll assets without thrashing the working set', async () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="paperdoll-art-armor" /></svg>';
        const fetcher = spyOn(globalThis, 'fetch').and.callFake(async () =>
            new Response(source, { status: 200 }));
        const urls = Array.from(
            { length: 33 },
            (_, index) => `https://example.test/cache-paperdoll-${index}.svg`,
        );

        for (const assetUrl of urls) {
            await MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl });
        }
        await MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl: urls.at(-1)! });
        expect(fetcher).toHaveBeenCalledTimes(urls.length);

        await MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl: urls[0] });
        expect(fetcher).toHaveBeenCalledTimes(urls.length + 1);
    });

    it('keeps semantic overlays and removes superseded asset text', async () => {
        const assetUrl = 'https://example.test/semantic-paperdoll.svg';
        const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
            <g id="paperdoll-art-armor"><text>Legacy</text></g>
            <g data-mekbay-paperdoll-overlay="armor"><text>Center Torso</text></g>
        </svg>`;
        spyOn(window, 'fetch').and.resolveTo(new Response(source));

        const layer = await MekPaperdollGenerator.createArmorPaperdoll(10, 10, {}, { assetUrl });

        expect(layer.textContent).toContain('Center Torso');
        expect(layer.textContent).not.toContain('Legacy');
    });

    it('renders armor and structure silhouettes with location pip layers', async () => {
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(84.68, 238, {
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
        const rearArmorLayer = await MekPaperdollGenerator.createArmorRearPaperdoll(84.68, 238, {
            CT_R: 10,
            LT_R: 8,
            RT_R: 8,
        }, {
            pipOptions: { inset: 1.8, stroke: '#b4492f' },
        });
        const structureLayer = await MekPaperdollGenerator.createStructurePaperdoll(55.32, 238, 50, {
            pipOptions: { inset: 1.8, stroke: '#356a8a' },
        });
        const paperdoll = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        paperdoll.append(armorLayer, rearArmorLayer, structureLayer);

        expect(paperdoll.querySelector('#paperdoll-art-armor')).not.toBeNull();
        expect(paperdoll.querySelector('#paperdoll-art-structure')).not.toBeNull();
        expect(paperdoll.querySelectorAll('[data-type="armor"]').length).toBe(2);
        expect(paperdoll.querySelectorAll('[data-type="structure"]').length).toBe(1);
        expect(armorLayer.querySelector('[data-location="CT_R"]')).toBeNull();
        expect(armorLayer.querySelector('[data-location="LT_R"]')).toBeNull();
        expect(armorLayer.querySelector('[data-location="RT_R"]')).toBeNull();
        expect(paperdoll.querySelectorAll('.paperdoll-zone').length).toBe(23);
        expect(paperdoll.querySelectorAll('[data-location="CT_R"]').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('[data-pip-type="shield-dc"] circle').length).toBe(16);
        expect(paperdoll.querySelectorAll('[data-pip-type="shield-da"] polygon').length).toBe(2);
        expect(paperdoll.querySelectorAll('.shield').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('path').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('circle').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('[data-canon]').length).toBe(0);
        expect(paperdoll.querySelectorAll('rect').length).toBe(0);
    });

    it('adds an optional outline frame', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path d="M 0 0 H 100 V 20 H 0 Z" />
                </g>
            </svg>
        `);
        const unframedLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
        });
        const framedLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 40, {}, {
            assetUrl: `data:image/svg+xml,${source}`,
            outline: true,
        });

        expect(unframedLayer.querySelector('.paperdoll-frame')).toBeNull();
        const frame = framedLayer.querySelector<SVGRectElement>('.paperdoll-frame');
        expect(frame).not.toBeNull();
        expect(frame?.getAttribute('fill')).toBe('none');
    });

    it('renders rear armor from the dedicated rear asset', async () => {
        const paperdoll = await MekPaperdollGenerator.createArmorRearPaperdoll(84.68, 238, {
            CT_R: 10,
            LT_R: 8,
            RT_R: 8,
        });

        expect(paperdoll.getAttribute('data-source')).toBe('/images/paperdolls/biped-armor-back.svg');
        expect(paperdoll.querySelector('svg#paperdoll-art-armor')).toBeNull();
        expect(paperdoll.querySelector('#paperdoll-art-armor-CT_R-armorCTR')).not.toBeNull();
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
        const structureLayer = await MekPaperdollGenerator.createStructurePaperdoll(55.32, 238, structureTonnage);

        const headZone = structureLayer.querySelector('[data-location="HD"][data-zone-type="structure"]');
        const centerTorsoZone = structureLayer.querySelector('[data-location="CT"][data-zone-type="structure"]');
        expect(headZone?.querySelectorAll('circle').length).toBe(CanonPipRenderer.getStructurePipCount(10, 'HD'));
        expect(centerTorsoZone?.querySelectorAll('circle').length).toBe(CanonPipRenderer.getStructurePipCount(20, 'CT'));
    });

    it('lets combined paperdolls render armor and structure with independent pip shapes', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
                <g id="paperdoll-art-armor">
                    <rect data-fill="armor" data-location="CT" x="0" y="0" width="100" height="38" />
                    <rect data-fill="structure" data-location="CT" x="0" y="42" width="100" height="38" />
                </g>
            </svg>
        `);
        const paperdoll = await PaperdollGenerator.createPaperdoll(
            `data:image/svg+xml,${source}`,
            100,
            80,
            { armor: { CT: 4 }, structure: { CT: 3 } },
            {
                pipLayout: 'distributed',
                pipOptions: { shape: 'diamond' },
                structurePipOptions: { shape: 'circle' },
            },
        );

        const armor = paperdoll.querySelector('[data-location="CT"][data-zone-type="armor"]');
        const structure = paperdoll.querySelector('[data-location="CT"][data-zone-type="structure"]');
        expect(armor?.querySelectorAll('polygon').length).toBe(4);
        expect(armor?.querySelectorAll('circle').length).toBe(0);
        expect(structure?.querySelectorAll('circle').length).toBe(3);
        expect(structure?.querySelectorAll('polygon').length).toBe(0);
    });

    it('distributes pips when a canon amount is unavailable', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect data-canon="armor" data-location="HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 20, { HD: 10 }, {
            assetUrl: `data:image/svg+xml,${source}`,
        });

        expect(armorLayer.querySelector('[data-pip-layout="canon"]')).toBeNull();
        expect(armorLayer.querySelectorAll('[data-pip-layout="distributed"] circle')).toHaveSize(10);
    });

    it('uses the explicitly selected fallback when a canon amount is unavailable', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <rect data-canon="armor" data-location="HD" x="0" y="0" width="100" height="20" />
                </g>
            </svg>
        `);
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 20, { HD: 10 }, {
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
        const railLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
        });
        const fallbackLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 20, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
            fallbackPipLayout: 'canon',
        });

        expect(railLayer.querySelector('[data-pip-layout="canon"]')).toBeNull();
        expect(railLayer.querySelectorAll('[data-pip-layout="distributed"] circle')).toHaveSize(1);
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
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 20, { HD: 1 }, {
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
            const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 60, {
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

    it('uses rectangular fill bounds for canonical placement on classic assets', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
                <g id="paperdoll-art-armor">
                    <rect data-fill="armor" data-location="HD" x="10" y="5" width="80" height="30" />
                </g>
            </svg>
        `);
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 40, { HD: 1 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'canon',
        });

        const zone = armorLayer.querySelector('[data-location="HD"][data-zone-type="armor"]');
        expect(zone?.querySelector('[data-pip-layout="canon"]')).not.toBeNull();
        expect(zone?.querySelectorAll('circle').length).toBe(1);
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
            const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(120, 50, {
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

    it('allocates authored multisection pips proportionally like MegaMekLab', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 50">
                <g id="paperdoll-art-armor">
                    <g class="paperdoll-pip-profile" data-multisection="true">
                        <g>
                            <rect data-fill="armor" data-location="RA"
                                x="0" y="0" width="10" height="10" />
                        </g>
                        <g>
                            <rect data-fill="armor" data-location="RA"
                                x="0" y="30" width="30" height="10" />
                        </g>
                    </g>
                </g>
            </svg>
        `);
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(60, 50, { RA: 8 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'classic',
            scale: false,
        });

        const zone = armorLayer.querySelector('[data-location="RA"][data-zone-type="armor"]');
        const sections = zone?.querySelectorAll<SVGGElement>('[data-pip-section-index]');
        expect(zone?.querySelectorAll('circle').length).toBe(8);
        expect(sections?.length).toBe(2);
        expect(sections?.[0].querySelectorAll('circle').length).toBe(2);
        expect(sections?.[1].querySelectorAll('circle').length).toBe(6);
    });

    it('renders production limb fill shapes in active shape layouts', async () => {
        const locations = ['LT', 'RT', 'LA', 'RA', 'LL', 'RL'] as const;
        const values = Object.fromEntries(locations.map(location => [location, 12]));

        for (const pipLayout of ['distributed', 'generic'] as const) {
            const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(84.68, 238, values, {
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
        const canonLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 60, {
            HD: 2,
            CT: 4,
        }, {
            assetUrl: `data:image/svg+xml,${source}`,
            shieldValues: { RA: { dc: 2 } },
            pipLayout: 'canon',
        });
        const distributedLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 60, {
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

    it('generates fill rows by default unless disabled', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
                <g id="paperdoll-art-armor">
                    <path data-fill="armor" data-location="CT" d="M 0 0 H 100 V 80 H 0 Z" />
                </g>
            </svg>
        `);
        const createProfile = spyOn(PipShapeProfileGenerator, 'createProfile').and.callThrough();
        const options = {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'distributed' as const,
            pipOptions: { inset: 1, minPipRadius: 0, pipGap: 0 },
        };

        const generatedLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 80, { CT: 8 }, options);
        expect(generatedLayer.querySelector('[data-pip-layout="distributed"]')).not.toBeNull();
        expect(createProfile).toHaveBeenCalled();

        createProfile.calls.reset();
        const directLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 80, { CT: 8 }, {
            ...options,
            generateFillRows: false,
        });
        expect(directLayer.querySelector('[data-pip-layout="distributed"]')).not.toBeNull();
        expect(createProfile).not.toHaveBeenCalled();
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
        const armorLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 20, { CT: 4 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'rail',
        });

        const zones = armorLayer.querySelectorAll('[data-layout="rail"]');
        expect(zones.length).toBe(2);
        expect(zones[0].querySelectorAll('circle').length).toBe(3);
        expect(zones[1].querySelectorAll('circle').length).toBe(1);
    });

    it('shows generated fill rows as outlined placeholders when requested', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
                <g id="paperdoll-art-armor">
                    <path data-fill="armor" data-location="CT" d="M 0 0 H 100 V 60 H 0 Z" />
                </g>
            </svg>
        `);
        const options = {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'distributed' as const,
            pipOptions: { rowHeight: 5 },
            showFillPlaceholders: true,
        };
        const debugLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 60, { CT: 4 }, options);
        const rows = Array.from(debugLayer.querySelectorAll<SVGRectElement>('[data-fill-placeholder-row="true"]'));
        const placeholderGroup = debugLayer.querySelector('[data-fill-placeholder="true"]');

        expect(placeholderGroup).not.toBeNull();
        expect(placeholderGroup?.getAttribute('data-fill-location')).toBe('CT');
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.every(row => row.getAttribute('fill') === 'none')).toBeTrue();
        expect(rows.every(row => row.getAttribute('stroke'))).toBeTrue();

        const noGeneratedRowsLayer = await MekPaperdollGenerator.createArmorPaperdoll(100, 60, { CT: 4 }, {
            assetUrl: `data:image/svg+xml,${source}`,
            pipLayout: 'distributed',
            generateFillRows: false,
            showFillPlaceholders: true,
        });
        expect(noGeneratedRowsLayer.querySelector('[data-fill-placeholder]')).toBeNull();
        expect(noGeneratedRowsLayer.querySelector('[data-fill-placeholder-row]')).toBeNull();
    });

    it('renders rail diamonds along curved SVG paths', () => {
        const rail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rail.setAttribute('d', 'M 0 0 C 10 0 20 20 30 20');

        const pips = RailPipRenderer.createPips(rail, 5, { shape: 'diamond' }, 'shield-da', 'RA', 5);

        expect(pips).not.toBeNull();
        expect(pips?.querySelectorAll('polygon').length).toBe(5);
    });
});
