// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';
import {
    drawRecordSheetInventory,
    groupRecordSheetWeaponRows,
    isRegroupingInventoryRow,
    regroupRecordSheetInventory,
} from './record-sheet-weapon-grouping';

describe('record-sheet weapon grouping', () => {
    const row = (id: string, name: string, mountKey?: string, linked?: string) => ({
        name,
        componentIds: [id],
        ...(mountKey === undefined ? {} : { mountKey }),
        linkedEquipment: linked === undefined ? null : { name: 'Artemis IV', componentIds: [linked] },
    });

    it('counts identical weapons on one row and leaves other equipment uncounted, in place', () => {
        const rows = groupRecordSheetWeaponRows([
            row('a', 'Medium Laser', 'LA'),
            row('tc', 'Targeting Computer'),
            row('b', 'Medium Laser', 'LA'),
            row('c', 'Medium Laser', 'RA'),
            row('d', 'Small Laser', 'LA'),
        ], () => '');

        expect(rows.map(grouped => [grouped.quantity, grouped.name, grouped.componentIds.join(' ')])).toEqual([
            [2, 'Medium Laser', 'a b'],
            [undefined, 'Targeting Computer', 'tc'],
            [1, 'Medium Laser', 'c'],
            [1, 'Small Laser', 'd'],
        ]);
    });

    it('splits a design by live state, in state order, and keeps the enhancements with their weapons', () => {
        const states: Record<string, string> = { a: '1', b: '0', c: '1', d: '0', 'artemis-d': '3' };
        const rows = groupRecordSheetWeaponRows([
            row('a', 'LRM 10', 'LT', 'artemis-a'),
            row('b', 'LRM 10', 'LT', 'artemis-b'),
            row('c', 'LRM 10', 'LT', 'artemis-c'),
            row('d', 'LRM 10', 'LT', 'artemis-d'),
        ], componentId => states[componentId] ?? '0');

        expect(rows.map(grouped => [grouped.quantity, grouped.componentIds, grouped.linkedEquipment?.componentIds])).toEqual([
            [1, ['b'], ['artemis-b']],
            [1, ['d'], ['artemis-d']],
            [2, ['a', 'c'], ['artemis-a', 'artemis-c']],
        ]);
    });

    it('draws a grouped inventory again only when a weapon state changed', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const frame = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
        let drawn = 0;
        drawRecordSheetInventory(frame, true, (parent, stateKey) => {
            drawn++;
            for (const componentId of ['a', 'b']) {
                const entry = parent.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
                entry.setAttribute('class', 'inventoryEntry');
                entry.textContent = `${componentId}:${stateKey!(componentId)}`;
            }
        });
        const texts = () => [...svg.querySelectorAll('.inventoryEntry')].map(entry => entry.textContent);

        expect(texts()).toEqual(['a:', 'b:']);
        expect(isRegroupingInventoryRow(svg.querySelector('.inventoryEntry')!)).toBeTrue();
        expect(regroupRecordSheetInventory(svg, () => '')).toBeFalse();
        expect(regroupRecordSheetInventory(svg, componentId => componentId === 'b' ? 'hit' : '')).toBeTrue();
        expect(texts()).toEqual(['a:', 'b:hit']);
        expect(regroupRecordSheetInventory(svg, componentId => componentId === 'b' ? 'hit' : '')).toBeFalse();
        expect(drawn).toBe(2);
    });

    it('draws an ungrouped inventory straight into its parent', () => {
        const frame = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        drawRecordSheetInventory(frame, false, (parent, stateKey) => {
            expect(parent).toBe(frame);
            expect(stateKey).toBeNull();
            parent.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
        });
        expect(frame.querySelector('[data-mekbay-inventory-block]')).toBeNull();
        expect(isRegroupingInventoryRow(frame.firstElementChild!)).toBeFalse();
    });
});

describe('grouped Mek inventory', () => {
    const laser = new WeaponEquipment({
        id: 'ISMediumLaser', name: 'Medium Laser', type: 'weapon',
        weapon: { heat: 3, damage: 5, ranges: [3, 6, 9] },
    });

    function entity() {
        const mek = new TestBipedMekEntity();
        mek.setTonnage(50);
        const mounts = {
            left: [0, 1, 2].map(() => addTestEquipment(mek, laser, { location: 'LA' })),
            right: [addTestEquipment(mek, laser, { location: 'RA' })],
            front: addTestEquipment(mek, laser, { location: 'CT' }),
            rear: addTestEquipment(mek, laser, { location: 'CT', rearMounted: true }),
            computer: addTestEquipment(mek, new MiscEquipment({
                id: 'ISTargeting Computer', name: 'Targeting Computer', type: 'misc',
            }), { location: 'RT' }),
            hatchet: addTestEquipment(mek, new MiscEquipment({
                id: 'Hatchet', name: 'Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'],
            }), { location: 'RA' }),
        };
        return { mek, mounts };
    }

    const rows = (svg: SVGSVGElement) => [...svg.querySelectorAll<SVGElement>('.inventoryEntry[data-mekbay-component-ids]')]
        .map(entry => ({
            quantity: entry.querySelector(':scope > .quantity')?.textContent ?? null,
            name: entry.querySelector(':scope > .name')?.textContent ?? '',
            location: entry.querySelector(':scope > .location')?.textContent ?? '',
            weapons: entry.getAttribute('data-mekbay-component-ids')!.split(' ').length,
        }));

    it('keeps a row per weapon and no quantity column unless grouping is on', async () => {
        const { mek } = entity();
        const svg = await RecordSheetSvgGenerator.generate(mek, { ruleset: 'total-warfare' });

        expect(svg.querySelector('[data-mekbay-inventory-block]')).toBeNull();
        expect(svg.querySelector('.inventoryEntry .quantity')).toBeNull();
        expect(rows(svg).filter(row => row.name.startsWith('Medium Laser')).length).toBe(6);
    });

    it('counts identical weapons per location and facing, numbers melee weapons, and leaves equipment uncounted', async () => {
        const { mek } = entity();
        const svg = await RecordSheetSvgGenerator.generate(mek, { ruleset: 'total-warfare', groupWeapons: true });

        const printed = rows(svg);
        expect(printed.filter(row => row.name.startsWith('Medium Laser')).map(row =>
            [row.quantity, row.location, row.weapons])).toEqual(jasmine.arrayWithExactContents([
            ['3', 'LA', 3], ['1', 'RA', 1], ['1', 'CT', 1], ['1', 'CT', 1],
        ]));
        expect(printed.find(row => row.name === 'Targeting Computer')?.quantity).toBeNull();
        expect(printed.find(row => row.name === 'Hatchet')?.quantity).toBe('1');
        const block = svg.querySelector('[data-mekbay-inventory-block]')!;
        expect([...block.parentElement!.querySelectorAll(':scope > text')].some(text => text.textContent === '#')).toBeTrue();
    });

    it('splits a counted row as its weapons take states of their own, and rejoins them', async () => {
        const { mek, mounts } = entity();
        const svg = await RecordSheetSvgGenerator.generate(mek, { ruleset: 'total-warfare', groupWeapons: true });
        const leftArm = () => rows(svg).filter(row => row.name === 'Medium Laser' && row.location === 'LA')
            .map(row => row.quantity);
        const states = new Map<string, string>();
        const stateKey = (componentId: string) => states.get(componentId) ?? '0';

        states.set(mounts.left[0].mountId, '1 target A');
        states.set(mounts.left[1].mountId, '3 destroyed');
        expect(regroupRecordSheetInventory(svg, stateKey)).toBeTrue();
        expect(leftArm()).toEqual(['1', '1', '1']);

        states.set(mounts.left[1].mountId, '1 target A');
        expect(regroupRecordSheetInventory(svg, stateKey)).toBeTrue();
        expect(leftArm()).toEqual(['1', '2']);

        states.clear();
        expect(regroupRecordSheetInventory(svg, stateKey)).toBeTrue();
        expect(leftArm()).toEqual(['3']);
        expect(svg.querySelectorAll('#heatProfile').length).toBe(1);
        expect(svg.querySelectorAll('#ammoProfile').length).toBe(1);
    });
});
