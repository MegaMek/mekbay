// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestBipedMekEntity, TestInfantryEntity, TestProtoMekEntity, TestTankEntity } from '../models/entity/testing/test-entities';
import { renderRecordSheetCrewName } from '../components/page-viewer/record-sheet-dom';
import { CBTForce } from '../models/cbt-force.model';
import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../models/cbt-ruleset.model';
import { CBTForceMember } from '../models/force-member.model';
import type { PrintAllOptions } from '../models/print-options.model';
import { projectNonMekRecordSheet } from '../models/runtime/non-mek-record-sheet';
import { createNonMekRuntimeForTest } from '../models/runtime/testing/unit-runtime-owner-fixture';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { isCBTNonMekUnit, type CBTUnit } from '../models/runtime/cbt-unit';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { RecordSheetSourceService } from '../services/record-sheet-source.service';
import { CBTPrintUtil } from './cbtprint.util';
import { RecordSheetSvgGenerator } from './sheets/record-sheet-svg-generator';
import { recordSheetLayoutProfile } from './sheets/layouts/record-sheet-layout-resolver';
import { recordSheetPageProfile } from './sheets/record-sheet-layout';

describe('bulk record sheet pagination and printing', () => {
    afterEach(() => window.dispatchEvent(new Event('afterprint')));

    for (const printPilotData of [true, false]) {
        for (const name of ['', 'Morgan']) {
            it(`shows only missing-field blanks with pilot data ${printPilotData} and name "${name}"`, async () => {
                const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
                renderRecordSheetCrewName(svg, 0, name);
                document.body.appendChild(svg);
                try {
                    const skills = [...svg.querySelectorAll('.skillValue')];
                    const blanks = [...svg.querySelectorAll('.skillBlank')];
                    expect(skills.length).toBe(2);
                    expect(blanks.length).toBe(2);
                    for (const blank of blanks) expect(getComputedStyle(blank).display).toBe('none');
                    (CBTPrintUtil as unknown as { applyPilotDataPrintOption: (svg: SVGSVGElement, show: boolean) => void })
                        .applyPilotDataPrintOption(svg, printPilotData);
                    svg.classList.add('print-preview');
                    for (const skill of skills) expect(getComputedStyle(skill).display === 'none').toBe(!printPilotData);
                    for (const blank of blanks) expect(getComputedStyle(blank).display === 'none').toBe(printPilotData);
                    const showName = printPilotData && name.length > 0;
                    expect(getComputedStyle(svg.getElementById('pilotName0')!).visibility)
                        .toBe(showName ? 'visible' : 'hidden');
                    expect(getComputedStyle(svg.getElementById('blankCrewName0')!).visibility)
                        .toBe(showName ? 'hidden' : 'visible');
                } finally {
                    svg.remove();
                }
            });
        }
    }

    it('retains generated per-trooper battle value when printing without pilot data', async () => {
        const entity = new TestBattleArmorEntity();
        entity.setArmorValue('Squad', 'front', 6);
        const svg = await RecordSheetSvgGenerator.generate(entity, { pageFormat: 'letter' });
        const bv = svg.getElementById('bv')!;
        const suffix = bv.getAttribute('data-mekbay-bv-suffix');
        expect(suffix).toMatch(/^\/\d+$/);
        (CBTPrintUtil as unknown as { applyPilotDataPrintOption: (svg: SVGSVGElement, show: boolean, bv: number) => void })
            .applyPilotDataPrintOption(svg, false, 123);
        expect(bv.textContent).toBe(`123${suffix}`);
    });

    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        for (const family of ['Mek', 'Tank'] as const) {
            it(`reprojects clean ${family} movement, crew and BV without changing live ${ruleset} damage`, async () => {
                let runtime: CBTUnit;
                if (family === 'Mek') {
                    runtime = createDirectMekRuntimeFixture(ruleset).instance;
                } else {
                    const tank = new TestTankEntity();
                    tank.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'));
                    tank.setTonnage(50);
                    tank.originalWalkMP.set(4);
                    runtime = createNonMekRuntimeForTest('clean-print-unit', {
                        entity: tank.uuid(), ruleset,
                        initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
                    }, tank, ruleset);
                }
                const entity = runtime.getUnit();
                const crewPosition = runtime.getCrewAssignment().positions[0];
                // Exercise the production force projections with a real bound runtime.
                const force: CBTForce = Object.assign(Object.create(CBTForce.prototype), {
                    unitStore: { mekUnit: () => runtime, nonMekUnit: () => runtime },
                    memberRegistry: { member: () => null },
                    getUnitSnapshot: () => ({
                        entity, ruleset, index: runtime.getIndex(), state: runtime.snapshot(), query: runtime.query(),
                        editContext: { owner: runtime, state: runtime.snapshot() },
                    }),
                    currentHeatPolicy: () => 'manual',
                    queryInventoryControlTargetRegistry: () => ({ revision: 0, targets: [] }),
                    getUnitCurrentBaseBattleValue: () => 300,
                    getUnitAdjustedBattleValue: () => 350,
                    getUnitPristineBattleValue: () => 1000,
                    getUnitPristineAdjustedBattleValue: () => 1200,
                    getUnitCrewAssignment: () => runtime.getCrewAssignment(),
                });
                const member = new CBTForceMember(runtime.instanceId, force, entity);
                const source = jasmine.createSpyObj<RecordSheetSourceService>('recordSheets', ['load', 'applyUnitName']);
                source.load.and.callFake(async (loadedEntity, options) => ({
                    svgs: await RecordSheetSvgGenerator.generatePages(loadedEntity, { ...options, ruleset }),
                }));
                const prepare = (clean: boolean) => (CBTPrintUtil as unknown as {
                    createPrintSheets: (member: CBTForceMember, clean: boolean, paper: 'letter', source: RecordSheetSourceService)
                        => Promise<readonly { svg: SVGSVGElement }[]>;
                }).createPrintSheets(member, clean, 'letter', source);
                const pristineSheet = (await prepare(true))[0].svg;
                const pristineWalk = pristineSheet.getElementById('mpWalk')!.textContent;
                expect(Number(pristineWalk)).toBeGreaterThan(0);

                if (family === 'Mek') {
                    expect(runtime.dispatch({ type: 'set-heat', heat: 15 }).accepted).toBeTrue();
                } else if (isCBTNonMekUnit(runtime)) {
                    const track = [...runtime.getIndex().damageTracks.values()].find(row => row.system === 'engine')!;
                    expect(runtime.dispatch({ type: 'damage-track', damageTrackId: track.id,
                        amount: 1, target: 'committed', timestamp: 1 }).accepted).toBeTrue();
                }
                expect(runtime.dispatch({ type: 'set-crew-state', positionId: crewPosition.positionId,
                    wounds: 2, unconscious: true, ejected: false }).accepted).toBeTrue();
                const damagedState = runtime.snapshot();
                const damagedSheet = (await prepare(false))[0].svg;
                const cleanSheet = (await prepare(true))[0].svg;

                expect(damagedSheet.getElementById('mpWalk')!.textContent).not.toBe(pristineWalk);
                expect(cleanSheet.getElementById('mpWalk')!.textContent).toBe(pristineWalk);
                expect(cleanSheet.getElementById('mpRun')!.textContent)
                    .toBe(pristineSheet.getElementById('mpRun')!.textContent);
                expect(cleanSheet.getElementById('bv')!.textContent).toBe('1200 (1000)');
                const cleanProjection = family === 'Mek'
                    ? force.getMekRecordSheetSnapshot(runtime.instanceId, true)!
                    : force.getNonMekRecordSheetSnapshot(runtime.instanceId, true)!;
                expect(cleanProjection.crew[0].state.wounds).toBe(0);
                expect(cleanProjection.crew[0].effectiveState).toBe('healthy');
                expect(cleanProjection.crew[0].gunnery).toBe(crewPosition.gunnery);
                expect(cleanProjection.editContext.state).not.toBe(damagedState);
                expect(runtime.snapshot()).toBe(damagedState);
                (CBTPrintUtil as unknown as { applyPilotDataPrintOption: (svg: SVGSVGElement, show: boolean, bv: number) => void })
                    .applyPilotDataPrintOption(cleanSheet, false, 1000);
                expect(cleanSheet.getElementById('bv')!.textContent).toBe('1000');
            });
        }
    }

    for (const format of ['letter', 'a4'] as const) {
        for (const Factory of [TestAeroSpaceFighterEntity, TestTankEntity]) {
            it(`generates and prints ${Factory.name} using ${format} for both SVG geometry and @page`, async () => {
                const entity = new Factory();
                entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'));
                const runtime = createNonMekRuntimeForTest('print-unit', {
                    entity: entity.uuid(), ruleset: CORE_2026_RULESET,
                    initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
                }, entity, CORE_2026_RULESET);
                const force = {
                    getUnitSnapshot: () => ({ entity, ruleset: CORE_2026_RULESET }),
                    getNonMekRecordSheetSnapshot: () => ({
                        ...projectNonMekRecordSheet(entity, runtime.getIndex(), runtime.snapshot(),
                            CORE_2026_RULESET, 100, 100),
                        editContext: { owner: runtime, state: runtime.snapshot() },
                    }),
                } as unknown as CBTForce;
                const member = new CBTForceMember('print-unit', force, entity);
                const source = jasmine.createSpyObj<RecordSheetSourceService>('recordSheets', ['load', 'applyUnitName']);
                source.load.and.callFake(async (loadedEntity, options) => ({
                    svgs: [await RecordSheetSvgGenerator.generate(loadedEntity, options)],
                }));
                const options: PrintAllOptions = {
                    paperSize: format, clean: false, printPilotData: true, printMargin: 'none',
                    recordSheetCenterPanelContent: 'clusterTable', ASPrintCardSize: 'standard', ASPrintPageBreakOnGroups: true,
                };
                const print = spyOn(window, 'print').and.stub();

                await CBTPrintUtil.multipagePrint([member], options, source);

                const profile = recordSheetLayoutProfile(entity, format);
                expect(source.load).toHaveBeenCalledOnceWith(entity, {
                    format: profile.compact ? 'compact' : format, pageFormat: format, ruleset: CORE_2026_RULESET,
                });
                const overlay = document.getElementById('record-sheet-print-container')!;
                const pages = overlay.querySelectorAll(':scope > .record-sheet-print-page > svg');
                const page = recordSheetPageProfile(format);
                expect(pages.length).toBe(1);
                expect(pages[0].getAttribute('viewBox')).toBe(`0 0 ${page.width} ${page.height}`);
                expect(overlay.querySelector(':scope > style')!.textContent)
                    .toContain(`size: ${format === 'a4' ? 'A4' : 'Letter'} portrait`);
                expect(print).toHaveBeenCalledOnceWith();
            });
        }

        for (const [Factory, capacity] of [[TestBattleArmorEntity, 5], [TestInfantryEntity, 4], [TestProtoMekEntity, 5], [TestTankEntity, 2]] as const) {
            it(`prints ${capacity} ${Factory.name} units together on ${format}`, async () => {
                const entity = new Factory();
                const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact', pageFormat: format });
                const profile = recordSheetLayoutProfile(entity, format);
                // Isolate runtime binding while exercising the bulk print planner, compositor, and print overlay.
                spyOn(CBTPrintUtil as unknown as { createPrintSheets: () => Promise<unknown[]> }, 'createPrintSheets').and.callFake(async () => [{
                    ...profile, svg: svg.cloneNode(true), pristineBattleValue: 0,
                }]);
                const options = { paperSize: format, clean: true, printPilotData: true, printMargin: 'none',
                    recordSheetCenterPanelContent: 'clusterTable' } as PrintAllOptions;
                await CBTPrintUtil.multipagePrint(Array.from({ length: capacity + 1 }, () => ({} as CBTForceMember)),
                    options, {} as RecordSheetSourceService, false);
                const overlay = document.getElementById('record-sheet-print-container')!;
                const pages = [...overlay.querySelectorAll('svg')];
                expect(pages.map(page => page.querySelectorAll('.compact-sheet-block').length)).toEqual([capacity, 1]);
                if (Factory === TestBattleArmorEntity || Factory === TestInfantryEntity) {
                    expect(pages[0].querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
                    expect(pages[1].querySelector('[data-mekbay-reference="cluster-hits"]')).not.toBeNull();
                }
                expect(pages[0].getAttribute('width')).toBe(String(recordSheetPageProfile(format).width));
                expect(pages[0].getAttribute('height')).toBe(String(recordSheetPageProfile(format).height));
                expect(overlay.querySelector(':scope > style')!.textContent).toContain('margin: 0 !important');
                expect(overlay.querySelector(':scope > style')!.textContent).not.toContain('0.16in');
            });
        }
    }
});
