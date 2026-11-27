// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity, TestQuadMekEntity } from '../../models/entity/testing/test-entities';
import { gameRulesFor } from '../../models/rules/game-rules';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('printed Mek reference tables per ruleset', () => {
    // The sheet must print the table the runtime reads for a biped punch or kick (attack-hit-location.ts).
    // Front/rear punch roll 1: TW Left Arm, Core Right Arm (Core p.81 Punch Location Table).
    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        it(`prints the ${ruleset} biped punch/kick location table`, async () => {
            const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity(), { ruleset });
            const table = svg.querySelector<SVGGElement>('[data-mekbay-reference="mek-punch-kick"]')!;
            const printed = [1, 2, 3, 4, 5, 6].map(roll => Array.from(table.querySelectorAll(
                `.reference-table-row[data-mekbay-reference-roll="${roll}"] .reference-table-cell`,
            )).map(node => node.textContent));

            expect(printed).toEqual(gameRulesFor(ruleset).physicalLocationRows.map(row => [
                String(row.roll),
                row.punchLeftSide, row.punchFrontRear, row.punchRightSide,
                row.kickLeftSide, row.kickFrontRear, row.kickRightSide,
            ]));
        });
    }

    it('prints quad legs as the rulebooks abbreviate them, mirroring the front/rear punch column under Core', async () => {
        const frontRearPunch = async (ruleset: 'total-warfare' | 'core-2026') => {
            const svg = await RecordSheetSvgGenerator.generate(new TestQuadMekEntity(), { ruleset });
            return [1, 2, 4, 5].map(roll => svg.querySelectorAll(`[data-mekbay-reference="mek-punch-kick"] `
                + `.reference-table-row[data-mekbay-reference-roll="${roll}"] .reference-table-cell`)[2]?.textContent);
        };
        // TW p.145 and Core p.239, four-legged punch Front/Rear rolls 1, 2, 4 and 5.
        expect(await frontRearPunch('total-warfare')).toEqual(['LFL/LRL', 'LT', 'RT', 'RFL/RRL']);
        expect(await frontRearPunch('core-2026')).toEqual(['RFL/RRL', 'RT', 'LT', 'LFL/LRL']);
    });
});
