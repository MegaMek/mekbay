// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';

import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { SerializedNonMekUnit } from '../models/runtime/non-mek-unit-persistence';
import { isSerializedNonMekUnit } from '../models/runtime/non-mek-unit-persistence';
import type { CBTUnit } from '../models/runtime/cbt-unit';
import { CBTNonMekUnit } from '../models/runtime/cbt-non-mek-unit';
import { CBTMekUnit } from '../models/runtime/cbt-mek-unit';
import type { SerializedCBTUnitV2 } from '../models/runtime/persistence-v2';
import {
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
    UNIT_STATE_INITIALIZER_REVISION,
    type DeploymentConfiguration,
    type ScenarioRules,
} from '../models/runtime/unit-state-initializer';
import type { SourceHash, UnitProviderId, UnitUuid } from './unit-catalog/unit-catalog.types';
import {
    NativeEntityService,
    nativeSourceHandleForLoadedEntity,
    savedIdentityForLoadedEntity,
} from './native-entity.service';

export interface CreateCBTUnitRequest {
    readonly identity: {
        readonly provider: UnitProviderId;
        readonly uuid: UnitUuid;
        readonly sourceHashAtSave?: SourceHash;
    };
    readonly instanceId: string;
    readonly deployment: DeploymentConfiguration;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId?: string;
    readonly crewSkills?: Readonly<{ readonly gunnery: number; readonly piloting: number }>;
}

/** Loads one native entity once, then creates or restores its CBT runtime aggregate. */
@Injectable({ providedIn: 'root' })
export class CBTUnitService {
    private readonly entities = inject(NativeEntityService);

    public async create(request: CreateCBTUnitRequest): Promise<CBTUnit> {
        const loaded = await this.entities.load(request.identity);
        const identity = savedIdentityForLoadedEntity(loaded);
        const nativeSource = nativeSourceHandleForLoadedEntity(loaded);
        if (loaded.entity instanceof MekEntity) {
            return CBTMekUnit.createFromEntity({
                identity: request.identity,
                instanceId: request.instanceId,
                ...(request.crewSkills ? { crewSkills: request.crewSkills } : {}),
            }, loaded.entity, identity, {
                    initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                    profileId: request.initialStateProfileId ?? DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                    deployment: request.deployment,
                    scenario: request.scenario,
            }, nativeSource);
        }
        if (loaded.source.format !== 'blk') {
            throw new Error(`${loaded.entity.entityType} requires a BLK source`);
        }
        return CBTNonMekUnit.create(loaded.entity, {
            instanceId: request.instanceId,
            identity,
            deployment: request.deployment,
            scenario: request.scenario,
            initialStateProfileId: request.initialStateProfileId
                ?? DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
            ...(request.crewSkills ? { crewSkills: request.crewSkills } : {}),
        }, nativeSource);
    }

    public async restore(
        saved: SerializedCBTUnitV2 | SerializedNonMekUnit,
        scenario: ScenarioRules,
    ): Promise<CBTUnit> {
        const loaded = await this.entities.load(saved.entity);
        const identity = savedIdentityForLoadedEntity(loaded);
        const nativeSource = nativeSourceHandleForLoadedEntity(loaded);
        if (isSerializedNonMekUnit(saved)) {
            if (loaded.entity instanceof MekEntity) {
                throw new Error('A persisted non-Mek runtime resolved to a Mek entity');
            }
            return CBTNonMekUnit.restore(saved, loaded.entity, identity, nativeSource);
        }
        if (!(loaded.entity instanceof MekEntity)) {
            throw new Error('A persisted Mek runtime resolved to a non-Mek entity');
        }
        return CBTMekUnit.restoreFromEntity(saved, loaded.entity, identity, {
                initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
                profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
                deployment: saved.deployment.values,
                scenario,
        }, nativeSource);
    }
}
