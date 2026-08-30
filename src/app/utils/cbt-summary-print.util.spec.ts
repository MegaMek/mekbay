// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment } from '../models/equipment.model';
import type { BaseEntity } from '../models/entity/base-entity';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceMember } from '../models/force-member.model';
import { CBTSummaryPrintUtil } from './cbt-summary-print.util';

describe('CBTSummaryPrintUtil', () => {
    it('renders every admitted Entity member and repeats the group name in the table header', async () => {
        const group = { id: 'alpha', groupDisplayName: () => 'Alpha Lance' };
        const force = createForce();
        const members = Array.from({ length: 30 }, (_, index) =>
            createMember(force as unknown as CBTForce, `Unit ${index + 1}`, 'alpha'));
        force.groups = () => [group];
        force.getClassicMembers = () => members;

        const host = document.createElement('div');
        host.innerHTML = await createRosterSummary(force as unknown as CBTForce, true);

        expect(host.querySelectorAll('.cbt-roster-unit-entry').length).toBe(30);
        expect(host.querySelector('thead .cbt-roster-group-header')?.textContent).toContain('Alpha Lance');
        expect(host.querySelector('.cbt-roster-table tbody tr:last-child')?.textContent).toContain('Unit 30');
    });

    it('omits pilot identity and skills and uses unadjusted BV when pilot data is disabled', () => {
        const force = createForce();
        force.getUnitCrewAssignment = () => ({
            positions: [{ name: 'Morgan & Co.', gunnery: 3, piloting: 4 }],
        }) as never;
        const member = createMember(force as unknown as CBTForce, 'Atlas', 'alpha');

        const withoutPilot = createRosterTableRow(member, false);
        const withPilot = createRosterTableRow(member, true);

        expect(withoutPilot).toContain('<div class="cbt-roster-unit-chassis">Atlas</div>');
        expect(withoutPilot).toContain('<td class="col-gp is-numeric"></td>');
        expect(withoutPilot).not.toContain('Morgan');
        expect(withoutPilot).toContain('<td class="col-bv is-numeric is-bold">900</td>');
        expect(withPilot).toContain('Atlas (Morgan &amp; Co.)');
        expect(withPilot).toContain('<td class="col-gp is-numeric">3/4</td>');
        expect(withPilot).toContain('<td class="col-bv is-numeric is-bold">1,100</td>');
    });

    it('keeps CASE-protected and unprotected Entity ammo bins separate', () => {
        const ammunition = new AmmoEquipment({
            id: 'LRM 10 Ammo',
            name: 'LRM 10 Ammo',
            shortName: 'LRM 10 Ammo',
            type: 'ammo',
            ammo: { type: 'LRM', rackSize: 10, shots: 12 },
        });
        const mounts = [
            { equipment: ammunition, equipmentId: ammunition.id, location: 'LT', shotsCount: 12 },
            { equipment: ammunition, equipmentId: ammunition.id, location: 'CT', shotsCount: 12 },
            { equipment: ammunition, equipmentId: ammunition.id, location: 'RT', shotsCount: 12 },
        ];
        const entity = {
            equipment: () => mounts,
            locationHasCaseProtection: (location: string) => location !== 'RT',
        } as unknown as BaseEntity;

        const summary = formatEquipmentSummary(entity);

        expect(summary).toContain('>[2×LRM 10 Ammo (24)]</span>');
        expect(summary).toContain('>1×LRM 10 Ammo (12)</span>');
        expect(summary).not.toContain('3×LRM 10 Ammo');
    });
});

interface MutableForceFixture {
    getClassicMembers: () => CBTForceMember[];
    groups: () => Array<{ id: string; groupDisplayName(): string }>;
    getUnitCrewAssignment: () => unknown;
    faction: () => undefined;
    era: () => undefined;
    instanceId: () => string;
    name: string;
    displayName: () => string;
}

function createForce(): MutableForceFixture {
    return {
        getClassicMembers: () => [],
        groups: () => [],
        getUnitCrewAssignment: () => null,
        faction: () => undefined,
        era: () => undefined,
        instanceId: () => '',
        name: 'First Davion Guards',
        displayName: () => 'First Davion Guards',
    };
}

function createMember(force: CBTForce, chassis: string, rosterGroupId: string): CBTForceMember {
    const entity = {
        fullChassis: () => chassis,
        model: () => 'TST-1',
        unitType: () => 'Mek',
        unitSubtype: () => 'BattleMek',
        role: () => 'Skirmisher',
        rangedWeapons: () => [],
        resolveMountedWeaponDamage: () => ({ maximum: 0 }),
        battleValue: () => 900,
        tonnage: () => 50,
        year: () => 3025,
        techBase: () => 'Inner Sphere',
        mixedTech: () => false,
        staticTechLevel: () => 'Standard',
        walkMP: () => 5,
        runMP: () => 8,
        jumpMP: () => 0,
        umuMP: () => 0,
        totalArmorPoints: () => 160,
        totalInternalPoints: () => 100,
        equipment: () => [],
    } as unknown as BaseEntity;
    return {
        id: `${rosterGroupId}-${chassis}`,
        force,
        entity,
        rosterGroupId,
        pristineBattleValue: () => 900,
        currentBaseBattleValue: () => 900,
        adjustedBattleValue: () => 1_100,
    } as unknown as CBTForceMember;
}

function createRosterSummary(force: CBTForce, printPilotData: boolean): Promise<string> {
    return (CBTSummaryPrintUtil as unknown as {
        createRosterSummary(force: CBTForce, printPilotData: boolean): Promise<string>;
    }).createRosterSummary(force, printPilotData);
}

function createRosterTableRow(member: CBTForceMember, printPilotData: boolean): string {
    return (CBTSummaryPrintUtil as unknown as {
        createRosterTableRow(member: CBTForceMember, printPilotData: boolean): string;
    }).createRosterTableRow(member, printPilotData);
}

function formatEquipmentSummary(entity: BaseEntity): string {
    return (CBTSummaryPrintUtil as unknown as {
        formatEquipmentSummary(entity: BaseEntity): string;
    }).formatEquipmentSummary(entity);
}
