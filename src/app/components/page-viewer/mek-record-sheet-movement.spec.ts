// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../../models/mek-sheet-binding';
import { projectMekRecordSheet } from '../../models/runtime/mek-record-sheet';
import {
    createDirectMekRuntimeFixture,
    createDirectPartialWingRuntimeFixture,
    createDirectShieldRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    emptyCBTEncounterSnapshot,
    type DirectMekRuntimeFixture,
} from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { renderGeneratedRecordSheetControls } from '../../utils/sheets/generated-record-sheet-controls';
import { createUnitEditContextFixture } from '../../models/runtime/testing/unit-edit-context-fixture';
import { bindMekRecordSheet } from './mek-record-sheet-binder';

describe('Mek record-sheet movement PSR pre-warnings', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

    function bindMovement(fixture: DirectMekRuntimeFixture) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('mekbay-sheet');
        svg.innerHTML = '<g><text>Walking:</text><text id="mpWalk"/><text>Running:</text><text id="mpRun"/><text>Jumping:</text><text id="mpJump"/></g>';
        renderGeneratedRecordSheetControls(svg, fixture.entity, { ruleset: fixture.instance.ruleset() });
        document.body.append(svg);
        const warning = (mode: 'run' | 'jump') => svg.getElementById(
            mode === 'run' ? 'mpRun-psr-warning' : 'mpJump-psr-warning',
        ) as SVGTextElement;
        expect(warning('run').getAttribute('display')).toBe('none');
        expect(warning('jump').getAttribute('display')).toBe('none');
        const editContext = createUnitEditContextFixture();
        const snapshot = () => {
            const sheet = projectMekRecordSheet(
                fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.snapshot(),
                fixture.instance.query(), emptyCBTEncounterSnapshot(), null,
            );
            return { ...sheet, editContext: editContext(sheet.stateRevision) };
        };
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot());
        cleanups.push(() => { binding.destroy(); svg.remove(); });
        return { svg, warning, render: () => binding.render(snapshot()) };
    }

    function systemSlot(fixture: DirectMekRuntimeFixture, systemType: string) {
        return [...fixture.index.slots.values()].find(slot => slot.componentIds.some(id => {
            const component = fixture.index.components.get(id);
            return component?.kind === 'system' && component.systemType === systemType;
        }))!;
    }

    function hitSystem(fixture: DirectMekRuntimeFixture, systemType: string) {
        expect(fixture.instance.dispatch({
            type: 'hit-critical', slotId: systemSlot(fixture, systemType).id,
            hits: 1, target: 'committed',
        }).accepted).toBeTrue();
    }

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(ruleset + ': colors only the movement mode actually reduced by heat or equipment damage', () => {
            for (const underwater of [false, true]) {
                const fixture = underwater ? createDirectShieldRuntimeFixture(ruleset, 'small')
                    : createDirectPartialWingRuntimeFixture(ruleset);
                const sheet = bindMovement(fixture);
                const jump = sheet.svg.getElementById('mpJump')!;
                const pristine = Number(jump.textContent);
                expect(pristine).toBeGreaterThan(0);
                expect(fixture.instance.dispatch({ type: 'set-heat', heat: 8 }).accepted).toBeTrue();
                sheet.render();
                expect(jump.textContent).toBe(String(pristine));
                expect(jump.classList.contains('damaged')).toBeFalse();
                expect(sheet.svg.getElementById('mpWalk')!.classList.contains('damaged')).toBeTrue();
                const component = [...fixture.index.components.values()].find(component => component.kind === 'equipment'
                    && component.mount.equipment?.hasFlag(underwater ? 'F_UMU' : 'F_JUMP_JET'))!;
                const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(component.id))!;
                expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).accepted).toBeTrue();
                sheet.render();
                expect(jump.textContent).toBe(String(pristine - 1));
                expect(jump.classList.contains('damaged')).toBeTrue();
            }
        });

        it(ruleset + ': recalculates the baseline after modular armor is expended and brackets only boosts', () => {
            const fixture = createDirectModularArmorRuntimeFixture(ruleset);
            const sheet = bindMovement(fixture);
            const beforeWalk = Number(sheet.svg.getElementById('mpWalk')!.textContent);
            const beforeJump = Number(sheet.svg.getElementById('mpJump')!.textContent);
            const panels = [...fixture.index.components.values()].filter(component => component.kind === 'equipment'
                && component.mount.equipment?.hasFlag('F_MODULAR_ARMOR'));
            for (const panel of panels) {
                const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(panel.id))!;
                const face = [...fixture.index.armorFaces.values()].find(face => face.locationId === slot.locationId && face.face === 'front')!;
                expect(fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 10, target: 'committed' }).accepted).toBeTrue();
            }
            sheet.render();
            expect(sheet.svg.getElementById('mpWalk')!.textContent).toBe(String(beforeWalk + 1));
            expect(sheet.svg.getElementById('mpJump')!.textContent).toBe(String(beforeJump + 1));
            expect(sheet.svg.getElementById('mpWalk')!.classList.contains('damaged')).toBeFalse();
            expect(sheet.svg.getElementById('mpJump')!.classList.contains('damaged')).toBeFalse();
            expect(fixture.instance.dispatch({ type: 'set-heat', heat: 8 }).accepted).toBeTrue();
            sheet.render();
            // Walking now matches its original design value but has a real heat penalty.
            expect(sheet.svg.getElementById('mpWalk')!.textContent).toBe(String(beforeWalk));
            expect(sheet.svg.getElementById('mpWalk')!.classList.contains('damaged')).toBeTrue();
            expect(sheet.svg.getElementById('mpJump')!.textContent).toBe(String(beforeJump + 1));
            expect(sheet.svg.getElementById('mpJump')!.classList.contains('damaged')).toBeFalse();
        });

        it(`${ruleset}: hides warnings for pristine units, unrelated damage, and movement blocks`, () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            const sheet = bindMovement(fixture);
            expect(sheet.warning('run').getAttribute('display')).toBe('none');
            expect(sheet.warning('jump').getAttribute('display')).toBe('none');

            hitSystem(fixture, 'Hand Actuator');
            expect(fixture.instance.dispatch({ type: 'set-heat', heat: 25 }).accepted).toBeTrue();
            sheet.render();
            expect(sheet.warning('run').getAttribute('display')).toBe('none');
            expect(sheet.warning('jump').getAttribute('display')).toBe('none');
            expect(sheet.warning('run').hasAttribute('title')).toBeFalse();
        });

        it(`${ruleset}: never warns about jumping for a unit built without jump jets`, () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            expect(fixture.entity.jumpMP()).toBe(0);
            hitSystem(fixture, 'Gyro');
            const sheet = bindMovement(fixture);
            expect(sheet.warning('run').getAttribute('display')).toBeNull();
            expect(sheet.warning('run').getAttribute('title')).toBe('Running with damaged gyro');
            expect(sheet.warning('jump').getAttribute('display')).toBe('none');
        });

        it(`${ruleset}: warns only for jumping when a foot actuator is damaged`, () => {
            const fixture = createDirectPartialWingRuntimeFixture(ruleset);
            hitSystem(fixture, 'Foot Actuator');
            const sheet = bindMovement(fixture);
            expect(sheet.warning('run').getAttribute('display')).toBe('none');
            expect(sheet.warning('jump').getAttribute('display')).toBeNull();
            expect(sheet.warning('jump').getAttribute('title')).toBe('Jumping with damaged leg actuator');

            expect(fixture.instance.dispatch({
                type: 'declare-mek-movement',
                declaration: { schemaVersion: 1, mode: 'jump', distance: 1, boosterComponentIds: [] },
            }).accepted).toBeTrue();
            expect(fixture.instance.query().mekMovementPsrState().checks.filter(check =>
                check.source.sourceKind === 'movement').map(check => check.reason))
                .toEqual([sheet.warning('jump').getAttribute('title')!]);
        });

        it(`${ruleset}: keeps the Run warning when heat removes its available MP`, () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            hitSystem(fixture, 'Gyro');
            expect(fixture.instance.dispatch({ type: 'set-heat', heat: 25 }).accepted).toBeTrue();
            const movement = fixture.instance.query().mekMovementPsr();
            if (movement.kind !== 'supported') throw new Error('Expected supported movement');
            expect(movement.runMp).toBe(0);
            expect(movement.actions.find(action => action.kind === 'run')?.legal).toBeFalse();
            const sheet = bindMovement(fixture);
            expect(sheet.warning('run').getAttribute('display')).toBeNull();
            expect(getComputedStyle(sheet.warning('run')).fill).toBe('rgb(0, 0, 0)');
        });

        it(`${ruleset}: keeps the Jump warning after damage removes all available jump MP`, () => {
            const fixture = createDirectPartialWingRuntimeFixture(ruleset);
            hitSystem(fixture, 'Foot Actuator');
            const jumpSlots = [...fixture.index.slots.values()].filter(slot => slot.componentIds.some(id => {
                const component = fixture.index.components.get(id);
                return component?.kind === 'equipment'
                    && ['Test Jump Jet', 'Test Partial Wing'].includes(component.mount.equipment?.internalName ?? '');
            }));
            expect(jumpSlots.length).toBeGreaterThan(0);
            for (const slot of jumpSlots) {
                expect(fixture.instance.dispatch({
                    type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed',
                }).accepted).toBeTrue();
            }
            const movement = fixture.instance.query().mekMovementPsr();
            if (movement.kind !== 'supported') throw new Error('Expected supported movement');
            expect(movement.jumpMp).toBe(0);
            expect(movement.actions.find(action => action.kind === 'jump')?.legal).toBeFalse();
            const sheet = bindMovement(fixture);
            expect(sheet.warning('jump').getAttribute('display')).toBeNull();
            expect(getComputedStyle(sheet.warning('jump')).fill).toBe('rgb(0, 0, 0)');
        });
    }

    it('uses black before selection, red for the selected movement, and hides warnings after repair', () => {
        const fixture = createDirectPartialWingRuntimeFixture();
        const sheet = bindMovement(fixture);
        const gyro = systemSlot(fixture, 'Gyro');
        expect(fixture.instance.dispatch({
            type: 'hit-critical', slotId: gyro.id, hits: 1, target: 'pending',
        }).accepted).toBeTrue();
        sheet.render();
        expect(sheet.warning('run').getAttribute('display')).toBe('none');
        expect(sheet.warning('jump').getAttribute('display')).toBe('none');
        expect(fixture.instance.dispatch({ type: 'commit-pending' }).accepted).toBeTrue();
        sheet.render();
        for (const mode of ['run', 'jump'] as const) {
            expect(sheet.warning(mode).textContent).toBe('PSR!');
            expect(sheet.warning(mode).getAttribute('display')).toBeNull();
            expect(getComputedStyle(sheet.warning(mode)).fill).toBe('rgb(0, 0, 0)');
        }

        for (const mode of ['run', 'jump', 'walk'] as const) {
            expect(fixture.instance.dispatch({
                type: 'declare-mek-movement',
                declaration: { schemaVersion: 1, mode, distance: 1, boosterComponentIds: [] },
            }).accepted).toBeTrue();
            sheet.render();
            for (const warningMode of ['run', 'jump'] as const) {
                expect(getComputedStyle(sheet.warning(warningMode)).fill)
                    .toBe(mode === warningMode ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 0)');
            }
        }

        expect(fixture.instance.dispatch({
            type: 'repair-critical', slotId: gyro.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        sheet.render();
        for (const mode of ['run', 'jump'] as const) {
            expect(sheet.warning(mode).getAttribute('display')).toBe('none');
            expect(sheet.warning(mode).hasAttribute('title')).toBeFalse();
            expect(sheet.warning(mode).classList.contains('currentMoveMode')).toBeFalse();
        }
    });

    it('does not warn about running with a damaged Heavy-Duty gyro under Core rules', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:hd-gyro-warning', 'Heavy Duty');
        hitSystem(fixture, 'Gyro');
        const sheet = bindMovement(fixture);
        expect(sheet.warning('run').getAttribute('display')).toBe('none');
        expect(sheet.warning('jump').getAttribute('display')).toBe('none');
    });
});
