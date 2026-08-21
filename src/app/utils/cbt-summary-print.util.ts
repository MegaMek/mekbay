// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { PrintAllOptions } from '../models/print-options.model';
import type { Unit, UnitComponent } from '../models/units.model';
import { printInOverlay } from './print-overlay.util';
import {
    createPrintRosterHeader,
    createPrintRosterQrMarkup,
    getPrintRosterBrandingStyles,
} from './print-roster-branding.util';

type CBTSummaryPrintOptions = Pick<PrintAllOptions, 'printPilotData' | 'printMargin'>;

export class CBTSummaryPrintUtil {
    public static async print(
        force: CBTForce,
        printOptions: CBTSummaryPrintOptions,
        triggerPrint: boolean = true,
    ): Promise<void> {
        const forceUnits = force.units();
        if (forceUnits.length === 0) {
            console.warn('No units to export.');
            return;
        }

        await printInOverlay({
            containerId: 'cbt-summary-print-container',
            bodyClass: 'cbt-summary-print-active',
            content: await this.createRosterSummary(force, printOptions.printPilotData),
            styles: this.getPrintStyles(printOptions.printMargin),
            triggerPrint,
        });
    }

    private static async createRosterSummary(
        force: CBTForce,
        printPilotData: boolean,
    ): Promise<string> {
        let totalBaseBv = 0;
        let totalFinalBv = 0;
        const groupSections: string[] = [];

        for (const group of force.groups()) {
            const groupUnits = group.units();
            if (groupUnits.length === 0) continue;

            const bodyRows: string[] = [];
            for (const forceUnit of groupUnits) {
                const unit = forceUnit.getUnit();
                totalBaseBv += unit.bv ?? 0;
                totalFinalBv += this.getPrintableBv(forceUnit, printPilotData);
                bodyRows.push(this.createRosterTableRow(forceUnit, printPilotData));
            }

            const groupBv = groupUnits.reduce(
                (total, forceUnit) => total + this.getPrintableBv(forceUnit, printPilotData),
                0,
            );
            groupSections.push(`
                <section class="cbt-roster-group-section">
                    <table class="cbt-roster-table">
                        <thead>
                            <tr class="cbt-roster-group-heading">
                                <th class="cbt-roster-group-heading-cell" colspan="13">
                                    <div class="cbt-roster-group-header">
                                        <span class="cbt-roster-group-name">${this.escapeHtml(group.groupDisplayName())}</span>
                                        <span class="cbt-roster-group-bv">BV: ${groupBv.toLocaleString()}</span>
                                    </div>
                                </th>
                            </tr>
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
                        <tbody>${bodyRows.join('')}</tbody>
                    </table>
                </section>
            `);
        }

        const qrMarkup = await createPrintRosterQrMarkup(
            force,
            'print-roster-qr-inline print-roster-qr-block',
        );

        return `
            <main class="cbt-roster-summary">
                <div class="cbt-roster-sheet">
                    ${createPrintRosterHeader(force).outerHTML}
                    <div class="cbt-roster-groups">${groupSections.join('')}</div>
                    <div class="cbt-roster-footer">Base BV: ${totalBaseBv.toLocaleString()} · Total BV: ${totalFinalBv.toLocaleString()}</div>
                    ${qrMarkup}
                </div>
            </main>
        `;
    }

    private static createRosterTableRow(forceUnit: CBTForceUnit, printPilotData: boolean): string {
        const unit = forceUnit.getUnit();
        const alias = printPilotData ? forceUnit.alias() : undefined;
        const model = unit.model || '';
        const chassisLine = alias ? `${unit.chassis} (${alias})` : unit.chassis;
        const typeSubtype = [unit.type || '', unit.subtype && unit.subtype !== unit.type ? unit.subtype : '']
            .filter(Boolean)
            .join(' / ');

        return `
            <tr class="cbt-roster-unit-entry">
                <td class="col-unit">
                    ${model ? `<div class="cbt-roster-unit-model">${this.escapeHtml(model)}</div>` : ''}
                    <div class="cbt-roster-unit-chassis">${this.escapeHtml(chassisLine)}</div>
                </td>
                <td class="col-type">${this.escapeHtml(typeSubtype)}</td>
                <td class="col-role">${this.escapeHtml(unit.role && unit.role !== 'None' ? unit.role : '')}</td>
                <td class="col-base-bv is-numeric">${this.formatNumber(unit.bv)}</td>
                <td class="col-gp is-numeric">${printPilotData ? `${forceUnit.gunnerySkill()}/${forceUnit.pilotingSkill()}` : ''}</td>
                <td class="col-bv is-numeric is-bold">${this.formatNumber(this.getPrintableBv(forceUnit, printPilotData))}</td>
                <td class="col-tons is-numeric">${this.formatNumber(unit.tons)}</td>
                <td class="col-year">${this.createYearValue(unit)}</td>
                <td class="col-rules">${this.escapeHtml(this.formatTechBase(unit.techBase, unit.mixed))}<br/>${this.escapeHtml(unit.level)}</td>
                <td class="col-move">${this.escapeHtml(this.formatMovement(unit))}</td>
                <td class="col-as is-numeric">${this.escapeHtml(this.formatArmorStructure(unit))}</td>
                <td class="col-firepower is-numeric">${this.escapeHtml(this.formatNumber(unit._mdSumNoPhysical) || '—')}<br/>(${this.escapeHtml(this.formatNumber(unit.dpt) || '—')})</td>
                <td class="col-equipment">${this.formatEquipmentSummary(unit)}</td>
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

    private static getPrintableBv(forceUnit: CBTForceUnit, printPilotData: boolean): number {
        return printPilotData ? forceUnit.getBv() : forceUnit.getBaseBv();
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

    private static formatTechBase(techBase: Unit['techBase'], mixed: boolean): string {
        if (!techBase) return '';
        const tech = techBase === 'Inner Sphere' ? 'IS' : 'Clan';
        return mixed ? `Mixed (${tech})` : tech;
    }

    private static formatArmorStructure(unit: Unit): string {
        return `${this.formatNumber(unit.armor) || '0'}/${this.formatNumber(unit.internal) || '0'}`;
    }

    private static formatEquipmentSummary(unit: Unit): string {
        const equipment = this.getExpandedComponents(unit.comp).map(comp => this.formatComponentText(comp));
        const caseLocations = this.getCaseLocations(unit);
        const ammo = this.getAmmoComponents(unit.comp, caseLocations).map(comp => {
            const text = this.formatComponentText(comp);
            return this.hasCaseProtection(caseLocations, comp.l) ? `[${text}]` : text;
        });

        const equipmentMarkup = equipment
            .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
            .join('<span class="cbt-roster-equipment-sep">, </span>');
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
        const aggregated = new Map<string, UnitComponent>();
        for (const component of components ?? []) {
            if (component.t === 'HIDDEN' || component.t === 'S' || component.t === 'X') continue;
            if (component.t === 'C' && component.eq?.hasAnyFlag([
                'F_HEAT_SINK',
                'F_DOUBLE_HEAT_SINK',
                'F_CASE',
                'F_CASE_P',
                'F_CASE_II',
                'F_JUMP_JET',
            ])) continue;

            const key = component.n || '';
            if (!key) continue;

            const existing = aggregated.get(key);
            if (existing) {
                existing.q = (existing.q ?? 1) + (component.q ?? 1);
            } else {
                aggregated.set(key, { ...component });
            }
        }

        return Array.from(aggregated.values()).sort((left, right) => (left.n ?? '').localeCompare(right.n ?? ''));
    }

    private static getAmmoComponents(
        components: UnitComponent[],
        caseLocations: ReadonlySet<string>,
    ): UnitComponent[] {
        const aggregated = new Map<string, UnitComponent>();
        for (const component of components ?? []) {
            if (component.t !== 'X') continue;
            const name = component.n?.endsWith(' Ammo') ? component.n.slice(0, -5).trimEnd() : component.n;
            if (!name) continue;

            const protectedByCase = this.hasCaseProtection(caseLocations, component.l);
            const key = `${name}\u0000${protectedByCase}`;

            const existing = aggregated.get(key);
            if (existing) {
                existing.q = (existing.q ?? 1) + (component.q ?? 1);
                existing.q2 = (existing.q2 ?? 0) + (component.q2 ?? 0);
            } else {
                aggregated.set(key, { ...component, n: name });
            }
        }

        return Array.from(aggregated.values()).sort((left, right) => (left.n ?? '').localeCompare(right.n ?? ''));
    }

    private static formatComponentText(component: UnitComponent): string {
        const quantity = component.q ?? 1;
        const secondary = component.q2 ? ` (${component.q2})` : '';
        return `${quantity}×${component.n}${secondary}`;
    }

    private static getCaseLocations(unit: Unit): Set<string> {
        const result = new Set<string>();
        for (const component of unit.comp ?? []) {
            if (!component.eq || !component.l) continue;
            if (component.eq.hasAnyFlag(['F_CASE', 'F_CASE_P', 'F_CASE_II'])) {
                for (const location of this.normalizeLocations(component.l)) {
                    result.add(location);
                }
            }
        }
        return result;
    }

    private static hasCaseProtection(caseLocations: ReadonlySet<string>, location: string): boolean {
        return caseLocations.has('ALL')
            || this.normalizeLocations(location).some(normalized => caseLocations.has(normalized));
    }

    private static normalizeLocations(location: string): string[] {
        if (location.trim() === '*') return ['ALL'];
        return location.split('/').map(part => this.normalizeLocation(part));
    }

    private static normalizeLocation(location: string): string {
        if (!location) return 'UNK';
        let normalized = location.trim().toUpperCase();
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
            @media screen {
                #cbt-summary-print-container {
                    display: none;
                }
            }

            ${getPrintRosterBrandingStyles('#cbt-summary-print-container')}

            #cbt-summary-print-container .cbt-roster-summary {
                width: 100%;
                background: white !important;
            }

            #cbt-summary-print-container .cbt-roster-sheet {
                width: 100%;
                background: white;
                padding: 0.08in 0.12in 0.1in;
                font-family: sans-serif;
                color: #222;
                box-sizing: border-box;
            }

            #cbt-summary-print-container .cbt-roster-groups {
                display: block;
            }

            #cbt-summary-print-container .cbt-roster-group-section {
                margin-bottom: 0.06in;
                break-inside: auto;
                page-break-inside: auto;
            }

            #cbt-summary-print-container .cbt-roster-table thead {
                display: table-header-group;
            }

            #cbt-summary-print-container .cbt-roster-table .cbt-roster-unit-entry,
            #cbt-summary-print-container .cbt-roster-table .cbt-roster-unit-entry > td {
                break-inside: avoid;
                page-break-inside: avoid;
            }

            #cbt-summary-print-container .cbt-roster-group-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.03in 0.01in 0.02in;
                border-top: 1px solid #cfcfcf;
                border-bottom: 1px solid #cfcfcf;
            }

            #cbt-summary-print-container .cbt-roster-table .cbt-roster-group-heading-cell {
                padding: 0;
                border: 0;
                white-space: normal;
            }

            #cbt-summary-print-container .cbt-roster-group-name,
            #cbt-summary-print-container .cbt-roster-group-bv {
                font-weight: 700;
                font-size: 10pt;
            }

            #cbt-summary-print-container .cbt-roster-table {
                width: 100%;
                border-collapse: collapse;
                table-layout: auto;
                font-size: 9pt;
                break-inside: auto;
                page-break-inside: auto;
            }

            #cbt-summary-print-container .cbt-roster-table th,
            #cbt-summary-print-container .cbt-roster-table td {
                padding: 3px 4px;
                border-bottom: 1px solid #d7d7d7;
                vertical-align: middle;
                text-align: center;
                box-sizing: border-box;
                background: white;
            }

            #cbt-summary-print-container .cbt-roster-table th {
                border-bottom: 2px solid #666;
                font-weight: 700;
                white-space: nowrap;
                line-height: 1.1;
            }

            #cbt-summary-print-container .cbt-roster-era-icon {
                width: 12px;
                height: 12px;
                object-fit: contain;
                vertical-align: -1px;
                filter: invert(1);
            }

            #cbt-summary-print-container .cbt-roster-table .is-numeric {
                text-align: center;
                white-space: nowrap;
            }

            #cbt-summary-print-container .cbt-roster-table .is-bold {
                font-weight: 700;
            }

            #cbt-summary-print-container .cbt-roster-table .col-unit {
                min-width: 80px;
            }

            #cbt-summary-print-container .cbt-roster-table .col-unit,
            #cbt-summary-print-container .cbt-roster-table .col-role,
            #cbt-summary-print-container .cbt-roster-table .col-equipment {
                white-space: normal;
            }

            #cbt-summary-print-container .cbt-roster-table .col-unit,
            #cbt-summary-print-container .cbt-roster-table .col-equipment {
                text-align: left;
            }

            #cbt-summary-print-container .cbt-roster-table .col-equipment {
                line-height: 1.22;
            }

            #cbt-summary-print-container .cbt-roster-equipment-ammo-line {
                margin-top: 2px;
            }

            #cbt-summary-print-container .cbt-roster-equipment-ammo-label {
                font-weight: 700;
                margin-right: 3px;
            }

            #cbt-summary-print-container .cbt-roster-equipment-entry {
                white-space: nowrap;
                display: inline;
            }

            #cbt-summary-print-container .cbt-roster-equipment-sep {
                white-space: normal;
            }

            #cbt-summary-print-container .cbt-roster-unit-model {
                font-size: 0.92em;
                color: #555;
                line-height: 1.15;
            }

            #cbt-summary-print-container .cbt-roster-unit-chassis {
                font-weight: 700;
                line-height: 1.15;
            }

            #cbt-summary-print-container .cbt-roster-table .col-year {
                white-space: nowrap;
            }

            #cbt-summary-print-container .cbt-roster-footer {
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.08in;
                padding: 0.05in 0.04in 0;
                border-top: 2px solid #333;
                text-align: right;
                break-inside: avoid;
                page-break-inside: avoid;
            }

            #cbt-summary-print-container .print-roster-qr-block {
                margin: 0.05in 0 0.1in 0.04in;
            }

            #cbt-summary-print-container .cbt-roster-summary-content {
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
                    width: 100% !important;
                    height: auto !important;
                }

                body.cbt-summary-print-active > *:not(#cbt-summary-print-container) {
                    display: none !important;
                }

                #cbt-summary-print-container,
                #cbt-summary-print-container .cbt-roster-summary {
                    display: block;
                    width: 100% !important;
                    height: auto !important;
                    overflow: visible !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }

                @page {
                    size: landscape;
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }
}
