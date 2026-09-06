// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment, createEquipment } from '../../../models/equipment.model';
import { TestBipedMekEntity, TestQuadVeeEntity, TestSupportTankEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../../models/entity/testing/test-equipment-registry';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { recordSheetInventoryMountName } from '../record-sheet-inventory-equipment';

describe('record-sheet inventory content parity', () => {
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
