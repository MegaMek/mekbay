// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { LoadedEntity } from '../models/entity/entity-repository';
import {
    ReadyMekUnit,
    ReadyMekUnitFactory,
} from '../models/runtime/ready-unit-factory';
import type { UnitInstanceId } from '../models/runtime/runtime-state';
import type { SerializedCBTUnitV2 } from '../models/runtime/persistence-v2';
import type { CrewAssignment } from '../models/runtime/crew-assignment';
import {
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    UNIT_STATE_INITIALIZER_REVISION,
    type DeploymentConfiguration,
    type ScenarioRules,
} from '../models/runtime/unit-state-initializer';
import {
    type UnitProviderId,
    type UnitUuid,
} from './unit-catalog/unit-catalog.types';
import {
    NativeEntityService,
    nativeSourceHandleForLoadedEntity,
    savedIdentityForLoadedEntity,
} from './native-entity.service';

export interface LoadReadyMekRequest {
    readonly identity: { readonly provider: UnitProviderId; readonly uuid: UnitUuid };
    readonly instanceId: UnitInstanceId;
    readonly deployment: DeploymentConfiguration;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId?: string;
}

export interface RestoreReadyMekV2Request {
    readonly saved: SerializedCBTUnitV2;
    readonly deployment: DeploymentConfiguration;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId?: string;
}

export interface RedeployReadyMekV2Request {
    readonly current: ReadyMekUnit;
    readonly crewAssignment: CrewAssignment;
    readonly scenario: ScenarioRules;
}

/**
 * Angular readiness boundary for the first full-entity Mek lane.
 * `loadMekEntity` creates no runtime; `loadReadyMek` is the only method
 * here that creates a V2 unit instance.
 */
@Injectable({ providedIn: 'root' })
export class ReadyMekUnitService {
    private readonly entities = inject(NativeEntityService);

    public async loadMekEntity(identity: {
        readonly provider: UnitProviderId;
        readonly uuid: UnitUuid;
    }): Promise<MekEntity> {
        identity = captureCanonicalValue(identity);
        return requireMekEntity((await this.entities.load(identity)).entity);
    }

    public async loadReadyMek(request: LoadReadyMekRequest): Promise<ReadyMekUnit> {
        request = captureCanonicalValue(request);
        const loaded = requireLoadedMek(await this.entities.load(request.identity));
        return this.readyFactory(request).createFromEntity({
            identity: request.identity,
            instanceId: request.instanceId,
        }, loaded.entity, savedIdentityForLoadedEntity(loaded), nativeSourceHandleForLoadedEntity(loaded));
    }

    /** Restores persisted current authority directly into Entity + sparse runtime. */
    public async restoreReadyMekV2(request: RestoreReadyMekV2Request): Promise<ReadyMekUnit> {
        request = captureCanonicalValue(request);
        const identity = {
            provider: request.saved.entity.provider,
            uuid: request.saved.entity.uuid,
        };
        const loaded = requireLoadedMek(await this.entities.load(identity));
        return this.readyFactory({
            identity,
            instanceId: request.saved.instanceId,
            deployment: request.deployment,
            scenario: request.scenario,
            ...(request.initialStateProfileId === undefined
                ? {}
                : { initialStateProfileId: request.initialStateProfileId }),
        }).restoreFromEntity(
            request.saved,
            loaded.entity,
            savedIdentityForLoadedEntity(loaded),
            nativeSourceHandleForLoadedEntity(loaded),
        );
    }

    /**
     * Creates an atomic replacement candidate for one retained, unstarted V2
     * runtime. Only crew deployment values may change; entity, instance,
     * initializer, scenario, runtime state, and recovery evidence stay exact.
     */
    public async redeployReadyMekV2(request: RedeployReadyMekV2Request): Promise<ReadyMekUnit> {
        // ReadyMekUnit is an authority-bearing class instance and remains reference-bound. Only
        // its caller-owned structural options are detached before the async factory boundary.
        const current = request.current;
        const crewAssignment = captureCanonicalValue(request.crewAssignment);
        const scenario = captureCanonicalValue(request.scenario);
        const saved = current.serialize();
        return ReadyMekUnitFactory.redeployPreCombat(current, {
            initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
            profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
            deployment: {
                id: saved.deployment.values.id,
                ...(saved.deployment.values.initialHeat === undefined
                    ? {}
                    : { initialHeat: saved.deployment.values.initialHeat }),
                crewAssignment,
            },
            scenario,
        });
    }

    private readyFactory(
        request: LoadReadyMekRequest,
    ): ReadyMekUnitFactory {
        return new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                profileId: request.initialStateProfileId ?? DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment: request.deployment,
                scenario: request.scenario,
            },
        });
    }

}

function requireLoadedMek(loaded: LoadedEntity): LoadedEntity & { readonly entity: MekEntity } {
    requireMekEntity(loaded.entity);
    return loaded as LoadedEntity & { readonly entity: MekEntity };
}

function requireMekEntity(entity: LoadedEntity['entity']): MekEntity {
    if (!(entity instanceof MekEntity)) {
        throw new Error(`Expected a Mek entity, received ${entity.entityType}`);
    }
    return entity;
}

/** Detaches and freezes caller-owned JSON while leaving authority-bearing class objects outside. */
function captureCanonicalValue<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) value.forEach(item => deepFreeze(item, seen));
    else Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
}
