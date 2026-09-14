// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MEKLAB_DESIGN_SEO, SEO_PAGES, SITE_URL, pageStructuredData, type SeoPage } from '../src/app/seo/seo-pages';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replaceRequired(html: string, pattern: RegExp, replacement: string): string {
    if (!pattern.test(html)) throw new Error(`Cannot generate SEO HTML: missing ${pattern} in index.html.`);
    return html.replace(pattern, () => replacement);
}

export function renderSeoPage(sourceHtml: string, page: SeoPage): string {
    let html = replaceRequired(sourceHtml, /<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`);
    const canonicalUrl = SITE_URL + page.path;
    html = replaceRequired(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`);
    const tags = [
        ['name', 'description', page.description],
        ['property', 'og:title', page.title],
        ['property', 'og:description', page.description],
        ['property', 'og:url', canonicalUrl],
        ['name', 'twitter:title', page.title],
        ['name', 'twitter:description', page.description],
    ];
    for (const [attribute, name, content] of tags) {
        html = replaceRequired(html, new RegExp(`<meta ${attribute}="${name}" content="[^"]*"\\s*\\/?>`),
            `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`);
    }
    html = html.replace(/<meta name="robots"[^>]*>\s*/g, '');
    html = replaceRequired(html, /<\/head>/, `<meta name="robots" content="${page.indexable ? 'index, follow' : 'noindex, follow'}">\n</head>`);
    html = replaceRequired(html, /<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/,
        `<script id="mekbay-page-schema" type="application/ld+json">${JSON.stringify(pageStructuredData(page)).replace(/</g, '\\u003c')}</script>`);
    const links = Object.values(SEO_PAGES).filter(candidate => candidate.indexable)
        .map(candidate => `<a href="${escapeHtml(candidate.path)}">${escapeHtml(candidate.name)}</a>`).join(' · ');
    // Visible before bootstrap and without JavaScript; Angular replaces app-root normally.
    html = replaceRequired(html, /<!-- seo-content:start -->[\s\S]*?<!-- seo-content:end -->/,
        `<!-- seo-content:start --><section class="mekbay-seo-intro"><h1>${escapeHtml(page.name)}</h1><p>${escapeHtml(page.description)}</p><nav aria-label="MekBay tools">${links}</nav></section><!-- seo-content:end -->`);
    return html;
}

export function generateSeoPages(outputDirectory: string): void {
    const sourceHtml = fs.readFileSync(path.join(outputDirectory, 'index.html'), 'utf8');
    for (const page of [...Object.values(SEO_PAGES), MEKLAB_DESIGN_SEO]) {
        fs.writeFileSync(path.join(outputDirectory, page.outputFile), renderSeoPage(sourceHtml, page));
    }
    const urls = Object.values(SEO_PAGES).filter(page => page.indexable)
        .map(page => `  <url><loc>${escapeHtml(SITE_URL + page.path)}</loc></url>`).join('\n');
    fs.writeFileSync(path.join(outputDirectory, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);

    // Angular already hashed index.html. Rebuild the manifest AFTER all HTML changes,
    // otherwise a fresh service-worker install fails its integrity check.
    if (fs.existsSync(path.join(outputDirectory, 'ngsw.json'))) {
        execFileSync(process.execPath, [
            path.join(projectDirectory, 'node_modules/@angular/service-worker/ngsw-config.js'),
            '.', path.relative(outputDirectory, path.join(projectDirectory, 'ngsw-config.json')), '/',
        ], { cwd: outputDirectory, stdio: 'inherit' });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const outputDirectory = path.resolve(process.argv[2] ?? path.join(projectDirectory, 'dist/browser'));
    generateSeoPages(outputDirectory);
    console.log(`Generated SEO pages, sitemap, and service-worker hashes in ${outputDirectory}`);
}
