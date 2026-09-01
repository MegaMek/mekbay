// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import {
    CORE_2026_RULESET,
    isCBTRuleset,
    type CBTRuleset,
} from '../cbt-ruleset.model';
import {
    createPristineMekState,
    type MekUnitRuntimeState,
    type InstanceBaselineRef,
} from './runtime-state';
import {
    createPristineMekHeatStateV2,
    MAX_MEK_HEAT_VALUE_V2,
} from './mek-heat-state-v2';
import {
    canonicalizeCrewAssignment,
    createDefaultCrewAssignment,
    type CrewAssignment,
} from './crew-assignment';
import type { MekRuntimeIndex } from './mek-runtime-index';

export const UNIT_STATE_INITIALIZER_SCHEMA_VERSION = 7 as const;
export const UNIT_STATE_INITIALIZER_REVISION = 1 as const;
export const MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION = 2 as const;
export const DEFAULT_MEK_INITIAL_STATE_PROFILE_ID = `pristine-mek-v${UNIT_STATE_INITIALIZER_SCHEMA_VERSION}`;
export const DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID = 'pristine-non-mek-v1';
export const DEFAULT_FORCE_DEPLOYMENT_ID = 'force-builder-default';

export interface DeploymentConfiguration {
    readonly id: string;
    readonly initialHeat?: number;
    readonly crewAssignment?: CrewAssignment;
}

export interface CanonicalMekDeploymentConfigurationV2 {
    readonly id: string;
    readonly initialHeat?: number;
    readonly crewAssignment: CrewAssignment;
}

export interface ScenarioRules {
    readonly id: string;
    readonly ruleset?: CBTRuleset;
    readonly options?: Readonly<Record<string, string | number | boolean>>;
}

export function scenarioRuleset(scenario: ScenarioRules): CBTRuleset {
    if (scenario.ruleset === undefined) return CORE_2026_RULESET;
    if (!isCBTRuleset(scenario.ruleset)) throw new Error(`Unsupported CBT ruleset ${String(scenario.ruleset)}`);
    return scenario.ruleset;
}

export interface InitializeUnitStateOptions {
    readonly initializerRevision: number;
    readonly profileId: string;
    readonly deployment: DeploymentConfiguration;
    readonly scenario: ScenarioRules;
}

export interface InitializedUnitState {
    readonly baselineRef: InstanceBaselineRef;
    readonly state: MekUnitRuntimeState;
    readonly deployment: CanonicalMekDeploymentConfigurationV2;
}

/** Deterministic pristine baseline. Sparse absence means exactly this versioned projection. */
export function initializeUnitState(
    entity: MekEntity,
    index: MekRuntimeIndex,
    identity: UnitUuid,
    options: InitializeUnitStateOptions,
): InitializedUnitState {
    options = structuredClone(options);
    if (identity !== entity.uuid()) {
        throw new Error('Entity UUID does not match the baseline identity');
    }
    if (!Number.isSafeInteger(options.initializerRevision) || options.initializerRevision < 1) {
        throw new Error('Initializer revision must be a positive integer');
    }
    if (!options.profileId.trim()) throw new Error('Initial-state profile ID cannot be empty');
    const deployment = canonicalizeDeploymentConfiguration(index, options.deployment);
    const ruleset = scenarioRuleset(options.scenario);
    const initialHeat = deployment.initialHeat ?? 0;
    const pristine = createPristineMekState();
    const state: MekUnitRuntimeState = Object.freeze({
        ...pristine,
        ...(initialHeat === 0 ? {} : { heat: createPristineMekHeatStateV2(initialHeat) }),
    });

    return {
        baselineRef: Object.freeze({
            entity: identity,
            ruleset,
            initialStateProfile: Object.freeze({
                schemaVersion: 1,
                initializerRevision: options.initializerRevision,
                profileId: options.profileId,
            }),
        }),
        state,
        deployment,
    };
}

function canonicalizeDeploymentConfiguration(
    index: MekRuntimeIndex,
    deployment: DeploymentConfiguration,
): CanonicalMekDeploymentConfigurationV2 {
    if (typeof deployment.id !== 'string' || !deployment.id.trim()
        || deployment.id.length > 256 || deployment.id.includes('\0')) {
        throw new Error('Deployment configuration ID must be a bounded non-empty string');
    }
    if (deployment.initialHeat !== undefined
        && (!Number.isSafeInteger(deployment.initialHeat)
            || deployment.initialHeat < 0
            || deployment.initialHeat > MAX_MEK_HEAT_VALUE_V2
            || Object.is(deployment.initialHeat, -0))) {
        throw new Error('Initial heat must be a canonical bounded non-negative integer');
    }
    const crewAssignment = deployment.crewAssignment === undefined
        ? createDefaultCrewAssignment(index.crewPositions)
        : canonicalizeCrewAssignment(index.crewPositions, deployment.crewAssignment);
    return Object.freeze({
        id: deployment.id,
        ...(deployment.initialHeat === undefined ? {} : { initialHeat: deployment.initialHeat }),
        crewAssignment,
    });
}
