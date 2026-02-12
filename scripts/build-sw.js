/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/**
 * Post-build script that uses workbox-build to:
 *  1. Bundle src/sw.ts into the dist output via esbuild
 *  2. Inject the precache manifest into the bundled service worker
 *
 * Run after `ng build`: npm run build:sw
 */

const { injectManifest } = require('workbox-build');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const DIST_DIR = path.resolve(__dirname, '../dist/browser');
const SW_SRC = path.resolve(__dirname, '../src/sw.ts');
const SW_DEST = path.join(DIST_DIR, 'sw.js');

async function buildSW() {
    // 1. Bundle the TypeScript service worker source with esbuild
    console.log('[sw] Bundling service worker with esbuild...');
    await esbuild.build({
        entryPoints: [SW_SRC],
        bundle: true,
        outfile: SW_DEST,
        format: 'esm',
        target: 'es2022',
        minify: true,
        sourcemap: false,
        // The workbox runtime modules are bundled in; no external CDN needed.
    });

    // 2. Inject the precache manifest into the bundled sw.js
    console.log('[sw] Injecting precache manifest...');
    const { count, size, warnings } = await injectManifest({
        swSrc: SW_DEST,   // the already-bundled file
        swDest: SW_DEST,  // overwrite in place
        globDirectory: DIST_DIR,
        globPatterns: [
            '**/*.{js,css,html,webmanifest,ico}',
            'icons/**/*.png',
            'sprites/**/*.json',
        ],
        globIgnores: [
            'sw.js',              // don't precache the SW itself
            'assets/zip/**',      // large zip bundles — cache on demand
            'images/units/**',    // unit images — too many, lazy-cache
        ],
        // Maximum file size to precache (5 MB)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    });

    if (warnings.length) {
        console.warn('[sw] Warnings:', warnings.join('\n'));
    }
    console.log(`[sw] Precached ${count} files (${(size / 1024).toFixed(1)} KB)`);
}

buildSW().catch((err) => {
    console.error('[sw] Build failed:', err);
    process.exit(1);
});
