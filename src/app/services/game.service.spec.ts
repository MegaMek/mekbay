// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GameSystem } from '../models/common.model';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameService } from './game.service';
import { OptionsService } from './options.service';
import { UrlService } from './url.service';

describe('GameService URL synchronization', () => {
    let router: Router;
    let urls: UrlService;
    const hasForces = signal(false);

    beforeEach(() => {
        hasForces.set(false);
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([{ path: '', children: [] }, { path: 'collection', children: [] }]),
                { provide: OptionsService, useValue: { options: signal({ gameSystem: GameSystem.AS }) } },
                { provide: ForceWorkspaceStateService, useValue: {
                    hasForces,
                    forceGameSystem: signal(null),
                } },
            ],
        });
        router = TestBed.inject(Router);
        urls = TestBed.inject(UrlService);
        spyOn(urls, 'getGameSystemOverride').and.returnValue(null);
        TestBed.inject(GameService);
    });

    async function settle(): Promise<void> {
        TestBed.tick();
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
        TestBed.tick();
    }

    it('removes a bare game system on the homepage and routed pages', async () => {
        for (const path of ['/', '/collection']) {
            await router.navigateByUrl(`${path}?gs=cbt`);
            await settle();
            expect(router.url).toBe(path);
        }
    });

    it('adds the selected system when search starts and removes it when search clears', async () => {
        await router.navigateByUrl('/');
        await settle();
        expect(router.url).toBe('/');

        urls.setQueryParams({ q: 'atlas' });
        await settle();
        await settle();
        expect(router.parseUrl(router.url).queryParams).toEqual({ q: 'atlas', gs: GameSystem.AS });

        urls.setQueryParams({ q: null });
        await settle();
        expect(router.url).toBe('/');
    });

    it('leaves a loaded force game system to force URL synchronization', async () => {
        hasForces.set(true);
        await router.navigateByUrl('/?units=Atlas&gs=cbt');
        await settle();
        expect(router.parseUrl(router.url).queryParams['gs']).toBe(GameSystem.CBT);
    });
});
