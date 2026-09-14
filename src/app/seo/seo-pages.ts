// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Shared by the HTML build, sitemap, and client navigation metadata. */
export interface SeoPage {
    path: string;
    outputFile: string;
    name: string;
    title: string;
    description: string;
    indexable: boolean;
}

export const SITE_URL = 'https://mekbay.com';
export const SEO_PAGES = {
    home: {
        path: '/', outputFile: 'index.html', name: 'MekBay',
        title: 'MekBay: BattleTech Force Builder & Record Sheets',
        description: 'Build and manage BattleTech forces for Classic and Alpha Strike. Search units, balance BV/PV, generate forces, and use interactive or printable record sheets.',
        indexable: true,
    },
    search: {
        path: '/?expanded=true', outputFile: 'search.html', name: 'BattleTech Unit Search',
        title: 'BattleTech Unit Search | MekBay',
        description: 'Search and compare BattleTech units for Classic and Alpha Strike by name, faction, era, role, Battle Value, Point Value, and more.',
        indexable: true,
    },
    forcegenerator: {
        path: '/forcegenerator', outputFile: 'forcegenerator.html', name: 'BattleTech Force Generator',
        title: 'BattleTech Force Generator | MekBay',
        description: 'Generate balanced BattleTech forces for Classic and Alpha Strike by faction, era, unit type, Battle Value, or Point Value.',
        indexable: true,
    },
    meklab: {
        path: '/meklab', outputFile: 'meklab.html', name: 'MekLab: BattleTech Unit Designer',
        title: 'MekLab: BattleTech Unit Designer | MekBay',
        description: 'Design and customize BattleTech units in your browser with MekLab. Configure armor, engines, weapons, and equipment, and create record sheets for your designs.',
        indexable: true,
    },
    collection: {
        path: '/collection', outputFile: 'collection.html', name: 'BattleTech Miniature Collection',
        title: 'BattleTech Miniature Collection | MekBay',
        description: 'Organize your BattleTech miniature collection and use your available units when building forces in MekBay.',
        indexable: false,
    },
    toe: {
        path: '/toe', outputFile: 'toe.html', name: 'BattleTech Table of Organization & Equipment',
        title: 'BattleTech Table of Organization & Equipment | MekBay',
        description: 'Organize your BattleTech forces with the MekBay Table of Organization and Equipment workspace.',
        indexable: false,
    },
} satisfies Record<string, SeoPage>;

/** Individual designs depend on catalog/user data and are not public landing pages. */
export const MEKLAB_DESIGN_SEO: SeoPage = {
    ...SEO_PAGES.meklab,
    outputFile: 'meklab-design.html',
    indexable: false,
};

export function seoForUrl(url: string): { page: SeoPage; indexable: boolean } {
    const parsed = new URL(url, SITE_URL);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const page = path === '/'
        ? (parsed.searchParams.get('expanded') === 'true' ? SEO_PAGES.search : SEO_PAGES.home)
        : /^\/meklab\/[^/]+$/.test(path)
            ? MEKLAB_DESIGN_SEO
            : Object.values(SEO_PAGES).find(candidate => candidate.path === path) ?? SEO_PAGES.home;
    // Match the server's policy: only the canonical landing URLs are indexable.
    // Shared forces, filters, workspaces, and arbitrary paths must not become search results.
    return { page, indexable: page.indexable && parsed.pathname + parsed.search === page.path };
}

export function pageStructuredData(page: SeoPage): object {
    const canonicalUrl = SITE_URL + page.path;
    return {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        '@id': canonicalUrl + '#webapplication',
        name: page.name === 'MekBay' ? page.name : `MekBay ${page.name}`,
        url: canonicalUrl,
        description: page.description,
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript and a modern web browser.',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: SITE_URL + '/images/ogimage.jpg',
        author: {
            '@type': 'Organization', '@id': 'https://megamek.org/#organization',
            name: 'MegaMek', alternateName: 'The MegaMek Team', url: 'https://megamek.org/',
        },
        publisher: { '@id': 'https://megamek.org/#organization' },
        sameAs: ['https://github.com/MegaMek/mekbay', 'https://discord.gg/megamek'],
    };
}
