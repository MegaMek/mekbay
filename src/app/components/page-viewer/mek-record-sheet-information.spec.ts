// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../../models/cbt-ruleset.model';
import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../../models/mek-sheet-binding';
import type { EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import { projectMekRecordSheet } from '../../models/runtime/mek-record-sheet';
import { createDirectTorsoCockpitRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { RecordSheetSvgGenerator } from '../../utils/sheets/record-sheet-svg-generator';
import { bindMekRecordSheet } from './mek-record-sheet-binder';

describe('bound Mek record-sheet information', () => {
    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        it(`preserves design heat and typed systems alongside live ${ruleset} projections`, async () => {
            const { entity, index, instance } = createDirectTorsoCockpitRuntimeFixture(ruleset);
            entity.mixedTech.set(true);
            entity.techBase.set('Clan');
            const [svg] = await RecordSheetSvgGenerator.generatePages(entity, { ruleset });
            const sinkType = svg.querySelector('#hsType')!.textContent;
            expect(sinkType).toBe('Heat Sinks:');
            const typedCockpit = [...svg.querySelectorAll('.critSlot text')]
                .map(text => text.textContent).find(text => text?.includes('Torso-Mounted Cockpit'));
            expect(typedCockpit).toBeDefined();
            const mixedTechLabel = [...svg.querySelectorAll('.critSlot text')]
                .map(text => text.textContent).find(text => text?.includes('[IS]'));
            expect(mixedTechLabel).toBeDefined();
            const state = instance.snapshot();
            const original = {
                ...projectMekRecordSheet(entity, index, ruleset, state, instance.query(),
                    { revision: 0, targets: [] }, null),
                editContext: { owner: instance, state },
            };
            const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, original);
            expect([...svg.querySelectorAll('.critSlot text')].map(text => text.textContent))
                .toContain(typedCockpit!);
            expect([...svg.querySelectorAll('.critSlot text')].map(text => text.textContent))
                .toContain(mixedTechLabel!);
            expect(svg.querySelector('#hsType')!.textContent).toBe(sinkType);
            expect(svg.querySelector('#heatProfile')!.textContent)
                .toContain(`Maximum Heat (Dissipation): ${entity.heatGeneration()}`);
            expect(original.heatProjection.kind).toBe('supported');
            if (original.heatProjection.kind !== 'supported') throw new Error('Expected heat projection');
            binding.render({
                ...original,
                heatProjection: {
                    ...original.heatProjection,
                    projection: { ...original.heatProjection.projection, projected: 9, capacity: 5 },
                },
            });
            expect(svg.querySelector('#heatProfile')!.textContent)
                .toBe(`Maximum Heat (Dissipation): ${entity.heatGeneration()} (5)`);
            const projected = {
                ...original,
                heatProjection: {
                    ...original.heatProjection,
                    projection: { ...original.heatProjection.projection, capacity: 5 },
                },
            };
            const selectedPanel = {
                components: [{ status: 'available', weapon: { selectable: true, firingHeat: 10, selection: { kind: 'manual-range', range: 'short' } } }],
                physicalAttacks: [],
            } as unknown as EquipmentPanelSnapshot;
            binding.render(projected, { panel: selectedPanel, attack: null });
            expect(svg.querySelector('#heatProfile')!.textContent).toBe('Selected Heat (Dissipation): 10 (5)');
            expect(svg.querySelector('#heatProfile > tspan')?.getAttribute('font-weight')).toBe('700');
            binding.render(projected, null);
            expect(svg.querySelector('#heatProfile')!.textContent)
                .toBe(`Maximum Heat (Dissipation): ${entity.heatGeneration()} (5)`);
            expect(svg.querySelector('#hsCount')!.textContent).toBe(`${entity.heatSinkCount()} (5)`);
            expect(svg.querySelector('#hsType')!.textContent).toBe(sinkType);
            binding.destroy();
        });
    }
});
