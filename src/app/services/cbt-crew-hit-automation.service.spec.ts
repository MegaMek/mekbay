// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { AutomationCheck } from '../models/automation-check.model';
import {
    CBTAutomationCheckService,
    resolveAutomationChecksAutomatically,
} from './cbt-automation-check.service';
import {
    automaticConsciousnessNotifications,
    automaticConsciousnessRecoveryNotification,
    CBTCrewHitAutomationService,
} from './cbt-crew-hit-automation.service';

describe('CBTCrewHitAutomationService', () => {
    let resolveChecks: jasmine.Spy;
    let service: CBTCrewHitAutomationService;

    beforeEach(() => {
        resolveChecks = jasmine.createSpy('resolve').and.callFake(
            async (_key: string, checks: readonly AutomationCheck[]) =>
                resolveAutomationChecksAutomatically(checks),
        );
        TestBed.configureTestingModule({
            providers: [
                CBTCrewHitAutomationService,
                { provide: CBTAutomationCheckService, useValue: { resolve: resolveChecks } },
            ],
        });
        service = TestBed.inject(CBTCrewHitAutomationService);
    });

    it('aggregates Core pilot hits into one consciousness roll', async () => {
        spyOn(Math, 'random').and.returnValue(0.99);

        const result = await service.resolve('Atlas', 'core-2026', 'event', [{
            id: 'pilot', wounds: 0, unconscious: false, unavailable: false, hits: 2,
        }]);

        expect(result).toEqual([jasmine.objectContaining({
            id: 'pilot', wounds: 2, unconscious: false,
            checks: [jasmine.objectContaining({
                resolution: jasmine.objectContaining({ outcome: 'success' }),
            })],
        })]);
        expect(resolveChecks.calls.argsFor(0)[1]).toHaveSize(1);
        expect(resolveChecks.calls.argsFor(0)[1][0]).toEqual(jasmine.objectContaining({
            label: 'Consciousness check',
            description: '2 pilot hits.',
            successLabel: 'STAYS CONSCIOUS',
            failedLabel: 'UNCONSCIOUS',
        }));
    });

    it('stops a Total Warfare sequence when its next consciousness roll fails', async () => {
        spyOn(Math, 'random').and.returnValue(0);

        const result = await service.resolve('Atlas', 'total-warfare', 'event', [{
            id: 'pilot', wounds: 0, unconscious: false, unavailable: false, hits: 2,
        }]);

        expect(result?.[0]).toEqual(jasmine.objectContaining({
            wounds: 2,
            unconscious: true,
            checks: [
                jasmine.objectContaining({ resolution: jasmine.objectContaining({
                    outcome: 'failed', automatic: false,
                }) }),
            ],
        }));
        expect(resolveChecks).toHaveBeenCalledTimes(1);
        expect(resolveChecks.calls.argsFor(0)[1]).toHaveSize(1);
    });

    it('offers the next Total Warfare wound level only after the prior roll succeeds', async () => {
        spyOn(Math, 'random').and.returnValue(0.99);

        const result = await service.resolve('Atlas', 'total-warfare', 'event', [{
            id: 'pilot', wounds: 0, unconscious: false, unavailable: false, hits: 2,
        }]);

        expect(result?.[0]).toEqual(jasmine.objectContaining({
            wounds: 2,
            unconscious: false,
            checks: [
                jasmine.objectContaining({ resolution: jasmine.objectContaining({ outcome: 'success' }) }),
                jasmine.objectContaining({ resolution: jasmine.objectContaining({ outcome: 'success' }) }),
            ],
        }));
        expect(resolveChecks).toHaveBeenCalledTimes(2);
        expect(resolveChecks.calls.allArgs().map(args => args[1].length)).toEqual([1, 1]);
    });

    it('returns cancellation before any caller mutation is required', async () => {
        resolveChecks.and.resolveTo(null);

        expect(await service.resolve('Atlas', 'total-warfare', 'event', [{
            id: 'pilot', wounds: 0, unconscious: false, unavailable: false, hits: 1,
        }])).toBeNull();
    });

    it('keeps every consciousness stage interactive for badge-driven parent work', async () => {
        spyOn(Math, 'random').and.returnValue(0.99);

        await service.resolve('Atlas', 'total-warfare', 'event', [{
            id: 'pilot', wounds: 0, unconscious: false, unavailable: false, hits: 2,
        }], { interactive: true });

        expect(resolveChecks.calls.allArgs().map(args => args[2])).toEqual([
            jasmine.objectContaining({ interactive: true }),
            jasmine.objectContaining({ interactive: true }),
        ]);
    });

    it('supports different hit counts for each crew position in one grouped dialog', async () => {
        spyOn(Math, 'random').and.returnValue(0.99);

        const result = await service.resolve('Tripod', 'core-2026', 'event', [
            { id: 'pilot', wounds: 0, unconscious: false, unavailable: false, hits: 2 },
            { id: 'gunner', wounds: 1, unconscious: false, unavailable: false, hits: 1 },
        ]);

        expect(result).toEqual([
            jasmine.objectContaining({ id: 'pilot', wounds: 2 }),
            jasmine.objectContaining({ id: 'gunner', wounds: 2 }),
        ]);
        expect(resolveChecks.calls.argsFor(0)[1]).toHaveSize(2);
    });

    it('formats automatic consciousness results in origin/next rules stages', () => {
        const result = automaticConsciousnessNotifications([
            {
                id: 'pilot',
                wounds: 2,
                unconscious: false,
                checks: [
                    { targetNumber: 3, resolution: { id: 'pilot:1', outcome: 'success', dice: [3, 2], automatic: false } },
                    { targetNumber: 5, resolution: { id: 'pilot:2', outcome: 'success', dice: [3, 3], automatic: false } },
                ],
            },
            {
                id: 'gunner',
                wounds: 1,
                unconscious: true,
                checks: [
                    { targetNumber: 3, resolution: { id: 'gunner:1', outcome: 'failed', dice: [1, 1], automatic: false } },
                ],
            },
        ], id => id === 'pilot' ? 'Alice' : 'Bob');

        expect(result).toEqual([
            {
                message: 'Consciousness checks — Alice: PASSED (5 vs 3+) — crew member remains conscious; Bob: FAILED (2 vs 3+) — crew member rendered unconscious',
                type: 'error',
            },
            {
                message: 'Consciousness check: PASSED (6 vs 5+) — crew member remains conscious',
                type: 'success',
            },
        ]);
    });

    it('groups automatic consciousness recoveries with their crew names', () => {
        expect(automaticConsciousnessRecoveryNotification([
            { id: 'pilot', targetNumber: 5, total: 8, recovered: true },
            { id: 'gunner', targetNumber: 7, total: 4, recovered: false },
        ], id => id === 'pilot' ? 'Alice' : 'Bob')).toEqual({
            message: 'Consciousness recovery — Alice: PASSED (8 vs 5+) — crew member regained consciousness; Bob: FAILED (4 vs 7+) — crew member remains unconscious',
            type: 'error',
        });
    });
});
