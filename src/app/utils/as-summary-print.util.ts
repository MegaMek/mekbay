// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASForceUnit } from '../models/as-force-unit.model';
import type { ASForce } from '../models/as-force.model';
import type { PrintAllOptions } from '../models/print-options.model';
import type { AsAbilityLookupService } from '../services/as-ability-lookup.service';
import { formatMovement, formatMovementWithAlternate } from './as-common.util';
import { createASPrintRulesReferencePage, getASPrintRulesReferenceStyles } from './as-print-reference.util';
import { printInOverlay } from './print-overlay.util';
import {
    createPrintRosterHeader,
    createPrintRosterQrMarkup,
    getPrintRosterHeading,
    getPrintRosterBrandingStyles,
} from './print-roster-branding.util';

interface RosterCell {
    content: string;
    renderAsHtml?: boolean;
}

type ASSummaryPrintOptions = Pick<PrintAllOptions, 'printMargin'>;
type ASAbilityLookup = Pick<AsAbilityLookupService, 'parseAbility'>;

export class ASSummaryPrintUtil {
    public static async print(
        force: ASForce,
        abilityLookup: ASAbilityLookup,
        useHex: boolean,
        printOptions: ASSummaryPrintOptions,
        triggerPrint: boolean = true,
    ): Promise<void> {
        if (force.units().length === 0) {
            console.warn('No units to export.');
            return;
        }

        const groups = force.groups();
        const forceName = getPrintRosterHeading(force).name;
        const rosterPage = await this.createRosterSummaryPage(force, useHex);
        const rulesReferencePage = createASPrintRulesReferencePage(
            groups,
            abilityLookup,
            useHex,
            forceName,
        );

        await printInOverlay({
            containerId: 'as-summary-print-container',
            bodyClass: 'as-summary-print-active',
            content: rosterPage.outerHTML + rulesReferencePage.outerHTML,
            styles: this.getPrintStyles(printOptions.printMargin),
            triggerPrint,
        });
    }

    private static async createRosterSummaryPage(
        force: ASForce,
        useHex: boolean,
    ): Promise<HTMLElement> {
        const groups = force.groups();
        const container = document.createElement('div');
        container.className = 'as-roster-summary';
        container.appendChild(createPrintRosterHeader(force));

        const table = document.createElement('table');
        table.className = 'as-roster-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const columns = ['Unit', 'TP', 'SZ', 'Skill', 'PV', 'Role', 'TMM', 'MV', 'S', 'M', 'L', 'A+S', 'OV', 'Specials'];
        for (const column of columns) {
            const th = document.createElement('th');
            th.textContent = column;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        let totalPv = 0;
        for (const group of groups) {
            for (const forceUnit of group.units()) {
                const unit = forceUnit.getSummary();
                const as = unit.as;
                const adjustedPv = forceUnit.adjustedPv();
                totalPv += adjustedPv;

                const row = document.createElement('tr');
                const cells: RosterCell[] = [
                    { content: [unit.chassis, unit.model].filter(Boolean).join(' ') },
                    { content: as.TP },
                    { content: String(as.SZ) },
                    { content: String(forceUnit.pilotSkill()) },
                    { content: String(adjustedPv) },
                    { content: unit.role || '' },
                    { content: this.formatRosterTmm(forceUnit) },
                    { content: this.formatRosterMovement(forceUnit, useHex), renderAsHtml: true },
                    { content: as.dmg.dmgS },
                    { content: as.dmg.dmgM },
                    { content: as.dmg.dmgL },
                    { content: `${as.Arm}+${as.Str}` },
                    { content: this.formatOV(as.OV) },
                    { content: (as.specials || []).join(', ') },
                ];
                for (const cell of cells) {
                    row.appendChild(this.createRosterCell(cell));
                }
                tbody.appendChild(row);
            }
        }
        table.appendChild(tbody);
        container.appendChild(table);

        const qrHost = document.createElement('div');
        qrHost.innerHTML = await createPrintRosterQrMarkup(
            force,
            'print-roster-qr-inline print-roster-qr-block',
        );
        const qr = qrHost.firstElementChild;

        const total = document.createElement('div');
        total.className = 'as-roster-footer';
        total.textContent = `Total PV: ${totalPv}`;
        container.appendChild(total);
        if (qr) {
            container.appendChild(qr);
        }

        return container;
    }

    private static formatRosterTmm(forceUnit: ASForceUnit): string {
        const isBattleMek = forceUnit.getSummary().as.TP === 'BM';
        return Object.entries(forceUnit.effectiveTmm())
            .filter(([mode]) => !isBattleMek || (mode !== 'a' && mode !== 'g'))
            .map(([mode, value]) => `${value}${mode}`)
            .join('/');
    }

    private static formatOV(OV: number): string {
        if (OV === 0) return '—';
        return String(OV);
    }

    private static formatRosterMovement(forceUnit: ASForceUnit, useHex: boolean): string {
        const isBattleMek = forceUnit.getSummary().as.TP === 'BM';
        return (Object.entries(forceUnit.effectiveMovement()) as Array<[string, number]>)
            .filter(([mode, value]) => typeof value === 'number'
                && (!isBattleMek || (mode !== 'a' && mode !== 'g')))
            .sort(([left], [right]) => Number(left !== '') - Number(right !== ''))
            .map(([mode, inches]) => this.formatRosterMovementEntry(forceUnit, mode, inches, useHex))
            .join('/');
    }

    private static formatRosterMovementEntry(
        forceUnit: ASForceUnit,
        mode: string,
        inches: number,
        useHex: boolean,
    ): string {
        const display = forceUnit.movementDisplayValue(mode, inches);
        return display.adjustedInches !== undefined
            ? formatMovementWithAlternate(display.baseInches, display.adjustedInches, mode, useHex)
            : formatMovement(display.baseInches, mode, useHex);
    }

    private static createRosterCell(cell: RosterCell): HTMLTableCellElement {
        const td = document.createElement('td');
        if (cell.renderAsHtml) {
            td.innerHTML = cell.content;
        } else {
            td.textContent = cell.content;
        }
        return td;
    }

    private static getPrintStyles(printMargin: PrintAllOptions['printMargin']): string {
        return `
            @media screen {
                #as-summary-print-container {
                    display: none;
                }
            }

            ${this.getRosterSummaryStyles()}
            ${getASPrintRulesReferenceStyles()}
            ${getPrintRosterBrandingStyles('#as-summary-print-container')}

            @media print {
                body, html {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                }

                body.as-summary-print-active > *:not(#as-summary-print-container) {
                    display: none !important;
                }

                #as-summary-print-container {
                    display: block;
                    width: 100% !important;
                    height: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }

                #as-summary-print-container .as-roster-summary,
                #as-summary-print-container .as-rules-reference {
                    width: 100%;
                    background: white;
                    box-sizing: border-box;
                }

                #as-summary-print-container .as-roster-summary {
                    page-break-after: always;
                    break-after: page;
                }

                #as-summary-print-container .as-rules-reference {
                    page-break-after: auto;
                    break-after: auto;
                }

                @page {
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

    private static getRosterSummaryStyles(): string {
        return `
            .as-roster-summary {
                background: white;
                padding: 0.08in 0.12in 0.1in;
                box-sizing: border-box;
                font-family: sans-serif;
                color: #222;
            }

            .as-roster-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 8pt;
            }

            .as-roster-table th {
                font-weight: 700;
                text-align: center;
                padding: 2px 4px;
                border-bottom: 1.5px solid #555;
                white-space: nowrap;
            }

            .as-roster-table td {
                text-align: center;
                padding: 2px 4px;
                border-bottom: 0.5px solid #ddd;
                vertical-align: top;
                white-space: nowrap;
            }

            .as-roster-table :is(th, td):nth-child(1),
            .as-roster-table :is(th, td):nth-child(6),
            .as-roster-table :is(th, td):nth-child(14) {
                text-align: left;
            }

            .as-roster-footer {
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.14in;
                padding: 0.08in 0.04in 0.05in;
                border-top: 2px solid #333;
                text-align: right;
                break-inside: avoid;
                page-break-inside: avoid;
            }

            .as-roster-summary .print-roster-qr-block {
                margin: 0.08in 0 0.05in 0.04in;
            }
        `;
    }
}

