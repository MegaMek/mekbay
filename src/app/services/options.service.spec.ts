import { TestBed } from '@angular/core/testing';
import type { Options } from '../models/options.model';
import { DbService } from './db.service';
import { normalizeASCardStyle, OptionsService } from './options.service';

describe('ASCardStyle persistence migration', () => {
    it('maps legacy and invalid persisted values to the new contract', () => {
        expect(normalizeASCardStyle('monochrome')).toBe('default');
        expect(normalizeASCardStyle('colored')).toBe('night');
        expect(normalizeASCardStyle('default')).toBe('default');
        expect(normalizeASCardStyle('night')).toBe('night');
        expect(normalizeASCardStyle('invalid')).toBe('default');
        expect(normalizeASCardStyle(undefined)).toBe('default');
    });

    it('persists a normalized legacy value during options loading', async () => {
        const saved = { ASCardStyle: 'colored' } as unknown as Options;
        const dbService = jasmine.createSpyObj<DbService>('DbService', ['getOptions', 'saveOptions']);
        dbService.getOptions.and.resolveTo(saved);
        dbService.saveOptions.and.resolveTo();

        TestBed.configureTestingModule({
            providers: [
                OptionsService,
                { provide: DbService, useValue: dbService },
            ],
        });

        const service = TestBed.inject(OptionsService);
        await service.initOptions();

        expect(service.options().ASCardStyle).toBe('night');
        expect(dbService.saveOptions).toHaveBeenCalled();
        expect(dbService.saveOptions.calls.mostRecent().args[0].ASCardStyle).toBe('night');
    });

    it('does not rewrite an already normalized value', async () => {
        const saved = { ASCardStyle: 'default' } as Options;
        const dbService = jasmine.createSpyObj<DbService>('DbService', ['getOptions', 'saveOptions']);
        dbService.getOptions.and.resolveTo(saved);
        dbService.saveOptions.and.resolveTo();

        TestBed.configureTestingModule({
            providers: [
                OptionsService,
                { provide: DbService, useValue: dbService },
            ],
        });

        const service = TestBed.inject(OptionsService);
        await service.initOptions();

        expect(service.options().ASCardStyle).toBe('default');
        expect(dbService.saveOptions).not.toHaveBeenCalled();
    });
});