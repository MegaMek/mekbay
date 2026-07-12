import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { GameSystem } from '../models/common.model';
import { UrlService, computeGameSystemOverride } from './url.service';

describe('UrlService', () => {
    let service: UrlService;
    let router: Router;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([{ path: '', children: [] }]),
            ],
        });
        service = TestBed.inject(UrlService);
        router = TestBed.inject(Router);
    });

    async function flushPendingWrites(): Promise<void> {
        // setQueryParams coalesces via setTimeout(0); the navigation itself is async too.
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    it('coalesces same-tick writes into a single merge navigation', async () => {
        const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

        service.setQueryParams({ a: '1' });
        service.setQueryParams({ b: 2, c: null });
        await flushPendingWrites();

        expect(navigateSpy).toHaveBeenCalledTimes(1);
        expect(navigateSpy).toHaveBeenCalledWith([], {
            queryParams: { a: '1', b: 2, c: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });

    it('ignores undefined values and skips navigation when nothing changes', async () => {
        const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

        service.setQueryParams({ a: undefined });
        await flushPendingWrites();

        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('merges params into the current URL and removes null params', async () => {
        await router.navigateByUrl('/?a=1&b=2');

        service.setQueryParams({ b: null, c: '3' });
        await flushPendingWrites();

        expect(router.url).toBe('/?a=1&c=3');
    });

    it('defers writes while a navigation is in flight', async () => {
        const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);
        const currentNavigationSpy = spyOn(router, 'currentNavigation').and.returnValue({} as any);

        service.setQueryParams({ a: '1' });
        await flushPendingWrites();
        expect(navigateSpy).not.toHaveBeenCalled();

        currentNavigationSpy.and.returnValue(null);
        await router.navigateByUrl('/'); // emits NavigationEnd, which resumes the pending flush
        await flushPendingWrites();
        expect(navigateSpy).toHaveBeenCalledTimes(1);
    });

    describe('computeGameSystemOverride', () => {
        it('returns null when only gs is present', () => {
            expect(computeGameSystemOverride(new URLSearchParams('gs=' + GameSystem.ALPHA_STRIKE), '/')).toBeNull();
        });

        it('returns the game system when meaningful params are present', () => {
            expect(computeGameSystemOverride(new URLSearchParams(`gs=${GameSystem.CLASSIC}&q=atlas`), '/'))
                .toBe(GameSystem.CLASSIC);
        });

        it('treats a page path as meaningful', () => {
            expect(computeGameSystemOverride(new URLSearchParams('gs=' + GameSystem.ALPHA_STRIKE), '/toe'))
                .toBe(GameSystem.ALPHA_STRIKE);
        });

        it('ignores invalid gs values', () => {
            expect(computeGameSystemOverride(new URLSearchParams('gs=bogus&q=atlas'), '/')).toBeNull();
        });
    });
});
