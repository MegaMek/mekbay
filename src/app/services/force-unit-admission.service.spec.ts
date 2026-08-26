// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CBTForce } from '../models/cbt-force.model';
import {
    CBTForceMember,
    isCBTForceMember,
    isCBTMekForceMember,
} from '../models/force-member.model';
import type { Injector } from '@angular/core';
import type { DataService } from './data.service';
import type { UnitInstanceId } from '../models/runtime/runtime-state';
import type { UnitSummary } from '../models/unit-summary.model';
import { MM_DATA_UNIT_PROVIDER_ID } from './unit-catalog/unit-catalog.types';
import { ForceUnitAdmissionService } from './force-unit-admission.service';

describe('ForceUnitAdmissionService', () => {
    it('creates and targets the first roster group for a retained CBT Mek', async () => {
        const force = new CBTForce('Test force', {} as DataService, {} as Injector);
        const summary = {
            name: 'Crab CRB-20',
            uuid: '019f6767-0dcb-7bb8-992f-aef08202f5e1',
            origin: 'megamek',
            provider: MM_DATA_UNIT_PROVIDER_ID,
            hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
            entityType: 'Mek',
            type: 'Mek',
            subtype: '',
        } as unknown as UnitSummary;
        const ownedMember = new CBTForceMember('instance-1' as UnitInstanceId, force, summary);
        const admit = spyOn(force, 'admitRetainedUnit').and.resolveTo({
            kind: 'admitted',
            instanceId: 'instance-1' as UnitInstanceId,
        });
        spyOn(force, 'getClassicMember').and.returnValue(ownedMember);

        const member = await new ForceUnitAdmissionService().admit({
            force,
            summary,
            rosterMemberIndex: 0,
        });

        expect(force.groups()).toHaveSize(1);
        expect(admit).toHaveBeenCalledWith(jasmine.objectContaining({
            targetRosterGroupId: force.groups()[0].id,
            targetRosterMemberIndex: 0,
        }));
        expect(isCBTMekForceMember(member)).toBeTrue();
        expect(member).toBe(ownedMember);
    });

    it('admits a native BLK family through the same direct Classic member path', async () => {
        const force = new CBTForce('Vehicle force', {} as DataService, {} as Injector);
        const summary = {
            name: 'Vedette Medium Tank',
            uuid: '019f6767-0dcb-7bb8-992f-aef08202f5e2',
            origin: 'megamek',
            provider: MM_DATA_UNIT_PROVIDER_ID,
            hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
            entityType: 'Tank',
            type: 'Combat Vehicle',
            subtype: 'Tracked',
        } as unknown as UnitSummary;
        const ownedMember = new CBTForceMember('instance-vehicle' as UnitInstanceId, force, summary);
        const admit = spyOn(force, 'admitRetainedUnit').and.resolveTo({
            kind: 'admitted',
            instanceId: 'instance-vehicle' as UnitInstanceId,
        });
        spyOn(force, 'getClassicMember').and.returnValue(ownedMember);

        const member = await new ForceUnitAdmissionService().admit({ force, summary });

        expect(admit).toHaveBeenCalled();
        expect(isCBTForceMember(member)).toBeTrue();
        expect(isCBTMekForceMember(member)).toBeFalse();
        expect(member).toBe(ownedMember);
    });
});
