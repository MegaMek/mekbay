// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTForce } from '../models/cbt-force.model';
import { CBTForceMember } from '../models/force-member.model';
import { TestBattleArmorEntity, TestInfantryEntity, TestWarShipEntity } from '../models/entity/testing/test-entities';
import type { PrintAllOptions } from '../models/print-options.model';
import { projectNonMekRecordSheet } from '../models/runtime/non-mek-record-sheet';
import { createNonMekRuntimeForTest } from '../models/runtime/testing/unit-runtime-owner-fixture';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { RecordSheetSourceService } from '../services/record-sheet-source.service';
import { constructionBreakdown } from '../construction/domain/construction-breakdowns';
import { CBTPrintUtil } from './cbtprint.util';
import { RecordSheetSvgGenerator } from './sheets/record-sheet-svg-generator';

describe('manual BV sheet authority', () => {
    afterEach(() => window.dispatchEvent(new Event('afterprint')));

    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        for (const Factory of [TestInfantryEntity, TestBattleArmorEntity, TestWarShipEntity]) {
            it(`generates, binds and prints the exact manual BV for ${Factory.name} in ${ruleset}`, async () => {
                const entity = new Factory();
                entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'));
                entity.manualBV.set(321);
                const runtime = createNonMekRuntimeForTest('manual-bv-print', {
                    entity: entity.uuid(), ruleset,
                    initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
                }, entity, ruleset);
                const force = {
                    getUnitSnapshot: () => ({ entity, ruleset }),
                    getNonMekRecordSheetSnapshot: () => ({
                        ...projectNonMekRecordSheet(entity, runtime.getIndex(), runtime.snapshot(), ruleset,
                            runtime.query().currentBaseBattleValue()!, entity.battleValue(), runtime.getCrewAssignment()),
                        editContext: { owner: runtime, state: runtime.snapshot() },
                    }),
                } as unknown as CBTForce;
                const member = new CBTForceMember('manual-bv-print', force, entity);
                const source = jasmine.createSpyObj<RecordSheetSourceService>('recordSheets', ['load', 'applyUnitName']);
                const rawValues: string[] = [];
                source.load.and.callFake(async (loadedEntity, options) => {
                    const svgs = await RecordSheetSvgGenerator.generatePages(loadedEntity, options);
                    rawValues.push(svgs[0].getElementById('bv')!.textContent!);
                    return { svgs };
                });
                for (const printPilotData of [true, false]) {
                    const options: PrintAllOptions = {
                        paperSize: 'letter', clean: !printPilotData, printPilotData, printMargin: 'none',
                        recordSheetCenterPanelContent: 'clusterTable', ASPrintCardSize: 'standard', ASPrintPageBreakOnGroups: true,
                    };
                    await CBTPrintUtil.multipagePrint([member], options, source, false);
                    const printed = document.querySelector('#record-sheet-print-container [id="bv"]')!;
                    const suffix = entity instanceof TestBattleArmorEntity
                        ? printed.getAttribute('data-mekbay-bv-suffix') ?? '' : '';
                    if (entity instanceof TestBattleArmorEntity) expect(suffix).toMatch(/^\/\d+$/);
                    expect(printed.textContent).toBe(`321${suffix}`);
                    expect(rawValues.at(-1)).toBe(`321${suffix}`);
                    expect(source.load.calls.mostRecent().args[1]?.ruleset).toBe(ruleset);
                    window.dispatchEvent(new Event('afterprint'));
                }
                const breakdown = constructionBreakdown(entity, 'bv');
                expect(breakdown.total).toBe(321);
                expect(breakdown.rows.some(row => /manual.*battle value/i.test(row.label) && row.value === 321)).toBeTrue();
            });
        }
    }
});
