// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceMember, isCBTForceMember, isCBTMekForceMember } from '../models/force-member.model';
import { Injector } from '@angular/core';
import type { DataService } from './data.service';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { createEmptyUnit, createTestMekEntity, createTestTankEntity } from '../testing/unit-test-helpers';
import { AsAbilityLookupService } from './as-ability-lookup.service';
import { OptionsService } from './options.service';

describe('ForceUnitAdmissionService', () => {
    it('applies Alpha Strike skill and commander facts during admission', async () => {
        const injector = Injector.create({
            providers: [{ provide: AsAbilityLookupService, useValue: {} }],
        });
        const force = new ASForce('Alpha Strike force', {} as DataService, injector);

        const member = await createAdmissionService().admit({
            force,
            summary: createEmptyUnit(),
            gunnerySkill: 2,
            commander: true,
        });

        expect(member).toBeInstanceOf(ASForceUnit);
        if (!(member instanceof ASForceUnit)) return;
        expect(member.pilotSkill()).toBe(2);
        expect(member.commander()).toBeTrue();
    });

    it('creates and targets the first roster group for a retained CBT Mek', async () => {
        const force = new CBTForce('Test force', {} as DataService, {} as Injector);
        const summary = createEmptyUnit({
            name: 'Crab CRB-20',
            uuid: '019f6767-0dcb-7bb8-992f-aef08202f5e1',
            entityType: 'Mek',
            type: 'Mek',
        });
        const ownedMember = new CBTForceMember(
            'instance-1',
            force,
            createTestMekEntity({
                uuid: summary.uuid,
                chassis: 'Crab',
                model: 'CRB-20',
            }),
        );
        const admit = spyOn(force, 'admitRetainedUnit').and.resolveTo({
            kind: 'admitted',
            instanceId: 'instance-1',
        });
        spyOn(force, 'getCBTMember').and.returnValue(ownedMember);

        const member = await createAdmissionService().admit({
            force,
            summary,
            rosterMemberIndex: 0,
            commander: true,
        });

        expect(force.groups()).toHaveSize(1);
        expect(admit).toHaveBeenCalledWith(jasmine.objectContaining({
            targetRosterGroupId: force.groups()[0].id,
            targetRosterMemberIndex: 0,
            commander: true,
        }));
        expect(isCBTMekForceMember(member)).toBeTrue();
        expect(member).toBe(ownedMember);
    });

    it('admits a native BLK family through the same direct CBT member path', async () => {
        const force = new CBTForce('Vehicle force', {} as DataService, {} as Injector);
        const summary = createEmptyUnit({
            name: 'Vedette Medium Tank',
            uuid: '019f6767-0dcb-7bb8-992f-aef08202f5e2',
            entityType: 'Tank',
            type: 'Tank',
            subtype: 'Combat Vehicle',
        });
        const ownedMember = new CBTForceMember(
            'instance-vehicle',
            force,
            createTestTankEntity({
                uuid: summary.uuid,
                chassis: 'Vedette',
                model: 'Medium Tank',
            }),
        );
        const admit = spyOn(force, 'admitRetainedUnit').and.resolveTo({
            kind: 'admitted',
            instanceId: 'instance-vehicle',
        });
        spyOn(force, 'getCBTMember').and.returnValue(ownedMember);

        const member = await createAdmissionService().admit({ force, summary });

        expect(admit).toHaveBeenCalled();
        expect(isCBTForceMember(member)).toBeTrue();
        expect(isCBTMekForceMember(member)).toBeFalse();
        expect(member).toBe(ownedMember);
    });
});

function createAdmissionService(): ForceUnitAdmissionService {
    return Injector.create({
        providers: [
            ForceUnitAdmissionService,
            {
                provide: OptionsService,
                useValue: {
                    options: () => ({
                        CBTOptionalRules: { forcedWithdrawal: false, sprinting: false },
                    }),
                },
            },
        ],
    }).get(ForceUnitAdmissionService);
}
