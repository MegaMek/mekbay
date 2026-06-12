import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { UrlStateService } from './url-state.service';

async function flushUrlUpdate(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('UrlStateService', () => {
    let service: UrlStateService;
    let replaceStateSpy: jasmine.Spy;

    beforeEach(() => {
        history.replaceState({}, '', '/?units=alpha&filters=heavy');
        replaceStateSpy = jasmine.createSpy('replaceState');

        TestBed.configureTestingModule({
            providers: [
                UrlStateService,
                { provide: Location, useValue: { replaceState: replaceStateSpy } },
            ],
        });

        service = TestBed.inject(UrlStateService);
        service.initialStateConsumed.set(true);
    });

    afterEach(() => {
        history.replaceState({}, '', '/');
    });

    it('shows only the exclusive params while an override is active', async () => {
        service.setExclusiveParams({ toe: 'org-42' });
        await flushUrlUpdate();

        expect(replaceStateSpy).toHaveBeenCalledWith('/?toe=org-42');
    });

    it('restores the underlying url params after clearing the exclusive override', async () => {
        service.setParams({ units: 'bravo', filters: null, instance: 'force-99' });
        service.setExclusiveParams({ toe: 'org-42' });
        await flushUrlUpdate();

        replaceStateSpy.calls.reset();

        service.setExclusiveParams(null);
        await flushUrlUpdate();

        expect(replaceStateSpy).toHaveBeenCalledWith('/?units=bravo&instance=force-99');
    });

    it('reflects the page path while a page is open and restores root when it closes', async () => {
        service.openPage('toe');
        await flushUrlUpdate();

        expect(replaceStateSpy).toHaveBeenCalledWith('/toe?units=alpha&filters=heavy');

        replaceStateSpy.calls.reset();

        service.closePage('toe');
        await flushUrlUpdate();

        expect(replaceStateSpy).toHaveBeenCalledWith('/?units=alpha&filters=heavy');
    });

    it('does not reset the page path when a different page closes', async () => {
        service.openPage('collection');
        await flushUrlUpdate();

        replaceStateSpy.calls.reset();

        service.closePage('toe');
        await flushUrlUpdate();

        expect(replaceStateSpy).not.toHaveBeenCalled();
    });
});