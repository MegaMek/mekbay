// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

const fs = require('node:fs');
const path = require('node:path');

const outputDirectory = path.resolve(__dirname, '..', 'dist', 'browser');
const indexPath = path.join(outputDirectory, 'index.html');

function replaceRequired(html, pattern, replacement, label, pageName) {
    if (!pattern.test(html)) {
        throw new Error(`Could not generate ${pageName} SEO page: ${label} was not found in index.html.`);
    }
    return html.replace(pattern, replacement);
}

const sourceHtml = fs.readFileSync(indexPath, 'utf8');
const pages = [
    {
        outputFile: 'forcegenerator.html',
        pageName: 'Force Generator',
        schemaName: 'MekBay BattleTech Force Generator',
        title: 'BattleTech Force Generator | MekBay',
        description: 'Generate balanced BattleTech forces for Classic and Alpha Strike by faction, era, unit type, Battle Value, or Point Value.',
        canonicalUrl: 'https://mekbay.com/forcegenerator',
    },
    {
        outputFile: 'search.html',
        pageName: 'Unit Search',
        schemaName: 'MekBay BattleTech Unit Search',
        title: 'BattleTech Unit Search | MekBay',
        description: 'Search and compare BattleTech units for Classic and Alpha Strike by name, faction, era, role, Battle Value, Point Value, and more.',
        canonicalUrl: 'https://mekbay.com/?expanded=true',
    },
];

function generateSeoPage(page) {
    let html = sourceHtml;
    html = replaceRequired(html, /<title>[^<]*<\/title>/, `<title>${page.title}</title>`, 'title', page.pageName);
    html = replaceRequired(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${page.canonicalUrl}">`, 'canonical link', page.pageName);
    html = replaceRequired(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${page.description}">`, 'description', page.pageName);
    html = replaceRequired(html, /<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${page.title}">`, 'Open Graph title', page.pageName);
    html = replaceRequired(html, /<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${page.description}">`, 'Open Graph description', page.pageName);
    html = replaceRequired(html, /<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${page.canonicalUrl}">`, 'Open Graph URL', page.pageName);
    html = replaceRequired(html, /<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${page.title}">`, 'Twitter title', page.pageName);
    html = replaceRequired(html, /<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${page.description}">`, 'Twitter description', page.pageName);
    html = replaceRequired(html, /"name": "MekBay",/, `"name": "${page.schemaName}",`, 'structured-data name', page.pageName);
    html = replaceRequired(html, /"url": "https:\/\/mekbay\.com\/",/, `"url": "${page.canonicalUrl}",`, 'structured-data URL', page.pageName);
    html = replaceRequired(html, /"description": "[^"]*",/, `"description": "${page.description}",`, 'structured-data description', page.pageName);

    const outputPath = path.join(outputDirectory, page.outputFile);
    fs.writeFileSync(outputPath, html);
    console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);
}

for (const page of pages) {
    generateSeoPage(page);
}
