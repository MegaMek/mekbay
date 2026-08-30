// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { isCaseEquipment } from '../models/case-equipment.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { AmmoEquipment } from '../models/equipment.model';
import type { CBTForceMember } from '../models/force-member.model';
import { isHeatSinkEquipment } from '../models/heat-equipment.model';
import { isJumpJetEquipment } from '../models/jump-equipment.model';
import type { PrintAllOptions } from '../models/print-options.model';
import { printInOverlay } from './print-overlay.util';
import {
    createPrintRosterHeader,
    createPrintRosterQrMarkup,
    getPrintRosterBrandingStyles,
} from './print-roster-branding.util';

type CBTSummaryPrintOptions = Pick<
    PrintAllOptions,
    'printPilotData' | 'paperSize' | 'printMargin'
>;

interface AmmoSummary {
    readonly name: string;
    readonly protectedByCase: boolean;
    bins: number;
    shots: number;
}

/** Prints a force roster from admitted Classic Entity instances. */
export class CBTSummaryPrintUtil {
    public static async print(
        force: CBTForce,
        printOptions: CBTSummaryPrintOptions,
        triggerPrint: boolean = true,
    ): Promise<void> {
        if (force.getClassicMembers().length === 0) {
            console.warn('No units to export.');
            return;
        }

        await printInOverlay({
            containerId: 'cbt-summary-print-container',
            bodyClass: 'cbt-summary-print-active',
            content: await this.createRosterSummary(force, printOptions.printPilotData),
            styles: this.getPrintStyles(printOptions.printMargin, printOptions.paperSize),
            triggerPrint,
        });
    }

    private static async createRosterSummary(
        force: CBTForce,
        printPilotData: boolean,
    ): Promise<string> {
        const members = force.getClassicMembers();
        let totalBaseBv = 0;
        let totalFinalBv = 0;
        const groupSections: string[] = [];

        for (const group of force.groups()) {
            const groupMembers = members.filter(member => member.rosterGroupId === group.id);
            if (groupMembers.length === 0) continue;

            const rows = groupMembers.map(member => {
                totalBaseBv += this.getBaseBv(member);
                totalFinalBv += this.getPrintableBv(member, printPilotData);
                return this.createRosterTableRow(member, printPilotData);
            });
            const groupBv = groupMembers.reduce(
                (total, member) => total + this.getPrintableBv(member, printPilotData),
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
                                <th class="col-firepower">Firepower</th>
                                <th class="col-equipment">Equipment</th>
                            </tr>
                        </thead>
                        <tbody>${rows.join('')}</tbody>
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

    private static createRosterTableRow(member: CBTForceMember, printPilotData: boolean): string {
        const entity = member.entity;
        const primaryCrew = member.force.getUnitCrewAssignment(member.id)?.positions[0];
        const alias = printPilotData ? primaryCrew?.name : undefined;
        const chassis = entity.fullChassis();
        const chassisLine = alias ? `${chassis} (${alias})` : chassis;
        const unitType = entity.unitType();
        const unitSubtype = entity.unitSubtype();
        const typeSubtype = [unitType, unitSubtype !== unitType ? unitSubtype : '']
            .filter(Boolean)
            .join(' / ');
        const maximumDamage = entity.rangedWeapons().reduce(
            (total, mount) => total + entity.resolveMountedWeaponDamage(mount).maximum,
            0,
        );

        return `
            <tr class="cbt-roster-unit-entry">
                <td class="col-unit">
                    ${entity.model() ? `<div class="cbt-roster-unit-model">${this.escapeHtml(entity.model())}</div>` : ''}
                    <div class="cbt-roster-unit-chassis">${this.escapeHtml(chassisLine)}</div>
                </td>
                <td class="col-type">${this.escapeHtml(typeSubtype)}</td>
                <td class="col-role">${this.escapeHtml(entity.role() && entity.role() !== 'None' ? entity.role() : '')}</td>
                <td class="col-base-bv is-numeric">${this.formatNumber(this.getBaseBv(member))}</td>
                <td class="col-gp is-numeric">${printPilotData && primaryCrew ? `${primaryCrew.gunnery}/${primaryCrew.piloting}` : ''}</td>
                <td class="col-bv is-numeric is-bold">${this.formatNumber(this.getPrintableBv(member, printPilotData))}</td>
                <td class="col-tons is-numeric">${this.formatNumber(entity.tonnage())}</td>
                <td class="col-year">${entity.year() || '—'}</td>
                <td class="col-rules">${this.escapeHtml(this.formatTechBase(entity.techBase(), entity.mixedTech()))}<br/>${this.escapeHtml(entity.staticTechLevel())}</td>
                <td class="col-move">${this.escapeHtml(this.formatMovement(entity))}</td>
                <td class="col-as is-numeric">${this.formatNumber(entity.totalArmorPoints()) || '0'}/${this.formatNumber(entity.totalInternalPoints()) || '0'}</td>
                <td class="col-firepower is-numeric">${this.formatNumber(maximumDamage) || '—'}</td>
                <td class="col-equipment">${this.formatEquipmentSummary(entity)}</td>
            </tr>
        `;
    }

    private static getBaseBv(member: CBTForceMember): number {
        return member.pristineBattleValue() ?? member.entity.battleValue();
    }

    private static getPrintableBv(member: CBTForceMember, printPilotData: boolean): number {
        if (printPilotData) {
            return member.adjustedBattleValue() ?? member.entity.battleValue();
        }
        return member.currentBaseBattleValue() ?? this.getBaseBv(member);
    }

    private static formatMovement(entity: BaseEntity): string {
        const parts: string[] = [];
        if (entity.walkMP()) parts.push(`${entity.walkMP()}/${entity.runMP()}`);
        if (entity.jumpMP()) parts.push(String(entity.jumpMP()));
        if (entity.umuMP()) parts.push(String(entity.umuMP()));
        return parts.join('/');
    }

    private static formatTechBase(techBase: string, mixed: boolean): string {
        if (!techBase) return '';
        const shortTechBase = techBase === 'Inner Sphere' ? 'IS' : 'Clan';
        return mixed ? `Mixed (${shortTechBase})` : shortTechBase;
    }

    private static formatEquipmentSummary(entity: BaseEntity): string {
        const equipmentCounts = new Map<string, number>();
        const ammo = new Map<string, AmmoSummary>();

        for (const mount of entity.equipment()) {
            const equipment = mount.equipment;
            if (equipment instanceof AmmoEquipment) {
                const name = equipment.shortName || equipment.name || mount.equipmentId;
                const protectedByCase = entity.locationHasCaseProtection(mount.location);
                const key = `${name}\u0000${protectedByCase}`;
                const existing = ammo.get(key);
                if (existing) {
                    existing.bins++;
                    existing.shots += mount.shotsCount ?? equipment.shots;
                } else {
                    ammo.set(key, {
                        name,
                        protectedByCase,
                        bins: 1,
                        shots: mount.shotsCount ?? equipment.shots,
                    });
                }
                continue;
            }
            if (isHeatSinkEquipment(equipment)
                || isCaseEquipment(equipment)
                || isJumpJetEquipment(equipment)) continue;
            const name = mount.displayName();
            equipmentCounts.set(name, (equipmentCounts.get(name) ?? 0) + 1);
        }

        const equipmentEntries = [...equipmentCounts]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, quantity]) => `${quantity}×${name}`);
        const ammoEntries = [...ammo.values()]
            .sort((left, right) => left.name.localeCompare(right.name)
                || Number(left.protectedByCase) - Number(right.protectedByCase))
            .map(entry => {
                const text = `${entry.bins}×${entry.name} (${entry.shots})`;
                return entry.protectedByCase ? `[${text}]` : text;
            });

        const equipmentMarkup = equipmentEntries
            .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
            .join('<span class="cbt-roster-equipment-sep">, </span>');
        const ammoMarkup = ammoEntries.length === 0 ? '' : `
            <div class="cbt-roster-equipment-ammo-line">
                <span class="cbt-roster-equipment-ammo-label">Ammo:</span>
                <span class="cbt-roster-equipment-ammo-values">${ammoEntries
                    .map(entry => `<span class="cbt-roster-equipment-entry">${this.escapeHtml(entry)}</span>`)
                    .join('<span class="cbt-roster-equipment-sep">, </span>')}</span>
            </div>
        `;
        return `${equipmentMarkup}${ammoMarkup}`;
    }

    private static formatNumber(value: number | undefined | null): string {
        return value === undefined || value === null || Number.isNaN(value)
            ? ''
            : value.toLocaleString();
    }

    private static escapeHtml(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    private static getPrintStyles(
        printMargin: PrintAllOptions['printMargin'],
        paperSize: PrintAllOptions['paperSize'],
    ): string {
        return `
            @media screen { #cbt-summary-print-container { display: none; } }
            ${getPrintRosterBrandingStyles('#cbt-summary-print-container')}

            #cbt-summary-print-container .cbt-roster-summary,
            #cbt-summary-print-container .cbt-roster-sheet {
                width: 100%;
                background: white;
                color: #222;
                box-sizing: border-box;
            }
            #cbt-summary-print-container .cbt-roster-sheet {
                padding: 0.08in 0.12in 0.1in;
                font-family: sans-serif;
            }
            #cbt-summary-print-container .cbt-roster-group-section {
                margin-bottom: 0.06in;
                break-inside: auto;
                page-break-inside: auto;
            }
            #cbt-summary-print-container .cbt-roster-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 9pt;
                break-inside: auto;
                page-break-inside: auto;
            }
            #cbt-summary-print-container .cbt-roster-table thead { display: table-header-group; }
            #cbt-summary-print-container .cbt-roster-unit-entry,
            #cbt-summary-print-container .cbt-roster-unit-entry > td {
                break-inside: avoid;
                page-break-inside: avoid;
            }
            #cbt-summary-print-container .cbt-roster-group-header {
                display: flex;
                justify-content: space-between;
                padding: 0.03in 0.01in 0.02in;
                border-top: 1px solid #cfcfcf;
                border-bottom: 1px solid #cfcfcf;
            }
            #cbt-summary-print-container .cbt-roster-group-heading-cell { padding: 0; border: 0; }
            #cbt-summary-print-container .cbt-roster-group-name,
            #cbt-summary-print-container .cbt-roster-group-bv { font-weight: 700; font-size: 10pt; }
            #cbt-summary-print-container .cbt-roster-table th,
            #cbt-summary-print-container .cbt-roster-table td {
                padding: 3px 4px;
                border-bottom: 1px solid #d7d7d7;
                vertical-align: middle;
                text-align: center;
                background: white;
            }
            #cbt-summary-print-container .cbt-roster-table th {
                border-bottom: 2px solid #666;
                white-space: nowrap;
            }
            #cbt-summary-print-container .col-unit,
            #cbt-summary-print-container .col-role,
            #cbt-summary-print-container .col-equipment { white-space: normal; }
            #cbt-summary-print-container .col-unit,
            #cbt-summary-print-container .col-equipment { text-align: left; }
            #cbt-summary-print-container .is-numeric,
            #cbt-summary-print-container .cbt-roster-equipment-entry { white-space: nowrap; }
            #cbt-summary-print-container .is-bold,
            #cbt-summary-print-container .cbt-roster-group-name,
            #cbt-summary-print-container .cbt-roster-equipment-ammo-label,
            #cbt-summary-print-container .cbt-roster-unit-chassis { font-weight: 700; }
            #cbt-summary-print-container .cbt-roster-equipment-ammo-line { margin-top: 2px; }
            #cbt-summary-print-container .cbt-roster-unit-model { color: #555; }
            #cbt-summary-print-container .cbt-roster-footer {
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.08in;
                padding-top: 0.05in;
                border-top: 2px solid #333;
                text-align: right;
                break-inside: avoid;
            }
            #cbt-summary-print-container .print-roster-qr-block { margin-top: 0.05in; }

            @media print {
                body, html { margin: 0 !important; padding: 0 !important; }
                body.cbt-summary-print-active > *:not(#cbt-summary-print-container) { display: none !important; }
                #cbt-summary-print-container,
                #cbt-summary-print-container .cbt-roster-summary {
                    display: block;
                    width: 100% !important;
                    height: auto !important;
                    overflow: visible !important;
                }
                @page {
                    size: ${paperSize === 'a4' ? 'A4' : 'Letter'} landscape;
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }
}
