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

import type { HeatProfile } from '../models/force-serialization';
import type { SheetService } from '../services/sheet.service';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PrintAllOptions } from '../models/print-options.model';
import { createPrintRosterLogoMarkup, createPrintRosterQrMarkup, getPrintRosterBrandingStyles } from './print-roster-branding.util';

/*
 * Author: Drake
 */
export class CBTPrintUtil {

    public static async multipagePrint(
        sheetService: SheetService,
        forceUnits: CBTForceUnit[],
        printOptions: PrintAllOptions,
        triggerPrint: boolean = true
    ): Promise<void> {
        if (forceUnits.length === 0) {
            console.warn('No units to export.');
            return;
        }

        const clean = printOptions.clean;

        // Store original heat values and set to 0 for printing
        const originalHeats = new Map<CBTForceUnit, HeatProfile>();
        if (!clean) {
            for (const unit of forceUnits) {
                unit.disabledSaving = true;
                const unitHeat = unit.getHeat();
                originalHeats.set(unit, unitHeat);
                if (unitHeat.heatsinksOff !== undefined) {
                    unit.setHeatsinksOff(0);
                }
                unit.setHeatData({ current: 0, previous: 0, next: undefined });
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
                svg = await sheetService.getSheet(unit.getUnit().sheets[0]);
            }

            await this.nextAnimationFrames(2);

            // Turn on/off fluff image
            const injectedEl = svg.getElementById('fluff-image-fo') as HTMLElement | null;
            if (injectedEl) {
                const centerContent = printOptions.recordSheetCenterPanelContent;
                const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
                if (centerContent === 'fluffImage') {
                    injectedEl.style.setProperty('display', 'block');
                    referenceTables.forEach((rt) => {
                        rt.style.display = 'none';
                    });
                } else {
                    injectedEl.style.setProperty('display', 'none');
                    referenceTables.forEach((rt) => {
                        rt.style.display = 'block';
                    });
                }
            }

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
        await this.generateMultipagePrintContainer(svgStrings, forceUnits, originalHeats, printOptions, triggerPrint);
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
        forceUnits: CBTForceUnit[],
        originalHeats: Map<CBTForceUnit, HeatProfile>,
        printOptions: PrintAllOptions,
        triggerPrint: boolean = true): Promise<void> {
        const pages = svgStrings.map(svg => `<div class="svg-container">${svg}</div>`);
        if (printOptions.printRosterSummary) {
            const rosterPages = await this.createRosterSummaryPages(forceUnits);
            if (rosterPages.length > 0) {
                pages.unshift(...rosterPages);
            }
        }
        if (pages.length > 0) {
            pages[pages.length - 1] = pages[pages.length - 1].replace('svg-container', 'svg-container last-svg');
        }

        const bodyContent = pages.join('');
        const overlay = document.createElement('div');
        overlay.id = 'multipage-container';
        overlay.innerHTML = bodyContent;

        const style = document.createElement('style');
        style.textContent = this.getPrintStyles(printOptions.printMargin);
        overlay.appendChild(style);
        document.body.appendChild(overlay);
        document.body.classList.add('multipage-container-active');

        // Wait for fonts and all <image> elements in the SVGs
        if ((document as any).fonts?.ready) {
            try { await (document as any).fonts.ready; } catch { }
        }
        await this.waitForSvgImagesToLoad(overlay);
        await this.nextAnimationFrames(2);

        // Trigger print
        if (triggerPrint) {
            window.print();
        }

        // Remove overlay on first user interaction
        const removeOverlay = (evt: Event) => {
            overlay.remove();
            document.body.classList.remove('multipage-container-active');

            if (originalHeats.size > 0) {
                for (const unit of forceUnits) {
                    const heat = originalHeats.get(unit);
                    if (heat) {
                        unit.setHeatData(heat);
                        if (heat.heatsinksOff !== undefined) {
                            unit.setHeatsinksOff(heat.heatsinksOff);
                        }
                        unit.disabledSaving = false;
                    }
                }
            }

            window.removeEventListener('click', removeOverlay, { capture: true });
            window.removeEventListener('keydown', removeOverlay, { capture: true });
            window.removeEventListener('pointerdown', removeOverlay, { capture: true });
        };
        window.addEventListener('click', removeOverlay, { capture: true, once: true });
        window.addEventListener('keydown', removeOverlay, { capture: true, once: true });
        window.addEventListener('pointerdown', removeOverlay, { capture: true, once: true });
    }

    private static async waitForSvgImagesToLoad(root: ParentNode): Promise<void> {
        const svgImages = Array.from(root.querySelectorAll('image')) as SVGImageElement[];
        const htmlImages = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];

        await Promise.all([
            ...svgImages.map(img => new Promise<void>((resolve) => {
                const done = () => resolve();
                const href = this.getImageHref(img);
                if (!href || href.startsWith('data:')) return resolve();

                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
                setTimeout(done, 4000);
            })),
            ...htmlImages.map(img => new Promise<void>((resolve) => {
                if (img.complete) {
                    resolve();
                    return;
                }

                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
                setTimeout(done, 4000);
            }))
        ]);
    }

    private static async nextAnimationFrames(n: number = 1): Promise<void> {
        for (let i = 0; i < n; i++) {
            await new Promise<void>(r => requestAnimationFrame(() => r()));
        }
    }

    private static async createRosterSummaryPages(forceUnits: CBTForceUnit[]): Promise<string[]> {
        const force = forceUnits[0]?.force;
        if (!force) {
            return [];
        }

        const headerParts: string[] = [];
        const faction = force.faction();
        if (faction) {
            let factionLabel = faction.name;
            if (faction.group && faction.group !== faction.name) {
                factionLabel += ` · ${faction.group}`;
            }
            headerParts.push(factionLabel);
        }
        const era = force.era();
        if (era) {
            headerParts.push(era.name);
        }

        const groups: CBTForceUnit[][] = [];
        const seenGroupIds = new Set<string>();
        let totalBv = 0;

        for (const forceUnit of forceUnits) {
            totalBv += forceUnit.getBv();
            const group = forceUnit.getGroup();
            if (!group || seenGroupIds.has(group.id)) continue;
            seenGroupIds.add(group.id);
            groups.push(group.units() as CBTForceUnit[]);
        }

        const groupData = groups.map(groupUnits => {
            const group = groupUnits[0]?.getGroup();
            if (!group) {
                return null;
            }

            return {
                groupName: this.escapeHtml(group.groupDisplayName()),
                groupBv: group.totalBV().toLocaleString(),
                rows: groupUnits.map(forceUnit => this.createRosterUnitRowMarkup(forceUnit))
            };
        }).filter((group): group is { groupName: string; groupBv: string; rows: string[] } => group !== null);

        const qrMarkup = await createPrintRosterQrMarkup(force);

        const firstPageCapacity = 8.4;
        const continuationPageCapacity = 9.2;
        const groupHeaderCost = 0.42;
        const rowCost = 0.95;

        type PaginatedRosterSection = {
            groupName: string;
            groupBv: string;
            rows: string[];
        };

        type PaginatedRosterPage = {
            sections: PaginatedRosterSection[];
            remainingCapacity: number;
        };

        const paginatedPages: PaginatedRosterPage[] = [];
        const createPage = (isFirstPage: boolean): PaginatedRosterPage => {
            const page = {
                sections: [],
                remainingCapacity: isFirstPage ? firstPageCapacity : continuationPageCapacity,
            } satisfies PaginatedRosterPage;
            paginatedPages.push(page);
            return page;
        };

        let currentPage = createPage(true);

        for (const group of groupData) {
            for (const row of group.rows) {
                let section = currentPage.sections.at(-1);
                const needsGroupHeader = !section || section.groupName !== group.groupName;
                const requiredCapacity = rowCost + (needsGroupHeader ? groupHeaderCost : 0);

                if (currentPage.remainingCapacity < requiredCapacity) {
                    currentPage = createPage(false);
                    section = undefined;
                }

                if (!section || section.groupName !== group.groupName) {
                    section = {
                        groupName: group.groupName,
                        groupBv: group.groupBv,
                        rows: []
                    };
                    currentPage.sections.push(section);
                    currentPage.remainingCapacity -= groupHeaderCost;
                }

                section.rows.push(row);
                currentPage.remainingCapacity -= rowCost;
            }
        }

        const headerMarkup = `
            <div class="cbt-roster-header">
                ${headerParts.length > 0 ? `<span class="cbt-roster-faction">${this.escapeHtml(headerParts.join(' · '))}</span>` : ''}
                <span class="cbt-roster-force-name">${this.escapeHtml(force.name || force.displayName())}</span>
            </div>
        `;

        const footerMarkup = `
            <div class="cbt-roster-footer">
                ${qrMarkup}
                <div class="cbt-roster-footer-total">Total BV: ${totalBv.toLocaleString()}</div>
            </div>
        `;

        return paginatedPages.map((page, index) => {
            const groupsMarkup = page.sections.map(section => `
                <section class="cbt-roster-group-section">
                    <div class="cbt-roster-group-header">
                        <span class="cbt-roster-group-name">${section.groupName}</span>
                        <span class="cbt-roster-group-bv">BV: ${section.groupBv}</span>
                    </div>
                    <div class="cbt-roster-group-rows">
                        ${section.rows.join('')}
                    </div>
                </section>
            `).join('');

            return `
                <div class="cbt-roster-summary${index === paginatedPages.length - 1 ? ' last-roster-page' : ''}">
                    <div class="cbt-roster-summary-page">
                        ${index === 0 ? headerMarkup : ''}
                        <div class="cbt-roster-groups">
                            ${groupsMarkup}
                        </div>
                        ${index === paginatedPages.length - 1 ? footerMarkup : ''}
                        ${index === 0 ? createPrintRosterLogoMarkup() : ''}
                    </div>
                </div>
            `;
        });
    }

    private static createRosterUnitRowMarkup(forceUnit: CBTForceUnit): string {
        const unit = forceUnit.getUnit();
        const unitName = [unit.chassis, unit.model].filter(Boolean).join(' ');

        return `
            <div class="cbt-roster-unit-row">
                <div class="cbt-roster-unit-card-placeholder">${this.escapeHtml(unitName || unit.chassis || 'Unit')}</div>
            </div>
        `;
    }

    private static escapeHtml(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    private static getPrintStyles(printMargin: PrintAllOptions['printMargin']): string {
        return `
            ${getPrintRosterBrandingStyles('#multipage-container')}

            #multipage-container .cbt-roster-summary {
                display: flex;
                align-items: flex-start;
                justify-content: center;
                background: white !important;
                overflow: visible;
                padding: 0.16in;
            }

            #multipage-container .cbt-roster-summary-page {
                position: relative;
                width: 100%;
                background: white;
                padding: 0.16in;
                box-sizing: border-box;
                font-family: sans-serif;
                color: #222;
                min-height: 100%;
            }

            #multipage-container .cbt-roster-header {
                display: flex;
                align-items: baseline;
                gap: 0.1in;
                padding: 0.04in;
                border-bottom: 2px solid #333;
                margin-bottom: 0.1in;
            }

            #multipage-container .cbt-roster-faction {
                font-size: 10pt;
                color: #555;
            }

            #multipage-container .cbt-roster-faction::after {
                content: ':';
                margin-left: 2px;
            }

            #multipage-container .cbt-roster-force-name {
                font-size: 12pt;
                font-weight: 700;
            }

            #multipage-container .cbt-roster-groups {
                display: flex;
                flex-direction: column;
                gap: 0.12in;
            }

            #multipage-container .cbt-roster-group-section {
                    break-inside: auto;
                    page-break-inside: auto;
            }

            #multipage-container .cbt-roster-group-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.04in 0.04in;
                border-top: 1px solid #bbb;
                border-bottom: 1px solid #bbb;
                font-family: sans-serif;
                color: #333;
                    break-after: avoid-page;
                    page-break-after: avoid;
            }

            #multipage-container .cbt-roster-group-name,
            #multipage-container .cbt-roster-group-bv {
                font-size: 11pt;
                font-weight: 700;
            }

            #multipage-container .cbt-roster-group-rows {
                display: flex;
                flex-direction: column;
            }

            #multipage-container .cbt-roster-unit-row {
                padding: 0.08in 0.04in;
                border-bottom: 1px solid #ddd;
                break-inside: avoid;
                page-break-inside: avoid;
            }

            #multipage-container .cbt-roster-unit-card-placeholder {
                min-height: 0.8in;
                border: 1px solid #bbb;
                background: white;
                display: flex;
                align-items: center;
                padding: 0.12in;
                box-sizing: border-box;
                font-size: 12pt;
                font-weight: 700;
                color: #111;
            }

            #multipage-container .cbt-roster-footer {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 0.12in;
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.14in;
                padding: 0.08in 0.04in 0.05in;
                border-top: 2px solid #333;
                box-sizing: border-box;
            }

            #multipage-container .cbt-roster-footer-total {
                margin-left: auto;
                text-align: right;
                padding-top: 0.04in;
            }

            #multipage-container .cbt-roster-summary .print-roster-logo {
                top: 0.12in;
                right: 0.12in;
                width: 1.35in;
            }

            @media print {
                body, html {
                    margin: 0 !important;
                    padding: 0 !important;
                    height: 100% !important;
                    width: 100% !important;
                }

                body.multipage-container-active > *:not(#multipage-container) {
                    display: none !important;
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

                #multipage-container .cbt-roster-summary,
                #multipage-container .cbt-roster-header,
                #multipage-container .cbt-roster-unit-row,
                #multipage-container .cbt-roster-unit-card-placeholder {
                    break-inside: avoid;
                    page-break-inside: avoid;
                }

                #multipage-container .cbt-roster-summary {
                    page-break-after: always;
                    break-after: page;
                }

                #multipage-container .cbt-roster-group-section,
                #multipage-container .cbt-roster-summary-page {
                    break-inside: auto;
                    page-break-inside: auto;
                }

                #multipage-container .cbt-roster-group-header {
                    break-after: avoid-page;
                    page-break-after: avoid;
                }

                @page {
                    size: auto;
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

}