// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { MountedArmor } from '../../../models/entity/components/armor';
import { TestSupportNavalEntity, TestSupportTankEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { compactVehicleSheetTitle } from './vehicle-record-sheet-components';

describe('naval record-sheet presentation', () => {
    it('updates submarine art bounds and random-button framing without changing the contour geometry', async () => {
        const entity = new TestSupportNavalEntity();
        entity.setTonnage(100);
        entity.motiveType.set('Naval');
        const surface = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        entity.motiveType.set('Submarine');
        const submarine = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        const surfaceArt = surface.querySelector<SVGGElement>('.vehicle-paperdoll-layer')!;
        const submarineArt = submarine.querySelector<SVGGElement>('.vehicle-paperdoll-layer')!;
        expect(surfaceArt).not.toBeNull();
        expect(submarineArt).not.toBeNull();
        const surfaceRoot = surfaceArt.querySelector<SVGGElement>('.naval-paperdoll-root')!;
        const submarineRoot = submarineArt.querySelector<SVGGElement>('.naval-paperdoll-root')!;
        const normalTransform = surfaceRoot.transform.baseVal.consolidate()!.matrix;
        const submarineTransform = submarineRoot.transform.baseVal.consolidate()!.matrix;
        expect(submarineTransform.a).toBeCloseTo(0.95, 6);
        expect(submarineTransform.d).toBeCloseTo(0.95, 6);
        expect(submarineTransform.e).toBeCloseTo(9, 6);
        expect(submarineTransform.f).toBeCloseTo(35, 6);
        const original = artBounds(surfaceArt);
        const adjusted = artBounds(submarineArt);
        const scale = 0.95 / normalTransform.a;
        // Compare the same authored center before and after the naval-to-submarine root replacement.
        const originalCenterX = original.x + original.width / 2;
        const originalCenterY = original.y + original.height / 2;
        expect(adjusted.x + adjusted.width / 2)
            .toBeCloseTo((originalCenterX - normalTransform.e) * scale + 9, 3);
        expect(adjusted.y + adjusted.height / 2)
            .toBeCloseTo((originalCenterY - normalTransform.f) * scale + 35, 3);
        expect(adjusted.width).toBeCloseTo(original.width * scale, 3);
        expect(adjusted.height).toBeCloseTo(original.height * scale, 3);

        for (const art of [surfaceArt, submarineArt]) {
            const buttons = art.querySelectorAll<SVGGElement>('[data-mekbay-random-hit]');
            expect(buttons).toHaveSize(1);
            const button = buttons[0].transform.baseVal.consolidate()!.matrix;
            expect(button.e).toBeCloseTo(Number(art.dataset['width']) - 28, 3);
            expect(button.f).toBe(1);
            expect(button.a).toBeCloseTo(0.9, 6);
        }
        const contours = (root: SVGGElement): Array<string | null> =>
            [...root.querySelectorAll('.unitLocation')].map(path => path.getAttribute('d'));
        expect(contours(submarineRoot)).toEqual(contours(surfaceRoot));
    });

    it('renders the Small Steamer support title, kilogram weight, BAR rating and Notes panel', async () => {
        const entity = new TestSupportNavalEntity();
        entity.chassis.set('Small Steamer');
        entity.setTonnage(2.5);
        entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
            id: 'BAR 2 Armor', name: 'BAR 2 Armor', type: 'armor',
            armor: { type: 'SV_BAR_2', bar: 2 }, tech: { base: 'All' },
        }) }));
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

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
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });

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
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
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
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            expect(svg.getElementById('tonnage')?.textContent).toBe(String(entity.tonnage()));
            expect(svg.querySelector('[data-mekbay-weight-unit="kg"]')).toBeNull();
            expect(svg.getElementById('armorType')?.textContent).toBe('Standard Armor');
        }
    });
});

function artBounds(layer: SVGGElement): { x: number; y: number; width: number; height: number } {
    return {
        x: Number(layer.dataset['artX']),
        y: Number(layer.dataset['artY']),
        width: Number(layer.dataset['artWidth']),
        height: Number(layer.dataset['artHeight']),
    };
}
