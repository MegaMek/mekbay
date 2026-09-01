// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { AutomationMode } from '../models/options.model';
import { AutomationReviewService } from './automation-review.service';
import { CBTAutomationService } from './cbt-automation.service';
import { OptionsService } from './options.service';

describe('CBTAutomationService', () => {
    const events: AutomationReviewEvent[] = [
        { id: 'one', subject: 'Archer', event: 'Test', description: 'First' },
        { id: 'two', subject: 'Atlas', event: 'Test', description: 'Second' },
    ];
    let mode: AutomationMode;
    let review: jasmine.Spy;
    let service: CBTAutomationService;

    beforeEach(() => {
        mode = 'yes';
        review = jasmine.createSpy('review');
        TestBed.configureTestingModule({ providers: [
            CBTAutomationService,
            { provide: OptionsService, useValue: { cbtAutomationMode: () => mode } },
            { provide: AutomationReviewService, useValue: { review } },
        ] });
        service = TestBed.inject(CBTAutomationService);
    });

    it('maps yes, no, and ask to accept, skip, and shared review', async () => {
        expect([...(await service.resolve('breachAndFloodCheck', events))!]).toEqual(['one', 'two']);
        mode = 'no';
        expect([...(await service.resolve('breachAndFloodCheck', events))!]).toEqual([]);
        mode = 'ask';
        review.and.resolveTo(new Set(['two']));
        expect([...(await service.resolve('breachAndFloodCheck', events))!]).toEqual(['two']);
        review.and.resolveTo(null);
        expect(await service.resolve('breachAndFloodCheck', events)).toBeNull();
    });

    it('opens configured automatic reviews when resumed from a pending badge', async () => {
        review.and.resolveTo(new Set(['one']));

        const result = await service.resolve('heatEffectsCheck', events, {
            title: 'Review Pending Effects',
            interactive: true,
        });

        expect(review).toHaveBeenCalledTimes(1);
        expect([...(result ?? [])]).toEqual(['one']);
    });

    it('opens manual rule work instead of discarding it when its mode is no', async () => {
        mode = 'no';
        review.and.resolveTo(new Set(['two']));

        const result = await service.resolve('criticalHitChanceCheck', events, {
            title: 'Review Critical Hit',
            manualResolution: true,
        });

        expect(review).toHaveBeenCalledOnceWith(events, jasmine.objectContaining({
            manualResolution: true,
        }));
        expect([...(result ?? [])]).toEqual(['two']);
    });

    it('coalesces concurrent compatible family reviews and returns only each caller\'s ids', async () => {
        mode = 'ask';
        review.and.callFake(async (combined: readonly AutomationReviewEvent[]) =>
            new Set([combined[0]!.id, combined[1]!.id]));
        const options = {
            title: 'Review End-Turn Heat',
            message: 'Choose heat.',
            allowCancel: true,
        };

        const [mek, aero] = await Promise.all([
            service.resolve('heatAndDissipationResolution', [events[0]!], options),
            service.resolve('heatAndDissipationResolution', [events[1]!], options),
        ]);

        expect(review).toHaveBeenCalledOnceWith(events, options);
        expect([...(mek ?? [])]).toEqual(['one']);
        expect([...(aero ?? [])]).toEqual(['two']);
    });
});
