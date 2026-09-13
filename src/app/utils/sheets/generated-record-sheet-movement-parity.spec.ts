// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { bindRecordSheetMovement } from '../../components/page-viewer/record-sheet-movement';
import { TestInfantryEntity } from '../../models/entity/testing/test-entities';
import type { RecordSheetMovementSelection } from '../../models/runtime/record-sheet-movement';
import { createUnitEditContextFixture } from '../../models/runtime/testing/unit-edit-context-fixture';
import { renderGeneratedRecordSheetControls } from './generated-record-sheet-controls';

describe('generated movement field identity', () => {
    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        it(`preserves adjacent movement values and binds every control in ${ruleset}`, () => {
            const host = document.createElement('div');
            host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
                <text id="movementPointsLabel" x="10" y="10">Movement Points:</text>
                <text id="mpWalk" x="10" y="20">3</text>
                <text id="mpRun" x="30" y="20">3</text>
                <text id="mpJump" x="50" y="20">0</text>
            </svg>`;
            const svg = host.querySelector('svg')!;
            const ids = ['movementPointsLabel', 'mpWalk', 'mpRun', 'mpJump'];
            const original = ids.map(id => svg.getElementById(id));
            renderGeneratedRecordSheetControls(svg, new TestInfantryEntity(), { ruleset });
            expect(ids.map(id => svg.getElementById(id))).toEqual(original);
            expect(ids.map(id => svg.getElementById(id)?.textContent)).toEqual(['Movement Points:', '3', '3', '0']);

            const selection: RecordSheetMovementSelection = {
                selectedMode: null, airborne: false,
                options: [
                    { mode: 'stationary', modifier: 0, legal: true, minimumMp: 0 },
                    { mode: 'walk', modifier: 1, legal: true, minimumMp: 0 },
                    { mode: 'run', modifier: 2, legal: true, minimumMp: 0 },
                    { mode: 'jump', modifier: 3, legal: false, minimumMp: 0 },
                ],
            };
            const abort = new AbortController();
            const editContext = createUnitEditContextFixture();
            const render = bindRecordSheetMovement(svg, () => selection, () => editContext(0), abort.signal);
            expect(() => render(selection)).not.toThrow();
            for (const id of ids.slice(1)) {
                expect(svg.querySelector(`[data-mekbay-movement-control="${id}"]`)).not.toBeNull();
            }
            expect(() => abort.abort()).not.toThrow();
        });
    }
});
