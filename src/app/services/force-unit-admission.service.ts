// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';
import { ASForceUnit } from '../models/as-force-unit.model';
import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import type { CBTDirectUnitAdmissionResult } from '../models/cbt-force.types';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew.model';
import type { Force, UnitGroup } from '../models/force.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { DEFAULT_FORCE_DEPLOYMENT_ID } from '../models/runtime/unit-state-initializer';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asSourceHash,
    type UnitProviderId,
    type UnitUuid,
} from './unit-catalog/unit-catalog.types';
import { type CBTForceMember, type ForceMember } from '../models/force-member.model';
import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import { OptionsService } from './options.service';


export interface ForceUnitAdmissionRequest {
    readonly force: Force;
    readonly summary: UnitSummary;
    readonly group?: UnitGroup;
    readonly rosterGroupId?: string;
    readonly rosterMemberIndex?: number;
    readonly gunnerySkill?: number;
    readonly pilotingSkill?: number;
    readonly commander?: boolean;
    readonly instanceId?: string;
}

export interface CBTUnitIdentityAdmissionRequest {
    readonly force: CBTForce;
    readonly identity: Readonly<{ readonly provider: UnitProviderId; readonly uuid: UnitUuid }>;
    readonly group?: UnitGroup;
    readonly rosterGroupId?: string;
    readonly rosterMemberIndex?: number;
    readonly gunnerySkill?: number;
    readonly pilotingSkill?: number;
    readonly commander?: boolean;
    readonly instanceId?: string;
}

/**
 * The single whole-unit admission selector. CBT always installs a native
 * Entity + Rules + sparse runtime; Alpha Strike owns its separate ForceUnit.
 */
@Injectable({ providedIn: 'root' })
export class ForceUnitAdmissionService {
    private readonly options = inject(OptionsService);

    async admit(request: ForceUnitAdmissionRequest): Promise<ForceMember> {
        if (request.force instanceof CBTForce) return this.admitCBTUnit(request);
        const unit = await this.createAlphaStrikeUnit(request);
        this.applyRequestedSkills(unit, request);
        return unit;
    }

    private async admitCBTUnit(
        request: ForceUnitAdmissionRequest,
    ): Promise<CBTForceMember> {
        if (!(request.force instanceof CBTForce) || !isNativeCBTSummary(request.summary)) {
            throw new Error(`CBT runtime is not available for "${request.summary.name}"`);
        }

        return this.admitCBTIdentity({
            ...request,
            force: request.force,
            identity: Object.freeze({
                provider: request.summary.provider,
                uuid: request.summary.uuid,
            }),
        });
    }

    /** Entity-native admission used when a loaded CBT member is cloned or transferred. */
    async admitCBTIdentity(
        request: CBTUnitIdentityAdmissionRequest,
    ): Promise<CBTForceMember> {

        let rosterGroupId = request.rosterGroupId ?? request.group?.id;
        if (rosterGroupId === undefined) {
            const targetGroup = request.force.groups()[0] ?? await request.force.addGroup();
            rosterGroupId = targetGroup.id;
        } else if (!request.force.groups().some(group => group.id === rosterGroupId)) {
            throw new Error(`CBT roster group "${rosterGroupId}" is not owned by the target force`);
        }

        const result: CBTDirectUnitAdmissionResult = await request.force.admitRetainedUnit({
            identity: request.identity,
            deployment: Object.freeze({ id: DEFAULT_FORCE_DEPLOYMENT_ID }),
            scenario: Object.freeze({
                id: 'megamek',
                ruleset: CORE_2026_RULESET,
                options: Object.freeze({
                    forcedWithdrawal: this.options.options().CBTOptionalRules.forcedWithdrawal,
                    sprinting: this.options.options().CBTOptionalRules.sprinting,
                }),
            }),
            crewSkills: Object.freeze({
                gunnery: request.gunnerySkill ?? DEFAULT_GUNNERY_SKILL,
                piloting: request.pilotingSkill ?? DEFAULT_PILOTING_SKILL,
            }),
            targetRosterGroupId: rosterGroupId,
            ...(request.rosterMemberIndex === undefined
                ? {}
                : { targetRosterMemberIndex: request.rosterMemberIndex }),
            ...(request.instanceId === undefined ? {} : { instanceId: request.instanceId }),
            ...(request.commander ? { commander: true } : {}),
        });
        if (result.kind === 'deferred') {
            throw new Error(result.decision.blockers
                .map(blocker => `${blocker.code}: ${blocker.message}`)
                .join('\n'));
        }
        if (result.kind === 'failed') {
            throw new Error(result.message);
        }
        const member = request.force.getCBTMember(result.instanceId);
        if (!member) throw new Error(`Admitted CBT unit ${result.instanceId} is not in the live force`);
        return member;
    }

    private async createAlphaStrikeUnit(request: ForceUnitAdmissionRequest): Promise<ASForceUnit> {
        if (!(request.force instanceof ASForce)) {
            throw new Error(`Alpha Strike runtime is not available for "${request.summary.name}"`);
        }
        const targetGroup = request.group === undefined
            ? undefined
            : request.force.groups().find(group => group === request.group);
        if (request.group !== undefined && targetGroup === undefined) {
            throw new Error('The requested target group is not owned by the Alpha Strike force');
        }
        return request.force.addUnit(request.summary, targetGroup);
    }

    private applyRequestedSkills(unit: ASForceUnit, request: ForceUnitAdmissionRequest): void {
        if (request.gunnerySkill === undefined && request.pilotingSkill === undefined) return;
        unit.disabledSaving = true;
        try {
            if (request.gunnerySkill !== undefined) {
                unit.setPilotSkill(request.gunnerySkill);
            }
        } finally {
            unit.disabledSaving = false;
        }
    }
}

function isNativeCBTSummary(unit: UnitSummary): boolean {
    if (unit.origin !== 'megamek' || unit.provider !== MM_DATA_UNIT_PROVIDER_ID) return false;
    try {
        asSourceHash(unit.hash);
        return true;
    } catch {
        return false;
    }
}
