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

describe('generated Mek critical pips with live damage', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        for (const armored of [false, true]) {
            it(`${ruleset}, armored=${armored}: marks each pip before destroying the single-slot autocannon`, async () => {
                const fixture = createDirectMekRuntimeFixture(ruleset);
                const { entity } = fixture;
                const component = fixture.equipmentComponent('Test AC');
                entity.updateEquipment(mounts => mounts.map(mount => mount.mountId === component.mount.mountId
                    ? mount.clone({ armored }) : mount));
                const index = buildMekRuntimeIndex(entity);
                const unit = createMekRuntimeForTest('critical-pips', fixture.initialized.baselineRef,
                    entity, index, ruleset, fixture.initialized.state, fixture.initialized.deployment.crewAssignment,
                    createMekHeatContextV2(entity, index, ruleset, { id: 'megamek' }),
                    createMekMechanicsContextV2(entity, index, ruleset, { id: 'megamek' }));
                const snapshot = () => ({
                    ...projectMekRecordSheet(entity, index, ruleset, unit.snapshot(), unit.query(),
                        { revision: 0, targets: [] }, null),
                    editContext: { owner: unit, state: unit.snapshot() },
                });
                const slot = snapshot().criticalSlots.find(slot =>
                    slot.components.some(candidate => candidate.componentId === component.id))!;
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                document.body.append(svg);
                const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot());
                try {
                    const element = svg.querySelector<SVGElement>(
                        `.critSlot[data-loc="${slot.locationCode}"][slot="${slot.slotIndex}"]`)!;
                    const armor = element.querySelector<SVGCircleElement>('circle.armoredLocPip');
                    const extra = element.querySelector<SVGRectElement>('rect.extraHitPip');
                    const extraHits = ruleset === 'core-2026' ? 1 : 0;
                    const armorHits = armored ? 1 : 0;
                    const capacity = 1 + extraHits + armorHits;
                    expect(slot.hitCapacity).toBe(capacity);
                    expect(armor !== null).toBe(armored);
                    expect(extra !== null).toBe(extraHits === 1);
                    for (let hits = 1; hits <= capacity; hits++) {
                        expect(unit.dispatch({ type: 'hit-critical', slotId: slot.slotId,
                            hits: 1, target: 'committed' }).accepted).toBeTrue();
                        binding.render(snapshot());
                        if (armor) expect(armor.classList.contains('damaged')).toBeTrue();
                        if (extra) expect(extra.classList.contains('damaged')).toBe(hits > armorHits);
                        expect(element.classList.contains('damaged')).toBe(hits === capacity);
                        expect(unit.query().componentStatus(component.id) === 'destroyed').toBe(hits === capacity);
                    }
                    if (extra) {
                        const text = element.querySelector<SVGTextElement>('text')!;
                        expect(extra.getBBox().x - (Number(text.getAttribute('x')) + text.getComputedTextLength()))
                            .toBeCloseTo(1.4, 1);
                    }
                } finally {
                    binding.destroy();
                    svg.remove();
                }
            });
        }
    }
});
