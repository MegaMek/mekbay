// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { SeoService } from './seo.service';

describe('SeoService', () => {
    let pageDocument: Document;
    let events: Subject<NavigationEnd>;

    function initialize(pathname = '/meklab', hostname = 'mekbay.com') {
        const isolatedDocument = document.implementation.createHTMLDocument('Initial title');
        pageDocument = new Proxy(isolatedDocument, {
            get(target, key) {
                if (key === 'location') return { pathname, search: '', hostname };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, key, value) { return Reflect.set(target, key, value, target); },
        });
        events = new Subject<NavigationEnd>();
        TestBed.configureTestingModule({ providers: [
            SeoService, Meta, Title,
            { provide: DOCUMENT, useValue: pageDocument },
            { provide: Router, useValue: { url: '/', events } },
        ] });
        const service = TestBed.inject(SeoService);
        service.initialize();
        service.initialize();
    }

    function navigate(url: string) { events.next(new NavigationEnd(1, url, url)); }
    function content(selector: string) { return pageDocument.head.querySelector(selector)?.getAttribute('content'); }

    it('preserves cold-link metadata while the router is waiting for data', () => {
        initialize();
        expect(pageDocument.title).toBe('MekLab: BattleTech Unit Designer | MekBay');
        expect(content('meta[name="robots"]')).toBe('index, follow');
        expect(pageDocument.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://mekbay.com/meklab');
    });

    it('updates and resets every page signal when navigating between designs, workspaces, search, and home', () => {
        initialize();
        for (const [url, canonical, robots] of [
            ['/meklab/00000000-0000-4000-8000-000000000001', '/meklab', 'noindex, follow'],
            ['/collection', '/collection', 'noindex, follow'],
            ['/toe', '/toe', 'noindex, follow'],
            ['/?expanded=true&q=Atlas', '/?expanded=true', 'noindex, follow'],
            ['/?expanded=true', '/?expanded=true', 'index, follow'],
            ['/forcegenerator', '/forcegenerator', 'index, follow'],
            ['/', '/', 'index, follow'],
        ]) {
            navigate(url);
            const schema = JSON.parse(pageDocument.querySelector('#mekbay-page-schema')!.textContent!);
            expect(content('meta[name="robots"]')).withContext(url).toBe(robots);
            expect(content('meta[property="og:url"]')).toBe('https://mekbay.com' + canonical);
            expect(content('meta[property="og:title"]')).toBe(pageDocument.title);
            expect(content('meta[name="twitter:title"]')).toBe(pageDocument.title);
            expect(schema.url).toBe('https://mekbay.com' + canonical);
            expect(schema.description).toBe(content('meta[name="description"]'));
            expect(pageDocument.querySelectorAll('#mekbay-page-schema').length).toBe(1);
            expect(pageDocument.querySelectorAll('link[rel="canonical"]').length).toBe(1);
        }
    });

    it('keeps preview hosts noindex after client navigation', () => {
        initialize('/meklab', 'dev.mekbay.com');
        navigate('/');
        expect(content('meta[name="robots"]')).toBe('noindex, follow');
    });
});
