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
import { MountedArmor } from '../../models/entity/components/armor';
import { MountedStructure } from '../../models/entity/components/structure';
import {
    AmmoEquipment,
    ArmorEquipment,
    StructureEquipment,
    WeaponEquipment,
    createEquipment,
} from '../../models/equipment.model';
import { UNIT_CONDITION_DEFINITIONS } from '../../models/unit-status-presentation';
import { PageViewerPresentationService } from '../../components/page-viewer/internal/page-viewer-presentation.service';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('RecordSheetSvgGenerator', () => {
    it('generates independently movable front, rear and structure views for every Mek chassis', async () => {
        for (const entity of [new TestBipedMekEntity(), new TestQuadMekEntity(),
            new TestTripodMekEntity(), new TestQuadVeeEntity(), new TestLamEntity()]) {
            entity.setTonnage(55);
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const views = Array.from(svg.querySelectorAll<SVGGElement>('[data-mekbay-paperdoll-view]'));
            expect(views.map(view => view.getAttribute('data-mekbay-paperdoll-view')))
                .withContext(entity.chassisConfig).toEqual(['front', 'rear', 'structure']);
            expect(views[0].parentElement).withContext(entity.chassisConfig).toBe(views[1].parentElement);
            expect(views[1].parentElement).withContext(entity.chassisConfig).toBe(views[2].parentElement);
            const otherTransforms = views.slice(1).map(view => view.getAttribute('transform'));
            views[0].setAttribute('transform', 'translate(100 200)');
            expect(views.slice(1).map(view => view.getAttribute('transform'))).toEqual(otherTransforms);
            expect(views[0].querySelector('.pip[data-rear]')).withContext(entity.chassisConfig).toBeNull();
            expect(views[1].getAttribute('data-source')).toContain('-armor-back.svg');
            expect(views[2].querySelectorAll('.pip.armor').length).toBe(0);
        }
    });

    it('generates a compact vehicle sheet directly from an Entity', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Vedette');
        entity.model.set('Medium Tank');

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.dataset['mekbayGenerated']).toBe('1');
        expect(svg.dataset['mekbayCompact']).toBe('vehicle');
        expect(svg.hasAttribute('aria-label')).toBeFalse();
        expect(svg.querySelector(':scope > title')).toBeNull();
        expect(svg.querySelector('[data-mekbay-field="display-name"]')?.textContent)
            .toBe('Vedette Medium Tank');
        expect(svg.querySelector('.compact-vehicle-unit-chrome #btLogoColor')).not.toBeNull();
        expect(svg.querySelector('.compact-vehicle-title')?.textContent)
            .toMatch(/ VEHICLE RECORD SHEET$/u);
        expect(svg.querySelector('.compact-vehicle-catalyst #cglLogoBW')).not.toBeNull();
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
        entity.setArmorValue('Front Turret', 'front', 7);
        entity.setArmorValue('Rear Turret', 'front', 11);
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
        expect(svg.querySelectorAll('.pip.armor[data-loc="FT"]')).toHaveSize(7);
        expect(svg.querySelectorAll('.pip.armor[data-loc="RT"]')).toHaveSize(11);
        expect(svg.querySelector('.unitLocation.armor[data-loc="FT"]')).not.toBeNull();
        expect(svg.querySelector('.unitLocation.armor[data-loc="RT"]')).not.toBeNull();
        expect(svg.querySelector('.unitLocation.structure[data-loc="RT"]')).not.toBeNull();
        expect(svg.querySelector('.vehicle-paperdoll-layer [data-loc="TU"]')).toBeNull();
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
        expect(svg.querySelector('#engine_hit_1')).not.toBeNull();
    });

    it('prints the chin-turret lock beside the VTOL flight and sensor controls', async () => {
        const entity = new TestVtolEntity();
        entity.hasTurret.set(true);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const turret = svg.querySelector<SVGRectElement>('#turret_locked');
        expect(turret).not.toBeNull();
        expect(turret?.closest('[display="none"]')).toBeNull();
        expect(turret?.getAttribute('y')).toBe('32.796');
        expect(svg.querySelector('#sensor_hit_1')?.getAttribute('y')).toBe('42.66');
        expect(svg.querySelectorAll('#turret_locked').length).toBe(1);
    });

    it('renders Centaur armor and internal structure from the same projected ProtoMek locations', async () => {
        const entity = new TestProtoMekEntity();
        entity.setTonnage(5);
        entity.hasMainGun.set(true);
        for (const [location, value] of Object.entries({
            Head: 3, Torso: 7, 'Right Arm': 2, 'Left Arm': 2, Legs: 4, 'Main Gun': 3,
        })) entity.setArmorValue(location, 'front', value);

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.querySelectorAll('.protomek-paperdoll .pip.armor').length).toBe(21);
        expect(svg.querySelectorAll('.protomek-paperdoll .pip.structure').length).toBe(12);
        for (const location of entity.damageLocations()) {
            expect(svg.querySelectorAll(`.pip.structure[data-loc="${location.sheetCode}"]`).length)
                .withContext(location.code).toBe(location.internalPoints);
        }
        expect(svg.querySelector('[data-protomek-main-gun]')).not.toBeNull();
    });

    it('renders a quad ProtoMek without unused main-gun artwork', async () => {
        const entity = new TestProtoMekEntity();
        entity.setTonnage(6);
        entity.motiveType.set('Quad');
        entity.hasMainGun.set(false);
        for (const [location, value] of Object.entries({ Head: 4, Torso: 12, Legs: 14 })) {
            entity.setArmorValue(location, 'front', value);
        }
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.querySelectorAll('.protomek-paperdoll .pip.armor').length).toBe(30);
        expect(svg.querySelectorAll('.protomek-paperdoll .pip.structure').length).toBe(16);
        expect(svg.querySelector('[data-protomek-main-gun]')).toBeNull();
        expect(svg.querySelector('.pip[data-loc="MG"]')).toBeNull();
    });

    it('renders an ultraheavy glider ProtoMek with structure and its wing damage reference', async () => {
        const entity = new TestProtoMekEntity();
        entity.setTonnage(14);
        entity.isGlider.set(true);
        entity.hasMainGun.set(false);
        for (const [location, value] of Object.entries({
            Head: 9, Torso: 14, 'Right Arm': 4, 'Left Arm': 4, Legs: 8,
        })) entity.setArmorValue(location, 'front', value);
        for (let index = 0; index < 3; index++) {
            addTestEquipment(entity, new WeaponEquipment({
                id: `Test Chemical Laser ${index}`, name: 'Medium Chemical Laser', type: 'weapon',
                flags: ['F_PROTO_WEAPON'], weapon: { damage: 5 },
            }), { location: 'Torso' });
        }

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.querySelectorAll('.protomek-paperdoll .pip.armor').length).toBe(39);
        expect(svg.querySelectorAll('.protomek-paperdoll .pip.structure').length).toBe(34);
        expect(svg.querySelector('[data-protomek-main-gun]')).toBeNull();
        expect(svg.querySelector('#wings_hit_label')?.textContent).toBe('Wings');
        expect(svg.querySelector('#wings_hit_text')?.textContent).toBe('-1 Cruise MP (Each Hit)');
        expect(svg.textContent).toContain('1/2 Cruise MP');
        expect(svg.textContent).not.toContain('1/2 Jump MP');
        const torsoNote = svg.querySelector<SVGTextElement>('#torsoWeapon_2')!;
        expect(torsoNote.textContent).toContain('Medium Chemical Laser');
        expect(Number(torsoNote.getAttribute('x')) + Number(torsoNote.getAttribute('textLength')))
            .toBeLessThanOrEqual(173.834);
    });

    it('keeps paperdoll label ownership in each vehicle layout', async () => {
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

        expect(groundSvg.querySelector('.ground-vehicle-diagram-labels > text')).not.toBeNull();
        expect(vtolSvg.querySelector('.vtol-diagram-labels > text')).not.toBeNull();
        expect(wigeSvg.querySelector('.wige-diagram-labels > text')).not.toBeNull();
        expect(navalSvg.querySelector('.naval-diagram-labels')).not.toBeNull();
    });

    it('uses the six-side hull and counters for superheavy WiGE and naval vessels', async () => {
        const wige = new TestLargeSupportTankEntity();
        wige.motiveType.set('WiGE');
        wige.setTonnage(240);
        const naval = new TestSupportNavalEntity();
        naval.setTonnage(400);
        naval.hasTurret.set(true);
        naval.hasDualTurret.set(true);
        for (const entity of [wige, naval]) {
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            for (const code of ['FRLS', 'RRLS', 'FRRS', 'RRRS']) {
                expect(svg.querySelector(`#textArmor_${code}`)).withContext(`${entity.entityType} ${code}`).not.toBeNull();
            }
            expect(svg.querySelector('.vehicle-paperdoll-layer')?.getAttribute('data-source')).toContain('-superheavy-');
        }
        const navalSvg = await RecordSheetSvgGenerator.generate(naval, { format: 'compact' });
        expect(navalSvg.querySelector('#textArmor_FT')).not.toBeNull();
        expect(navalSvg.querySelector('#textArmor_RT')).not.toBeNull();
    });

    it('keeps every large support rail vehicle hull facing despite its motive weight classification', async () => {
        const entity = new TestLargeSupportTankEntity();
        entity.motiveType.set('Rail');
        entity.setTonnage(150);
        entity.hasTurret.set(false);
        entity.hasDualTurret.set(false);
        expect(entity.isSuperHeavy()).toBeFalse();
        entity.damageLocations().forEach(location => entity.setArmorValue(location.code, 'front', 8));

        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        expect(svg.querySelector('.vehicle-paperdoll-layer')?.getAttribute('data-source'))
            .toBe('/images/paperdolls/vehicle-superheavy-noturret.svg');
        for (const code of ['FRLS', 'RRLS', 'FRRS', 'RRRS']) {
            expect(svg.querySelector(`#textArmor_${code}`)).withContext(code).not.toBeNull();
            expect(svg.querySelector(`.pip.armor[data-loc="${code}"]`)).withContext(code).not.toBeNull();
        }
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
        expect(svg.querySelector('.naval-paperdoll-root')).not.toBeNull();
        expect(svg.querySelector('.compact-vehicle-catalyst')).not.toBeNull();
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

        expect(svg.dataset['mekbayLayout']).toBe('dropship');
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
        const movementTable = svg.querySelector<SVGGElement>('.ground-map-straight-movement-table')!;
        const heading = movementTable.querySelector<SVGTextElement>('.svg-frame-title')!;
        expect(Number(heading.getAttribute('textLength'))).toBeLessThan(Number(movementTable.dataset['mekbayFrameWidth']));
        expect(svg.querySelector('#heatDataPanel')).toBeNull();
        expect(svg.querySelector('.aero-movement-compass')).toBeNull();
    });

    it('prints zero armor and BAR damage thresholds on fixed-wing support paperdolls', async () => {
        const entity = new TestFixedWingSupportEntity();
        entity.barRating.set(2);
        for (const location of entity.locationOrder) entity.setArmorValue(location, 'front', 0);
        const unarmored = await RecordSheetSvgGenerator.generate(entity);
        expect(unarmored.querySelector('#textArmor_NOS')?.textContent).toBe('1 ( 0 )');

        entity.barRating.set(10);
        entity.setArmorValue('Left Wing', 'front', 11);
        const standardArmor = await RecordSheetSvgGenerator.generate(entity);
        expect(standardArmor.querySelector('#textArmor_NOS')?.textContent).toBe('0 ( 0 )');
        expect(standardArmor.querySelector('#textArmor_LWG')?.textContent).toBe('2 ( 11 )');
    });

    it('projects Small Craft mounts, ammo, and automatic ECM in the small-craft owner', async () => {
        const automaticEcm = createEquipment({
            id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
        });
        const entity = new TestSmallCraftEntity(createTestEquipmentRegistry({
            [automaticEcm.id]: automaticEcm,
        }));
        const laser = addTestEquipment(entity, new WeaponEquipment({
            id: 'Test Small Craft Large Laser', name: 'Large Laser', shortName: 'Large Laser',
            type: 'weapon', flags: ['F_ENERGY', 'F_DIRECT_FIRE'],
            weapon: { damage: 8, heat: 8, ranges: [5, 10, 15, 20], av: [8, 8, 0, 0] },
        }), { location: 'Nose' });
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test Small Craft LRM Ammo', name: 'LRM 15 Ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 15, shots: 40 },
        }), { location: 'Nose', shotsCount: 40 });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const laserRow = svg.querySelector<SVGGElement>(
            `.inventoryEntry[data-mekbay-component-ids="${laser.mountId}"]`,
        );

        expect(svg.dataset['mekbayLayout']).toBe('small-craft');
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

    it('merges equal opposite capital bays while keeping asymmetric arcs and all mount controls', async () => {
        const entity = new TestWarShipEntity();
        const weapon = new WeaponEquipment({
            id: 'Symmetric NAC', name: 'NAC', shortName: 'NAC', type: 'weapon',
            weapon: { capital: true, heat: 10, av: [2, 2, 1, 0] },
        });
        const addBay = (location: string, count: number) => {
            const mounts = Array.from({ length: count }, () => addTestEquipment(entity, weapon, { location }));
            entity.addEquipmentBay('weapon-bay', { mounts });
            return mounts;
        };
        const left = addBay('FLS', 2);
        const right = addBay('FRS', 2);
        addBay('ALS', 1);
        addBay('ARS', 2);

        const pages = await RecordSheetSvgGenerator.generatePages(entity);
        const rows = [...pages[0].querySelectorAll<SVGGElement>('.inventoryEntry.bay')];
        expect(pages.length).toBe(1);
        expect(rows.map(row => row.querySelector('.location')?.textContent)).toEqual(['FLS/FRS', 'ALS', 'ARS']);
        expect(rows[0].querySelector('.heat')?.textContent).toBe('20');
        expect(rows[0].querySelector('.range_short')?.textContent).toBe('4');
        expect(rows[0].getAttribute('data-mekbay-component-ids')?.split(' '))
            .toEqual([...left, ...right].map(mount => mount.mountId));
    });

    it('keeps opposite bays separate when equally printed rounds contain different munitions', async () => {
        const entity = new TestWarShipEntity();
        const weapon = new WeaponEquipment({
            id: 'Bay LRM 20', name: 'LRM 20', shortName: 'LRM 20', type: 'weapon',
            weapon: { heat: 6, ammoType: 'LRM', rackSize: 20, av: [12, 12, 12, 0] },
        });
        for (const [location, ammunition] of [['ALS', 'Standard'], ['ARS', 'Artemis']] as const) {
            const mountedWeapon = addTestEquipment(entity, weapon, { location });
            const ammo = addTestEquipment(entity, new AmmoEquipment({
                id: `Bay LRM 20 ${ammunition}`, name: `LRM 20 ${ammunition}`, type: 'ammo',
                ammo: { type: 'LRM', rackSize: 20, shots: 24 },
            }), { location, shotsCount: 24 });
            entity.addEquipmentBay('weapon-bay', { mounts: [mountedWeapon, ammo] });
        }
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const rows = [...svg.querySelectorAll<SVGGElement>('.inventoryEntry.bay')];
        expect(rows.map(row => row.querySelector('.name')?.textContent))
            .toEqual(['1 LRM 20 (24 rounds)', '1 LRM 20 (24 rounds)']);
        expect(rows.map(row => row.querySelector('.location')?.textContent)).toEqual(['ALS', 'ARS']);
    });

    it('sorts Small Craft by ground range and maps spheroid front and rear side arcs', async () => {
        const entity = new TestSmallCraftEntity();
        entity.motiveType.set('Spheroid');
        const medium = new WeaponEquipment({
            id: 'Small Craft ER Medium', name: 'ER Medium Laser', shortName: 'ER Medium Laser', type: 'weapon',
            weapon: { heat: 5, ranges: [5, 10, 15, 20], av: [5, 0, 0, 0] },
        });
        const large = new WeaponEquipment({
            id: 'Small Craft Large Pulse', name: 'Large Pulse Laser', shortName: 'Large Pulse Laser', type: 'weapon',
            weapon: { heat: 10, ranges: [3, 7, 10, 14], av: [9, 9, 0, 0] },
        });
        const mounts = [
            addTestEquipment(entity, large, { location: 'Nose' }),
            addTestEquipment(entity, medium, { location: 'Left Side' }),
            addTestEquipment(entity, medium, { location: 'Right Side', rearMounted: true }),
        ];
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const rows = [...svg.querySelectorAll<SVGGElement>('.inventoryEntry[data-mekbay-component-ids]')];
        expect(rows.map(row => row.getAttribute('data-mekbay-component-ids')))
            .toEqual([mounts[1], mounts[2], mounts[0]].map(mount => mount.mountId));
        expect(rows.map(row => row.querySelector('.location')?.textContent)).toEqual(['FLS', 'ARS', 'NOS']);
        expect(svg.querySelector('.large-aero-diagram-header polygon')).toBeNull();
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
        expect(row.querySelector('.name')?.textContent).toBe('1 Large Laser');
        expect(row.querySelector('.range_short')?.textContent).toBe('1 (8)');
        expect(svg.textContent).not.toContain('Standard Scale on Reverse');
    });

    it('splits crowded capital and standard weapon inventories into front and reverse pages', async () => {
        const entity = new TestWarShipEntity();
        for (let index = 0; index < 20; index++) {
            const capital = addTestEquipment(entity, new WeaponEquipment({
                id: `Test NAC ${index}`,
                name: `NAC ${index}`,
                shortName: `NAC ${index}`,
                type: 'weapon',
                weapon: { capital: true, heat: 10, av: [2, 2, 1, 0] },
            }), { location: 'Nose' });
            const standard = addTestEquipment(entity, new WeaponEquipment({
                id: `Test Laser ${index}`,
                name: `Laser ${index}`,
                shortName: `Laser ${index}`,
                type: 'weapon',
                weapon: { heat: 5, av: [8, 8, 0, 0] },
            }), { location: 'Nose' });
            entity.addEquipmentBay('weapon-bay', { mounts: [capital] });
            entity.addEquipmentBay('weapon-bay', { mounts: [standard] });
        }

        const pages = await RecordSheetSvgGenerator.generatePages(entity);

        expect(pages.length).toBe(2);
        expect(pages.map(page => page.dataset['mekbayPageRole'])).toEqual(['primary', 'supplemental']);
        expect(pages[0].textContent).toContain('Standard Scale on Reverse');
        expect(pages[0].textContent).toContain('NAC 0');
        expect(pages[0].textContent).not.toContain('Laser 0');
        expect(pages[1].textContent).toContain('Standard Scale');
        expect(pages[1].textContent).toContain('Laser 0');
        expect(pages[1].textContent).toContain('ADVANCED MOVEMENT');
        expect(pages[1].textContent).toContain('VELOCITY RECORD');
        expect(pages[1].textContent).toContain('note down that number on the record');
        const compass = pages[1].querySelector('[data-mekbay-region="advanced-movement-compass"]')!;
        expect(Array.from(compass.firstElementChild!.children)
            .filter(child => child.tagName.toLowerCase() === 'path').length).toBe(2);
        const vectorDiagram = pages[1].querySelector('#aero_vector_diagram');
        expect(vectorDiagram).not.toBeNull();
        expect(Array.from(vectorDiagram!.querySelectorAll('tspan'))
            .filter(label => label.textContent === 'X').length).toBe(6);
        expect(pages[1].querySelector('#cglLogo')).not.toBeNull();
        const velocity = pages[1].querySelector('[data-mekbay-region="advanced-velocity-record"]')!;
        expect(velocity.querySelector('rect')).toBeNull();
        expect(velocity.textContent).toContain('Turn');
        expect(velocity.textContent).toContain('Velocity');
        expect(velocity.textContent).toContain('Fuel');
        expect(velocity.textContent).toContain('20');
        expect(pages[1].dataset['mekbayPartialSheet']).toBe('1');
    });

    it('generates runtime binding anchors without a downloaded sheet', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestQuadMekEntity());

        expect(svg.classList.contains('mekbay-sheet')).toBeTrue();
        expect(svg.querySelectorAll('#mekbay-svg-style').length).toBe(1);
        expect(svg.querySelector('#mekbay-svg-style')?.textContent).not.toContain('.critSlot.pending');
        expect(svg.querySelectorAll('#mekbay-night-image-invert').length).toBe(1);
        expect(svg.dataset['mekbayRecordSheetPrepared']).toBeUndefined();
        expect(svg.querySelectorAll('.unitConditionButton[condition]').length).toBe(3);
        const randomHit = svg.querySelector('[data-mekbay-random-hit="1"]');
        expect(randomHit?.closest('[data-source="/images/paperdolls/quad-armor.svg"]')).not.toBeNull();
        expect(randomHit?.classList.contains('edit-only')).toBeFalse();
        expect(randomHit?.querySelector('image')?.getAttribute('href')).toBe('/images/random-black.svg');
        const locationLabels = Array.from(svg.querySelectorAll<SVGTextElement>('.diagram-location-label text'),
            label => label.textContent);
        const leftTorsoIndex = locationLabels.indexOf('Left');
        expect(locationLabels.slice(leftTorsoIndex, leftTorsoIndex + 2)).toEqual(['Left', 'Torso']);
        expect(svg.querySelector('#textArmor_CT')?.textContent).toMatch(/^\(\d+\)$/u);
        expect(svg.querySelector('#textIS_CT')?.textContent).toMatch(/^\(\d+\)$/u);
        expect(svg.querySelectorAll('.unitConditionBanner[condition]').length)
            .toBe(UNIT_CONDITION_DEFINITIONS.length);
        expect(svg.querySelectorAll('mask[id^="generated_condition_banner_fade_"]').length)
            .toBe(2);
        expect(svg.querySelector('.crewStateButton[crewId="0"] text')?.textContent).toBe('...');
        expect(svg.querySelectorAll('.crewStateButton[crewId="0"]').length).toBe(1);
        const crewStateRect = svg.querySelector<SVGRectElement>('.crewStateButton[crewId="0"] rect')!;
        expect(crewStateRect.getAttribute('x')).toBe('129.6');
        expect(crewStateRect.getAttribute('y')).toBe('4');
        expect(crewStateRect.getAttribute('width')).toBe('10');
        expect(svg.querySelector('.crewStateBanner[crewId="0"] .unitConditionBannerRect')).not.toBeNull();
        expect(svg.querySelector('.crewStateBanner[crewId="0"] .unitConditionBannerText')).not.toBeNull();
        expect(svg.getElementById('lifeSupportPilotDamageWarning')).not.toBeNull();
        expect(svg.getElementById('applyHeatButton')).not.toBeNull();
        expect(svg.getElementById('mpRun-psr-warning')).not.toBeNull();
        expect(svg.getElementById('mpJump-psr-warning')).not.toBeNull();
        expect(svg.querySelectorAll('.locationConditionControl[data-loc]').length).toBe(8);
        expect(svg.querySelectorAll('.locationNarcBanner[data-loc]').length).toBe(8);
        expect(svg.querySelector('#heatScale .overflowButton')).not.toBeNull();
        expect(svg.querySelectorAll('#heatScale .heat.no-autocolor').length).toBe(31);
        expect(svg.querySelector('#heatScale .heat')?.tagName.toLowerCase()).toBe('rect');
        expect(svg.querySelectorAll('.critSlot[data-loc][slot]').length).toBe(66);
        const hittableSlots = svg.querySelectorAll('.critSlot[hittable="1"]');
        expect(hittableSlots.length).toBeGreaterThan(0);
        expect(hittableSlots.length).toBeLessThan(66);
        expect(svg.querySelectorAll('.critSlot[hittable="1"] > .critSlot-bg-rect').length)
            .toBe(hittableSlots.length);
        expect(svg.querySelectorAll('.critSlot:not([hittable]) > .critSlot-bg-rect').length).toBe(0);
        expect(svg.querySelectorAll('.critSlot > .extraHitPip[display="none"]').length).toBe(66);
        const emptySlot = svg.querySelector('[data-mekbay-empty-slot="1"]');
        expect(emptySlot?.querySelector('text')?.textContent).toBe('Roll Again');
        expect(emptySlot?.hasAttribute('hittable')).toBeFalse();
        expect(emptySlot?.querySelector(':scope > .critSlot-bg-rect')).toBeNull();
        expect(svg.querySelectorAll('.inventoryEntry').length).toBeGreaterThan(0);
        expect(svg.querySelectorAll('.inventoryEntry[display="none"]').length).toBe(0);
        expect(svg.querySelectorAll('.crewHit').length).toBe(6);
        expect(svg.querySelectorAll('#heatScale .heat').length).toBe(31);
        expect(Array.from(svg.querySelectorAll('image')).every(image => {
            const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '';
            return href.startsWith('data:') || href === '/images/random-black.svg';
        })).toBeTrue();
        expect(svg.querySelectorAll('#btLogoColor > path').length).toBe(4);
        expect(svg.querySelectorAll('#btLogoColor > polygon').length).toBe(8);
        expect(svg.querySelectorAll('#cglLogoBW path').length).toBe(27);
        expect(svg.querySelectorAll('.svg-frame-title').length).toBeGreaterThan(5);
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
        expect(mainButton.getAttribute('x')).toBe('2');
        expect(mainButton.getAttribute('width')).toBe('177.104');
        expect(shortButton.getAttribute('x')).toBe('180.304');
        expect(shortButton.getAttribute('width')).toBe('10.448');
        expect(hitModRect.getAttribute('x')).toBe('-5');
        expect(hitModRect.getAttribute('width')).toBe('10');
        expect(hitModText.getAttribute('x')).toBe('0');
        expect(hitModText.getAttribute('font-family')).toBe('monospace');
        expect(quantity).not.toBeNull();
        expect(name).not.toBeNull();
    });

    it('uses the diagonal-striped unit-condition banner presentation', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestQuadMekEntity());
        const banner = svg.querySelector<SVGGElement>('.unitConditionBanner[condition="immobile"]')!;
        const rect = banner.querySelector<SVGRectElement>('.unitConditionBannerRect')!;
        const text = banner.querySelector<SVGTextElement>('.unitConditionBannerText')!;
        const maskReference = rect.getAttribute('mask')!;
        const maskId = maskReference.slice('url(#'.length, -1);
        const mask = svg.getElementById(maskId)!;
        const importantRect = svg.querySelector<SVGRectElement>(
            '.unitConditionBanner[condition="shutdown"] .unitConditionBannerRect',
        )!;
        const importantMaskReference = importantRect.getAttribute('mask')!;
        const importantMaskId = importantMaskReference.slice('url(#'.length, -1);
        const importantMask = svg.getElementById(importantMaskId)!;

        expect(rect.getAttribute('width')).toBe('200');
        expect(rect.getAttribute('height')).toBe('24');
        expect(text.getAttribute('font-family')).toBe('Roboto, sans-serif');
        expect(text.getAttribute('font-size')).toBe('24');
        expect(text.getAttribute('font-weight')).toBe('bold');
        expect(mask.getAttribute('maskUnits')).toBe('userSpaceOnUse');
        expect(mask.getAttribute('width')).toBe('200');
        expect(mask.getAttribute('height')).toBe('24');
        expect(mask.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
        expect(mask.querySelectorAll('path').length).toBeGreaterThan(0);
        expect(importantMaskId).not.toBe(maskId);
        expect(importantRect.getAttribute('width')).toBe('270');
        expect(importantRect.getAttribute('height')).toBe('32');
        expect(importantMask.getAttribute('width')).toBe('270');
        expect(importantMask.getAttribute('height')).toBe('32');
        expect(svg.querySelector('linearGradient[id^="generated_condition_banner_fade_"]')).toBeNull();
    });

    it('authors material symbols without duplicating construction point capacities', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(50);
        entity.setArmorValue('CT', 'front', 10);
        entity.setArmorValue('LT', 'front', 8);
        entity.setArmorAt('CT', new MountedArmor({
            armor: new ArmorEquipment({
                id: 'Test Hardened Armor',
                name: 'Hardened Armor',
                type: 'armor',
                armor: { type: 'HARDENED' },
            }),
        }));
        entity.setStructureAt('CT', new MountedStructure({
            tonnage: 50,
            structure: new StructureEquipment({
                id: 'Test Reinforced Structure',
                name: 'Reinforced Structure',
                type: 'structure',
                structure: { typeId: 4 },
            }),
        }));

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const ctArmor = svg.querySelectorAll('.pip.armor[data-loc="CT"]:not(.half)');
        const ctStructure = svg.querySelectorAll('.pip.structure[data-loc="CT"]:not(.half)');

        expect(ctArmor.length).toBe(10);
        expect(svg.querySelectorAll('.pip.armor[data-loc="CT"].half').length).toBe(0);
        expect(svg.querySelectorAll('.pip.armor[data-loc="LT"].half').length).toBe(0);
        expect(ctStructure.length).toBe(entity.structureValues().get('CT')!);
        expect(svg.querySelectorAll('.pip.structure[data-loc="CT"].half').length).toBe(0);
        expect(svg.querySelectorAll('.pip.structure[data-loc="LT"].half').length).toBe(0);
        expect(ctArmor[0].tagName).toBe('polygon');
        expect(ctStructure[0].tagName).toBe('polygon');
    });

    for (const [family, createEntity] of [
        ['Biped', () => new TestBipedMekEntity()],
        ['Quad', () => new TestQuadMekEntity()],
        ['ProtoMek', () => new TestProtoMekEntity()],
        ['Tank', () => new TestTankEntity()],
        ['Naval', () => new TestSupportNavalEntity()],
        ['VTOL', () => new TestVtolEntity()],
        ['WiGE', () => { const entity = new TestTankEntity(); entity.motiveType.set('WiGE'); return entity; }],
        ['Fighter', () => new TestAeroSpaceFighterEntity()],
        ['Conventional fighter', () => new TestConvFighterEntity()],
        ['Fixed-wing support', () => new TestFixedWingSupportEntity()],
        ['Small craft', () => new TestSmallCraftEntity()],
        ['DropShip', () => new TestDropShipEntity()],
        ['Battle armor', () => new TestBattleArmorEntity()],
        ['Handheld weapon', () => new TestHandheldWeaponEntity()],
    ] as const) {
        it(`retains Fancy Pips through the complete ${family} generation pipeline`, async () => {
            const entity = createEntity();
            entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
                id: 'Test Reactive Armor', name: 'Reactive', type: 'armor',
                armor: { type: 'REACTIVE', bar: 10 },
            }) }));
            for (const location of entity.armorLocations) entity.setArmorValue(location, 'front', 3);

            const svg = await RecordSheetSvgGenerator.generate(entity);
            const pips = [...svg.querySelectorAll<SVGPolygonElement>('.pip.armor:not(.trooperStatusPip)')];
            expect(pips.length).withContext(family).toBeGreaterThan(0);
            expect(pips.every(pip => pip.tagName === 'polygon' && pip.points.numberOfItems === 5))
                .withContext(family).toBeTrue();
            expect(svg.querySelector('.pip.armor.half')).toBeNull();
            if (family === 'Battle armor') {
                expect(svg.querySelector('.trooperStatusPip')?.tagName).toBe('circle');
            }
        });
    }

    it('retains dashed low-BAR armor and composite structure pips after SVG optimization', async () => {
        const entity = new TestBipedMekEntity();
        entity.setArmorValue('CT', 'front', 4);
        entity.setArmorAt('CT', new MountedArmor({ armor: new ArmorEquipment({
            id: 'Test Commercial Armor', name: 'Commercial', type: 'armor',
            armor: { type: 'COMMERCIAL', bar: 5 },
        }) }));
        entity.setStructureAt('CT', new MountedStructure({ tonnage: 50, structure: new StructureEquipment({
            id: 'Test Composite Structure', name: 'Composite', type: 'structure', structure: { typeId: 5 },
        }) }));

        const svg = await RecordSheetSvgGenerator.generate(entity);
        for (const type of ['armor', 'structure']) {
            const pips = [...svg.querySelectorAll<SVGCircleElement>(`.pip.${type}[data-loc="CT"]`)];
            expect(pips.length).toBeGreaterThan(0);
            expect(pips.every(pip => pip.tagName === 'circle' && pip.getAttribute('stroke-dasharray') === '1.8 .85'))
                .withContext(type).toBeTrue();
            expect(pips.some(pip => pip.classList.contains('half'))).toBeFalse();
        }
    });

    it('matches the MegaMekLab Mek location, cluster, and physical reference grids', async () => {
        const entity = new TestBipedMekEntity();
        addTestEquipmentWithFlags(entity, 'F_CASE', { location: 'LA' });
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
        const locationControl = svg.querySelector(
            '.critGroup[data-loc="LA"] > .locationConditionControl',
        );
        expect(locationControl?.querySelector(':scope > .critical-location-heading')).not.toBeNull();
        expect(locationControl?.querySelector(':scope > .critical-case-label')?.textContent).toBe('(CASE)');
        expect(svg.querySelector('.critGroup[data-loc="LA"] > .critical-location-heading')).toBeNull();
        expect(svg.querySelector('.critGroup[data-loc="LA"] > .critical-case-label')).toBeNull();
        expect(svg.querySelector('.critSlot[data-loc="LA"][slot="0"]')).not.toBeNull();
        expect(svg.querySelectorAll('.critical-roll-range').length).toBe(10);
        expect(svg.querySelectorAll('.mek-system-damage .systemHitPip').length).toBe(8);
        expect(svg.textContent).not.toContain('SYSTEM DAMAGE');
    });

    it('keeps Tripod crew roles and transfer art in the Mek family owner', async () => {
        const entity = new TestTripodMekEntity();
        entity.cockpitType.set('Tripod');
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const crew = svg.querySelector<SVGGElement>('.mek-multi-crew-data')!;
        const reference = svg.querySelector<SVGGElement>(
            '[data-mekbay-reference="mek-hit-location-cluster"]',
        )!;
        const transfer = svg.querySelector<SVGGElement>('.damage-transfer-tripod')!;

        expect(svg.dataset['mekbayLayout']).toBe('mek');
        expect(crew.querySelector('#crewName0')?.textContent).toBe('Pilot:');
        expect(crew.querySelector('#crewName1')?.textContent).toBe('Gunner:');
        expect(crew.querySelector('#crewName2')).toBeNull();
        expect(reference).not.toBeNull();
        expect(transfer.getAttribute('data-source'))
            .toBe('/images/paperdolls/tripod-damage-transfer.svg');
    });

    it('keeps LAM-only movement, systems, transfer, compass, and heat in the Mek family owner', async () => {
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
        expect(systemDamage).not.toBeNull();
        expect(systemDamage?.querySelector('#avionics_hit_3')).not.toBeNull();
        expect(systemDamage?.querySelector('#landing_gear_hit_1')).not.toBeNull();
        expect(transfer).not.toBeNull();
        expect(movementHeat?.hasAttribute('h-move')).toBeFalse();
        expect(movementHeat?.querySelector('#minus5MP')?.textContent).toBe('-5 Movement Points');
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
        expect(svg.querySelector('#unitDataPanel')?.textContent).toContain('Vehicle');
        expect(svg.querySelector('#mpCruise')).not.toBeNull();
        expect(svg.querySelector('#mpFlank')).not.toBeNull();
        expect(svg.querySelector('.mek-paperdolls')?.getAttribute('data-mekbay-pip-layout'))
            .toBe('distributed');
        expect(svg.querySelector('.mek-paperdolls-schematic [data-loc="FLL"]')).not.toBeNull();
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
            expect(Array.from(svg.querySelectorAll('image')).every(image => {
                const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '';
                return href.startsWith('data:') || href === '/images/random-black.svg';
            })).withContext(context).toBeTrue();
            expect(svg.querySelector('script')).withContext(context).toBeNull();
            expect(Array.from(svg.querySelectorAll('use')).some(use => {
                const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
                return href.length > 0 && !href.startsWith('#');
            })).withContext(context).toBeFalse();
            expect(svg.querySelectorAll('.svg-frame-title, .handheld-weapon-strip').length)
                .withContext(context).toBeGreaterThan(0);
            const paperdolls = [...svg.querySelectorAll('[data-mekbay-paperdoll]')];
            if (paperdolls.length > 0) {
                expect(svg.querySelectorAll('[data-mekbay-random-hit]')).withContext(context).toHaveSize(1);
            }
            paperdolls.forEach(paperdoll => {
                expect(paperdoll.querySelector('.pip-hit-area')).withContext(context).toBeNull();
                paperdoll.querySelectorAll('.pip.armor, .pip.structure, .capital-pip-grid').forEach(pip => {
                    const kind = pip.classList.contains('armor') ? 'armor' : 'structure';
                    const code = pip.getAttribute('data-loc');
                    const rear = pip.hasAttribute('data-rear') ? '[data-rear]' : ':not([data-rear])';
                    expect(paperdoll.querySelector(`.unitLocation.${kind}[data-loc="${code}"]${rear}`))
                        .withContext(`${context}: ${kind} ${code}`).not.toBeNull();
                });
            });
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
        expect(quadSvg.querySelector('.mek-paperdolls-schematic [data-loc="FLL"]')).not.toBeNull();
        expect(quadSvg.querySelectorAll('.mek-paperdolls .svg-frame-title').length).toBe(2);
    });

    it('marks generated A4 pages with their requested page format', async () => {
        const entity = new TestQuadMekEntity();
        const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4' });

        expect(a4.dataset['mekbayPageFormat']).toBe('a4');
        expect(a4.dataset['mekbayGenerated']).toBe('1');
    });

    it('forwards selected custom pip layouts to biped and vehicle paperdolls', async () => {
        for (const pipLayout of ['distributed', 'rail'] as const) {
            for (const entity of [new TestBipedMekEntity(), new TestTankEntity()]) {
                entity.damageLocations().forEach(location => entity.setArmorValue(location.code, 'front', 10));
                const sheet = await RecordSheetSvgGenerator.generate(entity, { pipLayout });
                expect(sheet.getAttribute('data-mekbay-pip-layout')).toBe(pipLayout);
                for (const location of entity.damageLocations()) {
                    const code = location.sheetCode ?? location.code;
                    expect(sheet.querySelectorAll(`.pip.armor[data-loc="${code}"]:not([data-rear])`).length)
                        .withContext(`${entity.entityType}: ${pipLayout} ${code}`).toBe(10);
                }
            }
        }
    });

    it('marks each generated non-vehicle compact family', async () => {
        const cases = [
            { entity: new TestBattleArmorEntity(), kind: 'battle-armor' },
            { entity: new TestInfantryEntity(), kind: 'infantry' },
            { entity: new TestProtoMekEntity(), kind: 'protomek' },
        ] as const;

        for (const item of cases) {
            const svg = await RecordSheetSvgGenerator.generate(item.entity, { format: 'compact' });
            expect(svg.dataset['mekbayCompact']).toBe(item.kind);
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

    it('keeps AP-mount weapons out of the Battle Armor inventory', async () => {
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
        expect(svg.querySelector(
            `.inventoryEntry[data-mekbay-component-ids="${antiPersonnel.mountId}"]`,
        )).toBeNull();
        expect(svg.textContent).toContain("Anti-'Mech Skill:");
    });

    it('shows large-aero double-sink dissipation and scale', async () => {
        const entity = new TestWarShipEntity();
        entity.heatSinkCount.set(20);
        entity.heatSinkType.set('Double');

        const svg = await RecordSheetSvgGenerator.generate(entity);
        const heat = svg.querySelector<SVGGElement>('#heatDataPanel')!;
        const labels = Array.from(heat.querySelectorAll<SVGTextElement>('text'));
        const text = (value: string): SVGTextElement | undefined => labels.find(node => node.textContent === value);

        expect(text('Heat Sinks:')).not.toBeUndefined();
        expect(text('20')).not.toBeUndefined();
        expect(text('(40)')).not.toBeUndefined();
        expect(text('Nose:')).not.toBeUndefined();
        const scaleLabel = Array.from(svg.querySelectorAll<SVGTextElement>('.large-aero-diagram-header text'))
            .find(node => node.textContent === 'Capital Scale');
        expect(scaleLabel).not.toBeUndefined();
    });

    it('prints counted vessel features and maximum rapid-fire heat in the correct arcs', async () => {
        const entity = new TestDropShipEntity();
        entity.motiveType.set('Aerodyne');
        const ultra = addTestEquipment(entity, new WeaponEquipment({
            id: 'Sheet Ultra AC20', name: 'Ultra AC20', type: 'weapon',
            weapon: { heat: 7, ammoType: 'AC_ULTRA', av: [30, 30, 0, 0] },
        }), { location: 'Left Side' });
        const rotary = addTestEquipment(entity, new WeaponEquipment({
            id: 'Sheet Rotary AC5', name: 'Rotary AC5', type: 'weapon',
            weapon: { heat: 1, ammoType: 'AC_ROTARY', av: [20, 20, 0, 0] },
        }), { location: 'Right Side', rearMounted: true });
        entity.addEquipmentBay('weapon-bay', { mounts: [ultra] });
        entity.addEquipmentBay('weapon-bay', { mounts: [rotary] });
        const container = createEquipment({
            id: 'Sheet Cargo Container', name: 'Cargo Container (10 tons)',
            shortName: 'Cargo Container (10 tons)', type: 'misc',
        });
        for (let index = 0; index < 10; index++) addTestEquipment(entity, container, { location: 'Hull' });

        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.textContent).toContain('Features 10xCargo Container (10 tons)');
        expect(svg.querySelector('#foreSidesHeat')?.textContent).toBe('14/0');
        expect(svg.querySelector('#aftSidesHeat')?.textContent).toBe('0/6');
    });

    it('omits the inactive sail counter from stations without a sail', async () => {
        const entity = new TestSpaceStationEntity();
        entity.setTonnage(6000);
        expect(entity.sail()).toBeFalse();
        expect(entity.sailIntegrity()).toBe(3);
        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.textContent).not.toContain('Sail Integrity:');
        expect(svg.querySelector('[data-location="SAIL"], #textSailIntegrity')).toBeNull();
    });

    it('lets each compact family own its masthead wording and identifying art', async () => {
        const battleArmor = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity());
        const infantry = await RecordSheetSvgGenerator.generate(new TestInfantryEntity());
        const protoMek = await RecordSheetSvgGenerator.generate(new TestProtoMekEntity());

        expect(mastheadLines(battleArmor)).toEqual(['BATTLE ARMOR', 'RECORD SHEET']);
        expect(battleArmor.querySelector('.battle-armor-masthead-icon')).not.toBeNull();
        expect(mastheadLines(infantry)).toEqual(['CONVENTIONAL', 'INFANTRY RECORD', 'SHEET']);
        expect(infantry.querySelector('.record-sheet-unit-title-frame [class$="masthead-icon"]'))
            .not.toBeNull();
        expect(mastheadLines(protoMek)).toEqual(['PROTOMECH', 'RECORD SHEET']);
        expect(protoMek.querySelector('.protomek-masthead-icon')).not.toBeNull();
    });

    it('keeps the structure torso labels beside their counters and below Head', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        const structure = svg.querySelector('.mek-paperdoll-structure')!;
        const head = [...structure.querySelectorAll<SVGTextElement>('.diagram-location-name')]
            .find(label => label.textContent === 'Head')!;
        for (const code of ['LT', 'RT']) {
            const name = structure.querySelector<SVGTextElement>(`[data-counter-id="textIS_${code}"]`)!;
            const value = structure.querySelector<SVGTextElement>(`#textIS_${code}`)!;
            expect(name.getAttribute('y')).toBe(value.getAttribute('y'));
            expect(name.getAttribute('text-anchor')).toBe('end');
            expect(Number(name.getAttribute('x'))).toBeCloseTo(Number(value.getAttribute('x')) - 10, 4);
            expect(Number(name.getAttribute('y')) - Number(head.getAttribute('y'))).toBeGreaterThan(10);
        }
    });

    it('shows resolved fighter artwork in its dedicated MML box independently of the Mek table preference', async () => {
        const source = '/images/record-sheet-art/custom-fighter-fluff.png';
        const entity = new TestFixedWingSupportEntity();
        entity.fluffImageEncoded.set('previous-encoded-image');
        const svg = await RecordSheetSvgGenerator.generate(entity, { fluffImageUrl: source });
        const region = svg.querySelector<SVGGElement>('.aero-artwork-region')!;
        const image = region.querySelector<SVGImageElement>('image')!;

        expect(region.getAttribute('transform')).toBe('translate(21 402)');
        expect(image.getAttribute('href')).toBe(source);
        expect(image.getAttribute('width')).toBe('224.4');
        expect(image.getAttribute('height')).toBe('101.4');
        expect(region.querySelectorAll('image')).toHaveSize(1);
        expect(svg.querySelector('#fluff-image, #fluff-image-injected')).toBeNull();
        const presentation = new PageViewerPresentationService();
        for (const showFluff of [false, true]) {
            presentation.applyFluffImageVisibilityToSvg(svg, showFluff);
            expect(image.style.display).toBe('');
            expect(region.style.display).toBe('');
        }
    });

    for (const [family, createEntity, fallbackClass] of [
        ['ProtoMek', () => new TestProtoMekEntity(), 'protomek-masthead-icon'],
        ['Battle Armor', () => new TestBattleArmorEntity(), 'battle-armor-masthead-icon'],
        ['Infantry', () => new TestInfantryEntity(), 'infantry-masthead-icon'],
    ] as const) {
        it(`places resolved ${family} fluff in the masthead and retains its default when absent`, async () => {
            const source = '/images/record-sheet-art/custom-unit-fluff.png';
            const custom = await RecordSheetSvgGenerator.generate(createEntity(), { fluffImageUrl: source });
            const fallback = await RecordSheetSvgGenerator.generate(createEntity(), { fluffImageUrl: null });
            const image = custom.querySelector<SVGImageElement>('.masthead-fluff-image')!;

            expect(image?.getAttribute('href')).toBe(source);
            expect(image?.closest('.record-sheet-unit-title-frame')).not.toBeNull();
            expect(['x', 'y', 'width', 'height'].map(attribute => image.getAttribute(attribute)))
                .toEqual(['9.45', '2', '37.8', '41.357']);
            expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
            expect(image.style.display).toBe('');
            expect(custom.querySelector(`.${fallbackClass}`)).toBeNull();
            expect(custom.querySelector('#fluff-image-injected')).toBeNull();
            expect(fallback.querySelector(`.${fallbackClass}`)).not.toBeNull();
            expect(fallback.querySelector('.masthead-fluff-image')).toBeNull();
        });
    }

    it('composes mixed compact sheets into distinct unit blocks', async () => {
        const vehicle = await RecordSheetSvgGenerator.generate(new TestTankEntity(), { format: 'compact' });
        const battleArmor = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), { format: 'compact' });
        const page = RecordSheetSvgGenerator.composeCompactPage([vehicle, battleArmor]);

        expect(page.dataset['mekbayUnitCount']).toBe('2');
        expect(page.querySelectorAll('.compact-sheet-block').length).toBe(2);
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

    it('emits one shared reference layer for a compact family page', async () => {
        const battleArmor = await Promise.all(Array.from({ length: 5 }, () =>
            RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), { format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(battleArmor);
        expect(page.dataset['mekbayReferenceFamily']).toBe('battle-armor');
        expect(page.querySelectorAll('.compact-sheet-block').length).toBe(5);
        expect(Array.from(page.querySelectorAll<SVGTextElement>('.svg-frame-title'))
            .filter(title => title.textContent === 'LEG ATTACKS TABLE').length).toBe(1);
        expect(page.querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
        const artId = 'mekbay-battle-armor-default-art';
        expect(page.querySelectorAll(`symbol#${artId}`).length).toBe(1);
        expect(page.querySelectorAll(`symbol#${artId} > image[href^="data:"]`).length).toBe(1);
        expect(page.querySelectorAll(`use[href="#${artId}"]`).length).toBeGreaterThan(5);
        const ids = Array.from(page.querySelectorAll<SVGElement>('[id]'), element => element.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(page.querySelector('#unit1-bv')).not.toBeNull();
        expect(page.querySelector('#unit5-bv')).not.toBeNull();
    });

    it('includes the applicable cluster reference when one Battle Armor unit leaves room for it', async () => {
        const page = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity());

        expect(page.dataset['mekbayReferenceFamily']).toBe('battle-armor');
        expect(page.querySelectorAll('[data-mekbay-reference="cluster-hits"]').length).toBe(1);
        expect(page.querySelector('[data-cluster-rack="5"][data-cluster-roll="2"]')?.textContent)
            .toBe('1');
    });

    it('composes compact blocks on an A4 canvas', async () => {
        const blocks = await Promise.all(Array.from({ length: 5 }, () =>
            RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), {
                format: 'compact',
                pageFormat: 'a4',
            })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks, 'a4');

        expect(page.dataset['mekbayPageFormat']).toBe('a4');
        expect(page.querySelectorAll('.compact-sheet-block').length).toBe(5);
    });
});

function mastheadLines(svg: SVGSVGElement): readonly string[] {
    return Array.from(svg.querySelectorAll<SVGTextElement>('.record-sheet-unit-title-frame > text'))
        .map(node => node.textContent ?? '');
}
