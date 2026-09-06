// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UnitNameService } from './unit-name.service';
import { Injectable, inject } from '@angular/core';

import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { SerializedNonMekUnit } from '../models/runtime/non-mek-unit-persistence';
import { isSerializedNonMekUnit } from '../models/runtime/non-mek-unit-persistence';
import type { CBTUnit } from '../models/runtime/cbt-unit';
import { CBTNonMekUnit } from '../models/runtime/cbt-non-mek-unit';
import { CBTMekUnit } from '../models/runtime/cbt-mek-unit';
import type { SerializedCBTUnitV2 } from '../models/runtime/persistence-v2';
import type { V2StateRestoreWarningCode } from '../models/runtime/runtime-state-codec-v2';
import {
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
    UNIT_STATE_INITIALIZER_REVISION,
    type DeploymentConfiguration,
    type ScenarioRules,
} from '../models/runtime/unit-state-initializer';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';
import { sourceHashCanaryChanged } from '../models/source-hash-canary';
import {
    NativeEntityService,
    nativeSourceHandleForLoadedEntity,
} from './native-entity.service';

export interface CreateCBTUnitRequest {
    readonly uuid: UnitUuid;
    readonly instanceId: string;
    readonly deployment: DeploymentConfiguration;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId?: string;
    readonly crewSkills?: Readonly<{ readonly gunnery: number; readonly piloting: number }>;
}

export type CBTUnitRestoreWarningCode =
    | 'SOURCE_REVISION_CHANGED'
    | V2StateRestoreWarningCode;

/** One transient restore diagnostic, independent of the source unit's file format. */
export interface CBTUnitRestoreWarning {
    readonly unitName: string;
    readonly code: CBTUnitRestoreWarningCode;
    readonly message: string;
}

export interface CBTUnitRestoreResult {
    readonly unit: CBTUnit;
    readonly warnings: readonly CBTUnitRestoreWarning[];
}

/** Loads one native entity once, then creates or restores its CBT runtime aggregate. */
@Injectable({ providedIn: 'root' })
export class CBTUnitService {
    private readonly unitNames = inject(UnitNameService);
    private readonly entities = inject(NativeEntityService);

    public async create(request: CreateCBTUnitRequest): Promise<CBTUnit> {
        const loaded = await this.entities.load(request.uuid);
        const uuid = loaded.source.uuid;
        const nativeSource = nativeSourceHandleForLoadedEntity(loaded);
        if (loaded.entity instanceof MekEntity) {
            return CBTMekUnit.createFromEntity({
                uuid: request.uuid,
                instanceId: request.instanceId,
                ...(request.crewSkills ? { crewSkills: request.crewSkills } : {}),
            }, loaded.entity, uuid, {
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
            uuid,
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
    ): Promise<CBTUnitRestoreResult> {
        const loaded = await this.entities.load(saved.entity);
        const uuid = loaded.source.uuid;
        const nativeSource = nativeSourceHandleForLoadedEntity(loaded);
        const unitName = this.unitNames.name(loaded.entity);
        const warnings: CBTUnitRestoreWarning[] = [];
        const warn = (code: CBTUnitRestoreWarningCode, message: string): void => {
            warnings.push(Object.freeze({ unitName, code, message }));
        };
        if (sourceHashCanaryChanged(saved.sourceHashCanary, loaded.source.sourceHash)) {
            warn(
                'SOURCE_REVISION_CHANGED',
                'The source file has changed since this unit state was saved.',
            );
        }
        let unit: CBTUnit;
        if (isSerializedNonMekUnit(saved)) {
            if (loaded.entity instanceof MekEntity) {
                throw new Error('A persisted non-Mek runtime resolved to a Mek entity');
            }
            unit = CBTNonMekUnit.restore(saved, loaded.entity, uuid, scenario, nativeSource);
        } else {
            if (!(loaded.entity instanceof MekEntity)) {
                throw new Error('A persisted Mek runtime resolved to a non-Mek entity');
            }
            unit = await CBTMekUnit.restoreFromEntity(saved, loaded.entity, uuid, {
                initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
                profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
                deployment: saved.deployment.values,
                scenario,
            }, nativeSource, {
                onWarning: warning => warn(warning.code, warning.message),
            });
        }
        return Object.freeze({ unit, warnings: Object.freeze(warnings) });
    }
}
