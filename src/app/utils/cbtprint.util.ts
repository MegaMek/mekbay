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

import type { HeatProfile, SerializedC3NetworkGroup } from '../models/force-serialization';
import type { SheetService } from '../services/sheet.service';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PrintAllOptions } from '../models/print-options.model';
import type { Unit, UnitComponent } from '../models/units.model';
import { C3NetworkType } from '../models/c3-network.model';
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
        return this.createRosterCardMarkup(forceUnit);
    }

    private static createRosterCardMarkup(forceUnit: CBTForceUnit): string {
        const unit = forceUnit.getUnit();
        const alias = forceUnit.alias();
        const model = unit.model || '';
        const chassisLine = alias ? `${unit.chassis} (${alias})` : unit.chassis;
        const displayName = [chassisLine, model].filter(Boolean).join(' ');
        const baseBv = unit.bv ?? null;
        const adjustedBv = forceUnit.getBv();
        const typeSubtype = [unit.type || '', unit.subtype && unit.subtype !== unit.type ? unit.subtype : '']
            .filter(Boolean)
            .join(' / ');
        const equipmentDetails = this.formatEquipmentDetails(unit);
        const adjustedBvMarkup = this.formatNumber(adjustedBv) || '—';
        const adjustedBvWithBaseMarkup = baseBv !== null && baseBv !== adjustedBv
            ? `${adjustedBvMarkup} (${this.formatNumber(baseBv) || '—'})`
            : adjustedBvMarkup;
        const networkMarkup = this.formatNetworkMarkup(forceUnit);
        const role = unit.role && unit.role !== 'None' ? unit.role : '—';
        const roleTypeLine = typeSubtype ? `${role} — ${typeSubtype}` : role;
        const detailItems = [
            this.createRosterCardDetailMarkup('Gunnery / Piloting', `${forceUnit.gunnerySkill()} / ${forceUnit.pilotingSkill()}`),
            this.createRosterCardDetailMarkup('BV', adjustedBvWithBaseMarkup),
            this.createRosterCardDetailMarkup('Tons', this.formatNumber(unit.tons) || '—'),
            this.createRosterCardDetailMarkup('Year', this.createYearValue(unit)),
            this.createRosterCardDetailMarkup('Tech / Rules', `${this.escapeHtml(this.formatTechBase(unit.techBase) || '—')} / ${this.escapeHtml(this.formatNumber(unit.level) || '—')}`),
            this.createRosterCardDetailMarkup('Move', this.escapeHtml(this.formatMovement(unit) || '—')),
            this.createRosterCardDetailMarkup('Armor / Structure', `${this.escapeHtml(this.formatNumber(unit.armor) || '0')} / ${this.escapeHtml(this.formatNumber(unit.internal) || '0')}`),
            this.createRosterCardDetailMarkup('Firepower (Dmg/Turn)', `${this.escapeHtml(this.formatNumber(unit._mdSumNoPhysical) || '—')} (${this.escapeHtml(this.formatNumber(unit.dpt) || '—')})`),
            networkMarkup
                ? this.createRosterCardDetailMarkup('Network', networkMarkup, 'cbt-roster-card-detail cbt-roster-card-detail-wide cbt-roster-card-detail-network')
                : '',
            this.createRosterCardDetailMarkup('Equipment', equipmentDetails.equipment, 'cbt-roster-card-detail cbt-roster-card-detail-wide'),
            equipmentDetails.ammo
                ? this.createRosterCardDetailMarkup('Ammo', equipmentDetails.ammo, 'cbt-roster-card-detail cbt-roster-card-detail-wide')
                : '',
        ].filter(Boolean).join('');

        return `
            <article class="cbt-roster-unit-row cbt-roster-unit-card">
                <div class="cbt-roster-unit-card-header">
                    <div class="cbt-roster-unit-card-title">
                        <div class="cbt-roster-unit-name">${this.escapeHtml(displayName || unit.chassis || 'Unit')}</div>
                    </div>
                    <div class="cbt-roster-unit-card-meta">
                        <div class="cbt-roster-unit-meta-line">${this.escapeHtml(roleTypeLine)}</div>
                    </div>
                </div>
                <div class="cbt-roster-unit-card-details">
                    ${detailItems}
                </div>
            </article>
        `;
    }

    private static createRosterCardDetailMarkup(label: string, value: string, className: string = 'cbt-roster-card-detail'): string {
        return `
            <div class="${className}">
                <span class="cbt-roster-card-label">${label}:</span>
                <span class="cbt-roster-card-value">${value}</span>
            </div>
        `;
    }

    private static formatNetworkMarkup(forceUnit: CBTForceUnit): string {
        const force = forceUnit.force;
        const networks = force?.c3Networks() ?? [];
        if (networks.length === 0) {
            return '';
        }

        const networkInfo = this.getNetworkDisplayInfo(forceUnit, networks);
        if (!networkInfo) {
            return '';
        }

        const primary = this.escapeHtml(networkInfo.primary);
        const secondary = networkInfo.secondary ? this.escapeHtml(networkInfo.secondary) : '';
        return secondary ? `${primary} (${secondary})` : primary;
    }

    private static getNetworkDisplayInfo(
        forceUnit: CBTForceUnit,
        networks: SerializedC3NetworkGroup[]
    ): { primary: string; secondary?: string } | null {
        const unitId = forceUnit.id;
        const peerNetwork = networks.find(network => network.peerIds?.includes(unitId));
        if (peerNetwork) {
            return this.getPeerNetworkDisplayInfo(peerNetwork, networks);
        }

        const masterNetwork = networks.find(network => network.masterId === unitId);
        const parentNetwork = networks.find(network => network.members?.some(member => this.parseNetworkMemberUnitId(member) === unitId));

        if (masterNetwork && parentNetwork) {
            return {
                primary: 'C3 Submaster',
                secondary: this.getNetworkMasterUnitName(forceUnit, parentNetwork.masterId),
            };
        }

        if (masterNetwork) {
            return { primary: 'C3 Master' };
        }

        if (parentNetwork) {
            return {
                primary: 'C3 Slave',
                secondary: this.getNetworkMasterUnitName(forceUnit, parentNetwork.masterId),
            };
        }

        return null;
    }

    private static getPeerNetworkDisplayInfo(
        network: SerializedC3NetworkGroup,
        networks: SerializedC3NetworkGroup[]
    ): { primary: string; secondary?: string } {
        switch (network.type) {
            case C3NetworkType.C3I:
                return {
                    primary: 'C3i',
                    secondary: this.getPeerNetworkLetter(network, networks, C3NetworkType.C3I),
                };
            case C3NetworkType.NOVA:
                return { primary: 'Nova' };
            case C3NetworkType.NAVAL:
                return { primary: 'Naval C3' };
            default:
                return { primary: '—' };
        }
    }

    private static getPeerNetworkLetter(
        network: SerializedC3NetworkGroup,
        networks: SerializedC3NetworkGroup[],
        networkType: C3NetworkType,
    ): string {
        const peerNetworks = networks.filter(entry => entry.type === networkType && (entry.peerIds?.length ?? 0) > 0);
        const index = peerNetworks.findIndex(entry => entry.id === network.id);
        return index >= 0 ? this.indexToLetterLabel(index) : '';
    }

    private static indexToLetterLabel(index: number): string {
        let current = index;
        let label = '';

        do {
            label = String.fromCharCode(65 + (current % 26)) + label;
            current = Math.floor(current / 26) - 1;
        } while (current >= 0);

        return label;
    }

    private static parseNetworkMemberUnitId(member: string): string {
        const [unitId] = member.split(':', 1);
        return unitId;
    }

    private static getNetworkMasterUnitName(forceUnit: CBTForceUnit, masterId: string | undefined): string {
        if (!masterId) {
            return '';
        }

        const masterUnit = forceUnit.force.units().find(unit => unit.id === masterId);
        return masterUnit?.getUnit().chassis || masterUnit?.getUnit().model || '';
    }

    private static createYearValue(unit: Unit): string {
        const year = unit.year ? this.escapeHtml(String(unit.year)) : '—';
        if (!unit._era?.img) {
            return year;
        }

        const eraName = this.escapeHtml(unit._era.name || 'Era');
        const eraSrc = this.escapeHtml(unit._era.img);
        return `<span class="cbt-roster-year-value"><span class="cbt-roster-year-text">${year}</span><img src="${eraSrc}" class="cbt-roster-era-icon" alt="${eraName}" title="${eraName}" /></span>`;
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
            let ground = `${unit.walk} / ${unit.run}`;
            if (unit.run2 && unit.run2 !== unit.run) {
                ground += ` [${unit.run2}]`;
            }
            parts.push(ground);
        }
        if (unit.jump) {
            parts.push(String(unit.jump));
        }
        if (unit.umu) {
            parts.push(String(unit.umu));
        }
        return parts.join(' / ');
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

    private static formatEquipmentDetails(unit: Unit): { equipment: string; ammo: string } {
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
            : '&mdash;';

        const ammoMarkup = ammo.length > 0
            ? ammo
                .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
                .join('<span class="cbt-roster-equipment-sep">, </span>')
            : '';

        return {
            equipment: equipmentMarkup,
            ammo: ammoMarkup,
        };
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
                padding: 0.04in;
                border-bottom: 1px solid #ddd;
                break-inside: avoid;
                page-break-inside: avoid;
                box-sizing: border-box;
                background: white;
            }

            #multipage-container .cbt-roster-unit-card {
                display: block;
            }

            #multipage-container .cbt-roster-unit-card-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 0.18in;
            }

            #multipage-container .cbt-roster-unit-card-title {
                flex: 1 1 auto;
                min-width: 0;
            }

            #multipage-container .cbt-roster-unit-card-meta {
                flex: 0 0 auto;
                text-align: right;
            }

            #multipage-container .cbt-roster-unit-meta-line {
                font-weight: 700;
                line-height: 1.2;
                font-size: 10pt;
            }

            #multipage-container .cbt-roster-unit-card-details {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                column-gap: 0.22in;
                row-gap: 0.02in;
            }

            #multipage-container .cbt-roster-card-detail {
                display: flex;
                align-items: flex-start;
                gap: 0.06in;
                font-size: 10pt;
                line-height: 1.1;
            }

            #multipage-container .cbt-roster-card-detail-wide {
                grid-column: 1 / -1;
                margin: 0;
            }

            #multipage-container .cbt-roster-card-detail-network {
                padding-top: 0;
            }

            #multipage-container .cbt-roster-card-label {
                flex: 0 0 auto;
                font-weight: 400;
            }

            #multipage-container .cbt-roster-card-value {
                min-width: 0;
                font-weight: 700;
            }

            #multipage-container .cbt-roster-year-value {
                display: inline-flex;
                align-items: center;
                gap: 0.02in;
                white-space: nowrap;
            }

            #multipage-container .cbt-roster-year-text {
                line-height: 1;
            }

            #multipage-container .cbt-roster-era-icon {
                width: 16px;
                height: 16px;
                object-fit: contain;
                flex: 0 0 auto;
                vertical-align: middle;
                margin-top: -2px;
                filter: invert(1);
            }

            #multipage-container .cbt-roster-equipment-entry,
            #multipage-container .cbt-roster-equipment-sep {
                white-space: normal;
            }

            #multipage-container .cbt-roster-unit-name {
                font-weight: 700;
                line-height: 1.2;
                font-size: 13pt;
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
                #multipage-container .cbt-roster-unit-card {
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