// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { bindNonMekRecordSheet } from '../../../components/page-viewer/non-mek-record-sheet-binder';
import type { RecordSheetInteraction } from '../../../components/page-viewer/record-sheet-interaction';
import type { BaseEntity } from '../../../models/entity/base-entity';
import {
    TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestInfantryEntity, TestProtoMekEntity, TestSupportVtolEntity,
    TestTankEntity, TestVtolEntity,
} from '../../../models/entity/testing/test-entities';
import { systemDamageId } from '../../../models/rules/system-damage-rules';
import { createNonMekUnit, repairNonMekUnit } from '../../../models/runtime/cbt-non-mek-unit';
import { projectNonMekRecordSheet } from '../../../models/runtime/non-mek-record-sheet';
import type { CBTUnitCommand } from '../../../models/runtime/unit-command';
import { asUnitUuid } from '../../../services/unit-catalog/unit-catalog.types';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e7');

describe('airborne record sheet trackers', () => {
    let stage: HTMLDivElement;

    beforeEach(() => {
        stage = document.createElement('div');
        document.body.appendChild(stage);
    });

    afterEach(() => stage.remove());

    const withMotive = <T extends BaseEntity>(entity: T, motive: string): T => {
        entity.motiveType.set(motive as never);
        return entity;
    };

    const glider = (): TestProtoMekEntity => {
        const entity = withMotive(new TestProtoMekEntity(), 'WiGE');
        entity.isGlider.set(true);
        return entity;
    };

    for (const [label, make, controls] of [
        ['a VTOL', () => new TestVtolEntity(), ['Rotor Hits', 'Elevation']],
        ['a support VTOL', () => new TestSupportVtolEntity(), ['Rotor Hits', 'Elevation']],
        ['a WiGE', () => withMotive(new TestTankEntity(), 'WiGE'), ['Elevation']],
        ['a tracked tank', () => withMotive(new TestTankEntity(), 'Tracked'), []],
        ['VTOL infantry', () => withMotive(new TestInfantryEntity(), 'VTOL'), ['Elevation']],
        ['foot infantry', () => withMotive(new TestInfantryEntity(), 'Leg'), []],
        ['VTOL battle armor', () => withMotive(new TestBattleArmorEntity(), 'VTOL'), ['Elevation']],
        ['jump battle armor', () => withMotive(new TestBattleArmorEntity(), 'Jump'), []],
        ['a glider ProtoMek', glider, ['Elevation']],
        ['a ProtoMek', () => new TestProtoMekEntity(), []],
        // Aerospace units keep their Altitude turn by turn in the velocity record.
        ['an aerospace fighter', () => new TestAeroSpaceFighterEntity(), []],
    ] as const) {
        it(`draws ${controls.length ? controls.join(' and ') : 'no height or rotor box'} on ${label}'s sheet, on screen only`,
            async () => {
            const entity: BaseEntity = make();
            entity.setTonnage(20);
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
            const boxes = [...svg.querySelectorAll('.rotorHitsControl, .elevationTracker')];
            expect(boxes.map(box => box.querySelector('text')?.textContent)).toEqual([...controls]);
            expect(boxes.every(box => box.classList.contains('screen-only'))).toBeTrue();
        });
    }

    it("shows a VTOL's Rotor Hits and Elevation, and picks its Elevation from the box", async () => {
        const entity = new TestVtolEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        entity.originalWalkMP.set(6);
        const unit = createNonMekUnit(entity, { instanceId: 'vtol-trackers', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const sheet = () => ({
            ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), unit.ruleset(), unit.query(), 0, 0),
            editContext: { owner: unit, state: unit.snapshot() },
        });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        stage.appendChild(svg);
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, sheet(), interaction => interactions.push(interaction));
        const dispatch = (command: CBTUnitCommand) => {
            expect(unit.dispatch(command).changed).withContext(command.type).toBeTrue();
            expect(binding.render(sheet())).toEqual([]);
        };
        dispatch({ type: 'set-elevation', elevation: 4 });
        dispatch({ type: 'damage-track', damageTrackId: systemDamageId('rotor'), amount: 2, target: 'committed', timestamp: 1 });

        expect(svg.querySelector('.elevationTrackerValue')?.textContent).toBe('4');
        expect(svg.getElementById('rotor_hits_counter')?.textContent).toBe('2');
        // Each hit takes a Cruising MP from a VTOL.
        expect(sheet().movement.walk).toBe(4);
        // The box is the rotor track's only control.
        expect(svg.querySelectorAll('[critId="rotor"]').length).toBe(1);
        svg.querySelector<SVGElement>('.elevationTracker')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        svg.querySelector<SVGElement>('.rotorHitsControl')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        expect(interactions.map(interaction => interaction.kind)).toEqual(['elevation', 'damage-track']);
    });
    it("shows a glider ProtoMek's Elevation in the box beside its movement points", async () => {
        const entity = glider();
        entity.uuid.set(UUID);
        const unit = createNonMekUnit(entity, { instanceId: 'glider-elevation', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        const sheet = () => ({
            ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), unit.ruleset(), unit.query(), 0, 0),
            editContext: { owner: unit, state: unit.snapshot() },
        });
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        stage.appendChild(svg);
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, sheet(), interaction => interactions.push(interaction));
        expect(unit.dispatch({ type: 'set-elevation', elevation: 3 }).changed).toBeTrue();
        expect(binding.render(sheet())).toEqual([]);

        expect(svg.querySelector('.elevationTrackerValue')?.textContent).toBe('3');
        svg.querySelector<SVGElement>('.elevationTracker')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        expect(interactions.map(interaction => interaction.kind)).toEqual(['elevation']);
    });

    it('starts a repaired unit over at turn 1 with no Elevation recorded, its box at a muted 0', async () => {
        const entity = new TestVtolEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        const unit = createNonMekUnit(entity, { instanceId: 'vtol-repair', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        expect(unit.dispatch({ type: 'set-elevation', elevation: 6 }).changed).toBeTrue();
        expect(unit.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();

        const repaired = repairNonMekUnit(unit);
        expect([repaired.snapshot().turn.turnCounter, repaired.snapshot().elevationRecord]).toEqual([0, undefined]);
        const sheet = {
            ...projectNonMekRecordSheet(entity, repaired.getIndex(), repaired.snapshot(), repaired.ruleset(),
                repaired.query(), 0, 0),
            editContext: { owner: repaired, state: repaired.snapshot() },
        };
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        stage.appendChild(svg);
        expect(bindNonMekRecordSheet(svg, sheet).render(sheet)).toEqual([]);
        const box = svg.querySelector('.elevationTrackerValue')!;
        expect([box.textContent, box.classList.contains('carriedOver')]).toEqual(['0', true]);
    });

    it("keeps a VTOL's Elevation Track live: written turns, this turn highlighted, moving on past turn 30", async () => {
        const entity = new TestVtolEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        const unit = createNonMekUnit(entity, { instanceId: 'vtol-track', uuid: UUID,
            scenario: { id: 'megamek', options: {} }, deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        // Turns are tracked: this turn is highlighted.
        const sheet = () => ({
            ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(), unit.ruleset(), unit.query(), 0, 0,
                false, true),
            editContext: { owner: unit, state: unit.snapshot() },
        });
        // The printed page carries the track beside the unit.
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'letter' });
        stage.appendChild(svg);
        const interactions: RecordSheetInteraction[] = [];
        const binding = bindNonMekRecordSheet(svg, sheet(), interaction => interactions.push(interaction));
        const value = (turn: number) => svg.querySelector(`.elevationTrackValue[data-turn="${turn}"]`)?.textContent;
        const highlighted = () => new Set([...svg.querySelectorAll<SVGElement>('.elevationTrackCell.currentTurn')]
            .map(cell => cell.dataset['turn']));
        expect(svg.querySelectorAll('.elevationTrackCell').length).toBe(30);

        expect(unit.dispatch({ type: 'set-elevation', elevation: 4 }).changed).toBeTrue();
        expect(unit.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
        binding.render(sheet());
        // Turn 2: turn 1 shows its 4, turn 2 is blank and highlighted; the box keeps the VTOL at 4, muted until
        // this turn's Elevation is recorded.
        const box = () => svg.querySelector('.elevationTrackerValue')!;
        expect([value(1), value(2)]).toEqual(['4', '']);
        expect(highlighted()).toEqual(new Set(['2']));
        expect([box().textContent, box().classList.contains('carriedOver')]).toEqual(['4', true]);
        expect(unit.dispatch({ type: 'set-elevation', elevation: 4 }).changed).toBeTrue();
        binding.render(sheet());
        expect([box().textContent, box().classList.contains('carriedOver')]).toEqual(['4', false]);

        for (let turn = 2; turn <= 30; turn++) {
            expect(unit.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
        }
        expect(unit.dispatch({ type: 'set-elevation', elevation: 7 }).changed).toBeTrue();
        binding.render(sheet());
        // Turn 31: the first table has moved on to turns 31-45, the second still shows 16-30.
        expect([...svg.querySelectorAll('.elevationTrackTurn')].map(turn => turn.textContent))
            .toEqual([...Array.from({ length: 15 }, (_, index) => String(31 + index)),
                ...Array.from({ length: 15 }, (_, index) => String(16 + index))]);
        expect([value(31), value(1)]).toEqual(['7', undefined]);
        expect(highlighted()).toEqual(new Set(['31']));
        svg.querySelector<SVGElement>('.elevationTrackCell[data-turn="31"]')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        expect(interactions).toEqual([jasmine.objectContaining({ kind: 'elevation', turn: 31 })]);
    });
});
