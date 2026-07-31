import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { OptionsService } from './options.service';

describe('OptionsService theme migration', () => {
    let savedOptions: unknown;
    let dbService: { getOptions: jasmine.Spy; saveOptions: jasmine.Spy };

    async function createService(): Promise<OptionsService> {
        dbService = {
            getOptions: jasmine.createSpy('getOptions').and.callFake(async () => savedOptions),
            saveOptions: jasmine.createSpy('saveOptions').and.resolveTo(undefined),
        };
        TestBed.configureTestingModule({
            providers: [
                OptionsService,
                { provide: DbService, useValue: dbService },
            ],
        });
        const service = TestBed.inject(OptionsService);
        await service.initOptions();
        return service;
    }

    afterEach(() => TestBed.resetTestingModule());

    it('uses the normal theme by default', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().colorScheme).toBe('default');
    });

    it('restores a disabled CBT automations preference', async () => {
        savedOptions = { cbtAutomations: false };

        const service = await createService();

        expect(service.options().cbtAutomations).toBeFalse();
    });

    it('restores the last Unit Search view mode', async () => {
        savedOptions = { unitSearchViewMode: 'chassis' };

        const service = await createService();

        expect(service.initialized()).toBeTrue();
        expect(service.options().unitSearchViewMode).toBe('chassis');
    });

    it('restores the canonical theme color', async () => {
        savedOptions = { colorScheme: 'night' };

        const service = await createService();

        expect(service.options().colorScheme).toBe('night');
    });

    it('migrates legacy sheet and Alpha Strike color settings deterministically', async () => {
        savedOptions = { sheetsColor: 'normal', ASCardStyle: 'colored' };

        const service = await createService();

        expect(service.options().colorScheme).toBe('default');
    });

    it('maps a legacy colored Alpha Strike card style when no sheet color exists', async () => {
        savedOptions = { ASCardStyle: 'colored' };

        const service = await createService();

        expect(service.options().colorScheme).toBe('night');
    });

    it('persists only canonical theme options after an update', async () => {
        savedOptions = { sheetsColor: 'night', ASCardStyle: 'monochrome' };
        const service = await createService();

        await service.setOption('colorScheme', 'default');

        const persisted = dbService.saveOptions.calls.mostRecent().args[0] as Record<string, unknown>;
        expect(persisted['colorScheme']).toBe('default');
        expect(persisted['themeColor']).toBeUndefined();
        expect(persisted['sheetsColor']).toBeUndefined();
        expect(persisted['ASCardStyle']).toBeUndefined();
    });
});
