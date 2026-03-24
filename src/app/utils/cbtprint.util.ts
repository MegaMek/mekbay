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
import type { Unit, UnitComponent } from '../models/units.model';

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
            pages.push(this.createRosterSummaryPage(forceUnits));
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

    private static createRosterSummaryPage(forceUnits: CBTForceUnit[]): string {
        const force = forceUnits[0]?.force;
        if (!force) {
            return `
                <div class="svg-container cbt-roster-summary">
                    <div class="cbt-roster-rotated-frame">
                        <div class="cbt-roster-sheet">
                            <div class="cbt-roster-summary-content">CBT ROSTER</div>
                        </div>
                    </div>
                </div>
            `;
        }

        const groups: CBTForceUnit[][] = [];
        const seenGroupIds = new Set<string>();
        for (const forceUnit of forceUnits) {
            const group = forceUnit.getGroup();
            if (!group || seenGroupIds.has(group.id)) continue;
            seenGroupIds.add(group.id);
            groups.push(group.units() as CBTForceUnit[]);
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

        let totalBaseBv = 0;
        let totalFinalBv = 0;
        const groupSections: string[] = [];

        for (const groupUnits of groups) {
            const group = groupUnits[0]?.getGroup();
            if (!group) continue;

            const bodyRows: string[] = [];

            for (const forceUnit of groupUnits) {
                const unit = forceUnit.getUnit();
                const baseBv = unit.bv ?? 0;
                const finalBv = forceUnit.getBv();

                totalBaseBv += baseBv;
                totalFinalBv += finalBv;

                bodyRows.push(this.createRosterTableRow(forceUnit));
            }

            groupSections.push(`
                <section class="cbt-roster-group-section">
                    <div class="cbt-roster-group-header">
                        <span class="cbt-roster-group-name">${this.escapeHtml(group.groupDisplayName())}</span>
                        <span class="cbt-roster-group-bv">BV: ${group.totalBV().toLocaleString()}</span>
                    </div>
                    <table class="cbt-roster-table">
                        <thead>
                            <tr>
                                <th class="col-unit">Unit</th>
                                <th class="col-type">Type</th>
                                <th class="col-role">Role</th>
                                <th class="col-base-bv">Base BV</th>
                                <th class="col-gp">G/P</th>
                                <th class="col-bv">BV</th>
                                <th class="col-tons">Tons</th>
                                <th class="col-year">Year</th>
                                <th class="col-rules">Tech<br/>Rules</th>
                                <th class="col-move">Move</th>
                                <th class="col-as">A/S</th>
                                <th class="col-firepower">Firepower<br/>(Dmg/Turn)</th>
                                <th class="col-equipment">Equipment</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${bodyRows.join('')}
                        </tbody>
                    </table>
                </section>
            `);
        }

        return `
            <div class="svg-container cbt-roster-summary">
                <div class="cbt-roster-rotated-frame">
                    <div class="cbt-roster-sheet">
                        <div class="cbt-roster-header">
                            ${headerParts.length > 0 ? `<span class="cbt-roster-faction">${this.escapeHtml(headerParts.join(' · '))}</span>` : ''}
                            <span class="cbt-roster-force-name">${this.escapeHtml(force.name || force.displayName())}</span>
                        </div>
                        <div class="cbt-roster-groups">
                            ${groupSections.join('')}
                        </div>
                        <div class="cbt-roster-footer">Base BV: ${totalBaseBv.toLocaleString()} · Total BV: ${totalFinalBv.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        `;
    }

    private static createRosterTableRow(forceUnit: CBTForceUnit): string {
        const unit = forceUnit.getUnit();
        const alias = forceUnit.alias();
        const model = unit.model || '';
        const chassisLine = alias ? `${unit.chassis} (${alias})` : unit.chassis;

        const typeSubtype = [unit.type || '', unit.subtype && unit.subtype !== unit.type ? unit.subtype : '']
            .filter(Boolean)
            .join(' / ');
        const equipment = this.formatEquipmentSummary(unit);

        return `
            <tr>
                <td class="col-unit">
                    ${model ? `<div class="cbt-roster-unit-model">${this.escapeHtml(model)}</div>` : ''}
                    <div class="cbt-roster-unit-chassis">${this.escapeHtml(chassisLine)}</div>
                </td>
                <td class="col-type">${this.escapeHtml(typeSubtype)}</td>
                <td class="col-role">${this.escapeHtml(unit.role && unit.role !== 'None' ? unit.role : '')}</td>
                <td class="col-base-bv is-numeric">${this.formatNumber(unit.bv)}</td>
                <td class="col-gp is-numeric">${forceUnit.gunnerySkill()}/${forceUnit.pilotingSkill()}</td>
                <td class="col-bv is-numeric is-bold">${this.formatNumber(forceUnit.getBv())}</td>
                <td class="col-tons is-numeric">${this.formatNumber(unit.tons)}</td>
                <td class="col-year">${this.createYearValue(unit)}</td>
                <td class="col-rules">${this.escapeHtml(this.formatTechBase(unit.techBase))}<br/>${this.escapeHtml(this.formatNumber(unit.level))}</td>
                <td class="col-move">${this.escapeHtml(this.formatMovement(unit))}</td>
                <td class="col-as is-numeric">${this.escapeHtml(this.formatArmorStructure(unit))}</td>
                <td class="col-firepower is-numeric">${this.escapeHtml(this.formatNumber(unit._mdSumNoPhysical) || '—')}<br/>(${this.escapeHtml(this.formatNumber(unit.dpt) || '—')})</td>
                <td class="col-equipment">${equipment}</td>
            </tr>
        `;
    }

    private static createYearValue(unit: Unit): string {
        const year = unit.year ? this.escapeHtml(String(unit.year)) : '—';
        if (!unit._era?.img) {
            return year;
        }

        const eraName = this.escapeHtml(unit._era.name || 'Era');
        const eraSrc = this.escapeHtml(unit._era.img);
        return `${year} <img src="${eraSrc}" class="cbt-roster-era-icon" alt="${eraName}" title="${eraName}" />`;
    }

    private static formatNumber(value: number | undefined | null): string {
        if (value === undefined || value === null || Number.isNaN(value)) {
            return '';
        }
        return value.toLocaleString();
    }

    private static formatMovement(unit: Unit): string {
        const parts: string[] = [];
        if (unit.walk) {
            let ground = `${unit.walk}/${unit.run}`;
            if (unit.run2 && unit.run2 !== unit.run) {
                ground += `[${unit.run2}]`;
            }
            parts.push(ground);
        }
        if (unit.jump) {
            parts.push(String(unit.jump));
        }
        if (unit.umu) {
            parts.push(String(unit.umu));
        }
        return parts.join('/');
    }

    private static formatTechBase(techBase: Unit['techBase']): string {
        switch (techBase) {
            case 'Inner Sphere':
                return 'IS';
            case 'Mixed':
                return 'Mix';
            default:
                return techBase || '';
        }
    }

    private static formatArmorStructure(unit: Unit): string {
        return `${this.formatNumber(unit.armor) || '0'}/${this.formatNumber(unit.internal) || '0'}`;
    }

    private static formatEquipmentSummary(unit: Unit): string {
        const equipment = this.getExpandedComponents(unit.comp).map(comp => this.formatComponentText(comp));
        const ammo = this.getAmmoComponents(unit.comp).map(comp => {
            const text = this.formatComponentText(comp);
            const caseLabel = this.getCaseLabel(unit, comp.l);
            return caseLabel ? `[${text}]` : text;
        });

        const equipmentMarkup = equipment.length > 0
            ? equipment
                .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
                .join('<span class="cbt-roster-equipment-sep">, </span>')
            : '';

        const ammoMarkup = ammo.length > 0
            ? `
                <div class="cbt-roster-equipment-ammo-line">
                    <span class="cbt-roster-equipment-ammo-label">Ammo:</span>
                    <span class="cbt-roster-equipment-ammo-values">${ammo
                        .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
                        .join('<span class="cbt-roster-equipment-sep">, </span>')}</span>
                </div>
            `
            : '';

        return `${equipmentMarkup}${ammoMarkup}`;
    }

    private static getExpandedComponents(components: UnitComponent[]): UnitComponent[] {
        if (!components?.length) {
            return [];
        }

        const aggregated = new Map<string, UnitComponent>();
        for (const comp of components) {
            if (comp.t === 'HIDDEN' || comp.t === 'S' || comp.t === 'X') continue;
            if (comp.t === 'C') {
                if (comp.eq?.hasAnyFlag(['F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK'])) continue;
                if (comp.eq?.hasAnyFlag(['F_CASE', 'F_CASE_II'])) continue;
                if (comp.eq?.hasAnyFlag(['F_JUMP_JET'])) continue;
            }

            const key = comp.n || '';
            if (!key) continue;

            if (aggregated.has(key)) {
                const existing = aggregated.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
            } else {
                aggregated.set(key, { ...comp });
            }
        }

        return Array.from(aggregated.values()).sort((left, right) => (left.n ?? '').localeCompare(right.n ?? ''));
    }

    private static getAmmoComponents(components: UnitComponent[]): UnitComponent[] {
        if (!components?.length) {
            return [];
        }

        const aggregated = new Map<string, UnitComponent>();
        for (const comp of components) {
            if (comp.t !== 'X') continue;
            const name = comp.n?.endsWith(' Ammo') ? comp.n.slice(0, -5).trimEnd() : comp.n;
            const key = name || '';
            if (!key) continue;

            if (aggregated.has(key)) {
                const existing = aggregated.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
                existing.q2 = (existing.q2 || 0) + (comp.q2 || 0);
            } else {
                aggregated.set(key, { ...comp, n: name });
            }
        }

        return Array.from(aggregated.values()).sort((left, right) => (left.n ?? '').localeCompare(right.n ?? ''));
    }

    private static formatComponentText(comp: UnitComponent): string {
        const quantity = comp.q ?? 1;
        const secondary = comp.q2 ? ` (${comp.q2})` : '';
        return `${quantity}×${comp.n}${secondary}`;
    }

    private static getCaseLabel(unit: Unit, loc: string): string {
        return this.getCaseByLocation(unit).get(this.normalizeLoc(loc)) ?? '';
    }

    private static getCaseByLocation(unit: Unit): Map<string, string> {
        const result = new Map<string, string>();
        for (const comp of unit.comp ?? []) {
            if (!comp.eq || !comp.l) continue;

            let label: string | undefined;
            if (comp.eq.hasFlag('F_CASE_II')) label = '[CASE II]';
            else if (comp.eq.hasFlag('F_CASE') || comp.eq.hasFlag('F_CASE_P')) label = '[CASE]';

            if (label) {
                result.set(this.normalizeLoc(comp.l), label);
            }
        }
        return result;
    }

    private static normalizeLoc(loc: string): string {
        if (!loc) return 'UNK';
        let normalized = loc === '*' ? 'ALL' : loc.trim();
        normalized = normalized.replace(/[^A-Za-z0-9_-]/g, '');
        if (/^[0-9]/.test(normalized)) {
            normalized = `L${normalized}`;
        }
        return normalized || 'UNK';
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
            #multipage-container .cbt-roster-summary {
                position: relative;
                background: white !important;
                overflow: hidden;
            }

            #multipage-container .cbt-roster-rotated-frame {
                position: absolute;
                top: 0;
                left: 100%;
                width: 100vh;
                height: 100vw;
                transform: rotate(90deg);
                transform-origin: top left;
            }

            #multipage-container .cbt-roster-sheet {
                width: 100%;
                height: 100%;
                background: white;
                padding: 0.08in 0.12in 0.1in;
                font-family: sans-serif;
                color: #222;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
            }

            #multipage-container .cbt-roster-header {
                display: flex;
                align-items: baseline;
                gap: 0.1in;
                padding: 0 0.04in 0.08in;
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
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 0.06in;
                overflow: hidden;
            }

            #multipage-container .cbt-roster-group-section {
                break-inside: avoid;
                page-break-inside: avoid;
            }

            #multipage-container .cbt-roster-group-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.03in 0.01in 0.02in;
                border-top: 1px solid #cfcfcf;
                border-bottom: 1px solid #cfcfcf;
            }

            #multipage-container .cbt-roster-group-name,
            #multipage-container .cbt-roster-group-bv {
                font-weight: 700;
                font-size: 10pt;
            }

            #multipage-container .cbt-roster-table {
                width: 100%;
                border-collapse: collapse;
                table-layout: auto;
                font-size: 9pt;
            }

            #multipage-container .cbt-roster-table th,
            #multipage-container .cbt-roster-table td {
                padding: 3px 4px;
                border-bottom: 1px solid #d7d7d7;
                vertical-align: middle;
                text-align: center;
                box-sizing: border-box;
                background: white;
            }

            #multipage-container .cbt-roster-table th {
                border-bottom: 2px solid #666;
                font-weight: 700;
                white-space: nowrap;
                line-height: 1.1;
            }

            #multipage-container .cbt-roster-era-icon {
                width: 12px;
                height: 12px;
                object-fit: contain;
                vertical-align: -1px;
                filter: invert(1);
            }

            #multipage-container .cbt-roster-table .is-numeric {
                text-align: center;
                white-space: nowrap;
            }

            #multipage-container .cbt-roster-table .is-bold {
                font-weight: 700;
            }

            #multipage-container .cbt-roster-table .col-unit,
            #multipage-container .cbt-roster-table .col-role,
            #multipage-container .cbt-roster-table .col-equipment {
                white-space: normal;
            }

            #multipage-container .cbt-roster-table .col-unit,
            #multipage-container .cbt-roster-table .col-equipment {
                text-align: left;
            }

            #multipage-container .cbt-roster-table .col-equipment {
                line-height: 1.22;
            }

            #multipage-container .cbt-roster-equipment-ammo-line {
                margin-top: 2px;
            }

            #multipage-container .cbt-roster-equipment-ammo-label {
                font-weight: 700;
                margin-right: 3px;
            }

            #multipage-container .cbt-roster-equipment-entry {
                white-space: nowrap;
                display: inline;
            }

            #multipage-container .cbt-roster-equipment-sep {
                white-space: normal;
            }

            #multipage-container .cbt-roster-unit-model {
                font-size: 0.92em;
                color: #555;
                line-height: 1.15;
            }

            #multipage-container .cbt-roster-unit-chassis {
                font-weight: 700;
                line-height: 1.15;
            }

            #multipage-container .cbt-roster-table .col-year {
                white-space: nowrap;
            }

            #multipage-container .cbt-roster-footer {
                text-align: right;
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.08in;
                padding: 0.05in 0.04in 0;
                border-top: 2px solid #333;
            }

            #multipage-container .cbt-roster-summary-content {
                color: #111;
                font-size: 36pt;
                font-weight: 700;
                letter-spacing: 0.08em;
                text-align: center;
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

                #multipage-container .cbt-roster-summary {
                    width: 100% !important;
                    height: 100% !important;
                    min-height: 0 !important;
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

                @page {
                    size: auto;                    
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

}