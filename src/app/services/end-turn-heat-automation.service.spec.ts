// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForce } from '../models/cbt-force.model';
import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { TestAeroSpaceFighterEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { createNonMekRuntimeForTest } from '../models/runtime/testing/unit-runtime-owner-fixture';
import { AutomationReviewService } from './automation-review.service';
import {
    CBTAutomationCheckService,
    resolveAutomationChecksAutomatically,
} from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { DirectMekAutomationService } from './direct-mek-automation.service';
import { DirectNonMekAutomationService } from './direct-non-mek-automation.service';
import { MekFallingAutomationService } from './mek-falling-automation.service';
import { OptionsService } from './options.service';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';

const AERO_UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f2');

describe('EndTurnHeatAutomationService', () => {
    it('reviews a mixed Mek and aerospace force in one end-turn heat dialog', async () => {
        const review = jasmine.createSpy('review').and.callFake(
            async (events: readonly AutomationReviewEvent[]) => new Set(events.map(event => event.id)),
        );
        TestBed.configureTestingModule({
            providers: [
                { provide: AutomationReviewService, useValue: { review } },
                {
                    provide: CBTAutomationCheckService,
                    useValue: { resolve: async (_key: string, checks: Parameters<typeof resolveAutomationChecksAutomatically>[0]) =>
                        resolveAutomationChecksAutomatically(checks) },
                },
                { provide: CBTAutomationToastService, useValue: { show: jasmine.createSpy('show') } },
                { provide: MekFallingAutomationService, useValue: {} },
                {
                    provide: OptionsService,
                    useValue: {
                        cbtAutomationMode: () => 'ask',
                        options: () => ({ displayUnitNameFormat: 'innerSphereClan' }),
                    },
                },
            ],
        });
        const mek = createDirectMekRuntimeFixture(CORE_2026_RULESET, 'unit:mixed-mek');
        expect(mek.instance.dispatch({ type: 'set-heat', heat: 24 }).accepted).toBeTrue();
        const aero = aeroRuntime('unit:mixed-aero');
        expect(aero.dispatch({ type: 'set-heat', heat: 10 }).accepted).toBeTrue();
        const snapshots = new Map<string, () => CBTUnitSnapshot>([
            ['unit:mixed-mek', () => Object.freeze({
                instanceId: 'unit:mixed-mek',
                entity: mek.entity,
                index: mek.index,
                uuid: mek.identity,
                ruleset: CORE_2026_RULESET,
                crewAssignment: mek.instance.query().crewAssignment(),
                editContext: { owner: mek.instance, state: mek.instance.snapshot() },
                state: mek.instance.snapshot(),
                query: mek.instance.query(),
            })],
            ['unit:mixed-aero', () => Object.freeze({
                instanceId: 'unit:mixed-aero',
                entity: aero.getUnit(),
                index: aero.getIndex(),
                uuid: AERO_UUID,
                ruleset: CORE_2026_RULESET,
                crewAssignment: aero.getCrewAssignment(),
                editContext: { owner: aero, state: aero.snapshot() },
                state: aero.snapshot(),
                query: aero.query(),
            })],
        ]);
        const force = {
            getUnitSnapshot: (instanceId: string) => snapshots.get(instanceId)?.() ?? null,
        } as unknown as CBTForce;

        const [mekRows, aeroRows] = await Promise.all([
            TestBed.inject(DirectMekAutomationService).prepareEndTurnCommands(force, [{
                instanceId: 'unit:mixed-mek',
                command: { type: 'end-turn', policy: 'automatic' },
            }]),
            TestBed.inject(DirectNonMekAutomationService).prepareEndTurnCommands(force, [{
                instanceId: 'unit:mixed-aero',
                command: { type: 'end-turn', policy: 'automatic' },
            }]),
        ]);

        expect(mekRows).not.toBeNull();
        expect(aeroRows).not.toBeNull();
        expect(review).toHaveBeenCalledTimes(1);
        expect((review.calls.argsFor(0)[0] as readonly AutomationReviewEvent[]).map(event => event.id))
            .toEqual(['end-turn-heat:unit:mixed-mek', 'end-turn-heat:unit:mixed-aero']);
    });
});

function aeroRuntime(instanceId: string) {
    const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({}));
    entity.uuid.set(AERO_UUID);
    entity.structuralIntegrity.set(10);
    entity.heatSinkCount.set(0);
    return createNonMekRuntimeForTest(instanceId, Object.freeze({
        entity: AERO_UUID,
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    }), entity, CORE_2026_RULESET);
}
