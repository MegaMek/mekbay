// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
    let service: LoggerService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                LoggerService,
            ],
        });

        service = TestBed.inject(LoggerService);
        service.clear();
    });

    it('publishes queued logs with a new array reference', async () => {
        spyOn(console, 'log');

        const before = service.logs();
        service.info('first');
        expect(service.logs()).toBe(before);

        await Promise.resolve();

        const after = service.logs();

        expect(after).not.toBe(before);
        expect(after.length).toBe(1);
        expect(after[0].type).toBe('INFO');
        expect(after[0].message).toBe('first');
    });

    it('keeps only the latest 1000 log entries', async () => {
        spyOn(console, 'log');

        for (let index = 1; index <= 1005; index++) {
            service.info(`entry-${index}`);
        }

        await Promise.resolve();

        const logs = service.logs();
        expect(logs.length).toBe(1000);
        expect(logs[0].message).toBe('entry-6');
        expect(logs[999].message).toBe('entry-1005');
    });

    it('clears all published and pending log entries', async () => {
        spyOn(console, 'warn');

        service.warn('to-clear');
        await Promise.resolve();
        expect(service.logs().length).toBe(1);

        service.clear();
        service.warn('still-pending');
        service.clear();
        await Promise.resolve();

        expect(service.logs()).toEqual([]);
    });

    it('can log while an Angular computed is evaluating', async () => {
        spyOn(console, 'log');
        const calculation = computed(() => {
            service.info('computed log');
            return 42;
        });

        expect(() => calculation()).not.toThrow();
        expect(calculation()).toBe(42);
        expect(service.logs()).toEqual([]);

        await Promise.resolve();

        expect(service.logs().map(entry => entry.message)).toEqual(['computed log']);
    });
});
