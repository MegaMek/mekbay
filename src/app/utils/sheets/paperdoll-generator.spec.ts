import { MekPaperdollGenerator } from './mek-paperdoll-generator';
import { PaperdollGenerator } from './paperdoll-generator';
import { decoratePaperdollPips } from './record-sheet-svg-rendering';

const PIP_ASSETS = [
    ...['biped', 'quad', 'quadvee', 'tripod', 'lam'].flatMap(chassis =>
        ['armor', 'armor-back', 'structure'].map(view => `${chassis}-${view}`)),
    ...['vehicle', 'naval'].flatMap(family =>
        ['', 'superheavy-'].flatMap(weight =>
            ['noturret', 'turret', 'dualturret'].map(turrets => `${family}-${weight}${turrets}`))),
    ...['noturret', 'turret'].map(turrets => `vtol-${turrets}`),
    ...['noturret', 'turret', 'dualturret'].map(turrets => `wige-${turrets}`),
    ...['biped', 'glider', 'quad'].map(chassis => `protomek-${chassis}`),
    ...['aerospace', 'conventional'].map(type => `fighter-${type}`),
    ...['smallcraft', 'dropship'].flatMap(family =>
        ['aerodyne', 'spheroid'].map(hull => `${family}-${hull}`)),
    'jumpship', 'warship', 'spacestation',
];

describe('PaperdollGenerator', () => {
    it('uses the bundled sheet font for legacy Eurostile artwork labels', async () => {
        const result = await PaperdollGenerator.createPaperdoll('/images/paperdolls/fighter-aerospace.svg', 344, 470);
        const nose = result.querySelector<SVGElement>('#textArmor_NOS');

        expect(nose?.style.fontFamily).toBe('Roboto, Arial, sans-serif');
        expect(nose?.closest('text')?.style.fontFamily).toBe('Roboto, Arial, sans-serif');
        expect(result.querySelector('[style*="Eurostile"], [font-family="Eurostile"]')).toBeNull();
    });

    for (const asset of PIP_ASSETS) {
        it(`fills every authored armor and structure location in ${asset}`, async () => {
            const assetUrl = `/images/paperdolls/${asset}.svg`;
            const source = new DOMParser().parseFromString(await (await fetch(assetUrl)).text(), 'image/svg+xml');
            const armor: Record<string, number> = {};
            const structure: Record<string, number> = {};
            for (const [type, counts, count] of [
                ['armor', armor, 7], ['structure', structure, 3],
            ] as const) {
                source.querySelectorAll(`[data-fill="${type}"][data-location], [data-canon="${type}"][data-location]`)
                    .forEach(element => { counts[element.getAttribute('data-location')!] = count; });
            }
            expect(Object.keys(armor).length + Object.keys(structure).length).toBeGreaterThan(0);

            for (const pipLayout of ['distributed', 'rail'] as const) {
                const result = await PaperdollGenerator.createPaperdoll(assetUrl, 200, 300, { armor, structure }, {
                    type: asset.endsWith('structure') ? 'structure' : 'armor',
                    pipLayout,
                });

                for (const [type, counts] of [['armor', armor], ['structure', structure]] as const) {
                    for (const [location, count] of Object.entries(counts)) {
                        expect(result.querySelectorAll(`[data-pip-type="${type}"][data-pip-location="${location}"] circle`).length)
                            .withContext(`${asset}: ${pipLayout} ${type} ${location}`).toBe(count);
                        const code = location.replace(/_R$/u, '');
                        const rear = location.endsWith('_R') ? '[data-rear]' : ':not([data-rear])';
                        expect(result.querySelector(`.unitLocation.${type}[data-loc="${code}"]${rear}`))
                            .withContext(`${asset}: ${type} ${location} needs a location contour`).not.toBeNull();
                    }
                }
                expect(result.querySelector('[data-fill], [data-canon], [data-rail]')).toBeNull();
                expect(result.querySelector('[loc], [rear]')).toBeNull();
                result.querySelectorAll('[clip-path]').forEach(element => {
                    const id = element.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/u)?.[1];
                    if (id) expect(result.querySelector(`[id="${id}"]`)).withContext(`${asset}: ${id}`).not.toBeNull();
                });
            }
        });
    }

    for (const chassis of ['quad', 'quadvee', 'tripod', 'lam']) {
        it(`keeps ${chassis} front and rear artwork and labels independent`, async () => {
            const front = await PaperdollGenerator.createPaperdoll(`/images/paperdolls/${chassis}-armor.svg`, 200, 300);
            const rear = await PaperdollGenerator.createPaperdoll(`/images/paperdolls/${chassis}-armor-back.svg`, 100, 85);

            expect(front.querySelector('[data-rear="1"]')).toBeNull();
            expect(front.querySelector('#textArmor_CTR')).toBeNull();
            expect(rear.querySelector('[data-rear="1"]')).not.toBeNull();
            expect(rear.querySelector('#textArmor_CTR')).not.toBeNull();
            expect(rear.querySelector('#textArmor_HD')).toBeNull();
            expect(rear.querySelector('[data-mekbay-random-hit]')).toBeNull();
            const ids = [front, rear].flatMap(layer =>
                Array.from(layer.querySelectorAll('[id]'), element => element.id));
            expect(new Set(ids).size).toBe(ids.length);
        });
    }

    it('has editable rail guides for every biped armor and structure location', async () => {
        const front = { HD: 9, CT: 47, LT: 32, RT: 32, LA: 34, RA: 34, LL: 41, RL: 41 };
        const rear = { CT_R: 15, LT_R: 10, RT_R: 10 };
        const structure = { HD: 3, CT: 31, LT: 21, RT: 21, LA: 17, RA: 17, LL: 21, RL: 21 };
        const layers = await Promise.all([
            MekPaperdollGenerator.createArmorPaperdoll(200, 300, front, { pipLayout: 'rail' }),
            MekPaperdollGenerator.createArmorRearPaperdoll(100, 90, rear, { pipLayout: 'rail' }),
            MekPaperdollGenerator.createStructurePaperdoll(117, 171, 100, { pipLayout: 'rail' }),
        ]);

        for (const [index, counts] of [front, rear, structure].entries()) {
            for (const [location, count] of Object.entries(counts)) {
                expect(layers[index].querySelectorAll(`[data-pip-layout="rail"][data-pip-location="${location}"] circle`).length)
                    .withContext(`view ${index}: ${location}`).toBe(count);
            }
            expect(layers[index].querySelector('[data-rail]')).toBeNull();
        }
    });

    it('includes alternate shield artwork only for equipped arms', async () => {
        const standard = await MekPaperdollGenerator.createArmorPaperdoll(200, 300, { LA: 20, RA: 20 });
        const shielded = await MekPaperdollGenerator.createArmorPaperdoll(200, 300, { LA: 20, RA: 20 }, {
            shieldValues: { LA: { dc: 8, da: 2 } },
        });

        expect(standard.querySelector('[data-mekbay-shield]')).toBeNull();
        expect(standard.querySelector('#paperdoll-art-armor-LA-path56721')).not.toBeNull();
        expect(shielded.querySelector('[data-mekbay-shield="LA"]')).not.toBeNull();
        expect(shielded.querySelector('[data-mekbay-shield="RA"]')).toBeNull();
        decoratePaperdollPips(shielded);
        expect(shielded.querySelectorAll('.pip.shield[data-loc="DCLA"]').length).toBe(8);
        expect(shielded.querySelectorAll('.pip.shield[data-loc="DALA"]').length).toBe(2);
        expect(shielded.querySelector('path.unitLocation.shield[data-loc="DCLA"]')).not.toBeNull();
        expect(shielded.querySelector('path.unitLocation.shield[data-loc="DALA"]')).not.toBeNull();
        expect(shielded.querySelectorAll('.pip.armor[data-loc="LA"]').length).toBe(20);
    });

    it('keeps grouped arm rails while falling back to filled shield damage tracks', async () => {
        const paperdoll = await MekPaperdollGenerator.createArmorPaperdoll(200, 300, { LA: 20 }, {
            pipLayout: 'rail',
            shieldValues: { LA: { dc: 8, da: 2 } },
        });
        decoratePaperdollPips(paperdoll);

        expect(paperdoll.querySelectorAll('[data-pip-layout="rail"][data-pip-location="LA"] .pip.armor').length).toBe(20);
        expect(paperdoll.querySelectorAll('.pip.shield[data-loc="DCLA"]').length).toBe(8);
        expect(paperdoll.querySelectorAll('.pip.shield[data-loc="DALA"]').length).toBe(2);
        expect(paperdoll.querySelector('.unitLocation.shield .pip')).toBeNull();
    });

    it('uses existing biped body contours as location hit areas', async () => {
        const front = await MekPaperdollGenerator.createArmorPaperdoll(200, 300, {});
        const rear = await MekPaperdollGenerator.createArmorRearPaperdoll(100, 90, {});
        const structure = await MekPaperdollGenerator.createStructurePaperdoll(117, 171, 50);

        expect(front.querySelectorAll('.unitLocation.armor[data-loc]').length).toBe(8);
        expect(rear.querySelectorAll('.unitLocation.armor[data-loc][data-rear="1"]').length).toBe(3);
        expect(structure.querySelectorAll('.unitLocation.structure[data-loc]').length).toBe(8);
        expect(front.querySelector('.unitLocation.armor')?.tagName).toBe('path');
    });

    for (const view of ['armor', 'armor-back', 'structure']) {
        it(`keeps the ${view} rail slots inside their editable location areas`, async () => {
            const source = new DOMParser().parseFromString(
                await (await fetch(`/images/paperdolls/biped-${view}.svg`)).text(), 'image/svg+xml',
            );
            const svg = document.importNode(source.documentElement, true) as unknown as SVGSVGElement;
            svg.style.visibility = 'hidden';
            document.body.appendChild(svg);
            try {
                for (const rail of svg.querySelectorAll<SVGPathElement>('[data-rail] path')) {
                    const location = rail.closest('[data-location]')!.getAttribute('data-location')!;
                    const type = view === 'structure' ? 'structure' : 'armor';
                    const area = svg.querySelector<SVGGeometryElement>(`[data-fill="${type}"][data-location="${location}"]`)!;
                    const transform = area.getScreenCTM()!.inverse().multiply(rail.getScreenCTM()!);
                    const capacity = Number(rail.getAttribute('data-rail-capacity'));
                    for (let index = 0; index < capacity; index++) {
                        const point = rail.getPointAtLength(rail.getTotalLength() * (index + 0.5) / capacity);
                        const local = new DOMPoint(point.x, point.y).matrixTransform(transform);
                        expect(area.isPointInFill(local)).withContext(
                            `${view} ${location} rail ${rail.getAttribute('data-rail-index')} slot ${index}: ${point.x},${point.y}`,
                        ).toBeTrue();
                    }
                }
            } finally {
                svg.remove();
            }
        });
    }
});
