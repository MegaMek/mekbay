// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { generateSeoPages, renderSeoPage } from './generate-seo-pages';
import { MEKLAB_DESIGN_SEO, SEO_PAGES, SITE_URL, seoForUrl } from '../src/app/seo/seo-pages';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceHtml = fs.readFileSync(path.join(projectDirectory, 'src/index.html'), 'utf8');

test('only intentional public landing URLs are indexable; shared state keeps the correct canonical', () => {
    for (const url of ['/', '/?expanded=true', '/forcegenerator', '/meklab']) {
        const result = seoForUrl(url + '#section');
        assert.equal(result.indexable, true, url);
        assert.equal(result.page.path, url);
    }
    for (const [url, canonical] of [
        ['/?q=Atlas&expanded=true', '/?expanded=true'],
        ['/?units=shared-force', '/'],
        ['/?gs=cbt&shareUnit=BMAnubis_ABS4C&tab=General', '/'],
        ['/forcegenerator?faction=5', '/forcegenerator'],
        ['/meklab?gs=cbt', '/meklab'],
        ['/meklab/00000000-0000-4000-8000-000000000001', '/meklab'],
        ['/meklab/', '/meklab'],
        ['/collection', '/collection'], ['/toe', '/toe'],
        ['/unknown', '/'], ['/meklab/design/extra', '/'],
    ]) {
        const result = seoForUrl(url);
        assert.equal(result.indexable, false, url);
        assert.equal(result.page.path, canonical, url);
    }
});

test('every app page has initial HTML; metadata, JSON-LD and visible content agree', () => {
    const routes = fs.readFileSync(path.join(projectDirectory, 'src/app/app.routes.ts'), 'utf8');
    const paths = [...routes.matchAll(/path: '([^']+)'/g)].map(match => match[1])
        .filter(route => route !== '**' && route !== 'search');
    // MekLab uses an Angular matcher to keep the editor alive when its UUID changes.
    assert.match(routes, /segments\[0\]\?\.path !== 'meklab'/);
    paths.push('meklab');
    for (const route of paths) {
        assert.ok(Object.values(SEO_PAGES).some(page => page.path === '/' + route), `Missing SEO page for ${route}`);
    }
    for (const page of [...Object.values(SEO_PAGES), MEKLAB_DESIGN_SEO]) {
        const html = renderSeoPage(sourceHtml, page);
        const schema = JSON.parse(html.match(/<script id="mekbay-page-schema"[^>]*>([\s\S]*?)<\/script>/)![1]);
        assert.equal(schema.url, SITE_URL + page.path);
        assert.equal(schema['@id'], schema.url + '#webapplication');
        assert.equal(schema.description, page.description);
        assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
        assert.equal((html.match(/type="application\/ld\+json"/g) ?? []).length, 1);
        assert.match(html, new RegExp(`name="robots" content="${page.indexable ? 'index' : 'noindex'}, follow"`));
        assert.match(html, /<h1>[^<]+<\/h1>/);
        assert.match(html, /<a href="\/meklab">/);
        assert.match(html, /<base href="\/">/);
        assert.equal(renderSeoPage(html, page), html, 'Regeneration must not duplicate markup');
    }
});

test('HTML escaping preserves titles, descriptions, and valid structured data', () => {
    const page = { ...SEO_PAGES.home, name: 'Test & <title>', title: 'A & B < C', description: 'A "quote" & </script>' };
    const html = renderSeoPage(sourceHtml, page);
    assert.match(html, /<title>A &amp; B &lt; C<\/title>/);
    assert.match(html, /content="A &quot;quote&quot; &amp; &lt;\/script&gt;"/);
    const schema = JSON.parse(html.match(/<script id="mekbay-page-schema"[^>]*>([\s\S]*?)<\/script>/)![1]);
    assert.equal(schema.description, page.description);
    assert.throws(() => renderSeoPage('<html></html>', page), /missing/);
});

test('postbuild generates the sitemap and regenerates valid service-worker hashes after changing HTML', () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-seo-'));
    try {
        fs.writeFileSync(path.join(outputDirectory, 'index.html'), sourceHtml + '<script src="main-12345678.js" type="module"></script>');
        fs.writeFileSync(path.join(outputDirectory, 'main-12345678.js'), '// test app bundle');
        fs.writeFileSync(path.join(outputDirectory, 'ngsw.json'), '{}');
        generateSeoPages(outputDirectory);
        const sitemap = fs.readFileSync(path.join(outputDirectory, 'sitemap.xml'), 'utf8');
        assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), [
            'https://mekbay.com/', 'https://mekbay.com/?expanded=true',
            'https://mekbay.com/forcegenerator', 'https://mekbay.com/meklab',
        ]);
        const manifest = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'ngsw.json'), 'utf8'));
        for (const file of ['index.html', 'search.html', 'forcegenerator.html', 'meklab.html', 'meklab-design.html', 'collection.html', 'toe.html', 'sitemap.xml']) {
            const contents = fs.readFileSync(path.join(outputDirectory, file));
            if (file === 'index.html' || file === 'sitemap.xml') {
                assert.equal(manifest.hashTable['/' + file], createHash('sha1').update(contents).digest('hex'), file);
            } else {
                assert.equal(manifest.hashTable['/' + file], undefined, 'HTML aliases must reach the server redirect, not the asset cache');
            }
            if (file.endsWith('.html')) assert.match(contents.toString(), /src="main-12345678.js"/);
        }
        const isNavigation = (url: string) => manifest.navigationUrls.some((entry: { positive: boolean; regex: string }) => entry.positive && new RegExp(entry.regex).test(url))
            && !manifest.navigationUrls.some((entry: { positive: boolean; regex: string }) => !entry.positive && new RegExp(entry.regex).test(url));
        for (const url of ['/meklab', '/meklab/00000000-0000-4000-8000-000000000001', '/forcegenerator', '/collection', '/toe']) assert.equal(isNavigation(url), true, url);
        for (const url of ['/search', '/search/', '/meklab.html', '/search.html', '/auth/google/start']) assert.equal(isNavigation(url), false, url);
    } finally {
        assert.equal(path.dirname(path.resolve(outputDirectory)), path.resolve(os.tmpdir()));
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});
