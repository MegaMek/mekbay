// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { bindNonMekRecordSheet } from '../../../components/page-viewer/non-mek-record-sheet-binder';
import type { RecordSheetInteraction } from '../../../components/page-viewer/record-sheet-interaction';
import {
    TestLargeSupportTankEntity, TestSupportNavalEntity, TestSupportTankEntity,
    TestSupportVtolEntity, TestTankEntity, TestVtolEntity,
} from '../../../models/entity/testing/test-entities';
import { systemDamageId } from '../../../models/rules/system-damage-rules';
import { createNonMekUnit } from '../../../models/runtime/cbt-non-mek-unit';
import { projectNonMekRecordSheet } from '../../../models/runtime/non-mek-record-sheet';
import type { CBTUnitCommand } from '../../../models/runtime/unit-command';
import { asUnitUuid } from '../../../services/unit-catalog/unit-catalog.types';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('generated vehicle motive hit pips', () => {
    let stage: HTMLDivElement;

    beforeEach(() => {
        stage = document.createElement('div');
        document.body.appendChild(stage);
    });

    afterEach(() => stage.remove());

    for (const [Factory, motiveType, visible] of [
        [TestTankEntity, 'Tracked', true],
        [TestTankEntity, 'WiGE', true],
        [TestSupportTankEntity, 'Wheeled', true],
        [TestLargeSupportTankEntity, 'Hover', true],
        [TestSupportNavalEntity, 'Naval', true],
        [TestSupportNavalEntity, 'Submarine', true],
        [TestVtolEntity, 'VTOL', false],
        [TestSupportVtolEntity, 'VTOL', false],
    ] as const) {
        it(`places ${Factory.name} ${motiveType} indicators beneath the corresponding controls`, async () => {
            const entity = new Factory();
            entity.setTonnage(30);
            entity.motiveType.set(motiveType);
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            stage.appendChild(svg);

            for (const level of [2, 3]) {
                const id = `motive_system_hit_${level}`;
                const control = svg.getElementById(id) as SVGRectElement;
                const group = svg.getElementById(`${id}_pips`) as SVGGElement;
                const pips = [...group.querySelectorAll<SVGCircleElement>('.motiveHitPip')];
                expect(pips.length).toBe(9);
                expect(group.parentElement).toBe(control.parentElement);
                expect(group.closest('[display="none"]') === null).toBe(visible);
                expect(pips.every(pip => getComputedStyle(pip).display === 'none')).toBeTrue();
                expect(group.classList.contains('screen-only')).toBeTrue();
                if (!visible) continue;

                // The reference uses three rows under each 8-unit button, with a 1-unit gap.
                const x = control.x.baseVal.value;
                const y = control.y.baseVal.value;
                expect(pips.map(pip => Math.round((pip.cx.baseVal.value - x) * 1000)))
                    .toEqual([1333, 4000, 6667, 1333, 4000, 6667, 1333, 4000, 6667]);
                expect(pips.map(pip => Math.round((pip.cy.baseVal.value - y) * 1000)))
                    .toEqual([10333, 10333, 10333, 13000, 13000, 13000, 15667, 15667, 15667]);
                for (const pip of pips) {
                    expect(pip.r.baseVal.value).toBeCloseTo(1.067, 3);
                    pip.classList.remove('hidden');
                    const bounds = pip.getBoundingClientRect();
                    const button = control.getBoundingClientRect();
                    expect(bounds.width).toBeGreaterThan(0);
                    expect(bounds.left).toBeGreaterThan(button.left);
                    expect(bounds.right).toBeLessThan(button.right);
                    expect(bounds.top).toBeGreaterThan(button.bottom);
                    expect(getComputedStyle(pip).pointerEvents).toBe('none');
                }
                const stabilizers = [...svg.querySelectorAll<SVGGraphicsElement>('.critLoc[critId^="stabilizer"]')];
                expect(stabilizers.length).toBeGreaterThan(0);
                expect(pips[8].getBoundingClientRect().bottom)
                    .toBeLessThan(Math.min(...stabilizers.map(control => control.getBoundingClientRect().top)));
            }
            expect(svg.getElementById('motive_system_hit_1_pips')).toBeNull();
            expect(svg.getElementById('motive_system_hit_4_pips')).toBeNull();
        });
    }

    it('keeps counts, colors, movement and controls in sync through damage, cancellation and repair', async () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        entity.uuid.set(uuid);
        entity.setTonnage(20);
        entity.originalWalkMP.set(8);
        const unit = createNonMekUnit(entity, { instanceId: 'motive-hit-pips', uuid,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const recordSheet = () => ({
            ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), unit.ruleset(),
                0, 0, unit.getCrewAssignment()),
            editContext: { owner: unit, state: unit.snapshot() },
        });
        const svg = await RecordSheetSvgGenerator.generate(entity);
        stage.appendChild(svg);
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, recordSheet(), interaction => interactions.push(interaction));
        const moderate = systemDamageId('motive', 2);
        const heavy = systemDamageId('motive', 3);
        const red = 'rgb(255, 0, 0)';
        const orange = 'rgb(255, 165, 0)';
        const blue = 'rgb(3, 169, 244)';
        const dispatch = (command: CBTUnitCommand) => {
            expect(unit.dispatch(command).changed).withContext(command.type).toBeTrue();
            expect(binding.render(recordSheet())).toEqual([]);
        };
        const colors = (moderateColors: string[], heavyColors: string[]) => {
            for (const night of [false, true]) {
                stage.classList.toggle('night-mode', night);
                for (const [level, expected] of [[2, moderateColors], [3, heavyColors]] as const) {
                    const group = svg.getElementById(`motive_system_hit_${level}_pips`)!;
                    const visiblePips = [...group.querySelectorAll<SVGGraphicsElement>('.motiveHitPip:not(.hidden)')];
                    expect(visiblePips.map(pip => getComputedStyle(pip).fill))
                        .withContext(`motive ${level}, night=${night}`).toEqual(expected);
                    expect(visiblePips.every(pip => pip.getBoundingClientRect().width > 0)).toBeTrue();
                    expect(group.classList.contains('hasVisiblePips')).toBe(expected.length > 0);
                }
            }
        };

        colors([], []);
        dispatch({ type: 'damage-track', damageTrackId: moderate, amount: 3, target: 'pending', timestamp: 10 });
        dispatch({ type: 'damage-track', damageTrackId: heavy, amount: 1, target: 'pending', timestamp: 20 });
        colors([orange, orange, orange], [orange]);
        expect(recordSheet().movement.walk).toBe(8);
        dispatch({ type: 'end-phase' });
        colors([red, red, red], [red]);
        expect(recordSheet().movement.walk).toBe(3);

        // Simultaneous repair and new damage match the reference screenshot.
        dispatch({ type: 'repair-damage-track', damageTrackId: moderate, amount: 2, target: 'pending' });
        dispatch({ type: 'damage-track', damageTrackId: heavy, amount: 1, target: 'pending', timestamp: 30 });
        colors([red, blue, blue], [red, orange]);
        expect(recordSheet().movement.walk).toBe(3);
        dispatch({ type: 'cancel-pending' });
        colors([red, red, red], [red]);
        dispatch({ type: 'repair-damage-track', damageTrackId: moderate, amount: 2, target: 'pending' });
        dispatch({ type: 'damage-track', damageTrackId: heavy, amount: 1, target: 'pending', timestamp: 30 });
        dispatch({ type: 'end-phase' });
        colors([red], [red, red]);
        expect(recordSheet().movement.walk).toBe(2);

        dispatch({ type: 'repair-damage-track', damageTrackId: moderate, amount: 1, target: 'committed' });
        dispatch({ type: 'repair-damage-track', damageTrackId: heavy, amount: 2, target: 'committed' });
        colors([], []);
        expect(recordSheet().movement.walk).toBe(8);
        for (const level of [2, 3]) {
            const button = svg.getElementById(`motive_system_hit_${level}`)!;
            expect(button.classList.contains('damaged')).toBeFalse();
            expect(button.classList.contains('willChange')).toBeFalse();
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(interactions.at(-1)).toEqual(jasmine.objectContaining({
                kind: 'damage-track', damageTrackId: systemDamageId('motive', level),
            }));
        }

        dispatch({ type: 'damage-track', damageTrackId: moderate, amount: 9, target: 'committed', timestamp: 40 });
        dispatch({ type: 'damage-track', damageTrackId: heavy, amount: 9, target: 'pending', timestamp: 50 });
        colors(Array(9).fill(red), Array(9).fill(orange));
        svg.classList.add('print-preview');
        for (const group of svg.querySelectorAll('.motiveHitPips')) {
            expect(getComputedStyle(group).display).toBe('none');
        }
        binding.destroy();
    });
});
