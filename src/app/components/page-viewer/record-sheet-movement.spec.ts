// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import {
    TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestInfantryEntity, TestLamEntity,
    TestProtoMekEntity, TestQuadVeeEntity, TestTankEntity, TestVtolEntity, TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../../models/mek-sheet-binding';
import { projectMekRecordSheet } from '../../models/runtime/mek-record-sheet';
import { projectNonMekRecordSheet } from '../../models/runtime/non-mek-record-sheet';
import type { RecordSheetMovementSelection } from '../../models/runtime/record-sheet-movement';
import { mekAttackMovementModifier } from '../../models/runtime/mek-turn-panel';
import { nonMekAttackMovementModifier } from '../../models/runtime/non-mek-unit-instance';
import { createDirectMekRuntimeFixture, createDirectPartialWingRuntimeFixture, emptyCBTEncounterSnapshot } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { createNonMekRuntimeForTest } from '../../models/runtime/testing/unit-runtime-owner-fixture';
import { createUnitEditContextFixture } from '../../models/runtime/testing/unit-edit-context-fixture';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { RecordSheetSvgGenerator } from '../../utils/sheets/record-sheet-svg-generator';
import { SvgExportUtil } from '../../utils/svg-export.util';
import { bindMekRecordSheet } from './mek-record-sheet-binder';
import { bindNonMekRecordSheet } from './non-mek-record-sheet-binder';
import { bindRecordSheetMovement } from './record-sheet-movement';

describe('record-sheet movement controls', () => {
    const cleanups: (() => void)[] = [];
    const editContext = createUnitEditContextFixture();
    afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

    async function mount(entity: BaseEntity) {
        const svg = await RecordSheetSvgGenerator.generate(entity);
        svg.classList.add('interactive-sheet');
        document.body.append(svg);
        cleanups.push(() => svg.remove());
        return svg;
    }
    function control(svg: SVGSVGElement, id: string) {
        return svg.querySelector<SVGGElement>(`[data-mekbay-movement-control="${id}"]`)!;
    }
    function badge(svg: SVGSVGElement, id: string) {
        return control(svg, id).querySelector<SVGGElement>('.movementModifier')!;
    }
    async function mek(fixture = createDirectPartialWingRuntimeFixture()) {
        const svg = await mount(fixture.entity);
        const snapshot = () => {
            const sheet = projectMekRecordSheet(fixture.entity, fixture.index, fixture.instance.ruleset(),
                fixture.instance.snapshot(), fixture.instance.query(), emptyCBTEncounterSnapshot(), null);
            return { ...sheet, editContext: editContext(sheet.stateRevision) };
        };
        const interactions = jasmine.createSpy('movement');
        const binding = bindMekRecordSheet(svg, MM_DATA_MEK_SHEET_BINDING_MANIFEST, snapshot(), interactions);
        cleanups.push(() => binding.destroy());
        return { fixture, svg, snapshot, interactions, render: () => binding.render(snapshot()) };
    }

    it('shows runtime modifiers before selection and selects Stationary independently from Walking', async () => {
        const sheet = await mek();
        for (const [id, mode] of [['mpWalk', 'walk'], ['mpRun', 'run'], ['mpJump', 'jump'], ['mpStationary', 'stationary']]) {
            const option = sheet.snapshot().movementSelection.options.find(option => option.mode === mode)!;
            expect(badge(sheet.svg, id).getAttribute('display')).toBe('inline');
            expect(badge(sheet.svg, id).textContent).toBe(`+${option.modifier}`);
        }
        expect(getComputedStyle(sheet.svg.getElementById('movementPointsLabel')!).display).toBe('none');
        expect(sheet.fixture.instance.dispatch({ type: 'declare-mek-movement', declaration: {
            schemaVersion: 1, mode: 'stationary', distance: 0, boosterComponentIds: [],
        } }).accepted).toBeTrue();
        sheet.render();
        expect(sheet.svg.getElementById('mpStationary')!.classList).toContain('currentMoveMode');
        expect(badge(sheet.svg, 'mpStationary').textContent).toBe('+0');
        for (const id of ['mpWalk', 'mpRun', 'mpJump']) {
            expect(sheet.svg.getElementById(id)!.classList).not.toContain('currentMoveMode');
            expect(getComputedStyle(sheet.svg.getElementById(id)!).opacity).toBe('0.5');
            expect(getComputedStyle(sheet.svg.getElementById(`${id}-label`)!).opacity).toBe('0.5');
            expect(badge(sheet.svg, id).getAttribute('display')).toBe('none');
        }
        sheet.fixture.instance.dispatch({ type: 'clear-mek-movement' });
        sheet.render();
        expect(badge(sheet.svg, 'mpWalk').getAttribute('display')).toBe('inline');
        expect(getComputedStyle(sheet.svg.getElementById('mpWalk-label')!).opacity).toBe('1');
    });

    it('supports click and keyboard selection with current context and rejects preview controls', async () => {
        const sheet = await mek();
        control(sheet.svg, 'mpWalk').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(sheet.interactions.calls.mostRecent().args[0]).toEqual({
            kind: 'movement', mode: 'walk', context: sheet.snapshot().editContext,
        });
        sheet.fixture.instance.dispatch({ type: 'set-heat', heat: 1 });
        sheet.render();
        control(sheet.svg, 'mpStationary').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(sheet.interactions.calls.mostRecent().args[0]).toEqual({
            kind: 'movement', mode: 'stationary', context: sheet.snapshot().editContext,
        });
        sheet.svg.classList.add('print-preview');
        control(sheet.svg, 'mpWalk').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(sheet.interactions).toHaveBeenCalledTimes(2);
        expect(getComputedStyle(sheet.svg.getElementById('movementPointsLabel')!).display).not.toBe('none');
        expect(getComputedStyle(sheet.svg.getElementById('mpStationary')!).display).toBe('none');
    });

    it('removes live movement choices and restores the caption in serialized exports', async () => {
        const sheet = await mek();
        const serialized = await (SvgExportUtil as any).serializeSvgForExport(sheet.svg, '');
        const exported = new DOMParser().parseFromString(serialized, 'image/svg+xml');
        expect(exported.querySelector('.movementStationary, .movementControl')).toBeNull();
        expect(exported.getElementById('movementPointsLabel')?.textContent).toBe('Movement Points:');
        expect(exported.getElementById('movementPointsLabel')?.classList).not.toContain('print-only');
        expect(sheet.svg.getElementById('mpStationary')).not.toBeNull();
    });

    it('renders a critically destroyed weapon red and an unavailable Charge gray in both themes', async () => {
        const sheet = await mek(createDirectMekRuntimeFixture());
        sheet.svg.style.setProperty('--damage-color', '#ff0000');
        sheet.svg.style.setProperty('--disabled-color', '#808080');
        const weapon = sheet.snapshot().equipment.find(component => component.weapon !== undefined)!;
        const slot = [...sheet.fixture.index.slots.values()].find(slot => slot.componentIds.includes(weapon.componentId))!;
        expect(sheet.fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).accepted).toBeTrue();
        expect(sheet.fixture.instance.dispatch({ type: 'declare-mek-movement', declaration: {
            schemaVersion: 1, mode: 'stationary', distance: 0, boosterComponentIds: [],
        } }).accepted).toBeTrue();
        sheet.render();
        const row = [...sheet.svg.querySelectorAll<SVGElement>('.inventoryEntry')].find(row =>
            JSON.parse(row.getAttribute('data-mekbay-component-ids') ?? '[]').includes(weapon.componentId))!;
        const charge = [...sheet.svg.querySelectorAll<SVGElement>('.inventoryEntry')]
            .find(row => row.querySelector('.name')?.textContent === 'Charge')!;
        const host = document.createElement('div');
        document.body.appendChild(host); host.appendChild(sheet.svg);
        cleanups.push(() => host.remove());
        for (const night of [false, true]) {
            host.classList.toggle('night-mode', night);
            expect(row.classList).toContain('damaged');
            expect(row.classList).not.toContain('disabled');
            expect(getComputedStyle(row.querySelector('text')!).fill).toBe('rgb(255, 0, 0)');
            expect(getComputedStyle(row).opacity).toBe('1');
            expect(charge.classList).toContain('disabledInventory');
            expect(charge.classList).not.toContain('damaged');
            expect(getComputedStyle(charge.querySelector('text')!).fill).toBe('rgb(128, 128, 128)');
        }
    });

    it('tracks the LAM ground and airborne columns with their runtime modifiers', async () => {
        const entity = new TestLamEntity();
        const svg = await mount(entity);
        const abort = new AbortController();
        cleanups.push(() => abort.abort());
        let selection: RecordSheetMovementSelection;
        const interactions = jasmine.createSpy('movement');
        const render = bindRecordSheetMovement(svg, () => selection, () => editContext(1), abort.signal, interactions);
        for (const airborne of [false, true]) {
            selection = { airborne, selectedMode: 'walk', options: (['walk', 'run'] as const).map(mode => ({
                mode, modifier: mekAttackMovementModifier(entity, mode, airborne), legal: true, minimumMp: 0,
            })) };
            render(selection);
            for (const id of ['mpWalk', 'mpAirMekWalk']) {
                expect(svg.getElementById(id)!.classList.contains('currentMoveMode')).toBe(!airborne);
                expect(svg.getElementById(`${id}-label`)!.classList.contains('currentMoveMode')).toBe(!airborne);
            }
            for (const id of ['mpAirMekCruise', 'mpSafeThrust']) {
                expect(svg.getElementById(id)!.classList.contains('currentMoveMode')).toBe(airborne);
                expect(badge(svg, id).getAttribute('display')).toBe(airborne ? 'inline' : 'none');
            }
            control(svg, airborne ? 'mpWalk' : 'mpAirMekCruise').dispatchEvent(new MouseEvent('click'));
            expect(interactions).not.toHaveBeenCalled();
        }
        expect(badge(svg, 'mpAirMekCruise').textContent).toBe('+3');
    });

    it('keeps a jumping vehicle badge clear of the Flanking value and adjacent facts', async () => {
        const entity = new TestTankEntity();
        entity.setTonnage(20);
        entity.originalWalkMP.set(10);
        for (let jet = 0; jet < 5; jet++) addTestEquipmentWithFlags(entity, 'F_JUMP_JET');
        entity.motiveType.set('WiGE');
        const svg = await mount(entity);
        const abort = new AbortController();
        cleanups.push(() => abort.abort());
        const selection: RecordSheetMovementSelection = { selectedMode: null, airborne: false,
            options: (['walk', 'run', 'jump'] as const).map(mode => ({ mode,
                modifier: nonMekAttackMovementModifier(entity, mode), legal: true, minimumMp: 0 })) };
        bindRecordSheetMovement(svg, () => selection, () => editContext(1), abort.signal, () => {})(selection);
        const run = svg.getElementById('mpRun')!.getBoundingClientRect();
        const jumpBadge = badge(svg, 'mpJump').getBoundingClientRect();
        const jump = svg.getElementById('mpJump')!.getBoundingClientRect();
        expect(jumpBadge.left).toBeGreaterThan(run.right);
        const role = svg.querySelector<SVGTextElement>('[data-mekbay-field="role"]')!;
        expect(jump.right).withContext(role.outerHTML).toBeLessThan(role.getBoundingClientRect().left);
    });

    for (const Factory of [TestTankEntity, TestVtolEntity, TestAeroSpaceFighterEntity, TestWarShipEntity,
        TestBattleArmorEntity, TestInfantryEntity, TestProtoMekEntity]) {
        it(`binds ${Factory.name} movement from the non-Mek runtime`, async () => {
            const entity = new Factory();
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
            entity.uuid.set(uuid);
            entity.originalWalkMP.set(5);
            const unit = createNonMekRuntimeForTest('sheet-move', { entity: uuid, ruleset: 'core-2026',
                initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' } },
                entity, 'core-2026');
            const svg = await mount(entity);
            const snapshot = () => ({ ...projectNonMekRecordSheet(entity, unit.getIndex(), unit.snapshot(),
                'core-2026', 0, 0, unit.getCrewAssignment()), editContext: editContext(unit.snapshot().stateRevision) });
            const binding = bindNonMekRecordSheet(svg, snapshot(), () => {});
            cleanups.push(() => binding.destroy());
            expect(svg.getElementById('mpStationary')).not.toBeNull();
            expect(unit.dispatch({ type: 'set-movement', movement: {
                mode: 'stationary', distance: 0, boosterComponentIds: [],
            } }).accepted).toBeTrue();
            binding.render(snapshot());
            expect(svg.getElementById('mpStationary')!.classList).toContain('currentMoveMode');
            expect(svg.getElementById('mpWalk')?.classList).not.toContain('currentMoveMode');
        });
    }

    it('provides controls for both QuadVee movement columns', async () => {
        const svg = await mount(new TestQuadVeeEntity());
        for (const id of ['mpWalk', 'mpRun', 'mpCruise', 'mpFlank']) {
            expect(control(svg, id)).not.toBeNull();
            expect(svg.getElementById(`${id}-label`)).not.toBeNull();
        }
    });
});
