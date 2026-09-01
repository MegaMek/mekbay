// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { AutomationMode } from '../models/options.model';
import { AutomationReviewService } from './automation-review.service';
import { CBTAutomationService } from './cbt-automation.service';
import { OptionsService } from './options.service';

describe('CBTAutomationService', () => {
    const events: AutomationReviewEvent[] = [
        { id: 'one', subject: 'Archer', event: 'Test', description: 'First event' },
        { id: 'two', subject: 'Atlas', event: 'Test', description: 'Second event' },
    ];
    let mode: AutomationMode;
    let review: jasmine.Spy;
    let service: CBTAutomationService;

    beforeEach(() => {
        mode = 'yes';
        review = jasmine.createSpy('review');
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                CBTAutomationService,
                { provide: OptionsService, useValue: { cbtAutomationMode: () => mode } },
                { provide: AutomationReviewService, useValue: { review } },
            ],
        });
        service = TestBed.inject(CBTAutomationService);
    });

    it('accepts every event without a dialog in yes mode', async () => {
        expect(Array.from((await service.resolve('breachAndFloodCheck', events))!)).toEqual(['one', 'two']);
        expect(review).not.toHaveBeenCalled();
    });

    it('rejects every event without a dialog in no mode', async () => {
        mode = 'no';

        expect(Array.from((await service.resolve('breachAndFloodCheck', events))!)).toEqual([]);
        expect(review).not.toHaveBeenCalled();
    });

    it('returns the review decision, including cancellation, in ask mode', async () => {
        mode = 'ask';
        review.and.resolveTo(new Set(['two']));

        expect(Array.from((await service.resolve('breachAndFloodCheck', events))!)).toEqual(['two']);

        review.and.resolveTo(null);
        expect(await service.resolve('breachAndFloodCheck', events)).toBeNull();
    });
});
