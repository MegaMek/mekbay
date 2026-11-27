// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, WeaponEquipment, createEquipment } from '../../../models/equipment.model';
import { TestAeroSpaceFighterEntity, TestSmallCraftEntity, TestConvFighterEntity, TestDropShipEntity, TestBipedMekEntity, TestQuadVeeEntity, TestSupportTankEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
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

    it('prints each laser attachment with its own mount and heat on fighter and small craft sheets', async () => {
        for (const entity of [new TestAeroSpaceFighterEntity(), new TestSmallCraftEntity()]) {
            entity.setTonnage(100);
            const weapon = addTestEquipment(entity, new WeaponEquipment({ id: 'Small Laser', name: 'Small Laser',
                type: 'weapon', flags: ['F_LASER', 'F_ENERGY', 'F_RISC_LASER_PULSE_COMPATIBLE'], weapon: { damage: 3, heat: 1, ranges: [1, 2, 3, 4] } }), { location: 'Nose' });
            const attachments = ['F_LASER_INSULATOR', 'F_RISC_LASER_PULSE_MODULE', 'F_LASER_INSULATOR'].map(flag => {
                const pulse = flag === 'F_RISC_LASER_PULSE_MODULE';
                const mount = addTestEquipment(entity, new MiscEquipment({ id: pulse ? 'ISRISCLaserPulseModule' : 'ISLaserInsulator',
                    name: pulse ? 'Pulse Module' : 'Laser Insulator', type: 'misc',
                    flags: ['F_WEAPON_ENHANCEMENT', pulse ? 'F_RISC_LASER_PULSE_MODULE' : 'F_LASER_INSULATOR'] }), { location: 'Nose' });
                entity.linkEquipment(mount, weapon);
                return mount;
            });
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
            const heat = (id: string) => [...svg.querySelectorAll(`.inventoryEntry[data-mekbay-component-ids="${id}"] > .heat`)]
                .map(field => field.textContent);
            // An insulated laser's heat and its pulse module's carry MegaMekLab's insulator mark
            expect(heat(weapon.mountId)).toEqual(['1*']);
            expect(attachments.map(source => heat(source.mountId))).toEqual([[], ['2*'], []]);
        }
    });

    it('prints a fighter MML with its Artemis line and its design ratings for both ammunition families', async () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.setTonnage(50);
        const mml = addTestEquipment(entity, new WeaponEquipment({ id: 'ISMML7', name: 'MML 7', type: 'weapon',
            flags: ['F_MISSILE', 'F_ARTEMIS_COMPATIBLE'],
            weapon: { heat: 4, ammoType: 'MML', rackSize: 7, av: [4, 4, 4, 0], ranges: [6, 7, 14, 21] } }), { location: 'Nose' });
        const artemis = addTestEquipment(entity, new MiscEquipment({ id: 'ISArtemisIV', name: 'Artemis IV FCS', type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS'] }), { location: 'Nose' });
        entity.linkEquipment(artemis, mml);
        // Only the LRM bin carries Artemis missiles, but both sheet rows show the mounted system's rating (TW p. 303).
        for (const [id, flag, munition] of [['IS Ammo MML-7 LRM Artemis-capable', 'F_MML_LRM', 'M_ARTEMIS_CAPABLE'],
            ['IS Ammo MML-7 SRM', 'F_MML_SRM', 'M_STANDARD']] as const) {
            addTestEquipment(entity, new AmmoEquipment({ id, name: id, type: 'ammo', flags: [flag],
                ammo: { type: 'MML', rackSize: 7, shots: 17, munitionType: [munition] } }), { location: 'Fuselage' });
        }
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${mml.mountId}"]`)!;
        const values = (line: Element) => ['range_short', 'range_medium', 'range_long', 'range_extreme']
            .map(field => line.querySelector(`:scope > .${field}`)?.textContent);
        const modes = [...row.querySelectorAll(':scope > .alternativeMode')];

        // An MML 7 with Artemis IV is rated 6 with LRM ammunition and 12 with SRM ammunition.
        expect(row.querySelector(':scope > .quantity')).toBeNull();
        expect(row.querySelector(':scope > .inventoryEntry.linked > .name')?.textContent).toBe('w/Artemis IV');
        expect(modes.map(mode => mode.querySelector('.name')?.textContent)).toEqual(['LRM', 'SRM']);
        expect(values(modes[0])).toEqual(['6', '6', '6', '—']);
        expect(values(modes[1])).toEqual(['12', '—', '—', '—']);
        expect(svg.querySelector('.inventoryEntry .name')?.textContent).not.toContain('Artemis IV FCS [E]');
    });

    it('prints an insulated chemical laser with its lower heat and its insulator on a fighter sheet', async () => {
        // TO:AUE p. 134: laser insulators fit chemical lasers too, which are not F_LASER weapons.
        const entity = new TestAeroSpaceFighterEntity();
        entity.setTonnage(50);
        const weapon = addTestEquipment(entity, new WeaponEquipment({ id: 'CLMediumChemLaser', name: 'Medium Chem Laser',
            type: 'weapon', flags: ['F_ENERGY'], weapon: { damage: 5, heat: 2, ammoType: 'CHEMICAL_LASER', ranges: [3, 6, 9, 12] } }),
        { location: 'Nose' });
        const insulator = addTestEquipment(entity, new MiscEquipment({ id: 'ISLaserInsulator', name: 'Laser Insulator', type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'] }), { location: 'Nose' });
        entity.linkEquipment(insulator, weapon);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const heat = (id: string) => [...svg.querySelectorAll(`.inventoryEntry[data-mekbay-component-ids="${id}"] > .heat`)]
            .map(field => field.textContent);
        expect(heat(weapon.mountId)).toEqual(['1*']);
        expect(heat(insulator.mountId)).toEqual([]);
    });

    it('prints a fighter PPC capacitor line with the charged values, 5 more at each range (TO:AUE p. 149)', async () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.setTonnage(50);
        const ppc = addTestEquipment(entity, new WeaponEquipment({ id: 'ISERPPC', name: 'ER PPC', type: 'weapon',
            flags: ['F_ENERGY', 'F_DIRECT_FIRE', 'F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
            weapon: { damage: 10, heat: 15, av: [10, 10, 10, 0], ranges: [0, 7, 14, 23] } }), { location: 'Left Wing' });
        const capacitor = addTestEquipment(entity, new MiscEquipment({ id: 'ISPPCCapacitor', name: 'PPC Capacitor',
            type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR'] }), { location: 'Left Wing' });
        entity.linkEquipment(capacitor, ppc);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        const values = (line: Element | null) => ['heat', 'range_short', 'range_medium', 'range_long', 'range_extreme']
            .map(field => line?.querySelector(`:scope > .${field}`)?.textContent);
        const row = svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${ppc.mountId}"]`)!;

        expect(values(row)).toEqual(['15', '10', '10', '10', '—']);
        expect(values(row.querySelector(':scope > .inventoryEntry.linked'))).toEqual(['20', '15', '15', '15', '—']);
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
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
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
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
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
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
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
        const artemis = addTestEquipment(entity, new MiscEquipment({ id: 'CLArtemisV', name: 'Artemis V FCS', type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'] }), { location: 'TU' });
        entity.linkEquipment(artemis, launcher);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
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
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const cargo = svg.querySelector('.vehicle-cargo')!;

        expect([...cargo.querySelectorAll('text')].map(text => text.textContent)).toEqual([
            'Cargo:', 'Bay 1: Cargo (4) (1 Door)', 'Bay 2: Liquid Cargo (45.5) (1 Door)',
        ]);
        expect(cargo.querySelector('.inventoryEntry')).toBeNull();
        expect(cargo.textContent).not.toContain('Quarters');
    });

    it('prints Oppie engineering-tool damage using the existing physical-weapon rules', async () => {
        const entity = new TestSupportTankEntity();
        const backhoe = addTestEquipment(entity, createEquipment({ id: 'Backhoe', name: 'Backhoe', type: 'misc',
            flags: ['F_CLUB', 'S_BACKHOE'] }), { location: 'RR' });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });

        expect(svg.querySelector(`.inventoryEntry[data-mekbay-component-ids="${backhoe.mountId}"] .damage`)?.textContent).toBe('6');
    });
});
