import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SessionPersistenceService } from './session-persistence.service';

describe('SessionPersistenceService', () => {
    let service: SessionPersistenceService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                SessionPersistenceService,
            ],
        });

        service = TestBed.inject(SessionPersistenceService);
        sessionStorage.clear();
    });

    afterEach(() => {
        sessionStorage.clear();
    });

    it('reads and writes from sessionStorage when available', () => {
        service.setItem('alpha', 'beta');

        expect(sessionStorage.getItem('alpha')).toBe('beta');
        expect(service.getItem('alpha')).toBe('beta');
    });

    it('falls back to in-memory values when sessionStorage writes fail', () => {
        spyOn(sessionStorage, 'setItem').and.throwError('blocked');

        service.setItem('alpha', 'beta');

        expect(service.getItem('alpha')).toBe('beta');
    });

    it('removes in-memory fallback values when running without sessionStorage', () => {
        spyOn(sessionStorage, 'setItem').and.throwError('blocked');

        service.setItem('alpha', 'beta');

        service.removeItem('alpha');

        expect(service.getItem('alpha')).toBeNull();
    });

    it('returns the mirrored in-memory value when sessionStorage reads fail after a prior write', () => {
        service.setItem('alpha', 'beta');
        spyOn(sessionStorage, 'getItem').and.throwError('blocked');

        expect(service.getItem('alpha')).toBe('beta');
    });
});