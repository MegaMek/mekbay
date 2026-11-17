// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../../models/mek-sheet-binding';
import { projectMekRecordSheet } from '../../models/runtime/mek-record-sheet';
import { buildMekRuntimeIndex } from '../../models/runtime/mek-runtime-index';
import { createMekMechanicsContextV2 } from '../../models/runtime/mek-mechanics-context-v2';
import { createMekHeatContextV2 } from '../../models/runtime/mek-heat-state-v2';
import { createDirectMekRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { createMekRuntimeForTest } from '../../models/runtime/testing/unit-runtime-owner-fixture';
import { RecordSheetSvgGenerator } from '../../utils/sheets/record-sheet-svg-generator';
import { bindMekRecordSheet } from './mek-record-sheet-binder';

const CELLS = ['name', 'location', 'heat', 'damage', 'range_min', 'range_short', 'range_medium', 'range_long'];

/** A bound generated sheet's inventory: the bound rows' names and every slotless row's cells. */
async function boundInventory(slotless: boolean) {
    const fixture = createDirectMekRuntimeFixture('total-warfare');
    const { entity } = fixture;
    entity.hasFullHeadEjectionSystem.set(slotless);
    entity.hasRiscHeatSinkOverrideKit.set(slotless);
    const index = buildMekRuntimeIndex(entity);
    const unit = createMekRuntimeForTest('slotless-inventory', fixture.initialized.baselineRef,
        entity, index, 'total-warfare', fixture.initialized.state, fixture.initialized.deployment.crewAssignment,
        createMekHeatContextV2(entity, index, 'total-warfare', { id: 'megamek' }),
        createMekMechanicsContextV2(entity, index, 'total-warfare', { id: 'megamek' }));
    const snapshot = () => ({
        ...projectMekRecordSheet(entity, index, 'total-warfare', unit.snapshot(), unit.query(),
            { revision: 0, targets: [] }, null, false, {}),
        editContext: { owner: unit, state: unit.snapshot() },
    });
    const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
    document.body.append(svg);
    const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot());
    try {
        binding.render(snapshot());
        const features = [...svg.querySelectorAll<SVGElement>('.inventoryFeature')];
        return {
            rows: [...svg.querySelectorAll<SVGElement>('.inventoryEntry:not(.linked)')]
                .filter(row => row.style.display !== 'none' && row.getAttribute('display') !== 'none')
                .map(row => row.querySelector(':scope > .name')?.textContent),
            features: features.map(row => CELLS.map(cell => row.querySelector(`:scope > .${cell}`)?.textContent)),
            featuresBound: features.some(row => row.hasAttribute('data-mekbay-component-ids')
                || row.querySelector('.inventoryEntryButton') !== null || row.style.display === 'none'),
        };
    } finally {
        binding.destroy();
        svg.remove();
    }
}

describe('generated Mek inventory of slotless equipment', () => {
    it('lists the Full-Head Ejection System and RISC override kit as rows the binding leaves alone', async () => {
        const plain = await boundInventory(false);
        const fitted = await boundInventory(true);

        expect(plain.features).toEqual([]);
        expect(fitted.features).toEqual([
            ['Full Head Ejection System', 'HD', '—', '[E]', '—', '—', '—', '—'],
            ['RISC Heat Sink Override Kit', '—', '—', '[E]', '—', '—', '—', '—'],
        ]);
        // The cells above are read after binding: an inventory entry without components would have been
        // overwritten with an attack's text, since the binding fills such rows in order.
        expect(fitted.featuresBound).toBeFalse();
        expect(fitted.rows).toEqual(plain.rows);
    });
});
