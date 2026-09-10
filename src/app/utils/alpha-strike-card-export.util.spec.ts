// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { snapshotAlphaStrikeCard } from './alpha-strike-card-export.util';
import { SvgExportUtil } from './svg-export.util';

describe('Alpha Strike native SVG raster export', () => {
    it('renders night text, nested SVG and filtered art identically at both display zoom levels without overlays', async () => {
        const art = document.createElement('canvas');
        art.width = 12;
        art.height = 6;
        const artContext = art.getContext('2d')!;
        artContext.fillStyle = '#000';
        artContext.fillRect(0, 0, 6, 6);
        artContext.fillStyle = '#fff';
        artContext.fillRect(6, 0, 6, 6);

        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;width:560px;--card-red:#681c0c;';
        const styles = document.createElement('style');
        styles.textContent = `
            .raster-card-title { font: 600 32px 'Roboto Condensed'; fill: var(--card-red); }
            .raster-card-art { mix-blend-mode: lighten; }
            .raster-card-css-filter { filter: saturate(0) invert(1) brightness(1.25); }
        `;
        const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 800" style="width:100%;height:auto">
            <defs><filter id="raster-card-invert" color-interpolation-filters="sRGB">
                <feColorMatrix type="saturate" values="0"/>
                <feComponentTransfer><feFuncR type="linear" slope="-1.25" intercept="1.25"/><feFuncG type="linear" slope="-1.25" intercept="1.25"/><feFuncB type="linear" slope="-1.25" intercept="1.25"/></feComponentTransfer>
            </filter></defs>
            <rect width="1120" height="800" fill="#242424"/>
            <svg x="40" y="40" width="480" height="300" viewBox="0 0 480 300">
                <rect width="480" height="300" fill="#abb3b4"/>
                <text x="20" y="48" class="raster-card-title">CRITICAL HITS</text>
            </svg>
            <image x="640" y="150" width="240" height="120" class="raster-card-art raster-card-css-filter"/>
            <image x="640" y="330" width="240" height="120" class="raster-card-art" filter="url(#raster-card-invert)"/>
            <g data-screen-only="true"><rect width="1120" height="800" fill="#ff0000"/><text>END TURN</text></g>
            <rect class="screen-only" x="700" y="500" width="100" height="100" fill="#00ff00"/>
        </svg>`, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        for (const image of svg.querySelectorAll('image')) image.setAttribute('href', art.toDataURL());
        host.append(styles, svg);
        document.body.appendChild(host);
        const download = spyOn(SvgExportUtil, 'downloadPngBlob').and.stub();
        const createUrl = spyOn(URL, 'createObjectURL').and.callThrough();
        let pngUrl: string | undefined;

        try {
            await document.fonts.load('600 32px "Roboto Condensed"');
            await document.fonts.ready;
            expect(svg.getBoundingClientRect().width).toBe(560);
            const normal = snapshotAlphaStrikeCard(svg);
            svg.style.width = '200%';
            expect(svg.getBoundingClientRect().width).toBe(1120);
            const zoomed = snapshotAlphaStrikeCard(svg);
            expect(zoomed.getAttribute('width')).toBe('1120');
            expect(zoomed.style.width).toBe('');

            // Only intercept the download; Image decoding, fonts, SVG filters and canvas rendering are real.
            await SvgExportUtil.downloadPng([normal, zoomed], 'native-card-raster', { scale: 1 });
            const png = download.calls.mostRecent().args[0];
            pngUrl = URL.createObjectURL(png);
            const image = new Image();
            image.src = pngUrl;
            await image.decode();
            expect(image.naturalWidth).toBe(2240);
            expect(image.naturalHeight).toBe(800);
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
            expect(pixel(20, 20)).toEqual([36, 36, 36, 255]);
            expect(pixel(750, 550)).toEqual([36, 36, 36, 255]);
            expect(pixel(60, 120)).toEqual([171, 179, 180, 255]);
            expect(pixel(700, 210)).toEqual([255, 255, 255, 255]);
            expect(pixel(820, 210)).toEqual([36, 36, 36, 255]);
            expect(pixel(700, 390)).toEqual([255, 255, 255, 255]);
            expect(pixel(820, 390)).toEqual([36, 36, 36, 255]);
            const titlePixels = context.getImageData(60, 50, 300, 50).data;
            let titleInk = 0;
            for (let index = 0; index < titlePixels.length; index += 4) {
                if (titlePixels[index] > 70 && titlePixels[index] < 140 && titlePixels[index + 1] < 60) titleInk++;
            }
            expect(titleInk).toBeGreaterThan(300);
            const left = context.getImageData(0, 0, 1120, 800).data;
            const right = context.getImageData(1120, 0, 1120, 800).data;
            expect(left.every((value, index) => value === right[index])).toBeTrue();

            const serialized = createUrl.calls.allArgs().map(([blob]) => blob)
                .find((blob): blob is Blob => blob instanceof Blob && blob.type.startsWith('image/svg+xml'))!;
            const exported = new DOMParser().parseFromString(await serialized.text(), 'image/svg+xml');
            expect(exported.querySelector('parsererror, foreignObject, .screen-only, [data-screen-only]')).toBeNull();
            expect(Array.from(exported.querySelectorAll('*')).every(element => element.namespaceURI === 'http://www.w3.org/2000/svg')).toBeTrue();
            expect(exported.documentElement.textContent).not.toContain('END TURN');
            expect(exported.documentElement.textContent).toContain('data:font/ttf;base64,');
        } finally {
            if (pngUrl) URL.revokeObjectURL(pngUrl);
            host.remove();
        }
    }, 30000);
});
