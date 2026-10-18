// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { MountedArmor } from '../../../models/entity/components/armor';
import { TestSupportNavalEntity, TestSupportTankEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { compactVehicleSheetTitle } from './vehicle-record-sheet-components';

describe('naval record-sheet presentation', () => {
    it('prints no WiGE charge under either ruleset (shared vehicle charge eligibility)', async () => {
        const entity = new TestTankEntity();
        entity.motiveType.set('WiGE');
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact', ruleset });
            expect(svg.textContent?.includes('Charge')).withContext(ruleset).toBe(false);
        }
    });

    it('uses the selected ruleset for ground and naval charge descriptions', async () => {
        for (const entity of [new TestTankEntity(), new TestSupportNavalEntity()]) {
            entity.setTonnage(10);
            for (const ruleset of ['total-warfare', 'core-2026'] as const) {
                const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact', ruleset });
                const expected = ruleset === 'total-warfare' ? '1/hex' : '2×(TMM+1)';
                const excluded = ruleset === 'total-warfare' ? '2×(TMM+1)' : '1/hex';
                expect(svg.textContent).withContext(`${entity.entityType} ${ruleset}`).toContain(expected);
                expect(svg.textContent).not.toContain(excluded);
            }
        }
    });

    it('keeps one random-hit control and the surface hit contours on submarine art', async () => {
        const entity = new TestSupportNavalEntity();
        entity.setTonnage(100);
        entity.motiveType.set('Naval');
        const surface = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        entity.motiveType.set('Submarine');
        const submarine = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const surfaceArt = surface.querySelector<SVGGElement>('.vehicle-paperdoll-layer')!;
        const submarineArt = submarine.querySelector<SVGGElement>('.vehicle-paperdoll-layer')!;
        expect(surfaceArt).not.toBeNull();
        expect(submarineArt).not.toBeNull();
        for (const art of [surfaceArt, submarineArt]) {
            expect(art.querySelectorAll('[data-mekbay-random-hit]')).toHaveSize(1);
        }
        const contours = (art: SVGGElement): Array<string | null> =>
            [...art.querySelector('.naval-paperdoll-root')!.querySelectorAll('.unitLocation')]
                .map(path => path.getAttribute('d'));
        expect(contours(submarineArt)).toEqual(contours(surfaceArt));
    });

    it('renders the Small Steamer support title, kilogram weight, BAR rating and Notes panel', async () => {
        const entity = new TestSupportNavalEntity();
        entity.chassis.set('Small Steamer');
        entity.setTonnage(2.5);
        entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
            id: 'BAR 2 Armor', name: 'BAR 2 Armor', type: 'armor',
            armor: { type: 'SV_BAR_2', bar: 2 }, tech: { base: 'All' },
        }) }));
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });

        expect(svg.querySelector('.compact-vehicle-title')?.textContent).toBe('SMALL NAVAL SUPPORT VESSEL RECORD SHEET');
        expect(svg.getElementById('tonnage')?.textContent).toBe('2,500 kg');
        expect(svg.getElementById('tonnage')?.getAttribute('data-mekbay-weight-unit')).toBe('kg');
        expect(svg.getElementById('armorType')?.textContent).toBe('BAR: 2');
        expect(svg.querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
        expect([...svg.querySelectorAll('.svg-frame-title')].some(title => title.textContent === 'NOTES')).toBeTrue();
    });

    it('uses Naval for naval, hydrofoil and submarine support titles while preserving support sizes', () => {
        const entity = new TestSupportNavalEntity();
        entity.setTonnage(2.5);
        for (const motive of ['Naval', 'Hydrofoil', 'Submarine'] as const) {
            entity.motiveType.set(motive);
            expect(compactVehicleSheetTitle(entity, true)).withContext(motive)
                .toBe('SMALL NAVAL SUPPORT VESSEL RECORD SHEET');
        }
        entity.motiveType.set('Naval');
        entity.setTonnage(100);
        expect(compactVehicleSheetTitle(entity, true)).toBe('MEDIUM NAVAL SUPPORT VESSEL RECORD SHEET');
    });

    it('keeps cluster hit references when the naval vessel has a cluster weapon', async () => {
        const entity = new TestSupportNavalEntity();
        addTestEquipment(entity, new WeaponEquipment({ id: 'LRM 5', name: 'LRM 5', type: 'weapon',
            flags: ['F_LRM', 'F_MISSILE'], weapon: { damage: '1/Msl', rackSize: 5, ammoType: 'LRM', ranges: [7, 14, 21] },
        }), { location: 'Front' });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });

        expect(svg.querySelector('[data-mekbay-reference="cluster-hits"]')).not.toBeNull();
    });

    it('prints Small Steamer seat capacities as passenger counts and retains its available Charge', async () => {
        const entity = new TestSupportNavalEntity();
        entity.chassis.set('Small Steamer');
        entity.setTonnage(2.5);
        entity.originalWalkMP.set(2);
        entity.transporters.set([
            { id: 'pillion-a', kind: 'bay', configuration: { type: 'pillion-seats' }, capacity: 10, doors: 0, bayNumber: 0, omni: false },
            { id: 'standard', kind: 'bay', configuration: { type: 'standard-seats' }, capacity: 1, doors: 0, bayNumber: 0, omni: false },
            { id: 'pillion-b', kind: 'bay', configuration: { type: 'pillion-seats' }, capacity: 11, doors: 0, bayNumber: 0, omni: false },
        ]);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'core-2026', format: 'compact' });
        expect(svg.textContent).toContain('Features 1 Standard Seat, 21 Pillion Seats');
        expect(svg.textContent).toContain('Charge');
        expect(svg.textContent).toContain('0.5×(TMM+1)');
        expect(svg.querySelector('.vehicle-cargo')).toBeNull();
    });

    it('limits kilogram labels to small support vehicles and retains standard armor names', async () => {
        const support = new TestSupportTankEntity();
        const combat = new TestTankEntity();
        support.setTonnage(5);
        combat.setTonnage(2.5);
        for (const entity of [support, combat]) {
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
            expect(svg.getElementById('tonnage')?.textContent).toBe(String(entity.tonnage()));
            expect(svg.querySelector('[data-mekbay-weight-unit="kg"]')).toBeNull();
            expect(svg.getElementById('armorType')?.textContent).toBe('Standard Armor');
        }
    });
});
