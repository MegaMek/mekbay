// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CBTSummaryPrintUtil } from './cbt-summary-print.util';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CBTForce } from '../models/cbt-force.model';

describe('CBTSummaryPrintUtil', () => {
    it('prints the summary in landscape without rotating its content', () => {
        const styles = getPrintStyles('none');

        expect(styles).toContain('size: landscape');
        expect(styles).not.toContain('rotate(');
        expect(styles).not.toContain('transform:');
    });

    it('allows roster tables to flow across pages with repeating headers', () => {
        const styles = getPrintStyles('none');

        expect(styles).toContain('display: table-header-group');
        expect(styles).toContain('.cbt-roster-unit-entry > td');
        expect(styles).toContain('page-break-inside: avoid');
        expect(styles).toContain('overflow: visible !important');
        expect(styles).not.toContain('overflow: hidden');
    });

    it('builds a summary-only print container', async () => {
        const forceUnit = {
        } as unknown as CBTForceUnit;
        const force = {
            units: () => [forceUnit],
            groups: () => [],
            faction: () => ({ name: 'Federated Suns', group: 'Inner Sphere' }),
            era: () => ({ name: 'Succession Wars' }),
            instanceId: () => 'cbt-summary-test',
            name: 'First Davion Guards',
            displayName: () => 'First Davion Guards',
        } as unknown as CBTForce;

        await CBTSummaryPrintUtil.print(force, {
            printPilotData: true,
            printMargin: 'none',
        }, false);

        const overlay = document.getElementById('cbt-summary-print-container')!;
        const total = overlay.querySelector('.cbt-roster-footer')!;
        expect(overlay.querySelectorAll('.cbt-roster-summary').length).toBe(1);
        expect(overlay.querySelector('.print-roster-qr-inline svg')).not.toBeNull();
        expect(total.nextElementSibling?.classList.contains('print-roster-qr-block')).toBeTrue();
        expect(overlay.querySelector('.svg-container')).toBeNull();
        expect(overlay.querySelector('.print-roster-context')?.textContent)
            .toBe('Federated Suns · Inner Sphere · Succession Wars');
        expect(overlay.querySelector('.print-roster-name')?.textContent).toBe('First Davion Guards');
        expect(overlay.querySelector('.print-roster-logo img')).not.toBeNull();

        window.dispatchEvent(new Event('click'));
    });

    it('renders every unit in a large group and includes the group name in the repeating table header', async () => {
        const force = {
            units: () => forceUnits,
            groups: () => [group],
            faction: () => undefined,
            era: () => undefined,
            instanceId: () => '',
            name: 'First Davion Guards',
            displayName: () => 'First Davion Guards',
        };
        let forceUnits: CBTForceUnit[] = [];
        const group = {
            id: 'alpha-lance',
            groupDisplayName: () => 'Alpha Lance',
            units: () => forceUnits,
        };
        forceUnits = Array.from({ length: 30 }, (_, index) => ({
            force,
            alias: () => `Pilot ${index + 1}`,
            gunnerySkill: () => 4,
            pilotingSkill: () => 5,
            getBv: () => 1_000,
            getBaseBv: () => 900,
            getGroup: () => group,
            getUnit: () => ({
                chassis: `Unit ${index + 1}`,
                model: 'Test Model',
                type: 'Mek',
                subtype: 'Mek',
                role: 'Skirmisher',
                bv: 900,
                tons: 50,
                level: 'Standard',
                mixed: false,
                comp: [],
            }),
        })) as unknown as CBTForceUnit[];

        const host = document.createElement('div');
        host.innerHTML = await createRosterSummary(force as unknown as CBTForce, true);

        expect(host.querySelectorAll('.cbt-roster-unit-entry').length).toBe(30);
        expect(host.querySelector('thead .cbt-roster-group-header')?.textContent).toContain('Alpha Lance');
        expect(host.querySelector('.cbt-roster-table tbody tr:last-child')?.textContent).toContain('Unit 30');
    });

    it('omits both the pilot name and skills from a roster row when pilot data is disabled', () => {
        const forceUnit = {
            alias: () => 'Morgan & Co.',
            gunnerySkill: () => 3,
            pilotingSkill: () => 4,
            getBv: () => 1234,
            getBaseBv: () => 1000,
            getUnit: () => ({
                chassis: 'Atlas',
                model: 'AS7-D',
                type: 'Mek',
                subtype: 'Mek',
                role: 'Juggernaut',
                bv: 1000,
                tons: 100,
                level: 'Standard',
                comp: [],
            }),
        };

        const withoutPilotData = createRosterTableRow(forceUnit, false);
        const withPilotData = createRosterTableRow(forceUnit, true);

        expect(withoutPilotData).toContain('<div class="cbt-roster-unit-chassis">Atlas</div>');
        expect(withoutPilotData).toContain('<td class="col-gp is-numeric"></td>');
        expect(withoutPilotData).not.toContain('Morgan');
        expect(withoutPilotData).not.toContain('3/4');
        expect(withoutPilotData).toContain('<td class="col-bv is-numeric is-bold">1,000</td>');
        expect(withoutPilotData).not.toContain('<td class="col-bv is-numeric is-bold">1,234</td>');
        expect(withPilotData).toContain('Atlas (Morgan &amp; Co.)');
        expect(withPilotData).toContain('<td class="col-gp is-numeric">3/4</td>');
        expect(withPilotData).toContain('<td class="col-bv is-numeric is-bold">1,234</td>');
    });

    it('does not merge CASE-protected and unprotected ammo bins', () => {
        const caseEquipment = {
            hasAnyFlag: (flags: string[]) => flags.includes('F_CASE'),
        };
        const unit = {
            comp: [
                { t: 'C', n: 'CASE', q: 1, l: 'lt/ct', eq: caseEquipment },
                { t: 'X', n: 'LRM 10 Ammo', q: 1, q2: 12, l: 'LT' },
                { t: 'X', n: 'LRM 10 Ammo', q: 1, q2: 12, l: 'CT' },
                { t: 'X', n: 'LRM 10 Ammo', q: 1, q2: 12, l: 'RT' },
            ],
        };

        const summary = formatEquipmentSummary(unit);

        expect(summary).toContain('>[2×LRM 10 (24)]</span>');
        expect(summary).toContain('>1×LRM 10 (12)</span>');
        expect(summary).not.toContain('3×LRM 10');
        expect(summary).not.toContain('>CASE<');
    });
});

function getPrintStyles(printMargin: 'none' | 'browserDefined'): string {
    return (CBTSummaryPrintUtil as unknown as {
        getPrintStyles(printMargin: 'none' | 'browserDefined'): string;
    }).getPrintStyles(printMargin);
}

function createRosterTableRow(forceUnit: unknown, printPilotData: boolean): string {
    return (CBTSummaryPrintUtil as unknown as {
        createRosterTableRow(forceUnit: unknown, printPilotData: boolean): string;
    }).createRosterTableRow(forceUnit, printPilotData);
}

function formatEquipmentSummary(unit: unknown): string {
    return (CBTSummaryPrintUtil as unknown as {
        formatEquipmentSummary(unit: unknown): string;
    }).formatEquipmentSummary(unit);
}

function createRosterSummary(force: CBTForce, printPilotData: boolean): Promise<string> {
    return (CBTSummaryPrintUtil as unknown as {
        createRosterSummary(force: CBTForce, printPilotData: boolean): Promise<string>;
    }).createRosterSummary(force, printPilotData);
}
