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

import { ForceUnit } from '../models/force-unit.model';
import { DataService } from '../services/data.service';

/*
 * Author: Drake
 */
export class PrintUtil {

    public static async multipagePrint(dataService: DataService, forceUnits: ForceUnit[], clean: boolean = false, triggerPrint: boolean = true): Promise<void> {
        if (forceUnits.length === 0) {
            console.warn('No units to export.');
            return;
        }

        // Store original heat values and set to 0 for printing
        const originalHeats = new Map<ForceUnit, { current: number, previous: number }>();
        if (!clean) {
            for (const unit of forceUnits) {
                unit.disabledSaving = true;
                originalHeats.set(unit, unit.getHeat());
                unit.setHeat(0);
            }
        }

        // Gather all SVGs as strings
        const svgStrings: string[] = [];
        for (const unit of forceUnits) {
            let svg;
            if (!clean) {
                // dirty sheet if we want to print unit damage and pilot
                await unit.load(); // ensure is loaded
                svg = unit.svg();
            }
            if (!svg) {
                svg = await dataService.getSheet(unit.getUnit().sheets[0]);
            }
            
            await this.nextAnimationFrames(2);

            // Ensure font-size has units
            svg.querySelectorAll('[style]').forEach(el => {
                const style = el.getAttribute('style');
                if (style && /font-size\s*:\s*\d+(\.\d+)?(\s*;|;|$)/i.test(style)) {
                    const fixed = style.replace(
                        /font-size\s*:\s*(\d+(\.\d+)?)(?!\s*[a-zA-Z%])(\s*;?)/gi,
                        (match, num, _, tail) => `font-size: ${num}px${tail || ''}`
                    );
                    if (fixed !== style) {
                        el.setAttribute('style', fixed);
                    }
                }
            });

            // Inline external images so they are guaranteed to render
            await this.embedExternalImages(svg);

            // Serialize, sanitize outer svg tag, ensure namespaces/viewBox
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svg);
            svgString = svgString.replace(
                /^<svg([^>]*)>/,
                (match, attrs) => {
                    let cleanedAttrs = attrs;
                        // .replace(/\sclass="[^"]*"/g, '')
                        // .replace(/\sstyle="[^"]*"/g, '')
                        // .replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, '')
                        // .replace(/\s+$/, '');
                    if (!/viewBox=/.test(cleanedAttrs)) {
                        cleanedAttrs += ' viewBox="0 0 612 792"';
                    }
                    if (!/xmlns=/.test(cleanedAttrs)) {
                        cleanedAttrs += ' xmlns="http://www.w3.org/2000/svg"';
                    }
                    if (!/xmlns:xlink=/.test(cleanedAttrs)) {
                        cleanedAttrs += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
                    }
                    if (!/preserveAspectRatio=/.test(cleanedAttrs)) {
                        cleanedAttrs += ' preserveAspectRatio="xMidYMid meet"';
                    }
                    return `<svg${cleanedAttrs}>`;
                }
            );
            if (svgString) {
                svgStrings.push(svgString);
            }
        }
        await this.generateMultipagePrintContainer(svgStrings, forceUnits, originalHeats, triggerPrint);
    }

    /**
     * Fetches external <image> hrefs and embeds them as data URLs.
     */
    private static async embedExternalImages(svg: SVGSVGElement): Promise<void> {
        const images = Array.from(svg.querySelectorAll('image')) as SVGImageElement[];
        const toDataURL = async (blob: Blob) =>
            new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result));
                fr.onerror = reject;
                fr.readAsDataURL(blob);
            });

        await Promise.all(images.map(async (img) => {
            const href = this.getImageHref(img);
            if (!href || href.startsWith('data:')) return;

            // Resolve relative URLs against document
            let url: string;
            try {
                url = new URL(href, document.baseURI).toString();
            } catch {
                return; // ignore bad URLs
            }

            try {
                const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
                if (!resp.ok) return;
                const blob = await resp.blob();
                const dataUrl = await toDataURL(blob);
                this.setImageHref(img, dataUrl);
            } catch {
                // If CORS blocks fetch, ignore
            }
        }));
    }

    private static getImageHref(img: SVGImageElement): string | null {
        return img.getAttribute('href') ??
               img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    }

    private static setImageHref(img: SVGImageElement, value: string): void {
        img.setAttribute('href', value);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', value);
    }

    /**
     * Generates a multipage print container and waits for images to load before printing.
     */
    private static async generateMultipagePrintContainer(svgStrings: string[],
        forceUnits: ForceUnit[],
        originalHeats: Map<ForceUnit, { current: number, previous: number }>, triggerPrint: boolean = true): Promise<void> {
        let bodyContent = '';
        for (let i = 0; i < svgStrings.length; i++) {
            if (i === svgStrings.length - 1) {
                bodyContent += `<div class="svg-container last-svg">${svgStrings[i]}</div>`;
            } else {
                bodyContent += `<div class="svg-container">${svgStrings[i]}</div>`;
            }
        }
        const overlay = document.createElement('div');
        overlay.id = 'multipage-container';
        overlay.innerHTML = `
            <style>
                @media print {
                    body, html {
                        margin: 0 !important;
                        padding: 0 !important;
                        height: 100% !important;
                        width: 100% !important;
                    }
                    #multipage-container {
                        width: 100% !important;
                        height: 100% !important;
                        padding: 0;
                        margin: 0;
                        left: 0;
                        top: 0;
                        display: block;
                        background: transparent !important;
                    }
                    #multipage-container .svg-container {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        background: white !important;
                        width: 100% !important;
                        height: 100% !important;
                        margin: 0 auto !important;
                        box-sizing: border-box;
                        page-break-after: always;
                        break-after: page;
                        overflow: hidden;
                    }
                    #multipage-container .svg-container.last-svg { 
                        page-break-after: auto !important;
                        break-after: auto !important;
                    }
                    #multipage-container .svg-container > svg {
                        display: block;
                        box-sizing: border-box;
                        padding: 0;
                        margin: 0in 0.16in;
                        transform: none !important;
                        height: 100%;
                        width: auto;
                        max-width: 100%;
                        min-width: 0;
                        max-height: 100%;
                        page-break-inside: avoid;
                        break-inside: avoid;
                    }
                }
            </style>${bodyContent}`;

        document.body.appendChild(overlay);
        document.body.classList.add('multipage-container-active');

        // Wait for fonts and all <image> elements in the SVGs
        if ((document as any).fonts?.ready) {
            try { await (document as any).fonts.ready; } catch {}
        }
        await this.waitForSvgImagesToLoad(overlay);
        await this.nextAnimationFrames(2);

        // Trigger print
        if (triggerPrint) {
            window.print();
        }

        // Remove overlay on first user interaction
        const removeOverlay = (evt: Event) => {
            console.trace('PrintUtil', evt);
            overlay.remove();
            document.body.classList.remove('multipage-container-active');
            
            if (originalHeats.size > 0) {
                for (const unit of forceUnits) {
                    const heat = originalHeats.get(unit);
                    if (heat) {
                        unit.setHeat(heat.previous);
                        unit.setHeat(heat.current);
                        unit.disabledSaving = false;
                    }
                }
            }

            window.removeEventListener('click', removeOverlay, true);
            window.removeEventListener('keydown', removeOverlay, true);
            window.removeEventListener('pointerdown', removeOverlay, true);
        };
        window.addEventListener('click', removeOverlay, true);
        window.addEventListener('keydown', removeOverlay, true);
        window.addEventListener('pointerdown', removeOverlay, true);
    }

    private static async waitForSvgImagesToLoad(root: ParentNode): Promise<void> {
        const imgs = Array.from(root.querySelectorAll('image')) as SVGImageElement[];
        if (imgs.length === 0) return;

        await Promise.all(imgs.map(img => new Promise<void>((resolve) => {
            const done = () => resolve();
            // If already a data URL, nothing to wait for
            const href = this.getImageHref(img);
            if (!href || href.startsWith('data:')) return resolve();

            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            // Safety timeout
            setTimeout(done, 4000);
        })));
    }

    private static async nextAnimationFrames(n: number = 1): Promise<void> {
        for (let i = 0; i < n; i++) {
            await new Promise<void>(r => requestAnimationFrame(() => r()));
        }
    }

}