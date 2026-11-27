// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestAeroSpaceFighterEntity, TestBipedMekEntity, TestTankEntity, TestWarShipEntity } from '../../models/entity/testing/test-entities';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';
import { appendHeatSinkData, svgElement } from './record-sheet-svg-rendering';

describe('record sheet data panels', () => {
    it('prints an unset role as the same dash on every family template', async () => {
        for (const entity of [new TestBipedMekEntity(), new TestTankEntity(), new TestAeroSpaceFighterEntity(), new TestWarShipEntity()]) {
            const sheet = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
            expect(sheet.querySelector('#role')?.textContent).withContext(entity.entityType).toBe('—');
        }
    });

    it('prints laser heat sinks doubled too, since they are double heat sinks', () => {
        const group = svgElement('g');
        appendHeatSinkData(group, { count: 12, type: 'Laser' }, { x: value => value, y: value => value, font: value => value },
            { rightX: 100, pipsX: 10 });
        expect(group.querySelector('#hsCount')?.textContent).toBe('12 (24)');
    });

    it('prints aerospace double heat sinks as "N (2N)", as MegaMekLab does', async () => {
        const mek = new TestBipedMekEntity();
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.heatSinkType.set('Double');
        fighter.heatSinkCount.set(10);
        const fighterSheet = await RecordSheetSvgGenerator.generate(fighter, { ruleset: 'total-warfare' });
        expect(fighterSheet.querySelector('#hsCount')?.textContent).toBe('10 (20)');
        expect(fighterSheet.querySelectorAll('.hsPips .pip').length).toBe(30);
        expect(fighterSheet.querySelectorAll('.hsPips .pip:not([style*="display: none"])').length).toBe(10);

        // Both panels draw the full pip grid so the binders can reveal a changed live count.
        const mekSheet = await RecordSheetSvgGenerator.generate(mek, { ruleset: 'total-warfare' });
        expect(mekSheet.querySelectorAll('.hsPips .pip').length).toBe(30);
    });
});
