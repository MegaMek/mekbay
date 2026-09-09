// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestInfantryEntity, TestProtoMekEntity, TestTankEntity } from '../models/entity/testing/test-entities';
import type { CBTForce } from '../models/cbt-force.model';
import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import { CBTForceMember } from '../models/force-member.model';
import type { PrintAllOptions } from '../models/print-options.model';
import { projectNonMekRecordSheet } from '../models/runtime/non-mek-record-sheet';
import { createNonMekRuntimeForTest } from '../models/runtime/testing/unit-runtime-owner-fixture';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { RecordSheetSourceService } from '../services/record-sheet-source.service';
import { CBTPrintUtil } from './cbtprint.util';
import { RecordSheetSvgGenerator } from './sheets/record-sheet-svg-generator';
import { recordSheetLayoutProfile } from './sheets/layouts/record-sheet-layout-resolver';
import { recordSheetPageProfile } from './sheets/record-sheet-layout';

describe('bulk record sheet pagination and printing', () => {
    afterEach(() => window.dispatchEvent(new Event('afterprint')));

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
                    getUnitSnapshot: () => ({ entity }),
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
                    format: profile.compact ? 'compact' : format, pageFormat: format,
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
                expect(pages[0].getAttribute('width')).toBe(String(recordSheetPageProfile(format).width));
                expect(pages[0].getAttribute('height')).toBe(String(recordSheetPageProfile(format).height));
                expect(overlay.querySelector(':scope > style')!.textContent).toContain('margin: 0 !important');
                expect(overlay.querySelector(':scope > style')!.textContent).not.toContain('0.16in');
            });
        }
    }
});
