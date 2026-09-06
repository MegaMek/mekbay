// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, createEquipment } from '../../../models/equipment.model';
import { MountedArmor } from '../../../models/entity/components/armor';
import { MountedEngine } from '../../../models/entity/components/engine';
import { TestConvFighterEntity, TestFixedWingSupportEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('fixed-wing support record-sheet presentation', () => {
    it('renders Boomerang identity and feature footer without inventing bomb capacity or inventory components', async () => {
        const entity = new TestFixedWingSupportEntity();
        entity.chassis.set('Boomerang Spotter Plane');
        entity.setTonnage(4.999);
        entity.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 1, techBase: 'IS' }));
        entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({ id: 'BAR 2 Armor', name: 'BAR 2 Armor',
            type: 'armor', armor: { type: 'SV_BAR_2', bar: 2 }, tech: { base: 'All' } }) }));
        const camera = addTestEquipment(entity, createEquipment({ id: 'Recon Camera', name: 'Recon Camera', type: 'misc' }), { location: 'Nose' });
        const modifications = ['Propeller-Driven', 'Ultra-Light', 'STOL'].map(name =>
            addTestEquipment(entity, createEquipment({ id: name, name, shortName: name, type: 'misc',
                flags: ['F_CHASSIS_MODIFICATION'] }), { location: 'Body' }));
        entity.transporters.set([
            { id: 'seat', kind: 'bay', configuration: { type: 'ejection-seats' }, capacity: 1, doors: 0, bayNumber: 0, omni: false },
            { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 0.013, doors: 0, bayNumber: 0, omni: false },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity);

        expect(svg.textContent).toContain('FIXED WING SUPPORT VEHICLE RECORD SHEET');
        expect(svg.getElementById('tonnage')?.textContent).toBe('4,999 kg');
        expect(svg.getElementById('tonnage')?.getAttribute('data-mekbay-weight-unit')).toBe('kg');
        expect(svg.getElementById('engineType')?.textContent).toBe('ICE');
        expect(svg.getElementById('armorType')?.textContent).toBe('BAR: 2');
        expect(svg.querySelector('.aero-external-stores')).toBeNull();
        expect([...svg.querySelectorAll('.aero-features text')].map(text => text.textContent).join(' '))
            .toBe('Features Propeller-Driven, Ultra-Light, STOL Chassis Mods, 1 Ejection Seat, Cargo (13 kg)');
        expect(svg.querySelectorAll('.inventoryEntry').length).toBe(1);
        expect(svg.querySelector('.inventoryEntry')?.textContent).toContain('Recon Camera [E]');
        expect(svg.querySelector('.inventoryEntry')?.getAttribute('data-mekbay-component-ids')).toBe(camera.mountId);
        for (const mount of modifications) expect(svg.querySelector(`[data-mekbay-component-ids="${mount.mountId}"]`)).toBeNull();
    });

    it('uses installed fixed-wing hardpoints as external-store capacity', async () => {
        const entity = new TestFixedWingSupportEntity();
        entity.setTonnage(50);
        for (let index = 0; index < 3; index++) addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT', { location: 'Wings' });
        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.querySelectorAll('.bombBox').length).toBe(3);
        expect(svg.querySelectorAll('.inventoryEntry').length).toBe(0);
        expect(svg.getElementById('tonnage')?.textContent).toBe('50');
    });

    it('preserves conventional-fighter mass, title and tonnage-derived bomb capacity', async () => {
        const entity = new TestConvFighterEntity();
        entity.setTonnage(20);
        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.textContent).toContain('CONVENTIONAL FIGHTER RECORD SHEET');
        expect(svg.getElementById('tonnage')?.textContent).toBe('20');
        expect(svg.querySelectorAll('.bombBox').length).toBe(4);
        expect(svg.querySelector('.aero-features')).toBeNull();
    });
});
