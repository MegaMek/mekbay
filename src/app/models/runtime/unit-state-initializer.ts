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
import { MAX_HEAT_VALUE } from './turn-heat-ledger';
import { createPristineMekHeatStateV2 } from './mek-heat-state-v2';
import {
    canonicalizeCrewAssignment,
    createDefaultCrewAssignment,
    type CrewAssignment,
} from './crew-assignment';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { Options } from '../options.model';
import {
    boundOptionalRulesFromOptions,
    readBoundOptionalRules,
    type BoundOptionalRules,
} from './bound-optional-rules';

export const DEFAULT_MEK_INITIAL_STATE_PROFILE_ID = 'pristine-mek';
export const DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID = 'pristine-non-mek';
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
    readonly options?: Partial<BoundOptionalRules>;
}

export type CBTApplicationOptions = Pick<Options, 'CBTRules' | 'CBTOptionalRules'>;

/** Captures the global CBT rules needed to construct one runtime owner. */
export function scenarioRulesFromOptions(options: CBTApplicationOptions): ScenarioRules {
    return Object.freeze({
        id: 'megamek',
        ruleset: options.CBTRules,
        options: boundOptionalRulesFromOptions(options.CBTOptionalRules),
    });
}

export function scenarioRuleset(scenario: ScenarioRules): CBTRuleset {
    if (scenario.ruleset === undefined) return CORE_2026_RULESET;
    if (!isCBTRuleset(scenario.ruleset)) throw new Error(`Unsupported CBT ruleset ${String(scenario.ruleset)}`);
    return scenario.ruleset;
}

/** The optional rules a scenario binds into its units; a malformed or unknown option throws. */
export function scenarioBoundRules(scenario: ScenarioRules): BoundOptionalRules {
    const result = readBoundOptionalRules(scenario.options);
    if (result.kind === 'unsupported') throw new Error(result.problems[0]!.message);
    return result.rules;
}

export interface InitializeUnitStateOptions {
    readonly profileId: string;
    readonly deployment: DeploymentConfiguration;
    readonly scenario: ScenarioRules;
}

export interface InitializedUnitState {
    readonly baselineRef: InstanceBaselineRef;
    readonly state: MekUnitRuntimeState;
    readonly deployment: CanonicalMekDeploymentConfigurationV2;
}

/** Deterministic pristine baseline. Sparse absence means exactly this projection. */
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
            || deployment.initialHeat > MAX_HEAT_VALUE
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
