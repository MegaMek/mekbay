// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestBipedMekEntity,
    TestConvFighterEntity,
    TestDropShipEntity,
    TestFixedWingSupportEntity,
    TestHandheldWeaponEntity,
    TestInfantryEntity,
    TestJumpShipEntity,
    TestLamEntity,
    TestLargeSupportTankEntity,
    TestProtoMekEntity,
    TestQuadMekEntity,
    TestQuadVeeEntity,
    TestSmallCraftEntity,
    TestSpaceStationEntity,
    TestSupportNavalEntity,
    TestSupportTankEntity,
    TestSupportVtolEntity,
    TestTankEntity,
    TestTripodMekEntity,
    TestVtolEntity,
    TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { AmmoEquipment, WeaponEquipment, createEquipment } from '../../models/equipment.model';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('RecordSheetSvgGenerator', () => {
    it('generates a compact vehicle sheet directly from an Entity', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Vedette');
        entity.model.set('Medium Tank');

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.getAttribute('viewBox')).toBe('0 0 576 375');
        expect(svg.dataset['mekbayGenerated']).toBe('1');
        expect(svg.dataset['mekbayCompact']).toBe('vehicle');
        expect(svg.querySelector('[data-mekbay-field="display-name"]')?.textContent)
            .toBe('Vedette Medium Tank');
        expect(svg.querySelector('.compact-vehicle-unit-chrome #btLogoColor')).not.toBeNull();
        expect(svg.querySelector('.compact-vehicle-title')?.textContent)
            .toMatch(/ VEHICLE RECORD SHEET$/u);
        expect(svg.querySelector('.compact-vehicle-catalyst #cglLogoBW')).not.toBeNull();
        expect(new XMLSerializer().serializeToString(svg).length).toBeLessThan(100_000);
    });

    it('publishes generated vehicle weapon rows through the non-Mek interaction contract', async () => {
        const entity = new TestTankEntity();
        const weapon = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test Medium Laser',
            name: 'Medium Laser',
            type: 'weapon',
            weapon: { damage: 5, heat: 3, ranges: [3, 6, 9] },
        }), { location: 'FR' });

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const row = svg.querySelector<SVGGElement>(
            `.inventoryEntry[data-mekbay-component-ids="${weapon.mountId}"]`,
        );

        expect(row).not.toBeNull();
        expect(row?.querySelector(':scope > .inventoryEntryButton.mainButton')).not.toBeNull();
        expect(row?.querySelector(':scope > .inventoryEntryButton.shrButton')).not.toBeNull();
        expect(row?.querySelector(':scope > .inventoryEntryButton.medButton')).not.toBeNull();
        expect(row?.querySelector(':scope > .inventoryEntryButton.lngButton')).not.toBeNull();
    });

    it('keeps superheavy dual-turret data, misc equipment, and footer text in the vehicle owner', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Gulltoppr OmniMonitor');
        entity.model.set('(Prime)');
        entity.setTonnage(190);
        entity.motiveType.set('Tracked');
        entity.omni.set(true);
        entity.hasTurret.set(true);
        entity.hasDualTurret.set(true);
        const ecm = addTestEquipment(entity, createEquipment({
            id: 'ISGuardianECMSuite',
            name: 'ECM Suite (Guardian)',
            type: 'misc',
            flags: ['F_ECM'],
        }), { location: 'Body' });
        addTestEquipmentWithFlags(entity, 'F_CASE', { location: 'Body' });
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test AMS Ammo',
            name: 'AMS Ammo',
            type: 'ammo',
            ammo: { type: 'AMS', rackSize: 2, shots: 24 },
        }), { location: 'Body', shotsCount: 24 });
        entity.quirks.set([
            { quirk: { key: 'oversized', name: 'Oversized', description: '', type: 'negative' } },
            {
                quirk: {
                    key: 'difficult_maintain', name: 'Difficult to Maintain',
                    description: '', type: 'negative',
                },
            },
            {
                quirk: {
                    key: 'non_standard', name: 'Non-Standard Parts',
                    description: '', type: 'negative',
                },
            },
            {
                quirk: {
                    key: 'battle_computer', name: 'Battle Computer',
                    description: '', type: 'positive',
                },
            },
            {
                quirk: {
                    key: 'poor_performance', name: 'Poor Performance',
                    description: '', type: 'negative',
                },
            },
        ]);

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const ecmRow = svg.querySelector<SVGGElement>(
            `.inventoryEntry[data-mekbay-component-ids="${ecm.mountId}"]`,
        );

        expect(svg.querySelector('.compact-vehicle-title')?.textContent)
            .toBe('SUPER-HEAVY TRACKED OMNIVEHICLE RECORD SHEET');
        expect(svg.querySelector('.vehicle-paperdoll-layer')?.getAttribute('data-source'))
            .toBe('/images/paperdolls/vehicle-superheavy-dualturret.svg');
        expect(svg.querySelector('#textArmor_FT')).not.toBeNull();
        expect(svg.querySelector('#textArmor_RT')).not.toBeNull();
        expect(ecmRow?.querySelector('.name')?.textContent).toBe('ECM Suite (Guardian)');
        expect(ecmRow?.querySelector('.range_long')?.textContent).toBe('6');
        expect(ecmRow?.querySelector('.mainButton')).not.toBeNull();
        expect(svg.querySelector('#ammoProfile')?.textContent).toContain('Ammo (CASE): (AMS) 24');
        expect(Array.from(svg.querySelectorAll<SVGTextElement>('.unitQuirks text'))
            .map(node => node.textContent)).toEqual([
                'Quirks: Battle Computer, Difficult to Maintain, Non-Standard Parts, Poor',
                'Performance, Oversized',
            ]);
    });

    it('omits turret-only critical controls for a turretless combat vehicle', async () => {
        const entity = new TestTankEntity();
        entity.hasTurret.set(false);
        entity.hasDualTurret.set(false);

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.querySelector('#turret_locked')).toBeNull();
        expect(svg.querySelector('#stabilizer_hit_turret')).toBeNull();
        expect(svg.querySelector('#engine_hit_1')?.getAttribute('x')).toBe('45.96');
    });

    it('keeps paperdoll label policy and geometry in the owning vehicle layouts', async () => {
        const ground = new TestTankEntity();
        const vtol = new TestVtolEntity();
        const wige = new TestTankEntity();
        wige.motiveType.set('WiGE');

        const [groundSvg, vtolSvg, wigeSvg, navalSvg] = await Promise.all([
            RecordSheetSvgGenerator.generate(ground, { format: 'compact' }),
            RecordSheetSvgGenerator.generate(vtol, { format: 'compact' }),
            RecordSheetSvgGenerator.generate(wige, { format: 'compact' }),
            RecordSheetSvgGenerator.generate(new TestSupportNavalEntity(), { format: 'compact' }),
        ]);

        expect(groundSvg.querySelector('.ground-vehicle-diagram-labels > text')?.getAttribute('transform'))
            .toBe('matrix(1.126742 0 0 1.129 90.697086 25.067548)');
        expect(vtolSvg.querySelector('.vtol-diagram-labels > text')?.getAttribute('transform'))
            .toBe('matrix(1.063 0 0 1.063 96.571424 41.321677)');
        expect(wigeSvg.querySelector('.wige-diagram-labels > text')?.getAttribute('transform'))
            .toBe('matrix(1.036 0 0 1.036 93.221352 40.178744)');
        expect(navalSvg.querySelector('.naval-diagram-labels')).not.toBeNull();
    });

    it('owns the submarine template variant and prints torpedo water ranges', async () => {
        const entity = new TestSupportNavalEntity();
        entity.motiveType.set('Submarine');
        const torpedo = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test LRT 20', name: 'LRT 20', type: 'weapon',
            weapon: {
                damage: 'cluster', heat: 6, rackSize: 20, ammoType: 'LRM_TORPEDO',
                minRange: 6, ranges: [0, 0, 0, 0], wRanges: [7, 14, 21, 28],
            },
        }), { location: 'Front' });

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const row = svg.querySelector<SVGGElement>(
            `.inventoryEntry[data-mekbay-component-ids="${torpedo.mountId}"]`,
        );

        expect(svg.dataset['mekbayLayout']).toBe('naval');
        expect(svg.textContent).toContain('DEPTH TRACK');
        expect(svg.querySelectorAll('.submarine-depth-turn').length).toBe(20);
        expect(svg.querySelector('.naval-paperdoll-root')?.getAttribute('transform'))
            .toBe('matrix(0.95 0 0 0.95 9 35)');
        expect(svg.querySelector('.compact-vehicle-catalyst')?.getAttribute('transform'))
            .toContain('610.907');
        expect(row?.querySelector('.range_min')?.textContent).toBe('6');
        expect(row?.querySelector('.range_short')?.textContent).toBe('7');
        expect(row?.querySelector('.range_medium')?.textContent).toBe('14');
        expect(row?.querySelector('.range_long')?.textContent).toBe('21');
    });

    it('projects DropShip weapon bays in the large-aero family instead of fighter mount rows', async () => {
        const entity = new TestDropShipEntity();
        entity.motiveType.set('Aerodyne');
        const mediumLaser = new WeaponEquipment({
            id: 'Test Medium Laser', name: 'Medium Laser', shortName: 'Medium Laser', type: 'weapon',
            weapon: { heat: 3, av: [5, 0, 0, 0] },
        });
        const largeLaser = new WeaponEquipment({
            id: 'Test Large Laser', name: 'Large Laser', shortName: 'Large Laser', type: 'weapon',
            weapon: { heat: 8, av: [8, 8, 0, 0] },
        });
        const lrm = new WeaponEquipment({
            id: 'Test LRM 20', name: 'LRM 20', shortName: 'LRM 20', type: 'weapon',
            weapon: { heat: 6, ammoType: 'LRM', rackSize: 20, av: [12, 12, 12, 0] },
        });
        const lrmAmmo = new AmmoEquipment({
            id: 'Test LRM 20 Ammo', name: 'LRM 20 Ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 20, shots: 12 },
        });
        const left = [
            addTestEquipment(entity, largeLaser, { location: 'Left Side' }),
            addTestEquipment(entity, largeLaser, { location: 'Left Side' }),
            addTestEquipment(entity, mediumLaser, { location: 'Left Side' }),
        ];
        const right = [
            addTestEquipment(entity, largeLaser, { location: 'Right Side' }),
            addTestEquipment(entity, largeLaser, { location: 'Right Side' }),
            addTestEquipment(entity, mediumLaser, { location: 'Right Side' }),
        ];
        const noseLrm = addTestEquipment(entity, lrm, { location: 'Nose' });
        const noseAmmo = addTestEquipment(entity, lrmAmmo, { location: 'Nose', shotsCount: 12 });
        entity.addEquipmentBay('weapon-bay', { mounts: [noseLrm, noseAmmo] });
        entity.addEquipmentBay('weapon-bay', { mounts: left });
        entity.addEquipmentBay('weapon-bay', { mounts: right });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const bays = [...svg.querySelectorAll<SVGGElement>('.inventoryEntry.bay')];
        const lrmRow = bays.find(row => row.querySelector('.name')?.textContent?.includes('LRM 20'))!;
        const laserRow = bays.find(row => row.querySelector('.name')?.textContent?.includes('Medium Laser'))!;

        expect(svg.dataset['mekbayLayout']).toBe('large-aero');
        expect(bays.length).toBe(2);
        expect(lrmRow.querySelector('.name')?.textContent).toBe('1 LRM 20 (12 rounds)');
        expect(lrmRow.querySelector('.range_short')?.textContent).toBe('1 (12)');
        expect(laserRow.querySelector('.location')?.textContent).toBe('LW/RW');
        expect(Array.from(laserRow.querySelectorAll('.name')).map(node => node.textContent))
            .toEqual(['1 Medium Laser,', '2 Large Laser']);
        expect(laserRow.querySelector('.heat')?.textContent).toBe('19');
        expect(laserRow.querySelector('.range_short')?.textContent).toBe('3 (21)');
        expect(laserRow.querySelector('.range_medium')?.textContent).toBe('2 (16)');
        expect(laserRow.getAttribute('data-mekbay-component-ids')?.split(' ').length).toBe(6);
        const children = [...laserRow.children];
        expect(children.indexOf(laserRow.querySelector(':scope > .mainButton')!))
            .toBeLessThan(children.indexOf(laserRow.querySelector('.name')!));
        expect(laserRow.querySelector('.hitMod-rect')).not.toBeNull();
        expect(laserRow.querySelector('.targetTn-rect')).not.toBeNull();
    });

    it('owns conventional-fighter movement and return tables instead of drawing an Aero heat panel', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestConvFighterEntity());

        expect(svg.dataset['mekbayLayout']).toBe('aero-fighter');
        expect(svg.textContent).toContain('GROUND MAP STRAIGHT MOVEMENT');
        expect(svg.textContent).toContain('FIGHTER RETURN TABLE');
        expect(svg.querySelector('#heatDataPanel')).toBeNull();
        expect(svg.querySelector('.aero-movement-compass')).toBeNull();
    });

    it('projects Small Craft mounts, ammo, and automatic ECM in the large-aero owner', async () => {
        const automaticEcm = createEquipment({
            id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
        });
        const entity = new TestSmallCraftEntity(createTestEquipmentRegistry({
            [automaticEcm.id]: automaticEcm,
        }));
        const laser = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test Small Craft Large Laser', name: 'Large Laser', shortName: 'Large Laser',
            type: 'weapon', flags: ['F_ENERGY', 'F_DIRECT_FIRE'],
            weapon: { heat: 8, av: [8, 8, 0, 0] },
        }), { location: 'Nose' });
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test Small Craft LRM Ammo', name: 'LRM 15 Ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 15, shots: 40 },
        }), { location: 'Nose', shotsCount: 40 });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const laserRow = svg.querySelector<SVGGElement>(
            `.inventoryEntry[data-mekbay-component-ids="${laser.mountId}"]`,
        );

        expect(svg.dataset['mekbayLayout']).toBe('large-aero');
        expect(laserRow?.classList.contains('bay')).toBeFalse();
        expect(laserRow?.querySelector('.quantity')?.textContent).toBe('1');
        expect(laserRow?.querySelector('.name')?.textContent).toContain('Large Laser');
        expect(Array.from(svg.querySelectorAll('.inventoryEntry .name')).map(node => node.textContent))
            .toContain('Single-Hex ECM [E]');
        expect(svg.textContent).toContain('Ammo: (LRM 15) 40');
    });

    it('uses standard-scale multiline bays and Artemis values for unarmed-capital-scale vessels', async () => {
        const entity = new TestSpaceStationEntity();
        const lrm = new WeaponEquipment({
            id: 'Test Station LRM 15', name: 'LRM 15', shortName: 'LRM 15', type: 'weapon',
            flags: ['F_LRM', 'F_MISSILE', 'F_ARTEMIS_COMPATIBLE'],
            weapon: { heat: 5, ammoType: 'LRM', rackSize: 15, av: [9, 9, 9, 0] },
        });
        const first = addTestEquipment(entity, lrm, { location: 'Nose' });
        const second = addTestEquipment(entity, lrm, { location: 'Nose' });
        const ammo = addTestEquipment(entity, new AmmoEquipment({
            id: 'Test Station LRM 15 Ammo', name: 'LRM 15 Artemis', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 15, shots: 40 },
        }), { location: 'Nose', shotsCount: 40 });
        const firstArtemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'Nose' });
        const secondArtemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'Nose' });
        entity.linkEquipment(firstArtemis, first);
        entity.linkEquipment(secondArtemis, second);
        entity.addEquipmentBay('weapon-bay', {
            mounts: [first, second, ammo, firstArtemis, secondArtemis],
        });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const row = svg.querySelector<SVGGElement>('.inventoryEntry.bay')!;

        expect(svg.querySelector('[data-mekbay-region="aero-data"]')?.getAttribute('data-mekbay-aero-scale'))
            .toBe('standard');
        expect(row.querySelector('.name')?.textContent).toBe('2 LRM 15 (40 rounds)*');
        expect(row.querySelector('.range_short')?.textContent).toBe('2 (24)');
        expect(svg.textContent).toContain('* w/Artemis IV');
        expect(svg.textContent).toContain('STATION DATA');
        expect(Array.from(svg.querySelectorAll('.svg-frame-title'))
            .filter(node => node.textContent === 'NOTES').length).toBe(2);
    });

    it('uses standard-scale weapon values on JumpShips without capital weapons', async () => {
        const entity = new TestJumpShipEntity();
        const laser = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test JumpShip Large Laser', name: 'Large Laser', shortName: 'Large Laser',
            type: 'weapon', flags: ['F_ENERGY'], weapon: { heat: 8, av: [8, 8, 0, 0] },
        }), { location: 'Front Left Side' });
        entity.addEquipmentBay('weapon-bay', { mounts: [laser] });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const row = svg.querySelector<SVGGElement>('.inventoryEntry.bay')!;
        const stationKeeping = Array.from(svg.querySelectorAll<SVGTextElement>('text'))
            .find(node => node.textContent === 'Station Keeping Only');

        expect(row.querySelector('.name')?.textContent).toBe('1 Large Laser');
        expect(row.querySelector('.range_short')?.textContent).toBe('1 (8)');
        expect(stationKeeping?.getAttribute('x')).toBe('9.844');
        expect(stationKeeping?.getAttribute('y')).toBe('56');
        expect(svg.textContent).not.toContain('Standard Scale on Reverse');
    });

    it('generates runtime binding anchors without a downloaded sheet', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestQuadMekEntity());

        expect(svg.getAttribute('viewBox')).toBe('0 0 612 792');
        expect(svg.querySelectorAll('.critSlot[loc][slot]').length).toBe(66);
        expect(svg.querySelectorAll('.critSlot[hittable="1"] > .critSlot-bg-rect').length).toBe(66);
        expect(svg.querySelectorAll('.critSlot > .extraHitPip[display="none"]').length).toBe(66);
        expect(svg.querySelector('[data-mekbay-empty-slot="1"] text')?.textContent).toBe('Roll Again');
        expect(svg.querySelectorAll('.inventoryEntry').length).toBeGreaterThan(0);
        expect(svg.querySelectorAll('.inventoryEntry[display="none"]').length).toBe(0);
        expect(svg.querySelectorAll('.crewHit').length).toBe(6);
        expect(svg.querySelectorAll('#heatScale .heat').length).toBe(31);
        expect(svg.querySelector('image')).toBeNull();
        expect(svg.querySelectorAll('#btLogoColor > path').length).toBe(4);
        expect(svg.querySelectorAll('#btLogoColor > polygon').length).toBe(8);
        expect(svg.querySelectorAll('#cglLogoBW path').length).toBe(27);
        expect(svg.querySelector('#cglLogoBW')?.getAttribute('transform'))
            .toBe('translate(140.363 674.365) scale(1.08)');
        expect(svg.querySelector('#cglLogoBW > .record-sheet-catalyst-logo')?.getAttribute('transform'))
            .toBe('matrix(1 0 0 -1 -162.795 110.035)');
        expect(svg.querySelectorAll('.svg-frame-title').length).toBeGreaterThan(5);
        expect(svg.querySelectorAll('*').length).toBeLessThan(1_600);
        expect(new XMLSerializer().serializeToString(svg).length).toBeLessThan(200_000);
        const generatedIds = Array.from(svg.querySelectorAll<SVGElement>('[id]'), element => element.id);
        expect(new Set(generatedIds).size).toBe(generatedIds.length);

        const inventory = svg.querySelector<SVGGElement>('.inventoryEntry:not([display="none"])')!;
        const children = [...inventory.children];
        const mainButton = inventory.querySelector('.inventoryEntryButton.mainButton')!;
        const hitModRect = inventory.querySelector('.hitMod-rect')!;
        const hitModText = inventory.querySelector('.hitMod-text')!;
        const name = inventory.querySelector('.name')!;
        const quantity = inventory.querySelector<SVGTextElement>('.quantity')!;
        const shortButton = inventory.querySelector('.inventoryEntryButton.shrButton')!;
        const shortText = inventory.querySelector('.range_short')!;
        expect(children.indexOf(mainButton)).toBeLessThan(children.indexOf(name));
        expect(children.indexOf(shortButton)).toBeLessThan(children.indexOf(shortText));
        expect(children.indexOf(hitModRect)).toBeLessThan(children.indexOf(name));
        expect(children.indexOf(hitModRect)).toBeLessThan(children.indexOf(hitModText));
        expect(Number(quantity.getAttribute('x'))).toBeLessThan(Number(hitModRect.getAttribute('x')));
        expect(Number(hitModRect.getAttribute('x')) + Number(hitModRect.getAttribute('width')))
            .toBeLessThan(Number(name.getAttribute('x')));
        expect(Number(svg.querySelector('.critSlot-bg-rect')?.getAttribute('width'))).toBeGreaterThan(50);
    });

    it('matches the MegaMekLab Mek location, cluster, and physical reference grids', async () => {
        const entity = new TestBipedMekEntity();
        addTestEquipment(entity, new WeaponEquipment({
            id: 'Test LRM 20',
            name: 'LRM 20',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 20 },
        }), { location: 'LT' });
        addTestEquipment(entity, new WeaponEquipment({
            id: 'Test SRM 6',
            name: 'SRM 6',
            type: 'weapon',
            weapon: { ammoType: 'SRM', rackSize: 6 },
        }), { location: 'LT' });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const hitTable = svg.querySelector<SVGGElement>('[data-mekbay-reference="mek-hit-location-cluster"]')!;
        const punchKick = svg.querySelector<SVGGElement>('[data-mekbay-reference="mek-punch-kick"]')!;

        expect(Array.from(hitTable.querySelectorAll('.reference-table-heading')).map(node => node.textContent))
            .toEqual(['Die Roll', '(2D6)', 'LS', 'F/R', 'RS', '6', '20']);
        expect(hitTable.querySelector('[data-cluster-rack="6"][data-cluster-roll="2"]')?.textContent)
            .toBe('2');
        expect(hitTable.querySelector('[data-cluster-rack="20"][data-cluster-roll="2"]')?.textContent)
            .toBe('6');
        expect(hitTable.querySelectorAll('.tableshading').length).toBe(6);
        expect(hitTable.querySelector('.reference-table-note')?.textContent)
            .toBe('*A result of 2 may inflict a critical hit.');
        expect(Array.from(punchKick.querySelectorAll(
            '.reference-table-row[data-mekbay-reference-roll="1"] .reference-table-cell',
        )).map(node => node.textContent)).toEqual(['1', 'LT', 'LA', 'RT', 'LL', 'RL', 'RL']);
        expect(punchKick.querySelectorAll('.tableshading').length).toBe(3);
        expect(Array.from(hitTable.children)
            .filter(child => child.tagName.toLowerCase() === 'path')
            .every(path => path.getAttribute('stroke-width') === '1.6')).toBeTrue();

        const leftArmHeading = svg.querySelector<SVGTextElement>(
            '.critGroup[loc="LA"] > .critical-location-heading',
        )!;
        const leftArmFirstSlot = svg.querySelector<SVGGElement>('.critSlot[loc="LA"][slot="0"]')!;
        expect(leftArmHeading.getAttribute('x')).toBe('31.05');
        expect(leftArmHeading.getAttribute('y')).toBe('34');
        expect(leftArmHeading.getAttribute('font-size')).toBe('8.75');
        expect(leftArmFirstSlot.getAttribute('transform')).toBe('translate(34.34 35)');
        expect(leftArmFirstSlot.querySelector('text')?.getAttribute('font-size')).toBe('7');
        expect(svg.querySelectorAll('.critical-roll-range').length).toBe(10);
        expect(svg.querySelectorAll('.mek-system-damage .systemHitPip').length).toBe(8);
        expect(svg.textContent).not.toContain('SYSTEM DAMAGE');
    });

    it('keeps Tripod crew geometry and transfer art in the Mek family owner', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestTripodMekEntity());
        const crew = svg.querySelector<SVGGElement>('.mek-multi-crew-data')!;
        const reference = svg.querySelector<SVGGElement>(
            '[data-mekbay-reference="mek-hit-location-cluster"]',
        )!;
        const transfer = svg.querySelector<SVGGElement>('.damage-transfer-tripod')!;

        expect(svg.dataset['mekbayLayout']).toBe('mek');
        expect(crew.getAttribute('transform')).toBe('translate(3 18) scale(1 1)');
        expect(crew.querySelector('#crewName0')?.textContent).toBe('Pilot:');
        expect(crew.querySelector('#pilotName0')?.getAttribute('x')).toBe('20.051');
        expect(crew.querySelector('#crewName1')?.textContent).toBe('Gunner:');
        expect(crew.querySelector('#crewName2')?.textContent).toBe('Tech Officer:');
        expect(reference.getAttribute('transform')).toBe('translate(249.366 282.857)');
        expect(transfer.getAttribute('data-source'))
            .toBe('/images/paperdolls/tripod-damage-transfer.svg');
        expect(transfer.getAttribute('transform')).toBe('translate(203.075 257.025)');
    });

    it('keeps LAM-only movement, system, transfer, compass, and heat geometry in the Mek family owner', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestLamEntity());
        const masthead = svg.querySelector<SVGTextElement>('.record-sheet-masthead > text');
        const systemDamage = svg.querySelector<SVGGElement>('.lam-system-damage');
        const transfer = svg.querySelector<SVGGElement>('.damage-transfer-diagram');
        const movementHeat = svg.querySelector<SVGGElement>('.heatEffect[heat="25"]');

        expect(masthead?.textContent).toBe("LAND-AIR 'MECH RECORD SHEET");
        expect(svg.querySelector('.mek-paperdolls')?.getAttribute('data-mekbay-pip-layout'))
            .toBe('distributed');
        expect(svg.querySelector('.lam-advanced-movement-compass')).not.toBeNull();
        expect(svg.querySelector('#mpAirMekWalk')).not.toBeNull();
        expect(svg.querySelector('#mpSafeThrust')).not.toBeNull();
        expect(systemDamage?.getAttribute('transform')).toBe('translate(132.929 206.025)');
        expect(systemDamage?.querySelector('#avionics_hit_3')).not.toBeNull();
        expect(systemDamage?.querySelector('#landing_gear_hit_1')).not.toBeNull();
        expect(transfer?.getAttribute('transform')).toBe('translate(188.552 305.425)');
        expect(movementHeat?.getAttribute('h-move')).toBe('-5');
        expect(movementHeat?.textContent).toContain('/Rand. Movement 10+');
        expect(svg.querySelector('#heatDataPanel')?.textContent).toContain('(AirMech +3)');
    });

    it('keeps QuadVee movement and paperdoll variants in the Mek family owner', async () => {
        const entity = new TestQuadVeeEntity();
        entity.omni.set(true);
        entity.motiveType.set('Wheel');

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const masthead = svg.querySelector<SVGTextElement>('.record-sheet-masthead > text');

        expect(masthead?.textContent).toBe('OMNIQUADVEE RECORD SHEET');
        expect(svg.querySelector('#mekDataPanel')?.textContent).toContain('Vehicle');
        expect(svg.querySelector('#mpCruise')).not.toBeNull();
        expect(svg.querySelector('#mpFlank')).not.toBeNull();
        expect(svg.querySelector('.mek-paperdolls')?.getAttribute('data-mekbay-pip-layout'))
            .toBe('distributed');
        expect(svg.querySelector('.mek-paperdolls-schematic [loc="FLL"]')).not.toBeNull();
        expect(svg.querySelector('#textArmor_FLL')).not.toBeNull();
    });

    it('generates a self-contained page for every supported Entity family', async () => {
        const entities = [
            new TestAeroSpaceFighterEntity(),
            new TestBattleArmorEntity(),
            new TestBipedMekEntity(),
            new TestConvFighterEntity(),
            new TestDropShipEntity(),
            new TestFixedWingSupportEntity(),
            new TestHandheldWeaponEntity(),
            new TestInfantryEntity(),
            new TestJumpShipEntity(),
            new TestLamEntity(),
            new TestLargeSupportTankEntity(),
            new TestProtoMekEntity(),
            new TestQuadMekEntity(),
            new TestQuadVeeEntity(),
            new TestSmallCraftEntity(),
            new TestSpaceStationEntity(),
            new TestSupportNavalEntity(),
            new TestSupportTankEntity(),
            new TestSupportVtolEntity(),
            new TestTankEntity(),
            new TestTripodMekEntity(),
            new TestVtolEntity(),
            new TestWarShipEntity(),
        ];

        for (const entity of entities) {
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const context = `${entity.entityType} (${entity.constructor.name})`;
            expect(svg.dataset['mekbayGenerated']).withContext(context).toBe('1');
            expect(svg.getAttribute('viewBox')).withContext(context).toBe('0 0 612 792');
            expect(Array.from(svg.querySelectorAll('image')).every(image => {
                const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '';
                return href.startsWith('data:');
            })).withContext(context).toBeTrue();
            expect(svg.querySelector('script')).withContext(context).toBeNull();
            expect(Array.from(svg.querySelectorAll('use')).some(use => {
                const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
                return href.length > 0 && !href.startsWith('#');
            })).withContext(context).toBeFalse();
            expect(svg.querySelectorAll('.svg-frame-title').length).withContext(context).toBeGreaterThan(0);
        }
    });

    it('uses canonical Biped pips only for non-superheavy Biped Meks', async () => {
        const standard = new TestBipedMekEntity();
        standard.setTonnage(55);
        const superheavy = new TestBipedMekEntity();
        superheavy.setTonnage(125);
        const quad = new TestQuadMekEntity();

        const standardSvg = await RecordSheetSvgGenerator.generate(standard);
        const superheavySvg = await RecordSheetSvgGenerator.generate(superheavy);
        const quadSvg = await RecordSheetSvgGenerator.generate(quad);

        expect(standardSvg.querySelector('.mek-paperdolls')?.getAttribute('data-mekbay-pip-layout'))
            .toBe('canon');
        expect(superheavySvg.querySelector('.mek-paperdolls')?.getAttribute('data-mekbay-pip-layout'))
            .toBe('distributed');
        expect(quadSvg.querySelector('.mek-paperdolls')?.getAttribute('data-mekbay-pip-layout'))
            .toBe('distributed');
        expect(quadSvg.querySelector('.mek-paperdolls-schematic [loc="FLL"]')).not.toBeNull();
        expect(quadSvg.querySelectorAll('.mek-paperdolls .svg-frame-title').length).toBe(2);
    });

    it('generates real A4 geometry and passes resized boxes to the frame utility', async () => {
        const entity = new TestQuadMekEntity();
        const letter = await RecordSheetSvgGenerator.generate(entity);
        const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4' });

        expect(a4.getAttribute('viewBox')).toBe('0 0 595.276 841.89');
        expect(a4.dataset['mekbayPageFormat']).toBe('a4');
        const letterCrewFrame = frameContainingTitle(letter, 'WARRIOR DATA');
        const a4CrewFrame = frameContainingTitle(a4, 'WARRIOR DATA');
        expect(a4CrewFrame?.getAttribute('transform')).not.toBe(letterCrewFrame?.getAttribute('transform'));
        expect(a4CrewFrame?.querySelector('path')?.getAttribute('d'))
            .not.toBe(letterCrewFrame?.querySelector('path')?.getAttribute('d'));
    });

    it('generates each non-vehicle compact family at its measured height', async () => {
        const cases = [
            { entity: new TestBattleArmorEntity(), kind: 'battle-armor', height: '136.2' },
            { entity: new TestInfantryEntity(), kind: 'infantry', height: '174' },
            { entity: new TestProtoMekEntity(), kind: 'protomek', height: '139.2' },
        ] as const;

        for (const item of cases) {
            const svg = await RecordSheetSvgGenerator.generate(item.entity, { format: 'compact' });
            expect(svg.getAttribute('viewBox')).toBe(`0 0 576 ${item.height}`);
            expect(svg.dataset['mekbayCompact']).toBe(item.kind);
            expect(new XMLSerializer().serializeToString(svg).length).toBeLessThan(100_000);
        }
    });

    it('keeps ProtoMek subtype identity and the single-unit cluster supplement in its owner', async () => {
        const entity = new TestProtoMekEntity();
        entity.chassis.set('Procyon');
        entity.model.set('(Quad)');
        entity.isQuad.set(true);
        addTestEquipment(entity, new WeaponEquipment({
            id: 'Test Proto SRM 6',
            name: 'SRM 6',
            type: 'weapon',
            weapon: { damage: 'cluster', ammoType: 'SRM', rackSize: 6, ranges: [3, 6, 9] },
        }), { location: 'Main Gun' });

        const page = await RecordSheetSvgGenerator.generate(entity);
        const compact = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(compact.querySelector('[data-mekbay-field="display-name"]')?.textContent)
            .toBe('Procyon (Quad)');
        expect(page.dataset['mekbayReferenceFamily']).toBe('protomek');
        expect(page.querySelector('[data-mekbay-reference="cluster-hits"]')).not.toBeNull();
        expect(page.querySelector('[data-cluster-rack="6"][data-cluster-roll="2"]')?.textContent)
            .toBe('2');
    });

    it('uses the Battle Armor inventory geometry and excludes AP-mount weapons', async () => {
        const entity = new TestBattleArmorEntity();
        const primary = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test BA SRM',
            name: 'SRM 2 (Body)',
            type: 'weapon',
            flags: ['F_MISSILE'],
            weapon: { ammoType: 'SRM', rackSize: 2, damage: 2, ranges: [3, 6, 9] },
        }), { location: 'Body' });
        const antiPersonnel = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test BA APM Rifle',
            name: 'Auto-Rifle',
            type: 'weapon',
            weapon: { damage: 1, ranges: [1, 2, 3] },
        }), { location: 'LA', isAPM: true });

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const primaryRow = svg.querySelector<SVGGElement>(
            `.inventoryEntry[data-mekbay-component-ids="${primary.mountId}"]`,
        );

        expect(primaryRow).not.toBeNull();
        expect(primaryRow?.querySelector('.name')?.getAttribute('font-size')).toBe('6.76');
        expect(svg.querySelector(
            `.inventoryEntry[data-mekbay-component-ids="${antiPersonnel.mountId}"]`,
        )).toBeNull();
        expect(svg.textContent).toContain("Anti-'Mech Skill:");
    });

    it('uses exact large-aero heat typography and shows double-sink dissipation', async () => {
        const entity = new TestWarShipEntity();
        entity.heatSinkCount.set(20);
        entity.heatSinkType.set('Double');

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const heat = svg.querySelector<SVGGElement>('#heatDataPanel')!;
        const labels = Array.from(heat.querySelectorAll<SVGTextElement>('text'));
        const text = (value: string): SVGTextElement | undefined => labels.find(node => node.textContent === value);

        expect(text('Heat Sinks:')?.getAttribute('font-size')).toBe('7.2');
        expect(text('20')?.getAttribute('font-size')).toBe('11.59');
        expect(text('(40)')?.getAttribute('font-size')).toBe('11.59');
        expect(text('Nose:')?.getAttribute('font-size')).toBe('6.76');
        expect(svg.querySelector('.large-aero-diagram-header text:last-of-type')?.getAttribute('font-size'))
            .toBe('6.2');
    });

    it('lets each compact family own its masthead wording and identifying art', async () => {
        const battleArmor = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity());
        const infantry = await RecordSheetSvgGenerator.generate(new TestInfantryEntity());
        const protoMek = await RecordSheetSvgGenerator.generate(new TestProtoMekEntity());

        expect(mastheadLines(battleArmor)).toEqual(['BATTLE ARMOR', 'RECORD SHEET']);
        expect(battleArmor.querySelector('.battle-armor-masthead-icon')).not.toBeNull();
        expect(mastheadLines(infantry)).toEqual(['CONVENTIONAL', 'INFANTRY RECORD', 'SHEET']);
        expect(infantry.querySelector('.record-sheet-unit-title-frame [class$="masthead-icon"]'))
            .toBeNull();
        expect(mastheadLines(protoMek)).toEqual(['PROTOMECH', 'RECORD SHEET']);
        expect(protoMek.querySelector('.protomek-masthead-icon')).not.toBeNull();
    });

    it('composes compact sheets by their measured heights', async () => {
        const vehicle = await RecordSheetSvgGenerator.generate(new TestTankEntity(), { format: 'compact' });
        const battleArmor = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), { format: 'compact' });
        const page = RecordSheetSvgGenerator.composeCompactPage([vehicle, battleArmor]);

        expect(page.getAttribute('viewBox')).toBe('0 0 612 792');
        expect(page.dataset['mekbayUnitCount']).toBe('2');
        expect(page.querySelectorAll('.compact-sheet-block').length).toBe(2);
        expect(page.querySelectorAll('.compact-sheet-block')[1].getAttribute('transform'))
            .toContain('452.357');
    });

    it('owns the legal footer at the vehicle page level instead of repeating it per unit', async () => {
        const vehicles = await Promise.all(Array.from({ length: 2 }, () =>
            RecordSheetSvgGenerator.generate(new TestTankEntity(), { format: 'compact' })));

        expect(vehicles.every(vehicle => !vehicle.textContent?.includes('The Topps Company'))).toBeTrue();
        const page = RecordSheetSvgGenerator.composeCompactPage(vehicles);
        const legalLines = [...page.querySelectorAll('text')]
            .filter(text => text.textContent?.includes('The Topps Company'));

        expect(page.querySelectorAll('.compact-sheet-block').length).toBe(2);
        expect(page.querySelectorAll('.compact-vehicle-unit-chrome').length).toBe(2);
        expect(page.querySelectorAll('[id$="-btLogoColor"]').length).toBe(2);
        expect(page.querySelectorAll('[id$="-cglLogoBW"]').length).toBe(2);
        expect(page.querySelector('.record-sheet-masthead')).toBeNull();
        expect(legalLines.length).toBe(1);
    });

    it('uses vehicle reference tables when a compact vehicle is alone on its page', async () => {
        const vehicle = await RecordSheetSvgGenerator.generate(new TestTankEntity(), { format: 'compact' });
        const page = RecordSheetSvgGenerator.composeCompactPage([vehicle]);

        expect(page.querySelector('.compact-vehicle-unit-chrome')).not.toBeNull();
        expect(page.querySelector('#bv')).not.toBeNull();
        expect(page.querySelector('#unit1-bv')).toBeNull();
        expect(page.textContent).toContain('GROUND COMBAT VEHICLE HIT LOCATION TABLE');
        expect(page.textContent).toContain('MOTIVE SYSTEM DAMAGE TABLE');
    });

    it('uses canonical compact strides and emits one shared family reference layer', async () => {
        const battleArmor = await Promise.all(Array.from({ length: 5 }, () =>
            RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), { format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(battleArmor);
        const transforms = Array.from(page.querySelectorAll<SVGGElement>('.compact-sheet-block'))
            .map(block => block.getAttribute('transform'));

        expect(page.dataset['mekbayReferenceFamily']).toBe('battle-armor');
        expect(transforms[0]).toContain('74.357');
        expect(transforms[1]).toContain('211.486');
        expect(transforms[4]).toContain('622.873');
        expect(Array.from(page.querySelectorAll<SVGTextElement>('.svg-frame-title'))
            .filter(title => title.textContent === 'LEG ATTACKS TABLE').length).toBe(1);
        expect(Array.from(page.querySelectorAll<SVGTextElement>('.svg-frame-title'))
            .filter(title => title.textContent === 'CLUSTER HITS TABLE').length).toBe(1);
        expect(page.querySelector('[data-cluster-rack="5"][data-cluster-roll="2"]')?.textContent)
            .toBe('1');
        const artId = 'mekbay-battle-armor-default-art';
        expect(page.querySelectorAll(`symbol#${artId}`).length).toBe(1);
        expect(page.querySelectorAll(`symbol#${artId} > image[href^="data:"]`).length).toBe(1);
        expect(page.querySelectorAll(`use[href="#${artId}"]`).length).toBeGreaterThan(5);
        const ids = Array.from(page.querySelectorAll<SVGElement>('[id]'), element => element.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(page.querySelector('#unit1-bv')).not.toBeNull();
        expect(page.querySelector('#unit5-bv')).not.toBeNull();
    });

    it('composes compact blocks on an A4 canvas', async () => {
        const blocks = await Promise.all(Array.from({ length: 5 }, () =>
            RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), {
                format: 'compact',
                pageFormat: 'a4',
            })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks, 'a4');

        expect(page.getAttribute('viewBox')).toBe('0 0 595.276 841.89');
        expect(page.dataset['mekbayPageFormat']).toBe('a4');
        expect(page.querySelectorAll('.compact-sheet-block').length).toBe(5);
    });
});

function frameContainingTitle(svg: SVGSVGElement, title: string): SVGGElement | null {
    const titleNode = Array.from(svg.querySelectorAll<SVGTextElement>('.svg-frame-title'))
        .find(node => node.textContent === title);
    return titleNode?.parentElement?.parentElement as SVGGElement | null;
}

function mastheadLines(svg: SVGSVGElement): readonly string[] {
    return Array.from(svg.querySelectorAll<SVGTextElement>('.record-sheet-unit-title-frame > text'))
        .map(node => node.textContent ?? '');
}
