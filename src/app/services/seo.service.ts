// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SITE_URL, pageStructuredData, seoForUrl } from '../seo/seo-pages';

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

        // router.url is still '/' while a cold deep link waits for catalog data.
        this.applyForUrl(this.document.location.pathname + this.document.location.search);
        this.router.events.pipe(
            filter((event): event is NavigationEnd => event instanceof NavigationEnd),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(event => this.applyForUrl(event.urlAfterRedirects));
    }

    private applyForUrl(url: string): void {
        const { page: seo, indexable } = seoForUrl(url);
        const canonicalUrl = SITE_URL + seo.path;
        const isPreview = this.document.location.hostname !== 'mekbay.com';

        this.title.setTitle(seo.title);
        this.meta.updateTag({ name: 'description', content: seo.description });
        this.meta.updateTag({ property: 'og:title', content: seo.title });
        this.meta.updateTag({ property: 'og:description', content: seo.description });
        this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
        this.meta.updateTag({ name: 'twitter:title', content: seo.title });
        this.meta.updateTag({ name: 'twitter:description', content: seo.description });
        this.meta.updateTag({ name: 'robots', content: indexable && !isPreview ? 'index, follow' : 'noindex, follow' });

        let canonical = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
            canonical = this.document.createElement('link');
            canonical.rel = 'canonical';
            this.document.head.appendChild(canonical);
        }
        canonical.href = canonicalUrl;

        let schema = this.document.head.querySelector<HTMLScriptElement>('#mekbay-page-schema');
        if (!schema) {
            schema = this.document.createElement('script');
            schema.id = 'mekbay-page-schema';
            schema.type = 'application/ld+json';
            this.document.head.appendChild(schema);
        }
        schema.textContent = JSON.stringify(pageStructuredData(seo));
    }
}
