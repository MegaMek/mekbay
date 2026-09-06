import { PaperdollGenerator } from './paperdoll-generator';

describe('paperdoll framing', () => {
    const assetUrl = `data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 80 160"
            data-shield-bounds-la="-30 0 40 80" data-shield-bounds-ra="90 0 40 80">
            <rect x="10" y="20" width="80" height="160" />
            <g data-mekbay-shield="LA" visibility="hidden"><rect x="-30" y="0" width="40" height="80" /></g>
            <g data-mekbay-shield="RA" visibility="hidden"><rect x="90" y="0" width="40" height="80" /></g>
        </svg>`)}`;

    for (const arms of [[], ['LA'], ['RA'], ['LA', 'RA']] as const) {
        it(`fits only visible artwork with ${arms.join('+') || 'no'} shields`, async () => {
            const layer = await PaperdollGenerator.createPaperdoll(assetUrl, 100, 200, {}, {
                centeredHorizontally: true,
                centeredVertically: true,
                shieldValues: Object.fromEntries(arms.map(arm => [arm, { dc: 8, da: 2 }])),
            });
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.appendChild(layer);
            document.body.appendChild(svg);
            try {
                const actual = layer.getBBox();
                // Browser SVG geometry uses float32; bounds may differ by a few millionths.
                expect(actual.x).toBeCloseTo(Number(layer.getAttribute('data-art-x')), 4);
                expect(actual.y).toBeCloseTo(Number(layer.getAttribute('data-art-y')), 4);
                expect(actual.width).toBeCloseTo(Number(layer.getAttribute('data-art-width')), 4);
                expect(actual.height).toBeCloseTo(Number(layer.getAttribute('data-art-height')), 4);
                expect(actual.x + actual.width / 2).toBeCloseTo(50, 4);
                expect(actual.y + actual.height / 2).toBeCloseTo(100, 4);
                expect(actual.width).toBeLessThanOrEqual(100.00001);
                expect(actual.height).toBeLessThanOrEqual(200.00001);
                expect(layer.querySelectorAll('[data-mekbay-shield]').length).toBe(arms.length);
                expect(layer.querySelector('[visibility="hidden"]')).toBeNull();
            } finally {
                svg.remove();
            }
        });
    }

    it('keeps authored coordinates and reports the cropped art origin at native size', async () => {
        const layer = await PaperdollGenerator.createPaperdoll(assetUrl, 100, 200, {}, {
            scale: false,
            preserveAuthoredCoordinates: true,
        });
        expect(layer.getAttribute('data-art-x')).toBe('10');
        expect(layer.getAttribute('data-art-y')).toBe('20');
        expect(layer.getAttribute('data-art-width')).toBe('80');
        expect(layer.getAttribute('data-art-height')).toBe('160');
        expect(layer.querySelector('[data-mekbay-shield]')).toBeNull();
    });
});
