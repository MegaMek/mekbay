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
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('RecordSheetSvgGenerator', () => {
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
        expect(svg.querySelector('#engine_hit_1')).not.toBeNull();
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
        expect(row.querySelector('.name')?.textContent).toBe('1 Large Laser');
        expect(row.querySelector('.range_short')?.textContent).toBe('1 (8)');
        expect(svg.textContent).not.toContain('Standard Scale on Reverse');
    });

    it('generates runtime binding anchors without a downloaded sheet', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestQuadMekEntity());

        expect(svg.classList.contains('mekbay-sheet')).toBeTrue();
        expect(svg.querySelectorAll('#mekbay-svg-style').length).toBe(1);
        expect(svg.querySelector('#mekbay-svg-style')?.textContent).not.toContain('.critSlot.pending');
        expect(svg.querySelectorAll('#mekbay-night-image-invert').length).toBe(1);
        expect(svg.dataset['mekbayRecordSheetPrepared']).toBeUndefined();
        expect(svg.querySelectorAll('.unitConditionButton[condition]').length).toBe(3);
        expect(svg.querySelectorAll('.unitConditionBanner[condition]').length)
            .toBe(UNIT_CONDITION_DEFINITIONS.length);
        expect(svg.querySelectorAll('mask[id^="generated_condition_banner_fade_"]').length)
            .toBe(UNIT_CONDITION_DEFINITIONS.length);
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
        expect(svg.querySelectorAll('.locationConditionControl[loc]').length).toBe(8);
        expect(svg.querySelectorAll('.locationNarcBanner[loc]').length).toBe(8);
        expect(svg.querySelector('#heatScale .overflowButton')).not.toBeNull();
        expect(svg.querySelectorAll('#heatScale .heat.no-autocolor').length).toBe(31);
        expect(svg.querySelector('#heatScale .heat')?.tagName.toLowerCase()).toBe('rect');
        expect(svg.querySelectorAll('.critSlot[loc][slot]').length).toBe(66);
        expect(svg.querySelectorAll('.critSlot[hittable="1"] > .critSlot-bg-rect').length).toBe(66);
        expect(svg.querySelectorAll('.critSlot > .extraHitPip[display="none"]').length).toBe(66);
        expect(svg.querySelector('[data-mekbay-empty-slot="1"] text')?.textContent).toBe('Roll Again');
        expect(svg.querySelectorAll('.inventoryEntry').length).toBeGreaterThan(0);
        expect(svg.querySelectorAll('.inventoryEntry[display="none"]').length).toBe(0);
        expect(svg.querySelectorAll('.crewHit').length).toBe(6);
        expect(svg.querySelectorAll('#heatScale .heat').length).toBe(31);
        expect(Array.from(svg.querySelectorAll('image')).every(image =>
            (image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '').startsWith('data:'),
        )).toBeTrue();
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

    it('authors doubled construction pips from each location material', async () => {
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
        const ctArmor = svg.querySelectorAll('.pip.armor[loc="CT"]:not(.half)');
        const ctStructure = svg.querySelectorAll('.pip.structure[loc="CT"]:not(.half)');

        expect(ctArmor.length).toBeGreaterThan(0);
        expect(svg.querySelectorAll('.pip.armor[loc="CT"].half').length).toBe(ctArmor.length);
        expect(svg.querySelectorAll('.pip.armor[loc="LT"].half').length).toBe(0);
        expect(ctStructure.length).toBeGreaterThan(0);
        expect(svg.querySelectorAll('.pip.structure[loc="CT"].half').length).toBe(ctStructure.length);
        expect(svg.querySelectorAll('.pip.structure[loc="LT"].half').length).toBe(0);
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
        expect(svg.querySelector('.critGroup[loc="LA"] > .critical-location-heading')).not.toBeNull();
        expect(svg.querySelector('.critSlot[loc="LA"][slot="0"]')).not.toBeNull();
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
        expect(svg.querySelector('#unitDataPanel')?.textContent).toContain('Vehicle');
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

    it('marks generated A4 pages with their requested page format', async () => {
        const entity = new TestQuadMekEntity();
        const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4' });

        expect(a4.dataset['mekbayPageFormat']).toBe('a4');
        expect(a4.dataset['mekbayGenerated']).toBe('1');
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
