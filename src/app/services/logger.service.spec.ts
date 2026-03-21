import { provideZonelessChangeDetection } from '@angular/core';
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

    it('appends logs with a new array reference', () => {
        spyOn(console, 'log');

        const before = service.logs();
        service.info('first');
        const after = service.logs();

        expect(after).not.toBe(before);
        expect(after.length).toBe(1);
        expect(after[0].type).toBe('INFO');
        expect(after[0].message).toBe('first');
    });

    it('keeps only the latest 1000 log entries', () => {
        spyOn(console, 'log');

        for (let index = 1; index <= 1005; index++) {
            service.info(`entry-${index}`);
        }

        const logs = service.logs();
        expect(logs.length).toBe(1000);
        expect(logs[0].message).toBe('entry-6');
        expect(logs[999].message).toBe('entry-1005');
    });

    it('clears all log entries', () => {
        spyOn(console, 'warn');

        service.warn('to-clear');
        expect(service.logs().length).toBe(1);

        service.clear();

        expect(service.logs()).toEqual([]);
    });
});