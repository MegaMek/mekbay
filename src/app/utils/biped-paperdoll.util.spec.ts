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
            pipOptions: { padding: 1.8, stroke: '#b4492f' },
        });
        const structureLayer = await BipedPaperdollUtil.createStructurePaperdoll(55.32, 238, 50, {
            pipOptions: { padding: 1.8, stroke: '#356a8a' },
        });
        armorLayer.setAttribute('transform', 'translate(2 2)');
        structureLayer.setAttribute('transform', 'translate(96.68 2)');
        const paperdoll = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        paperdoll.append(armorLayer, structureLayer);

            expect(paperdoll.querySelector('#paperdoll-art-armor')).not.toBeNull();
            expect(paperdoll.querySelector('#paperdoll-art-structure')).not.toBeNull();
        expect(paperdoll.querySelectorAll('[data-type="armor"]').length).toBe(1);
        expect(paperdoll.querySelectorAll('[data-type="structure"]').length).toBe(1);
        expect(armorLayer.getAttribute('transform')).toBe('translate(2 2)');
        expect(structureLayer.getAttribute('transform')).toBe('translate(96.68 2)');
        expect(paperdoll.querySelectorAll('.biped-paperdoll-zone').length).toBe(23);
        expect(paperdoll.querySelectorAll('[data-location="CT_R"]').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('[data-pip-type="shield-dc"] circle').length).toBe(16);
        expect(paperdoll.querySelectorAll('[data-pip-type="shield-da"] polygon').length).toBe(2);
        expect(paperdoll.querySelector('[data-zone-type="shield-dc"]')?.parentElement?.parentElement?.getAttribute('transform')).toContain('translate');
        expect(paperdoll.querySelectorAll('.shield').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('path').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('circle').length).toBeGreaterThan(0);
        expect(paperdoll.querySelectorAll('[id^="paperdoll-rail-"]').length).toBe(0);
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

    it('renders the Affinity-exported armor asset', async () => {
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
            assetUrl: '/images/paperdolls/biped-armor-affinity.svg',
            shieldValues: {
                LA: { dc: 8, da: 1 },
                RA: { dc: 8, da: 1 },
            },
        });

        expect(armorLayer.querySelector('#paperdoll-art-armor')).not.toBeNull();
        expect(armorLayer.querySelectorAll('.biped-paperdoll-zone').length).toBe(15);
        expect(armorLayer.querySelectorAll('[data-pip-type="shield-dc"] circle').length).toBe(16);
        expect(armorLayer.querySelectorAll('[data-pip-type="shield-da"] polygon').length).toBe(2);
        expect(armorLayer.querySelectorAll('[data-placeholder]').length).toBe(0);
        expect(armorLayer.querySelectorAll('rect').length).toBe(0);
    });

    it('prefers rail capacity attributes and falls back to durable SVG IDs', async () => {
        const source = encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">
                <g id="paperdoll-art-armor">
                    <path id="paperdoll-rail-armor-CT-01-capacity-1" d="M 0 16 L 30 16" />
                    <path id="paperdoll-rail-armor-CT-00-capacity-1" data-rail-capacity="3" d="M 0 4 L 30 4" />
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
        expect(armor.querySelector('#paperdoll-placeholder-armor-RT')).not.toBeNull();
        expect(structure.querySelector('#paperdoll-placeholder-structure-RT')).not.toBeNull();
        expect(armor.querySelector('#paperdoll-placeholder-shield-dc-RA-00')).not.toBeNull();
        expect(armor.querySelector('#paperdoll-placeholder-shield-da-LA-00')).not.toBeNull();
    });
});