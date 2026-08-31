// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import type { SourceHash, UnitProviderId, UnitUuid } from './unit-catalog/unit-catalog.types';
import type { UnitInstanceId } from '../models/runtime/runtime-state';
import {
    DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
    type ScenarioRules,
} from '../models/runtime/unit-state-initializer';
import type { SerializedNonMekUnit } from '../models/runtime/non-mek-unit-persistence';
import {
    ReadyNonMekUnit,
    type NonMekUnitDeploymentInput,
} from '../models/runtime/ready-non-mek-unit';
import {
    NativeEntityService,
    nativeSourceHandleForLoadedEntity,
    savedIdentityForLoadedEntity,
} from './native-entity.service';

export interface LoadReadyNonMekUnitRequest {
    readonly identity: {
        readonly provider: UnitProviderId;
        readonly uuid: UnitUuid;
        readonly sourceHashAtSave?: SourceHash;
    };
    readonly instanceId: UnitInstanceId;
    readonly deployment: NonMekUnitDeploymentInput;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId?: string;
}

export interface RestoreReadyNonMekUnitRequest {
    readonly saved: SerializedNonMekUnit;
}

/** Readiness boundary for every BLK-backed non-Mek Classic entity. */
@Injectable({ providedIn: 'root' })
export class ReadyNonMekUnitService {
    private readonly entities = inject(NativeEntityService);

    public async loadReadyNonMekUnit(request: LoadReadyNonMekUnitRequest): Promise<ReadyNonMekUnit> {
        const loaded = await this.entities.load(request.identity);
        if (loaded.entity.entityType === 'Mek') {
            throw new Error('Meks require ReadyMekUnitService');
        }
        if (loaded.source.format !== 'blk') {
            throw new Error(`${loaded.entity.entityType} requires a BLK source`);
        }
        return ReadyNonMekUnit.create(loaded.entity, {
            instanceId: request.instanceId,
            identity: savedIdentityForLoadedEntity(loaded),
            deployment: request.deployment,
            scenario: request.scenario,
            initialStateProfileId: request.initialStateProfileId ?? DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
        }, nativeSourceHandleForLoadedEntity(loaded));
    }

    public async restoreReadyNonMekUnit(request: RestoreReadyNonMekUnitRequest): Promise<ReadyNonMekUnit> {
        const identity = Object.freeze({
            provider: request.saved.entity.provider,
            uuid: request.saved.entity.uuid,
            ...(request.saved.entity.sourceHashAtSave === undefined
                ? {}
                : { sourceHashAtSave: request.saved.entity.sourceHashAtSave }),
        });
        const loaded = await this.entities.load(identity);
        if (loaded.entity.entityType === 'Mek') {
            throw new Error('A persisted non-Mek runtime resolved to a Mek entity');
        }
        return ReadyNonMekUnit.restore(
            request.saved,
            loaded.entity,
            savedIdentityForLoadedEntity(loaded),
            nativeSourceHandleForLoadedEntity(loaded),
        );
    }
}
