// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestJumpShipEntity, TestSpaceStationEntity, TestWarShipEntity } from '../../models/entity/testing/test-entities';
import { PaperdollGenerator } from './paperdoll-generator';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('capital-vessel record sheet grids', () => {
    for (const Family of [TestJumpShipEntity, TestWarShipEntity, TestSpaceStationEntity]) {
        for (const pipLayout of ['classic', 'distributed', 'rail'] as const) {
            it(`${Family.name}: always renders square blocks in ${pipLayout} mode`, async () => {
                const entity = new Family();
                entity.setTonnage(460_000);
                entity.structuralIntegrity.set(150);
                for (const code of entity.armorLocations) entity.setArmorValue(code, 'front', 1_000);

                const sheet = await RecordSheetSvgGenerator.generate(entity, { pipLayout });
                const paperdoll = sheet.querySelector('[data-mekbay-paperdoll]')!;
                expect(paperdoll).not.toBeNull();
                expect(paperdoll.querySelector('.pip.armor, .pip.structure')).toBeNull();
                for (const location of entity.damageLocations()) {
                    const code = location.sheetCode ?? location.code;
                    for (const [kind, count] of [
                        ['armor', location.armor.front + location.armor.rear],
                        ['structure', location.internalPoints],
                    ] as const) {
                        if (count <= 0) continue;
                        const grid = paperdoll.querySelector(`.capital-pip-grid.${kind}[data-loc="${code}"]`)!;
                        expect(grid).withContext(`${kind} ${code}`).not.toBeNull();
                        const blocks = [...grid.querySelectorAll<SVGGElement>('.capital-pip-block')];
                        const counts = blocks.map(block => Number(block.dataset['pipBlockCount']));
                        expect(counts.reduce((sum, value) => sum + value, 0)).toBe(count);
                        expect(counts.every(value => value > 0 && value <= 100)).toBeTrue();
                        if (kind === 'armor') expect(counts).toEqual(Array(10).fill(100));
                        for (const block of blocks) {
                            const backdrop = block.querySelector<SVGElement>('.capital-pip-backdrop')!;
                            expect(backdrop.matches(`.unitLocation.${kind}[data-loc="${code}"]`)).toBeTrue();
                            expect(backdrop.getAttribute('pointer-events')).toBe('all');
                            expect(block.querySelectorAll('.capital-pip-state')).toHaveSize(5);
                            expect(block.querySelector('.capital-pip-shadow')?.getAttribute('d')).not.toBe('');
                            expect(block.querySelector('.capital-pip-grid-lines')?.getAttribute('d')).not.toBe('');
                        }
                    }
                }
                // The clipped ship hull remains selectable; table gaps have no rectangular target.
                expect(paperdoll.querySelector('.unitLocation.armor[clip-path]')).not.toBeNull();
                expect(paperdoll.querySelector('.unitLocation.armor:not([clip-path]):not(.capital-pip-backdrop)')).toBeNull();
            });
        }
    }

    it('keeps partial armor blocks and integrity rows at their exact point counts', async () => {
        const paperdoll = await PaperdollGenerator.createPaperdoll('/images/paperdolls/warship.svg', 344, 450, {
            armor: { NOS: 101 }, structure: { SI: 150, KF: 46, SAIL: 9, DC: 20 },
        }, { pipLayout: 'capital-grid' });
        for (const [code, counts] of [
            ['NOS', [100, 1]], ['SI', [75, 75]], ['KF', [23, 23]], ['SAIL', [9]], ['DC', [10, 10]],
        ] as const) {
            const blocks = [...paperdoll.querySelectorAll<SVGGElement>(`.capital-pip-grid[data-loc="${code}"] .capital-pip-block`)];
            expect(blocks.map(block => Number(block.dataset['pipBlockCount']))).withContext(code).toEqual([...counts]);
        }
    });

    it('still uses square grids when capital artwork cannot be loaded', async () => {
        spyOn(PaperdollGenerator, 'createPaperdoll').and.rejectWith(new Error('Artwork unavailable'));
        const entity = new TestWarShipEntity();
        entity.setArmorValue('Nose', 'front', 101);
        entity.structuralIntegrity.set(150);
        const sheet = await RecordSheetSvgGenerator.generate(entity, { pipLayout: 'rail' });
        expect(sheet.querySelector('.capital-pip-grid.armor[data-loc="NOS"]')).not.toBeNull();
        expect(sheet.querySelector('.capital-pip-grid.structure[data-loc="SI"]')).not.toBeNull();
        expect(sheet.querySelector('.pip.armor, .pip.structure')).toBeNull();
    });
});
