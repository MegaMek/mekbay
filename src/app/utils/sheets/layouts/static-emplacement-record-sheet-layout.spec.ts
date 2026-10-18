// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentRegistry } from '../../../models/equipment-lookup';
import { AmmoEquipment, ArmorEquipment, WeaponEquipment, createEquipment } from '../../../models/equipment.model';
import { StaticEmplacementEntity } from '../../../models/entity/entities/misc/static-emplacement-entity';
import { parseEntity } from '../../../models/entity/parse-entity';
import { encodeNativeEntity } from '../../../models/entity/write-entity';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { resolveRecordSheetLayout } from './record-sheet-layout-resolver';
import { StaticEmplacementRecordSheetLayout } from './static-emplacement-record-sheet-layout';
import { setConstructionBuildingTopology } from '../../../construction/domain/construction-building-topology';
import { BUILDING_DIRECTIONS, BUILDING_ORIGIN, buildingLocationName, buildingConnectedComponents } from '../../../models/entity/types/building';
import { locationArmor } from '../../../models/entity/types';

describe('StaticEmplacementRecordSheetLayout', () => {
    it('marks reciprocal cuts while excluding exterior walls and missing upper-floor neighbors', async () => {
        const entity = parseEntity('<UnitType>\nMobileStructure\n</UnitType>\n<coords>\n0,0,0\n</coords>',
            'continuations.blk', registry).entity as StaticEmplacementEntity;
        const labels = ['0102', '0103', '0201', '0202', '0203', '0204', '0302', '0303', '0304', '0305',
            '0401', '0402', '0403', '0404', '0502', '0503', '0504', '0604', '0705', '0805', '0906'];
        const hexes = labels.map(label => {
            const q = Number(label.slice(0, 2)) - 1;
            return { q, r: Number(label.slice(2)) - 1 - Math.floor(q / 2) };
        });
        setConstructionBuildingTopology(entity, hexes, 2);
        const footprint = entity.coordinates();
        entity.hexHeights.set(new Map(footprint.filter(hex => hex.q >= 5).map(hex => [`${hex.q},${hex.r}`, 1])));
        for (const pageFormat of ['letter', 'a4'] as const) {
            const pages = (await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare', pageFormat })).filter(svg => svg.querySelector('#buildingTemplate'));
            const sections = new Map<string, number>(), actual: string[] = [];
            let section = 0;
            for (const page of pages) {
                for (const floor of page.querySelectorAll<SVGGElement>('.building-template-floor')) {
                    const level = floor.getAttribute('data-building-floor')!;
                    for (const hex of floor.querySelectorAll('.building-template-hex'))
                        sections.set(`${level}/${hex.getAttribute('data-building-hex')}`, section);
                    for (const marker of floor.querySelectorAll('.building-template-continuation')) {
                        expect(level).toBe('0');
                        actual.push(`${level}/${marker.getAttribute('data-continuation-from')}/${marker.getAttribute('data-continuation-to')}`);
                    }
                    section++;
                }
            }
            const expected: string[] = [];
            for (const level of entity.mapLevels()) for (const hex of footprint) {
                const from = `${level}/${entity.displayHex(hex)}`;
                if (!sections.has(from)) continue;
                for (const direction of BUILDING_DIRECTIONS) {
                    const neighbor = { q: hex.q + direction.q, r: hex.r + direction.r };
                    const to = `${level}/${entity.displayHex(neighbor)}`;
                    if (sections.has(to) && sections.get(from) !== sections.get(to)) expected.push(`${from}/${entity.displayHex(neighbor)}`);
                }
            }
            expect(expected.length).toBeGreaterThan(0);
            expect(actual.sort()).toEqual(expected.sort());
        }
    });

    it('minimizes connected template pieces and orders them by their first hex', async () => {
        const branched = ['0102', '0103', '0201', '0202', '0203', '0204', '0302', '0303', '0304', '0401', '0402', '0403',
            '0502', '0503', '0504', '0505', '0506', '0602', '0603', '0604', '0703', '0705', '0805', '0906', '1006', '1107',
            '1207', '1308', '1408', '1509', '1609', '1710', '1810', '1911'].map(label => {
                const q = Number(label.slice(0, 2)) - 1;
                return { q, r: Number(label.slice(2)) - 1 - Math.floor(q / 2) };
            });
        for (const fixture of [{ hexes: Array.from({ length: 11 }, (_, q) => ({ q, r: 0 })), pieces: 2, pages: 1 },
            { hexes: branched, pieces: 4, pages: 2 }]) for (const pageFormat of ['letter', 'a4'] as const) {
            const entity = parseBuilding();
            setConstructionBuildingTopology(entity, fixture.hexes, 1);
            const pages = (await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare', pageFormat })).filter(svg => svg.querySelector('#buildingTemplate'));
            expect(pages.length).toBe(fixture.pages);
            let pieces = 0;
            const seen: string[] = [], starts: string[] = [];
            for (const page of pages) {
                for (const floor of page.querySelectorAll<SVGGElement>('.building-template-floor')) {
                    pieces++;
                    const labels = [...floor.querySelectorAll('.building-template-hex')].map(hex => hex.getAttribute('data-building-hex')!).sort();
                    expect(labels.length).toBeGreaterThan(1);
                    expect(buildingConnectedComponents(entity.coordinates().filter(hex => labels.includes(entity.displayHex(hex)))).length).toBe(1);
                    seen.push(...labels);
                    starts.push(labels[0]);
                }
            }
            expect(pieces).toBe(fixture.pieces);
            expect(starts).toEqual([...starts].sort());
            expect(seen.sort()).toEqual(entity.coordinates().map(hex => entity.displayHex(hex)).sort());
        }
    });

    it('keeps the remaining corridor contiguous in the last template section', async () => {
        const entity = parseBuilding();
        const labels = ['0102', '0103', '0201', '0202', '0203', '0204', '0302', '0303', '0304', '0305',
            '0401', '0402', '0403', '0404', '0502', '0503', '0504', '0604', '0605', '0606', '0704', '0705',
            '0803', '0805', '0906', '1006', '1107', '1207', '1308', '1408', '1509', '1609'];
        const hexes = labels.map(label => {
            const q = Number(label.slice(0, 2)) - 1;
            return { q, r: Number(label.slice(2)) - 1 - Math.floor(q / 2) };
        });
        setConstructionBuildingTopology(entity, hexes, 1);
        for (const pageFormat of ['letter', 'a4'] as const) {
            const pages = (await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare', pageFormat })).filter(svg => svg.querySelector('#buildingTemplate'));
            expect(pages.length).toBe(2);
            const floors = [...pages.at(-1)!.querySelectorAll<SVGGElement>('.building-template-floor')];
            expect(floors.length).toBe(2);
            // Six columns fit across the page: this 16-column footprint needs at least three pieces.
            expect(pages.reduce((sum, page) => sum + page.querySelectorAll('.building-template-floor').length, 0)).toBe(3);
            const tail = [...floors.at(-1)!.querySelectorAll('.building-template-hex')].map(hex => hex.getAttribute('data-building-hex'));
            expect(tail).toEqual(jasmine.arrayContaining(['1308', '1408', '1509', '1609']));
            expect(pages.flatMap(page => [...page.querySelectorAll('.building-template-hex')]
                .map(hex => hex.getAttribute('data-building-hex'))).sort()).toEqual([...labels].sort());
        }
    });

    it('fills two template pages with connected sections in spatial order for a branched building and long corridor', async () => {
        const entity = parseBuilding();
        const labels = ['0101', '0201', '0202', '0301', '0302', '0303', '0401', '0402', '0403', '0404',
            '0502', '0503', '0504', '0601', '0602', '0603', '0604', '0703', '0704', '0804', '0905', '1005',
            '1106', '1206', '1307', '1407', '1508', '1608', '1709', '1809', '1910', '2010'];
        const hexes = labels.map(label => {
            const q = Number(label.slice(0, 2)) - 1;
            return { q, r: Number(label.slice(2)) - 1 - Math.floor(q / 2) };
        });
        setConstructionBuildingTopology(entity, hexes, 1);
        for (const pageFormat of ['letter', 'a4'] as const) {
            const pages = (await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare', pageFormat })).filter(svg => svg.querySelector('#buildingTemplate'));
            expect(pages.length).toBe(2);
            const sections = pages.flatMap(svg => [...svg.querySelectorAll('.building-template-floor')].map(floor =>
                [...floor.querySelectorAll('.building-template-hex')].map(hex => hex.getAttribute('data-building-hex')!)));
            const starts = sections.map(section => [...section].sort()[0]);
            expect(starts).toEqual([...starts].sort());
            expect(sections.flat().sort()).toEqual([...labels].sort());
            for (const section of sections) {
                expect(buildingConnectedComponents(section.map(label => hexes[labels.indexOf(label)])).length).toBe(1);
            }
        }
    });

    it('appends clean, named templates with full-scale hexes on Letter and A4', async () => {
        const entity = parseBuilding();
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN], 2);
        entity.doors.set([
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 1, height: 2, linkGroup: 1 },
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 2, height: 2, linkGroup: 1 },
        ]);
        for (const pageFormat of ['letter', 'a4'] as const) {
            const pages = await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare', pageFormat });
            expect(pages.length).toBe(2);
            expect(pages[0].querySelector('#pageNumber')?.textContent).toBe('Page 1 / 1');
            const svg = pages[1];
            expect(svg.querySelector('#title')?.textContent).toBe(`${entity.displayName()} TEMPLATE`.toUpperCase());
            expect(svg.querySelectorAll('image, #pageNumber, .building-map-key').length).toBe(0);
            expect(svg.querySelectorAll('.linked-door-opening').length).toBe(4);
            document.body.appendChild(svg);
            try {
                const floors = [...svg.querySelectorAll<SVGGElement>('.building-template-floor')];
                expect(floors.length).toBe(2);
                for (const floor of floors) {
                    // Template hexes print at the tabletop map's 1.25-inch hex size.
                    const hex = floor.querySelector<SVGPolygonElement>('.building-template-hex')!;
                    const points = hex.points, matrix = hex.getCTM()!;
                    expect((points.getItem(1).y - points.getItem(5).y) * matrix.d).toBeCloseTo(90, 2);
                }
            } finally { svg.remove(); }
        }
    });

    it('splits oversized templates into whole hexes without losing levels or duplicating coordinates', async () => {
        const entity = parseBuilding();
        const hexes = Array.from({ length: 24 }, (_, i) => ({ q: i % 8 - 10, r: Math.floor(i / 8) - 10 }));
        setConstructionBuildingTopology(entity, hexes, 2);
        const pages = (await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare' })).filter(svg => svg.querySelector('#buildingTemplate'));
        expect(pages.length).toBeGreaterThan(1);
        const cells: string[] = [];
        for (const svg of pages) {
            document.body.appendChild(svg);
            try {
                for (const floor of svg.querySelectorAll<SVGGElement>('.building-template-floor')) {
                    expect(floor.textContent).toContain(' · ');
                    for (const hex of floor.querySelectorAll<SVGPolygonElement>('.building-template-hex')) {
                        cells.push(`${floor.getAttribute('data-building-floor')}/${hex.getAttribute('data-building-hex')}`);
                        expect(hex.getBBox().height).toBeCloseTo(90, 4);
                    }
                }
            } finally { svg.remove(); }
        }
        expect(cells.length).toBe(48);
        expect(new Set(cells).size).toBe(48);
    });

    it('prints retained invalid links even when coincident segments cannot provide a linked arrow', async () => {
        const entity = parseBuilding(), northeast = { q: 1, r: -1 };
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, northeast], 1);
        entity.doors.set([
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 0, height: 1, linkGroup: 1 },
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 1, height: 1, linkGroup: 1 },
            { position: { hex: northeast, floor: 0 }, facing: 4, height: 1, linkGroup: 1 },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const doors = [...svg.querySelectorAll('.building-construction-note')].filter(row => row.textContent?.includes(': Door '));
        expect(doors.length).toBe(1);
        expect(doors[0].textContent).toContain('Door N/NE/SW: 1 level high');
    });
    it('draws linked structural openings on every served floor', async () => {
        const entity = parseBuilding();
        const south = { q: 0, r: 1 };
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, south], 2);
        entity.doors.set([
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 1, height: 2, linkGroup: 1 },
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 2, height: 2, linkGroup: 1 },
            { position: { hex: south, floor: 0 }, facing: 1, height: 2, linkGroup: 1 },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.querySelectorAll('.linked-door-opening').length).toBe(6);
        const doors = [...svg.querySelectorAll('.building-construction-note')].filter(row => row.textContent?.includes(': Door '));
        expect(doors.length).toBe(1);
        expect(doors[0].textContent).toContain('0101-0102/G: Door E: 2 levels high');
        const key = svg.querySelector('.building-map-key')!;
        expect(key.textContent).toBe('Large Door');
        const largeDoor = key.querySelector('[data-building-symbol="large-door"]')!;
        expect(largeDoor.querySelectorAll('polygon').length).toBe(2);
        expect(largeDoor.querySelectorAll('line').length).toBe(1);
        for (const layer of svg.querySelectorAll('.building-map-layer')) {
            expect(layer.querySelectorAll('.linked-door-opening').length).toBe(3);
            expect(layer.querySelectorAll('[data-building-symbol="door"]').length).toBe(3);
        }
    });
    it('lists connected linked openings once with unique hexes, arrow direction and their own starting level', async () => {
        const entity = parseBuilding();
        const east = { q: 1, r: 0 };
        setConstructionBuildingTopology(entity, [{ q: 0, r: -2 }, { q: 0, r: -1 }, BUILDING_ORIGIN, east], 2);
        entity.doors.set([
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 4, height: 1, linkGroup: 7 },
            { position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 3, height: 1, linkGroup: 7 },
            { position: { hex: east, floor: 0 }, facing: 4, height: 1, linkGroup: 7 },
            { position: { hex: east, floor: 0 }, facing: 2, height: 2 },
            { position: { hex: BUILDING_ORIGIN, floor: 1 }, facing: 4, height: 1, linkGroup: 7 },
            { position: { hex: BUILDING_ORIGIN, floor: 1 }, facing: 3, height: 1, linkGroup: 7 },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const doors = [...svg.querySelectorAll('.building-construction-note')].filter(row => row.textContent?.includes(': Door '));
        expect(doors.map(row => row.textContent)).toEqual([
            '0103-0203/G: Door SW: 1 level high',
            '0203/G: Door SE: 2 levels high',
            '0103/1: Door SW: 1 level high',
        ]);
    });
    const armor = new ArmorEquipment({ id: 'Standard Armor', name: 'Standard', type: 'armor',
        armor: { type: 'STANDARD' }, tech: { base: 'All' } });
    const laser = new WeaponEquipment({ id: 'Large Laser', name: 'Large Laser', type: 'weapon', stats: { bv: 123 },
        weapon: { damage: 8, heat: 8, ranges: [5, 10, 15] } });
    const registry = new EquipmentRegistry({ [armor.id]: armor, [laser.id]: laser });

    function parseBuilding(construction = ''): StaticEmplacementEntity {
        return parseEntity(`
<UnitType>
BuildingEntity
</UnitType>
<Name>
Assault Air Defense Missile Emplacement
</Name>
<Model>
(3075)
</Model>
<year>
3075
</year>
<type>
IS Level 3
</type>
${construction.includes('<coords>') ? '' : '<coords>\n0,0,0\n</coords>'}
${construction}
<Level 0 0.0,0.0,0.0 Equipment>
Large Laser
Unresolved Searchlight
</Level 0 0.0,0.0,0.0 Equipment>
`, 'static.blk', registry).entity as StaticEmplacementEntity;
    }

    it('prints different generator sizes in separate inventory rows in both rulesets', async () => {
        const entity = parseBuilding();
        const generator = createEquipment({ id: 'External PowerGenerator', name: 'External Power Generator',
            type: 'misc', flags: ['F_POWER_GENERATOR', 'F_VARIABLE_SIZE'] });
        const large = addTestEquipment(entity, generator, { location: 'Level 0 0.0,0.0,0.0', size: 16 });
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
            const row = (id: string) => svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${id}"]`);
            expect(row(large.mountId)?.textContent?.replace(/\s+/g, ' ')).toContain('16 tons');
        }
        const small = addTestEquipment(entity, generator, { location: 'Level 0 0.0,0.0,0.0', size: 2.5 });
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
            const row = (id: string) => svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${id}"]`);
            expect(row(large.mountId)?.textContent).toContain('16 tons');
            expect(row(small.mountId)?.textContent).toContain('2.5 tons');
            expect(row(large.mountId)).not.toBe(row(small.mountId));
        }
    });

    it('routes buildings to their full-page owner', () => {
        const entity = parseBuilding();
        const layout = resolveRecordSheetLayout(entity);
        expect(layout instanceof StaticEmplacementRecordSheetLayout).toBeTrue();
        expect(layout.id).toBe('static-emplacement');
        expect(layout.profile(entity).compact).toBeFalse();
    });

    it('renders parsed building construction and real armor/CF with dynamic location contracts', async () => {
        const entity = parseBuilding(`
<armor>
150
</armor>
<cf>
150
</cf>
<building_class>
3
</building_class>
<building_type>
4
</building_type>
<height>
1
</height>
<coords>
0.0,0.0,0.0
</coords>`);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });

        expect(svg.dataset['mekbayLayout']).toBe('static-emplacement');
        expect(svg.dataset['mekbayDesignSource']).toBe('native');
        expect(svg.textContent).toContain('Hardened');
        expect(svg.textContent).toContain('Gun Emplacement');
        expect(svg.textContent).toContain('STRUCTURE RECORD SHEET');
        expect(svg.textContent).toContain('0101/G');
        expect(svg.getElementById('textArmor_Level 0 0.0,0.0,0.0')?.textContent).toBe('( 150 )');
        expect(svg.getElementById('textIS_Level 0 0.0,0.0,0.0')?.textContent).toBe('( 150 )');
        expect(svg.querySelectorAll('.pip.armor, .pip.structure').length).toBe(0);
        expect(svg.querySelector('.unitLocation.structure')?.getAttribute('data-loc')).toBe('Level 0 0.0,0.0,0.0');
        expect(svg.querySelector('[data-mekbay-paperdoll-view], .vehicle-paperdoll, .mek-paperdolls, image, #crewName0')).toBeNull();
    });

    it('labels the single hex 0101, leaving the remaining wireframe unlabeled and gray', async () => {
        const entity = parseBuilding();
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const layers = [...svg.querySelectorAll<SVGGElement>('.building-map-layer')];
        expect(layers.length).toBe(1);
        const layer = layers[0];
        expect(layer.querySelectorAll('.building-hex').length).toBe(63);
        const occupied = layer.querySelector('.occupied')!;
        expect(occupied.getAttribute('data-building-hex')).toBe('0101');
        expect(occupied.getAttribute('stroke')).toBe('#000');
        const empty = [...layer.querySelectorAll('.building-hex:not(.occupied)')];
        expect(empty.length).toBe(62);
        expect(empty.every(hex => hex.getAttribute('stroke') === '#bbb')).toBeTrue();
        expect([...layer.querySelectorAll('text')].map(text => text.textContent)).toEqual(['0101', 'Level: G']);
        expect(svg.querySelector('.inventoryEntry .location')?.textContent).toBe('0101/G');
    });

    it('groups equipment by internal ID and hex/level while retaining all mounts and ammunition totals', async () => {
        const entity = parseBuilding();
        const east = { q: 1, r: 0 };
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, east], 2);
        const ground = buildingLocationName(BUILDING_ORIGIN, 0);
        const original = entity.equipment()[0];
        const duplicate = addTestEquipment(entity, laser, { location: ground, facing: 2 });
        const upper = addTestEquipment(entity, laser, { location: buildingLocationName(BUILDING_ORIGIN, 1) });
        const neighbor = addTestEquipment(entity, laser, { location: buildingLocationName(east, 0) });
        const differentId = addTestEquipment(entity, new WeaponEquipment({ id: 'Other Large Laser', name: 'Large Laser',
            type: 'weapon', weapon: { damage: 8, heat: 8, ranges: [5, 10, 15] } }), { location: ground });
        const ammo = new AmmoEquipment({ id: 'LRM 5 Ammo', name: 'LRM 5 Ammo', type: 'ammo',
            ammo: { type: 'LRM', shots: 24, rackSize: 5 } });
        const bin = addTestEquipment(entity, ammo, { location: ground, shotsCount: 24 });
        const partialBin = addTestEquipment(entity, ammo, { location: ground, shotsCount: 18 });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const rows = [...svg.querySelectorAll('.inventoryEntry')];
        const rowFor = (id: string) => rows.find(row => row.getAttribute('data-mekbay-component-ids')?.split(' ').includes(id))!;
        const gunRow = rowFor(original.mountId);
        const hexLabel = svg.querySelector(`.occupied[data-loc="${ground}"]`)!.getAttribute('data-building-hex');
        const neighborLabel = svg.querySelector(`.occupied[data-loc="${neighbor.location}"]`)!.getAttribute('data-building-hex');
        expect(rows.length).toBe(6);
        expect(gunRow).toBe(rowFor(duplicate.mountId));
        expect(gunRow.querySelector('.qty')?.textContent).toBe('2');
        expect(gunRow.querySelector('.location')?.textContent).toBe(`${hexLabel}/G`);
        expect(gunRow.querySelector('.range_long')?.textContent).toBe('15');
        for (const separate of [upper, neighbor, differentId]) {
            expect(rowFor(separate.mountId)).not.toBe(gunRow);
            expect(rowFor(separate.mountId).querySelector('.qty')?.textContent).toBe('1');
        }
        expect(rowFor(upper.mountId).querySelector('.location')?.textContent).toBe(`${hexLabel}/1`);
        expect(rowFor(neighbor.mountId).querySelector('.location')?.textContent).toBe(`${neighborLabel}/G`);
        expect(rowFor(bin.mountId)).toBe(rowFor(partialBin.mountId));
        expect(rowFor(bin.mountId).querySelector('.qty')?.textContent).toBe('2');
        expect([...rowFor(bin.mountId).querySelectorAll('.name')].map(text => text.textContent).join(' ')).toContain('42 total rounds');
        expect(svg.querySelector('#ammoProfile')?.textContent).toContain('42');
        expect(rows.flatMap(row => row.getAttribute('data-mekbay-component-ids')!.split(' ')).sort())
            .toEqual(entity.equipment().map(mount => mount.mountId).sort());
    });

    it('keeps all six axial neighbors adjacent and shares hex/floor labels with inventory and protection', async () => {
        const entity = parseBuilding('<armor>\n150\n</armor>\n<cf>\n100\n</cf>');
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, ...BUILDING_DIRECTIONS], 3);
        const upper = buildingLocationName(BUILDING_DIRECTIONS[1], 2);
        const ground = buildingLocationName(BUILDING_DIRECTIONS[1], 0);
        entity.armorValues.update(values => new Map(values).set(ground, locationArmor(91)));
        const gun = addTestEquipment(entity, laser, { location: upper });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const labels = ['0202', '0201', '0302', '0303', '0203', '0103', '0102'];
        const hexes = [BUILDING_ORIGIN, ...BUILDING_DIRECTIONS];
        for (let floor = 0; floor < 3; floor++) {
            const layer = svg.querySelector(`[data-building-floor="${floor}"]`)!;
            expect(layer.querySelectorAll('.building-hex').length).toBe(63);
            expect(layer.querySelectorAll('.occupied').length).toBe(7);
            hexes.forEach((hex, index) => expect(layer.querySelector(`[data-loc="${buildingLocationName(hex, floor)}"]`)
                ?.getAttribute('data-building-hex')).toBe(labels[index]));
        }
        expect(svg.querySelector(`[data-mekbay-component-ids="${gun.mountId}"] .location`)?.textContent).toBe('0302/2');
        expect(svg.getElementById(`textArmor_${ground}`)?.textContent).toBe('( 91 )');
        expect(svg.getElementById(`textIS_${ground}`)?.textContent).toBe('( 100 )');
        expect(svg.getElementById(`textArmor_${upper}`)).toBeNull();
        expect(svg.querySelectorAll('[data-mekbay-protection-value]').length).toBe(14);
        expect(entity.coordinates()).toEqual(hexes);
        expect(gun.location).toBe(upper);
    });

    it('round trips and prints the TO:AR p. 128 atrium with the same six occupied hexes on all three floors', async () => {
        const entity = parseBuilding('<cf>\n40\n</cf>\n<building_class>\n0\n</building_class>\n<building_type>\n2\n</building_type>');
        setConstructionBuildingTopology(entity, BUILDING_DIRECTIONS, 3);
        const loaded = parseEntity(encodeNativeEntity(entity), 'atrium.blk', registry).entity as StaticEmplacementEntity;
        expect(loaded.coordinates().length).toBe(6);
        expect(loaded.locationOrder.length).toBe(18);
        expect(loaded.capacityPerHex()).toBe(120);
        expect(loaded.tonnage()).toBe(720);
        expect(loaded.equipment()).toEqual([]);
        const svg = await RecordSheetSvgGenerator.generate(loaded, { ruleset: 'total-warfare' });
        const layers = [...svg.querySelectorAll('.building-map-layer')];
        expect(layers.map(layer => layer.getAttribute('data-building-floor'))).toEqual(['2', '1', '0']);
        for (const layer of layers) {
            expect(layer.querySelectorAll('.building-hex').length).toBe(63);
            expect([...layer.querySelectorAll('.occupied')].map(hex => hex.getAttribute('data-building-hex')))
                .toEqual(['0102', '0103', '0201', '0203', '0302', '0303']);
            expect(layer.textContent).not.toContain('0202');
        }
    });

    it('renders all actual floors over continuation pages with at most six layers per page', async () => {
        const entity = parseBuilding();
        for (const floors of [2, 6, 8]) {
            setConstructionBuildingTopology(entity, [BUILDING_ORIGIN], floors);
            const pages = await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare' });
            const layers = pages.flatMap(svg => [...svg.querySelectorAll<SVGGElement>('.building-map-layer')]);
            expect(layers.map(layer => Number(layer.getAttribute('data-building-floor'))))
                .toEqual(Array.from({ length: floors }, (_, index) => floors - 1 - index));
            expect(pages.reduce((sum, svg) => sum + svg.querySelectorAll('.building-hex').length, 0)).toBe(63 * floors);
            expect(pages.reduce((sum, svg) => sum + svg.querySelectorAll('.occupied').length, 0)).toBe(floors);
            expect(pages.filter(page => !page.querySelector('#buildingTemplate')).length).toBe(Math.ceil(floors / 6));
            for (const page of pages) expect(page.querySelectorAll('.building-map-layer').length).toBeLessThanOrEqual(6);
            expect(layers.at(-1)!.textContent).toContain('Level: G');
        }
    });

    it('prints occupied wall sides and lists protection separately for each segment', async () => {
        const entity = parseBuilding();
        entity.buildingClass.set(6);
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN], 2);
        entity.wallSides.set(new Map([['0,0', 3]]));
        const loaded = parseEntity(encodeNativeEntity(entity), 'wall.blk', registry).entity as StaticEmplacementEntity;
        const svg = await RecordSheetSvgGenerator.generate(loaded, { ruleset: 'total-warfare' });
        expect(svg.querySelectorAll('[data-building-side]').length).toBe(4);
        expect(svg.textContent).toContain('0101/N');
        expect(svg.textContent).toContain('0101/NE');
        expect([...svg.querySelectorAll('.occupied')].every(hex => hex.getAttribute('stroke') === '#bbb')).toBeTrue();
    });

    it('prints bridge decks above ground without inventing floors underneath', async () => {
        const entity = parseBuilding();
        entity.buildingClass.set(8); entity.buildingType.set(6);
        const hexes = Array.from({ length: 3 }, (_, q) => ({ q, r: 0 }));
        setConstructionBuildingTopology(entity, hexes, 1);
        entity.bridgeDecks.set(new Map([['0,0', 1], ['1,0', 2], ['2,0', 3]]));
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const layers = [...svg.querySelectorAll('.building-map-layer')];
        expect(layers.map(layer => layer.getAttribute('data-building-floor'))).toEqual(['3', '2', '1']);
        expect(layers.map(layer => layer.querySelectorAll('.occupied').length)).toEqual([1, 1, 1]);
        expect(svg.textContent).not.toContain('Level: G');
        expect(svg.textContent).toContain('Rail / Bridge');
    });

    it('labels capital protection and preserves large Castles Brian maps and protection over pages', async () => {
        const entity = parseBuilding();
        entity.buildingClass.set(4); entity.buildingType.set(4); entity.constructionFactor.set(150);
        const hexes = Array.from({ length: 70 }, (_, index) => ({ q: index % 10, r: Math.floor(index / 10) }));
        setConstructionBuildingTopology(entity, hexes, 15);
        const pages = await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare' });
        expect(pages.filter(page => !page.querySelector('#buildingTemplate')).length).toBe(3);
        expect(pages[0].textContent).toContain('CF and armor: capital points');
        expect(pages.flatMap(page => [...page.querySelectorAll('.building-map-layer')]).length).toBe(15);
        expect(pages.reduce((count, page) => count + page.querySelectorAll('[data-mekbay-protection-value="structure"]').length, 0)).toBe(70);
        expect(pages.flatMap(page => [...page.querySelectorAll('.building-hex.occupied')]).length).toBe(1050);
    });

    it('numbers asymmetric footprints from the top left independently of input order and expands grids that would clip hexes', async () => {
        const entity = parseBuilding();
        const hexes = Array.from({ length: 13 }, (_, q) => ({ q, r: -Math.floor(q / 2) }));
        setConstructionBuildingTopology(entity, hexes, 2);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(svg.querySelectorAll('.building-hex').length).toBe(13 * 7 * 2);
        expect(svg.querySelectorAll('.occupied').length).toBe(26);
        const positions = [...svg.querySelectorAll('.occupied')].map(hex => hex.getAttribute('data-building-hex'));
        expect(positions.slice(0, 13)).toEqual(Array.from({ length: 13 }, (_, index) => `${String(index + 1).padStart(2, '0')}01`));
        entity.coordinates.set([...hexes].reverse());
        const reversed = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect([...reversed.querySelectorAll('.occupied')].map(hex => hex.getAttribute('data-building-hex'))).toEqual(positions);
        const ids = [...svg.querySelectorAll('[id]')].map(element => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('labels the same footprint from 0101 on every floor regardless of origin and input order', async () => {
        const footprint = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }];
        for (const origin of [BUILDING_ORIGIN, { q: 37, r: -51 }]) {
            const hexes = footprint.map(hex => ({ q: hex.q + origin.q, r: hex.r + origin.r }));
            for (const coordinates of [hexes, [...hexes].reverse()]) {
                const entity = parseBuilding(`<height>\n2\n</height>\n<coords>\n${coordinates.map(hex =>
                    `${hex.q}.0,${hex.r}.0,${-hex.q - hex.r}.0`).join('\n')}\n</coords>`);
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
                const layers = [...svg.querySelectorAll('.building-map-layer')];
                expect(layers.length).toBe(2);
                for (const layer of layers) {
                    expect(layer.querySelectorAll('.building-hex').length).toBe(63);
                    expect([...layer.querySelectorAll('.occupied')].map(hex => hex.getAttribute('data-building-hex')).sort())
                        .toEqual(['0101', '0201', '0302', '0303']);
                }
                expect(entity.coordinates()).toEqual(coordinates);
            }
        }
    });

    it('prints negative floors below Ground with equipment and elevator labels using the same reference', async () => {
        const entity = parseBuilding('<height>\n4\n</height>\n<building_options>\nbase_level=-2\n</building_options>');
        entity.elevators.set([{ hex: BUILDING_ORIGIN, capacity: 20, exits: new Map([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]) }]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const layers = [...svg.querySelectorAll('.building-map-layer')];
        expect(layers.map(layer => layer.getAttribute('data-building-floor'))).toEqual(['3', '2', '1', '0']);
        expect(layers.map(layer => [...layer.querySelectorAll('text')].find(text => text.textContent?.startsWith('Level:'))?.textContent))
            .toEqual(['Level: 1', 'Level: G', 'Level: -1', 'Level: -2']);
        expect(svg.querySelector('.inventoryEntry .location')?.textContent).toBe('0101/-2');
        expect(svg.querySelector('.occupied[data-loc="Level 0 0.0,0.0,0.0"]')).not.toBeNull();
        expect(svg.textContent).toContain('Roof (2)');
        entity.buildingOptions.update(options => ({ ...options, baseLevel: null, site: 'UNDERGROUND', depth: 1 }));
        const underground = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        expect(underground.querySelector('[data-building-floor="0"]')?.textContent).toContain('Level: -5');
        expect(underground.textContent).toContain('Roof (-1)');
        expect(underground.querySelector('.inventoryEntry .location')?.textContent).toBe('0101/-5');
    });

    it('repositions displaced footprints before adding denser rows or columns without rewriting coordinates', async () => {
        const tight = Array.from({ length: 14 }, (_, i) => ({ q: Math.floor(i / 7), r: i % 7 }));
        const wide = Array.from({ length: 13 }, (_, q) => ({ q, r: -Math.floor(q / 2) }));
        const tall = Array.from({ length: 12 }, (_, r) => ({ q: 0, r }));
        const both = [...wide.slice(0, 11), ...tall.slice(1, 9)];
        for (const [index, [footprint, cells]] of ([[tight, 9 * 7], [wide, 13 * 7], [tall, 9 * 12], [both, 11 * 9]] as const).entries()) {
            // Load authored coordinates far from 0,0; display placement must not rewrite those coordinates.
            const hexes = footprint.map(hex => ({ q: hex.q + 37, r: hex.r - 51 }));
            const entity = parseBuilding(`<height>\n2\n</height>\n<coords>\n${hexes.map(hex => `${hex.q}.0,${hex.r}.0,${-hex.q - hex.r}.0`).join('\n')}\n</coords>`);
            const location = buildingLocationName(hexes.at(-1)!, 0);
            const mount = addTestEquipment(entity, laser, { location });
            const native = encodeNativeEntity(entity);
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
            const layers = [...svg.querySelectorAll<SVGGElement>('.building-map-layer')];
            expect(layers.length).toBe(2);
            for (const layer of layers) {
                expect(layer.querySelectorAll('.building-hex').length).toBe(cells);
                expect(layer.querySelectorAll('.occupied').length).toBe(hexes.length);
            }
            if (index === 0) expect(svg.querySelector(`[data-mekbay-component-ids="${mount.mountId}"] .location`)?.textContent).toBe('0207/G');
            expect(entity.coordinates()).toEqual(hexes);
            expect(mount.location).toBe(location);
            expect(encodeNativeEntity(entity)).toBe(native);
        }
    });

    it('preserves building inventory and weapon ranges without inventing missing protection', async () => {
        const entity = parseBuilding();
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });

        expect(svg.getElementById('textArmor_Level 0 0.0,0.0,0.0')?.textContent).toBe('—');
        expect(svg.getElementById('textIS_Level 0 0.0,0.0,0.0')?.textContent).toBe('—');
        expect(svg.querySelectorAll('.pip.armor, .pip.structure, .unitLocation').length).toBe(0);
        const rows = [...svg.querySelectorAll('.inventoryEntry')];
        expect(rows.length).toBe(2);
        expect(rows[0].getAttribute('data-mekbay-component-ids')).toBe(entity.equipment()[0].mountId);
        expect(rows[0].querySelector('.range_long')?.textContent).toBe('15');
        expect(rows[0].querySelector('.lngButton')).not.toBeNull();
        expect(rows[1].textContent).toContain('Unresolved Searchlight');
        expect(svg.textContent).toContain('CREW DATA');
        expect(svg.querySelector('#pilotingSkill0, .vehicle-paperdoll')).toBeNull();
    });

    it('retains every mount and ammunition capacity in a grouped building inventory', async () => {
        const entity = parseBuilding();
        const ammo = new AmmoEquipment({ id: 'LRM 5 Ammo', name: 'LRM 5 Ammo', type: 'ammo',
            ammo: { type: 'LRM', shots: 24, rackSize: 5 } });
        for (let index = 0; index < 34; index++) {
            addTestEquipment(entity, ammo, { location: 'Level 0 0.0,0.0,0.0', shotsCount: 24 });
        }
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const rows = [...svg.querySelectorAll<SVGElement>('.inventoryEntry')];

        expect(rows.length).toBe(3);
        expect(rows[2].querySelector('.qty')?.textContent).toBe('34');
        expect(rows.every(row => row.getAttribute('display') !== 'none')).toBeTrue();
        expect(rows.flatMap(row => row.getAttribute('data-mekbay-component-ids')?.split(' ') ?? []))
            .toEqual(entity.equipment().map(mount => mount.mountId));
        expect(svg.querySelector('#ammoProfile')?.textContent).toContain('816');
        const ids = [...svg.querySelectorAll('[id]')].map(element => element.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('distinguishes an explicit zero construction value from an unspecified value', async () => {
        const entity = parseBuilding('<armor>\n0\n</armor>\n<cf>\n0\n</cf>');
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });

        expect(svg.getElementById('textArmor_Level 0 0.0,0.0,0.0')?.textContent).toBe('( 0 )');
        expect(svg.getElementById('textIS_Level 0 0.0,0.0,0.0')?.textContent).toBe('( 0 )');
        expect(svg.textContent).not.toContain('not specified');
        expect(svg.querySelectorAll('.pip.armor, .pip.structure, .unitLocation').length).toBe(0);
    });

    it('prints building-wide transport capacity without assigning it to an invented hex', async () => {
        const entity = parseBuilding();
        entity.transporters.set([
            { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10, doors: 1, bayNumber: 1, omni: false },
            { id: 'troops', kind: 'troop-space', totalSpace: 5, omni: false },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const rows = [...svg.querySelectorAll('.building-transport')];
        expect(rows.length).toBe(2);
        expect(rows[0].textContent).toContain('Cargo');
        expect(rows[0].textContent).toContain('(10)');
        expect(rows[1].textContent).toContain('Troop space (5 t)');
        expect(rows.every(row => row.textContent?.endsWith('—'))).toBeTrue();
        expect(svg.textContent).toContain('External');
    });

    it('keeps a dense inventory on one page before making continuation pages and retains every item without ruling', async () => {
        const entity = parseBuilding();
        const install = (start: number, count: number) => {
            for (let index = start; index < start + count; index++) addTestEquipment(entity,
                new WeaponEquipment({ id: `Laser ${index}`, name: `Laser ${index}`, type: 'weapon',
                    weapon: { damage: 5, heat: 3, ranges: [3, 6, 9] } }), { location: buildingLocationName(BUILDING_ORIGIN, 0) });
        };
        install(0, 30);
        const compact = await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare' });
        expect(compact.filter(page => !page.querySelector('#buildingTemplate')).length).toBe(1);
        install(30, 60);
        const pages = (await RecordSheetSvgGenerator.generatePages(entity, { ruleset: 'total-warfare' })).filter(page => !page.querySelector('#buildingTemplate'));
        expect(pages.length).toBeGreaterThan(1);
        const ids = pages.flatMap(page => [...page.querySelectorAll('.inventoryEntry')]
            .flatMap(row => row.getAttribute('data-mekbay-component-ids')!.split(' ')));
        expect(ids.sort()).toEqual(entity.equipment().map(mount => mount.mountId).sort());
        for (const page of pages) expect(page.querySelector('[data-ammo-inventory] line')).toBeNull();
    });

    it('prints the feature key and map symbols for doors, elevators, bays and roof turrets', async () => {
        const entity = parseBuilding();
        const east = { q: 1, r: 0 };
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, east], 6);
        entity.doors.set([{ position: { hex: east, floor: 0 }, facing: 2, height: 2 }]);
        entity.elevators.set([{ hex: BUILDING_ORIGIN, capacity: 20, exits: new Map(Array.from({ length: 7 }, (_, level) => [level, 4])) }]);
        entity.transporters.set([{ id: 'bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10, doors: 1, bayNumber: 0, omni: false }]);
        entity.baySpace.set(new Map([['bay', [{ position: { hex: east, floor: 5 }, tons: 10 }]]]));
        addTestEquipment(entity, laser, { location: buildingLocationName(east, 5), turretType: 'sponson' });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const key = svg.querySelector<SVGGElement>('.building-map-key')!;
        expect(key.textContent).toContain('Elevator');
        expect(key.textContent).toContain('Bay / quarters');
        expect(key.textContent).toContain('Roof turret');
        expect(key.textContent).toContain('Door');
        expect(svg.querySelectorAll('.building-map-layer [data-building-symbol="door"]').length).toBe(2);
        expect(svg.querySelectorAll('.building-map-layer [data-building-symbol="turret"]').length).toBe(1);
        const symbol = svg.querySelector<SVGTSpanElement>('.building-map-layer [data-building-symbol="elevator"]')!;
        expect(symbol.parentElement!.textContent).toMatch(/^E\d{4}$/);
        const keyDoor = key.querySelector<SVGPolygonElement>('[data-building-symbol="door"]')!;
        expect(keyDoor.points.numberOfItems).toBe(3);
        expect(svg.textContent).toContain('Movement Type:Static');
    });

    it('prints elevator doors on their configured levels and sides without leaking roof access onto interior floors', async () => {
        const entity = parseBuilding();
        setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, ...BUILDING_DIRECTIONS], 3);
        entity.elevators.set([{ hex: BUILDING_ORIGIN, capacity: 20,
            exits: new Map([[0, 5], [2, 32], [3, 8]]) }]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        for (const [floor, sides] of [[0, [0, 2]], [1, []], [2, [5]]] as const) {
            const layer = svg.querySelector(`[data-building-floor="${floor}"]`)!;
            const markers = [...layer.querySelectorAll<SVGPolygonElement>('[data-building-symbol="elevator-door"]')];
            expect(markers.map(marker => Number(marker.getAttribute('data-building-facing')))).toEqual([...sides]);
            for (const marker of markers) {
                expect(marker.points.numberOfItems).toBe(3);
                expect(marker.getAttribute('fill')).toBe('#efcb8d');
            }
        }
        const key = svg.querySelector('.building-map-key')!;
        expect(key.textContent).toContain('Elevator door');
        expect(key.querySelector<SVGPolygonElement>('[data-building-symbol="elevator-door"]')!.points.numberOfItems).toBe(3);
    });

    it('uses actual Letter and A4 page dimensions for the same native design', async () => {
        const entity = parseBuilding();
        const letter = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'letter' });
        const a4 = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'a4' });

        expect(letter.getAttribute('viewBox')).toBe('0 0 612 792');
        expect(a4.getAttribute('viewBox')).toBe('0 0 595.276 841.89');
        expect(letter.querySelectorAll('.inventoryEntry').length).toBe(a4.querySelectorAll('.inventoryEntry').length);
        expect(a4.querySelector('[data-mekbay-compact]')).toBeNull();
    });
});
