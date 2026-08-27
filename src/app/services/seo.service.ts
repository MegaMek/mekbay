// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

interface PageSeo {
    title: string;
    description: string;
    canonicalUrl: string;
}

const HOME_SEO: PageSeo = {
    title: 'MekBay: BattleTech Force Builder & Record Sheets',
    description: 'Build and manage BattleTech forces for Classic and Alpha Strike. Search units, balance BV/PV, generate forces, and use interactive or printable record sheets.',
    canonicalUrl: 'https://mekbay.com/',
};

const FORCE_GENERATOR_SEO: PageSeo = {
    title: 'BattleTech Force Generator | MekBay',
    description: 'Generate balanced BattleTech forces for Classic and Alpha Strike by faction, era, unit type, Battle Value, or Point Value.',
    canonicalUrl: 'https://mekbay.com/forcegenerator',
};

const UNIT_SEARCH_SEO: PageSeo = {
    title: 'BattleTech Unit Search | MekBay',
    description: 'Search and compare BattleTech units for Classic and Alpha Strike by name, faction, era, role, Battle Value, Point Value, and more.',
    canonicalUrl: 'https://mekbay.com/?expanded=true',
};

@Injectable({ providedIn: 'root' })
export class SeoService {
    private readonly document = inject(DOCUMENT);
    private readonly meta = inject(Meta);
    private readonly title = inject(Title);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private initialized = false;

    initialize(): void {
        if (this.initialized) return;
        this.initialized = true;

        this.applyForUrl(this.router.url);
        this.router.events.pipe(
            filter((event): event is NavigationEnd => event instanceof NavigationEnd),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(event => this.applyForUrl(event.urlAfterRedirects));
    }

    private applyForUrl(url: string): void {
        const urlWithoutFragment = url.split('#', 1)[0];
        const queryStart = urlWithoutFragment.indexOf('?');
        const rawPath = queryStart === -1 ? urlWithoutFragment : urlWithoutFragment.slice(0, queryStart);
        const query = queryStart === -1 ? '' : urlWithoutFragment.slice(queryStart + 1);
        const path = rawPath.replace(/\/+$/, '') || '/';
        const isUnitSearch = path === '/' && new URLSearchParams(query).get('expanded') === 'true';
        const isNonIndexableWorkspace = path === '/collection' || path === '/toe';
        const seo = path === '/forcegenerator'
            ? FORCE_GENERATOR_SEO
            : isUnitSearch
                ? UNIT_SEARCH_SEO
                : HOME_SEO;

        this.title.setTitle(seo.title);
        this.meta.updateTag({ name: 'description', content: seo.description });
        this.meta.updateTag({ property: 'og:title', content: seo.title });
        this.meta.updateTag({ property: 'og:description', content: seo.description });
        this.meta.updateTag({ property: 'og:url', content: seo.canonicalUrl });
        this.meta.updateTag({ name: 'twitter:title', content: seo.title });
        this.meta.updateTag({ name: 'twitter:description', content: seo.description });
        if (isNonIndexableWorkspace) {
            this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
        } else {
            this.meta.removeTag('name="robots"');
        }

        let canonical = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
            canonical = this.document.createElement('link');
            canonical.rel = 'canonical';
            this.document.head.appendChild(canonical);
        }
        canonical.href = seo.canonicalUrl;
    }
}
