// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment, createEquipment } from '../../../models/equipment.model';
import { TestAeroSpaceFighterEntity, TestConvFighterEntity, TestDropShipEntity, TestBipedMekEntity, TestQuadVeeEntity, TestSupportTankEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../../models/entity/testing/test-equipment-registry';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { recordSheetInventoryMountName } from '../record-sheet-inventory-equipment';

describe('record-sheet inventory content parity', () => {
    it('retains support-vehicle fire control features in both rulesets', async () => {
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            for (const kind of ['BASIC', 'ADVANCED'] as const) {
                const entity = new TestSupportTankEntity();
                entity.setTonnage(240);
                entity.motiveType.set('WiGE');
                addTestEquipmentWithFlags(entity, `F_${kind}_FIRE_CONTROL`, { location: 'Body' });
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                const label = kind === 'ADVANCED' ? 'Advanced Fire Control' : 'Basic Fire Control';
                expect(svg.textContent).toContain(label);
            }
        }
    });

    it('labels DropShip heat arcs according to the hull shape in both rulesets', async () => {
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            for (const motive of ['Aerodyne', 'Spheroid'] as const) {
                const entity = new TestDropShipEntity();
                entity.motiveType.set(motive);
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                expect(svg.getElementById('foreSidesHeat')?.previousElementSibling?.textContent)
                    .toBe(motive === 'Spheroid' ? 'Left/Right Fore:' : 'Left/Right Wing:');
            }
        }
    });

    it('retains fighter VSTOL and small-cockpit features in both rulesets', async () => {
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            const conventional = new TestConvFighterEntity();
            conventional.vstol.set(true);
            const aerospace = new TestAeroSpaceFighterEntity();
            aerospace.cockpitType.set('Small');
            for (const [entity, feature] of [[conventional, 'VSTOL Equipment'], [aerospace, 'Small Cockpit']] as const) {
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                expect(svg.querySelector('.aero-features')?.textContent).toBe(`Features ${feature}`);
            }
        }
    });

    it('prints the mounted communications size in both rulesets and keeps mount modifiers', async () => {
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            const entity = new TestTankEntity();
            const comms = addTestEquipment(entity, createEquipment({ id: 'Communications Equipment',
                name: 'Communications Equipment', shortName: 'CommsGear', type: 'misc',
                flags: ['F_COMMUNICATIONS', 'F_VARIABLE_SIZE'] }), { location: 'TU', size: 3, turretMounted: true });
            expect(recordSheetInventoryMountName(entity, comms)).toBe('CommsGear (3 tons) (T)');
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
            const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${comms.mountId}"]`);
            expect(row?.querySelector(':scope > .name')?.textContent).toContain('CommsGear (3 tons)');
        }
    });

    it('keeps DemolitionMech miscellaneous equipment in source order and prints cargo capacity', async () => {
        const entity = new TestBipedMekEntity();
        entity.chassis.set('DemolitionMech');
        entity.model.set('WI-DM');
        entity.setTonnage(35);
        const wreckingBall = addTestEquipment(entity, createEquipment({ id: 'Wrecking Ball', name: 'Wrecking Ball', type: 'misc',
            flags: ['F_CLUB', 'S_WRECKING_BALL'] }), { location: 'LA' });
        const rockCutter = addTestEquipment(entity, createEquipment({ id: 'Rock Cutter', name: 'Rock Cutter', type: 'misc',
            flags: ['F_CLUB', 'S_ROCK_CUTTER'] }), { location: 'RA' });
        const cargo = addTestEquipment(entity, createEquipment({ id: 'Cargo', name: 'Cargo', type: 'misc',
            flags: ['F_CARGO'] }), { location: 'CT', size: 0.5 });
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const rows = [...svg.querySelectorAll('.inventoryEntry[data-mekbay-component-ids]')];

        expect(rows.map(row => row.getAttribute('data-mekbay-component-ids')))
            .toEqual([wreckingBall.mountId, rockCutter.mountId, cargo.mountId]);
        expect(rows.map(row => row.querySelector(':scope > .name')?.textContent))
            .toEqual(['Wrecking Ball', 'Rock Cutter', 'Cargo (0.5 tons)']);
        expect(rows.map(row => row.querySelector(':scope > .damage')?.textContent)).toEqual(['8', '5', '[E]']);
    });

    it('omits integral QuadVee tracks while retaining mounted tracks on ordinary Meks', async () => {
        for (const entity of [new TestQuadVeeEntity(), new TestBipedMekEntity()]) {
            const tracks = addTestEquipmentWithFlags(entity, 'F_TRACKS', { location: 'LL' });
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${tracks.mountId}"]`);
            expect(row !== null).withContext(entity.chassisConfig).toBe(entity.chassisConfig !== 'QuadVee');
            expect(entity.equipment().includes(tracks)).toBeTrue();
        }
    });

    it('shares mixed-tech disambiguation across Mek and vehicle inventory without adding it to unique names', async () => {
        const clan = new WeaponEquipment({ id: 'CLGaussRifle', name: 'Gauss Rifle', type: 'weapon',
            tech: { base: 'Clan' }, weapon: { damage: 15, heat: 1, ranges: [7, 15, 22] } });
        const innerSphere = new WeaponEquipment({ id: 'ISGaussRifle', name: 'Gauss Rifle', type: 'weapon',
            tech: { base: 'IS' }, weapon: { damage: 15, heat: 1, ranges: [7, 15, 22] } });
        const registry = createTestEquipmentRegistry({ [clan.id]: clan, [innerSphere.id]: innerSphere });
        for (const entity of [new TestBipedMekEntity(registry), new TestTankEntity(registry)]) {
            entity.mixedTech.set(true);
            const mount = addTestEquipment(entity, clan, { location: entity.entityType === 'Mek' ? 'RA' : 'TU', turretMounted: true });
            expect(recordSheetInventoryMountName(entity, mount)).toBe('Gauss Rifle (C) (T)');
            const svg = await RecordSheetSvgGenerator.generate(entity);
            const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${mount.mountId}"]`);
            expect(row?.querySelector(':scope > .name')?.textContent).toContain('Gauss Rifle (C)');
        }
        const unique = new TestTankEntity();
        unique.mixedTech.set(true);
        const mount = addTestEquipment(unique, clan, { location: 'FR' });
        expect(recordSheetInventoryMountName(unique, mount)).toBe('Gauss Rifle');
    });

    it('prints Artemis V as the actual linked component below its vehicle launcher', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Gulltoppr OmniMonitor');
        entity.model.set('(A)');
        const launcher = addTestEquipment(entity, new WeaponEquipment({ id: 'LRM 20', name: 'LRM 20', type: 'weapon',
            flags: ['F_LRM', 'F_MISSILE', 'F_ARTEMIS_COMPATIBLE'],
            weapon: { damage: '1/Msl', ammoType: 'LRM', rackSize: 20, ranges: [7, 14, 21] } }), { location: 'TU' });
        const artemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS_V', { location: 'TU' });
        entity.linkEquipment(artemis, launcher);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${launcher.mountId}"]`)!;
        const linked = row.querySelector('.inventoryEntry.linked');

        expect(linked?.getAttribute('data-mekbay-component-ids')).toBe(artemis.mountId);
        expect(linked?.querySelector('.name')?.textContent).toBe('w/Artemis V');
        expect(linked?.classList.contains('alternativeMode')).toBeFalse();
        expect(row.querySelector(':scope > .range_long')?.textContent).toBe('21');
        expect(svg.querySelectorAll(`.inventoryEntry[data-mekbay-component-ids="${artemis.mountId}"]`).length).toBe(1);
    });

    it('includes Dromedary cargo bays with their real capacities and doors outside interactive inventory', async () => {
        const entity = new TestSupportTankEntity();
        entity.chassis.set('Dromedary Water Transport');
        entity.transporters.set([
            { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 4, doors: 1, bayNumber: 1, omni: false },
            { id: 'water', kind: 'bay', configuration: { type: 'liquid-cargo' }, capacity: 45.5, doors: 1, bayNumber: 2, omni: false },
            { id: 'quarters', kind: 'bay', configuration: { type: 'crew-quarters' }, capacity: 3, doors: 0, bayNumber: 3, omni: false },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const cargo = svg.querySelector('.vehicle-cargo')!;

        expect([...cargo.querySelectorAll('text')].map(text => text.textContent)).toEqual([
            'Cargo:', 'Bay 1: Cargo (4) (1 Door)', 'Bay 2: Liquid Cargo (45.5) (1 Door)',
        ]);
        expect(cargo.closest('[data-ammo-inventory]')).not.toBeNull();
        expect(cargo.querySelector('.inventoryEntry')).toBeNull();
        expect(cargo.textContent).not.toContain('Quarters');
    });

    it('prints Oppie engineering-tool damage using the existing physical-weapon rules', async () => {
        const entity = new TestSupportTankEntity();
        const backhoe = addTestEquipment(entity, createEquipment({ id: 'Backhoe', name: 'Backhoe', type: 'misc',
            flags: ['F_CLUB', 'S_BACKHOE'] }), { location: 'RR' });
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${backhoe.mountId}"] .damage`)?.textContent).toBe('6');
    });
});
