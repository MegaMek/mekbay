// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from '../../../models/entity/entity-identifiers';
import { TestHandheldWeaponEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { planRecordSheetPages } from '../record-sheet-layout';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { HandheldWeaponRecordSheetLayout, renderHandheldWeaponAmmoPips } from './handheld-weapon-record-sheet-layout';

describe('HandheldWeaponRecordSheetLayout', () => {
    const layout = new HandheldWeaponRecordSheetLayout();

    it('generates the short inventory/armor/ammo strip with the live GUN and component contracts', async () => {
        const entity = new TestHandheldWeaponEntity();
        entity.chassis.set('AP Gauss Weapon');
        entity.model.set('(3 Tons)');
        entity.setTonnage(3);
        entity.setArmorValue('Gun', 'front', 8);
        const weapon = addTestEquipment(entity, new WeaponEquipment({ id: 'AP Gauss', name: 'AP Gauss Rifle', type: 'weapon',
            weapon: { damage: 3, heat: 1, ranges: [3, 6, 9] } }), { location: 'Gun' });
        addAmmo(entity, 'AP Gauss Rifle', 40);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

        expect(svg.dataset['mekbayLayout']).toBe('handheld-weapon');
        expect(Number(svg.getAttribute('height'))).toBeCloseTo(74.534, 3);
        expect(svg.querySelectorAll('.armor.pip[data-loc="GUN"]').length).toBe(8);
        expect(svg.querySelectorAll('.ammo.pip').length).toBe(40);
        expect(svg.querySelector('#type')?.textContent).toBe('AP Gauss Weapon (3 Tons)');
        expect(svg.querySelector('#type')?.parentElement?.textContent).toBe('AP Gauss Weapon (3 Tons) (3 tons)');
        expect(svg.querySelector('.inventoryEntry')?.getAttribute('data-mekbay-component-ids')).toBe(weapon.mountId);
        expect(svg.querySelector('.inventoryEntry .range_long')?.textContent).toBe('9');
        expect(svg.querySelector('.inventoryEntry .location')?.textContent).toBe('GUN');
        expect(svg.querySelector('.inventoryEntry .lngButton')).not.toBeNull();
        expect(svg.querySelector('.mek-paperdolls, .vehicle-paperdoll, #crewName0')).toBeNull();
    });

    it('uses MML large-strip thresholds for armor, distinct weapons and ammunition', () => {
        const entity = new TestHandheldWeaponEntity();
        entity.setArmorValue('Gun', 'front', 65);
        expect(layout.profile(entity).height).toBeCloseTo(74.534, 3);
        entity.setArmorValue('Gun', 'front', 66);
        expect(layout.profile(entity).height).toBe(149.06);
        entity.setArmorValue('Gun', 'front', 0);
        addAmmo(entity, 'AC/5', 125);
        expect(layout.profile(entity).height).toBeCloseTo(74.534, 3);
        addAmmo(entity, 'AC/10', 1);
        expect(layout.profile(entity).height).toBe(149.06);

        const weapons = new TestHandheldWeaponEntity();
        for (let index = 0; index < 3; index++) addTestEquipment(weapons, new WeaponEquipment({
            id: `weapon ${index}`, name: `Weapon ${index}`, type: 'weapon',
            weapon: { damage: 5, heat: 3, ranges: [3, 6, 9] },
        }), { location: 'Gun' });
        expect(layout.profile(weapons).height).toBe(149.06);
    });

    it('packs nine standard strips or four large plus one standard strip on one page', () => {
        const standard = new TestHandheldWeaponEntity();
        const large = new TestHandheldWeaponEntity();
        large.setArmorValue('Gun', 'front', 66);
        const standardPages = planRecordSheetPages(Array.from({ length: 10 }, () => standard), unit => layout.profile(unit));
        expect(standardPages.map(page => page.items.length)).toEqual([9, 1]);
        const mixedPages = planRecordSheetPages([large, large, large, large, standard, standard], unit => layout.profile(unit));
        expect(mixedPages.map(page => page.items.length)).toEqual([5, 1]);
        expect(layout.profile(standard, 'a4').width).toBeCloseTo(559.276, 3);
    });

    it('keeps spent ammo pips and their labels current without replacing the generated strip', async () => {
        const entity = new TestHandheldWeaponEntity();
        const mount = addAmmo(entity, 'AC/5', 20);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const originalPip = svg.querySelector('.ammo.pip');
        const component = { componentId: asComponentId(mount.mountId), equipmentId: 'AC/5 Ammo', label: 'AC/5 Ammo',
            sheetLocations: ['GUN'], status: 'available', previewStatus: 'available',
            ammo: { displayName: 'AC/5 Ammo', capacity: 20, remaining: 13 } } as const;

        expect(renderHandheldWeaponAmmoPips(svg, [component])).toBeTrue();
        expect(svg.querySelectorAll('.ammo.pip.damaged').length).toBe(7);
        expect(svg.querySelector('#ammoLabel')?.textContent).toBe('Ammo (13):');
        expect(svg.querySelector('.ammo.pip')).toBe(originalPip);
        renderHandheldWeaponAmmoPips(svg, [{ ...component, ammo: { ...component.ammo, remaining: 20 } }]);
        expect(svg.querySelectorAll('.ammo.pip.damaged').length).toBe(0);
    });

    it('preserves each ammunition type and emits no artificial pips for unarmored energy weapons', async () => {
        const entity = new TestHandheldWeaponEntity();
        addAmmo(entity, 'AC/5', 20);
        addAmmo(entity, 'LRM 5', 24);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        expect(svg.querySelectorAll('.handheld-ammo-label').length).toBe(2);
        expect(svg.querySelectorAll('.ammo.pip').length).toBe(44);
        expect(svg.querySelectorAll('.armor.pip').length).toBe(0);
        const empty = await RecordSheetSvgGenerator.generate(new TestHandheldWeaponEntity(), { format: 'compact' });
        expect(empty.querySelectorAll('.pip').length).toBe(0);
    });

    it('embeds one editable masthead artwork definition on a composed page', async () => {
        const entity = new TestHandheldWeaponEntity();
        const blocks = await Promise.all([entity, entity].map(unit =>
            RecordSheetSvgGenerator.generate(unit, { format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks);
        expect(page.querySelectorAll('#mekbay-handheld-weapon-masthead-art').length).toBe(1);
        expect(page.querySelector('#mekbay-handheld-weapon-masthead-art path')).not.toBeNull();
        expect(page.querySelector('.handheld-weapon-masthead-icon')?.getAttribute('href'))
            .toBe('#mekbay-handheld-weapon-masthead-art');
        expect(page.querySelector('.handheld-weapon-masthead-icon')?.tagName).toBe('use');
        expect(page.textContent).toContain('HANDHELD WEAPONS');
        expect(page.textContent).not.toContain('HANDHELD WEAPON RECORD SHEET');
    });

    it('prints a cluster table only when the handheld weapon uses cluster hits', async () => {
        const gauss = new TestHandheldWeaponEntity();
        addTestEquipment(gauss, new WeaponEquipment({ id: 'AP Gauss', name: 'AP Gauss Rifle', type: 'weapon',
            weapon: { damage: 3, ranges: [3, 6, 9] } }), { location: 'Gun' });
        const plain = await RecordSheetSvgGenerator.generate(gauss);
        expect(plain.querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();

        const missile = new TestHandheldWeaponEntity();
        addTestEquipment(missile, new WeaponEquipment({ id: 'SRM 2', name: 'SRM 2', type: 'weapon',
            flags: ['F_MISSILE'], weapon: { damage: '2/Msl', rackSize: 2, ammoType: 'SRM', ranges: [3, 6, 9] } }), { location: 'Gun' });
        const cluster = await RecordSheetSvgGenerator.generate(missile);
        expect(cluster.querySelector('[data-mekbay-reference="cluster-hits"]')).not.toBeNull();
        expect(cluster.querySelector('[data-cluster-rack="2"]')).not.toBeNull();
    });

    function addAmmo(entity: TestHandheldWeaponEntity, name: string, rounds: number) {
        return addTestEquipment(entity, new AmmoEquipment({ id: `${name} Ammo`, name: `${name} Ammo`, type: 'ammo',
            ammo: { type: 'AC', shots: rounds, rackSize: 5 } }), { location: 'Gun', shotsCount: rounds });
    }
});
