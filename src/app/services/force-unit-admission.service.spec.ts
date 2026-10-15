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
import { CUSTOM_UNIT_PROVIDER_ID } from './unit-catalog/unit-catalog.types';
import { CBTUnitService, type CreateCBTUnitRequest } from './cbt-unit.service';
import { createMekUnit } from '../models/runtime/cbt-mek-unit';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    UNIT_STATE_INITIALIZER_REVISION,
} from '../models/runtime/unit-state-initializer';

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
        const force = new CBTForce('Test force', {} as DataService, createCBTForceInjector());
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
            crewSkills: { gunnery: 4, piloting: 5 },
        }));
        expect(isCBTMekForceMember(member)).toBeTrue();
        expect(member).toBe(ownedMember);
    });

    it('admits a native BLK family through the same direct CBT member path', async () => {
        const force = new CBTForce('Vehicle force', {} as DataService, createCBTForceInjector());
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

    it('publishes a CBT member admitted while the force is bulk loading', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const cbtUnits = {
            create: (request: CreateCBTUnitRequest) => createMekUnit(
                { uuid: request.uuid, instanceId: request.instanceId },
                fixture.entity,
                fixture.identity,
                {
                    initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                    profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                    deployment: request.deployment,
                    scenario: request.scenario,
                },
            ),
        };
        const force = new CBTForce('Shared link', {} as DataService, Injector.create({
            providers: [
                { provide: OptionsService, useValue: TEST_OPTIONS_SERVICE },
                { provide: CBTUnitService, useValue: cbtUnits },
            ],
        }));
        force.loading = true;

        const member = await createAdmissionService().admit({
            force,
            summary: createEmptyUnit({ uuid: fixture.identity, entityType: 'Mek', type: 'Mek' }),
        });

        expect(force.members()).toEqual([member]);
    });

    it('admits constructed native units through the same CBT runtime', async () => {
        const force = new CBTForce('Custom force', {} as DataService, createCBTForceInjector());
        const summary = createEmptyUnit({ origin: 'user', provider: CUSTOM_UNIT_PROVIDER_ID, isCustom: true });
        const service = createAdmissionService();
        const admit = spyOn(service, 'admitCBT').and.resolveTo({} as CBTForceMember);
        await service.admit({ force, summary });
        expect(admit).toHaveBeenCalledOnceWith(jasmine.objectContaining({ uuid: summary.uuid }));
    });
});

function createAdmissionService(): ForceUnitAdmissionService {
    return Injector.create({
        providers: [ForceUnitAdmissionService],
    }).get(ForceUnitAdmissionService);
}

const TEST_OPTIONS_SERVICE = Object.freeze({
    options: () => ({
        CBTRules: 'total-warfare',
        CBTOptionalRules: { forcedWithdrawal: false, sprinting: false, hotLoadedAmmo: false },
    }),
});

function createCBTForceInjector(): Injector {
    return Injector.create({
        providers: [{ provide: OptionsService, useValue: TEST_OPTIONS_SERVICE }],
    });
}
