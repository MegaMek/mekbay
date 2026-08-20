// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASForceUnit } from '../models/as-force-unit.model';
import type { GameSystem } from '../models/common.model';
import type { UnitGroup } from '../models/force.model';
import { getFormationDefinition } from './formation-blueprints';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import { formationInheritsParentEffects, type FormationAssignmentEffectGroup, type FormationEffectGroup, type FormationSharedPoolEffectGroup, type FormationTypeDefinition, type FormationWideAbility } from './formation-type.model';

export interface FormationAssignmentPreviewOptions {
    readonly abilityOverrides?: ReadonlyMap<string, readonly string[]>;
    readonly commanderUnitId?: string | null;
}

export interface ReconcileFormationAssignmentOptions extends FormationAssignmentPreviewOptions {
    readonly markModified?: boolean;
}

export interface FormationEffectDescriptor {
    readonly key: string;
    readonly sourceFormationId: string;
    readonly sourceFormationName: string;
    readonly sourceFormationDescription: string;
    readonly group: FormationAssignmentEffectGroup;
    /** Formation-granted ability ids from either PILOT_ABILITIES or COMMAND_ABILITIES. */
    readonly abilityIds: readonly string[];
}

export interface FormationSharedPoolDescriptor {
    readonly key: string;
    readonly sourceFormationId: string;
    readonly sourceFormationName: string;
    readonly group: FormationSharedPoolEffectGroup;
    /** Formation-granted ability ids from either PILOT_ABILITIES or COMMAND_ABILITIES. */
    readonly abilityIds: readonly string[];
}

export interface FormationWideAbilityDescriptor {
    readonly key: string;
    readonly sourceFormationId: string;
    readonly sourceFormationName: string;
    readonly ability: FormationWideAbility;
}

export interface FormationSharedPoolPreview {
    readonly descriptor: FormationSharedPoolDescriptor;
    readonly formationUnitCount: number;
    readonly resolvedLevel: number | null;
    readonly totalUsesPerScenario: number | null;
    readonly maxUsesPerUnitPerScenario: number | null;
    readonly stacksWithIndividualAbility: boolean;
}

export interface FormationEffectPreview {
    readonly descriptor: FormationEffectDescriptor;
    readonly candidateUnitIds: readonly string[];
    readonly recipientUnitIds: readonly string[];
    readonly assignedByUnitId: ReadonlyMap<string, readonly string[]>;
    readonly recipientLimit: number | null;
    readonly maxPerUnit: number;
    readonly lockedAbilityId: string | null;
}

export interface FormationAssignmentPreview {
    readonly formation: FormationTypeDefinition | null;
    readonly commanderUnitId: string | null;
    readonly requirementsFiltered: boolean;
    readonly requirementsFilterCompositionName?: string;
    readonly requirementsFilterNotice?: string;
    readonly eligibleUnitIds: readonly string[];
    readonly assignmentsByUnitId: ReadonlyMap<string, readonly string[]>;
    readonly effectPreviews: readonly FormationEffectPreview[];
    readonly sharedPoolPreviews: readonly FormationSharedPoolPreview[];
    readonly formationWideAbilities: readonly FormationWideAbilityDescriptor[];
}

interface MutableFormationEffectPreview {
    readonly descriptor: FormationEffectDescriptor;
    readonly candidateUnitIds: string[];
    readonly recipientUnitIds: string[];
    readonly assignedByUnitId: Map<string, string[]>;
    readonly recipientLimit: number | null;
    readonly maxPerUnit: number;
    readonly lockedAbilityId: string | null;
}

function uniqueAbilityIds(abilityIds: readonly string[] | undefined): string[] {
    if (!abilityIds || abilityIds.length === 0) {
        return [];
    }

    return [...new Set(abilityIds.filter((abilityId) => typeof abilityId === 'string' && abilityId.length > 0))];
}

function getEffectAbilityIds(group: FormationAssignmentEffectGroup | FormationSharedPoolEffectGroup): string[] {
    return uniqueAbilityIds([
        ...(group.abilityIds ?? []),
        ...(group.commandAbilityIds ?? []),
    ]);
}

export function resolveFormationSharedPoolLevel(
    group: FormationSharedPoolEffectGroup,
    formationUnitCount: number,
): number | null {
    const level = group.sharedPool.level;
    if (!level) {
        return null;
    }

    switch (level.kind) {
        case 'fixed':
            return Math.max(0, level.value);
        case 'unit-count-plus':
            return Math.max(0, formationUnitCount + level.offset);
    }
}

function getParentFormationDefinition(
    definition: FormationTypeDefinition,
    gameSystem: GameSystem,
): FormationTypeDefinition | null {
    return definition.parent
        ? getFormationDefinition(definition.parent, gameSystem)
        : null;
}

function getFormationEffectChain(
    definition: FormationTypeDefinition | null | undefined,
    gameSystem: GameSystem,
    visited = new Set<string>(),
): FormationTypeDefinition[] {
    if (!definition || visited.has(definition.id)) {
        return [];
    }

    visited.add(definition.id);
    const inheritedParentDefinitions = formationInheritsParentEffects(definition)
        ? getFormationEffectChain(getParentFormationDefinition(definition, gameSystem), gameSystem, visited)
        : [];

    return [
        ...inheritedParentDefinitions,
        definition,
    ];
}

export function getInheritedFormationEffectGroups(
    definition: FormationTypeDefinition | null | undefined,
    gameSystem: GameSystem,
): FormationEffectGroup[] {
    return getFormationEffectChain(definition, gameSystem).flatMap((sourceDefinition) => sourceDefinition.effectGroups ?? []);
}

function orderAbilityIds(abilityIds: readonly string[], preferredOrder: readonly string[]): string[] {
    const orderIndex = new Map(preferredOrder.map((abilityId, index) => [abilityId, index]));
    return [...new Set(abilityIds)].sort((left, right) => {
        const leftIndex = orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
}

function getCurrentCommanderUnitId(group: UnitGroup<ASForceUnit>, options?: FormationAssignmentPreviewOptions): string | null {
    if (options && Object.prototype.hasOwnProperty.call(options, 'commanderUnitId')) {
        const explicitCommanderId = options.commanderUnitId ?? null;
        if (!explicitCommanderId) {
            return null;
        }

        return group.units().some((unit) => unit.id === explicitCommanderId)
            ? explicitCommanderId
            : null;
    }

    return group.units().find((unit) => unit.commander())?.id ?? null;
}

function getRequestedAssignments(
    group: UnitGroup<ASForceUnit>,
    options?: FormationAssignmentPreviewOptions,
): Map<string, string[]> {
    const assignments = new Map<string, string[]>();
    const abilityOverrides = options?.abilityOverrides;

    for (const unit of group.units()) {
        const overrideAbilityIds = abilityOverrides?.get(unit.id);
        assignments.set(
            unit.id,
            uniqueAbilityIds(overrideAbilityIds ?? unit.formationAbilities()),
        );
    }

    return assignments;
}

function hasAutomaticRecipients(group: FormationEffectGroup): boolean {
    switch (group.distribution) {
        case 'all':
        case 'conditional':
        case 'remainder':
        case 'role-filtered':
        case 'commander':
            return true;
        default:
            return false;
    }
}

function getSupportedEffectDescriptors(definition: FormationTypeDefinition | null, gameSystem: GameSystem): {
    supported: FormationEffectDescriptor[];
    sharedPools: FormationSharedPoolDescriptor[];
    formationWideAbilities: FormationWideAbilityDescriptor[];
} {
    if (!definition) {
        return { supported: [], sharedPools: [], formationWideAbilities: [] };
    }

    const supported: FormationEffectDescriptor[] = [];
    const sharedPools: FormationSharedPoolDescriptor[] = [];
    const formationWideAbilities: FormationWideAbilityDescriptor[] = [];

    for (const sourceDefinition of getFormationEffectChain(definition, gameSystem)) {
        const effectGroups = sourceDefinition.effectGroups ?? [];
        effectGroups.forEach((group, index) => {
            if (group.distribution === 'formation-wide') {
                group.formationWideAbilities.forEach((ability) => {
                    formationWideAbilities.push({
                        key: `${sourceDefinition.id}:${index}:${ability.id}`,
                        sourceFormationId: sourceDefinition.id,
                        sourceFormationName: sourceDefinition.name,
                        ability,
                    });
                });
                return;
            }

            const key = `${sourceDefinition.id}:${index}`;
            const abilityIds = getEffectAbilityIds(group);

            if (group.distribution === 'shared-pool') {
                if (abilityIds.length > 0) {
                    sharedPools.push({
                        key,
                        sourceFormationId: sourceDefinition.id,
                        sourceFormationName: sourceDefinition.name,
                        group,
                        abilityIds,
                    });
                }
                return;
            }

            if (abilityIds.length === 0) {
                return;
            }

            supported.push({
                key,
                sourceFormationId: sourceDefinition.id,
                sourceFormationName: sourceDefinition.name,
                sourceFormationDescription: sourceDefinition.description,
                group,
                abilityIds,
            });
        });
    }

    return { supported, sharedPools, formationWideAbilities };
}

function getConditionalCandidate(unit: ASForceUnit, group: FormationEffectGroup): boolean {
    if (group.condition === 'Move (Thrust) ≤ 9') {
        const movementValues = Object.values(unit.getUnit().as?.MVm ?? {});
        if (movementValues.length === 0) {
            return false;
        }
        return Math.max(...movementValues) <= 9;
    }

    return false;
}

function getRecipientLimit(group: FormationEffectGroup, candidateCount: number): number | null {
    switch (group.distribution) {
        case 'all':
        case 'conditional':
        case 'remainder':
        case 'role-filtered':
        case 'commander':
            return candidateCount;
        case 'half-round-down':
            return Math.floor(candidateCount / 2);
        case 'half-round-up':
            return Math.ceil(candidateCount / 2);
        case 'percent-75':
            return Math.round(candidateCount * 0.75);
        case 'up-to-50-percent':
            return Math.floor(candidateCount * 0.5);
        case 'fixed':
            return group.count ?? 0;
        case 'fixed-pairs':
            return (group.count ?? 0) * 2;
        default:
            return null;
    }
}

function getCandidateUnits(
    descriptor: FormationEffectDescriptor,
    baseEligibleUnits: readonly ASForceUnit[],
    commanderUnitId: string | null,
    previousRecipientIds: ReadonlySet<string>,
): ASForceUnit[] {
    let candidateUnits = [...baseEligibleUnits];

    switch (descriptor.group.distribution) {
        case 'role-filtered':
            candidateUnits = candidateUnits.filter((unit) => unit.getUnit().role === descriptor.group.roleFilter);
            break;
        case 'conditional':
            candidateUnits = candidateUnits.filter((unit) => getConditionalCandidate(unit, descriptor.group));
            break;
        case 'remainder':
            candidateUnits = candidateUnits.filter((unit) => !previousRecipientIds.has(unit.id));
            break;
        case 'commander':
            candidateUnits = commanderUnitId
                ? candidateUnits.filter((unit) => unit.id === commanderUnitId)
                : [];
            break;
        default:
            break;
    }

    if (descriptor.group.excludeCommander && commanderUnitId) {
        candidateUnits = candidateUnits.filter((unit) => unit.id !== commanderUnitId);
    }

    return candidateUnits;
}

function getInitialAssignedAbilityIds(
    units: readonly ASForceUnit[],
    requestedAssignments: ReadonlyMap<string, string[]>,
    descriptor: FormationEffectDescriptor,
): Map<string, string[]> {
    const effectAbilityIds = new Set(descriptor.abilityIds);
    const assignments = new Map<string, string[]>();

    for (const unit of units) {
        const requested = requestedAssignments.get(unit.id) ?? [];
        assignments.set(
            unit.id,
            orderAbilityIds(
                requested.filter((abilityId) => effectAbilityIds.has(abilityId)),
                descriptor.abilityIds,
            ),
        );
    }

    return assignments;
}

function trimRecipientUnits(units: readonly ASForceUnit[], recipientLimit: number | null): ASForceUnit[] {
    if (recipientLimit == null) {
        return [...units];
    }

    return units.slice(0, Math.max(0, recipientLimit));
}

function getCurrentRecipientUnits(
    descriptor: FormationEffectDescriptor,
    candidateUnits: readonly ASForceUnit[],
    currentAssignments: ReadonlyMap<string, string[]>,
    recipientLimit: number | null,
): ASForceUnit[] {
    if (hasAutomaticRecipients(descriptor.group)) {
        return trimRecipientUnits(candidateUnits, recipientLimit);
    }

    return trimRecipientUnits(
        candidateUnits.filter((unit) => (currentAssignments.get(unit.id)?.length ?? 0) > 0),
        recipientLimit,
    );
}

function getLockedAbilityIdForChooseOne(
    descriptor: FormationEffectDescriptor,
    currentRecipientUnits: readonly ASForceUnit[],
    currentAssignments: ReadonlyMap<string, string[]>,
    abilityOverrides?: ReadonlyMap<string, readonly string[]>,
): string | null {
    const explicitOverrideUnits = abilityOverrides
        ? currentRecipientUnits.filter((unit) => abilityOverrides.has(unit.id))
        : [];

    if (explicitOverrideUnits.length > 0) {
        const overrideSelectedAbilityId = descriptor.abilityIds.find((abilityId) =>
            explicitOverrideUnits.some((unit) => (currentAssignments.get(unit.id) ?? []).includes(abilityId)),
        ) ?? null;

        if (overrideSelectedAbilityId) {
            return overrideSelectedAbilityId;
        }

        if (hasAutomaticRecipients(descriptor.group)) {
            return null;
        }
    }

    return descriptor.abilityIds.find((abilityId) =>
        currentRecipientUnits.some((unit) => (currentAssignments.get(unit.id) ?? []).includes(abilityId)),
    ) ?? null;
}

function buildChooseEachAssignments(
    descriptor: FormationEffectDescriptor,
    recipientUnits: readonly ASForceUnit[],
    currentAssignments: ReadonlyMap<string, string[]>,
): Map<string, string[]> {
    const maxPerUnit = descriptor.group.maxPerUnit ?? 1;
    const nextAssignments = new Map<string, string[]>();

    if (descriptor.group.distribution !== 'fixed-pairs') {
        for (const unit of recipientUnits) {
            nextAssignments.set(unit.id, (currentAssignments.get(unit.id) ?? []).slice(0, maxPerUnit));
        }
        return nextAssignments;
    }

    const maxPairs = descriptor.group.count ?? 0;
    const usageCounts = new Map<string, number>();

    for (const unit of recipientUnits) {
        const selectedAbilityIds: string[] = [];
        for (const abilityId of currentAssignments.get(unit.id) ?? []) {
            const usageCount = usageCounts.get(abilityId) ?? 0;
            if (usageCount >= 2) {
                continue;
            }
            if (usageCount === 0 && usageCounts.size >= maxPairs) {
                continue;
            }

            selectedAbilityIds.push(abilityId);
            usageCounts.set(abilityId, usageCount + 1);
            if (selectedAbilityIds.length >= maxPerUnit) {
                break;
            }
        }

        if (selectedAbilityIds.length > 0) {
            nextAssignments.set(unit.id, selectedAbilityIds);
        }
    }

    return nextAssignments;
}

function freezeEffectPreview(preview: MutableFormationEffectPreview): FormationEffectPreview {
    const frozenAssignments = new Map<string, readonly string[]>();
    preview.assignedByUnitId.forEach((abilityIds, unitId) => {
        frozenAssignments.set(unitId, [...abilityIds]);
    });

    return {
        descriptor: preview.descriptor,
        candidateUnitIds: [...preview.candidateUnitIds],
        recipientUnitIds: [...preview.recipientUnitIds],
        assignedByUnitId: frozenAssignments,
        recipientLimit: preview.recipientLimit,
        maxPerUnit: preview.maxPerUnit,
        lockedAbilityId: preview.lockedAbilityId,
    };
}

export class FormationAbilityAssignmentUtil {
    public static previewGroupFormationAssignments(
        group: UnitGroup<ASForceUnit>,
        options?: FormationAssignmentPreviewOptions,
    ): FormationAssignmentPreview {
        const formation = group.activeFormation();
        const { supported, sharedPools, formationWideAbilities } = getSupportedEffectDescriptors(
            formation,
            group.force.gameSystem,
        );
        const formationUnitCount = group.units().length;
        const filterContext = LanceTypeIdentifierUtil.getRequirementsFilterContextForGroup(group);
        const baseEligibleUnits = (filterContext.filteredUnits as ASForceUnit[] | undefined) ?? group.units();
        const requestedAssignments = getRequestedAssignments(group, options);
        const commanderUnitId = getCurrentCommanderUnitId(group, options);

        const finalAssignments = new Map<string, string[]>();
        for (const unit of group.units()) {
            finalAssignments.set(unit.id, []);
        }

        const previousRecipientIds = new Set<string>();
        const previews: MutableFormationEffectPreview[] = [];

        for (const descriptor of supported) {
            const candidateUnits = getCandidateUnits(descriptor, baseEligibleUnits, commanderUnitId, previousRecipientIds);
            const recipientLimit = getRecipientLimit(descriptor.group, candidateUnits.length);
            const currentAssignments = getInitialAssignedAbilityIds(candidateUnits, requestedAssignments, descriptor);
            const maxPerUnit = descriptor.group.maxPerUnit ?? 1;
            const currentRecipientUnits = getCurrentRecipientUnits(descriptor, candidateUnits, currentAssignments, recipientLimit);

            const assignedByUnitId = new Map<string, string[]>();
            let lockedAbilityId: string | null = null;

            switch (descriptor.group.selection) {
                case 'all': {
                    for (const unit of currentRecipientUnits) {
                        assignedByUnitId.set(unit.id, [...descriptor.abilityIds]);
                    }
                    break;
                }
                case 'choose-one': {
                    lockedAbilityId = getLockedAbilityIdForChooseOne(
                        descriptor,
                        currentRecipientUnits,
                        currentAssignments,
                        options?.abilityOverrides,
                    );

                    if (lockedAbilityId) {
                        for (const unit of currentRecipientUnits) {
                            assignedByUnitId.set(unit.id, [lockedAbilityId]);
                        }
                    }
                    break;
                }
                case 'choose-each': {
                    const chooseEachAssignments = buildChooseEachAssignments(descriptor, currentRecipientUnits, currentAssignments);
                    chooseEachAssignments.forEach((abilityIds, unitId) => {
                        assignedByUnitId.set(unitId, abilityIds.slice(0, maxPerUnit));
                    });
                    break;
                }
            }

            const recipientUnitIds = Array.from(assignedByUnitId.keys());
            recipientUnitIds.forEach((unitId) => previousRecipientIds.add(unitId));
            assignedByUnitId.forEach((abilityIds, unitId) => {
                const currentAbilityIds = finalAssignments.get(unitId) ?? [];
                finalAssignments.set(unitId, [...currentAbilityIds, ...abilityIds]);
            });

            previews.push({
                descriptor,
                candidateUnitIds: candidateUnits.map((unit) => unit.id),
                recipientUnitIds,
                assignedByUnitId,
                recipientLimit,
                maxPerUnit,
                lockedAbilityId,
            });
        }

        const frozenAssignments = new Map<string, readonly string[]>();
        finalAssignments.forEach((abilityIds, unitId) => {
            frozenAssignments.set(unitId, [...abilityIds]);
        });

        const sharedPoolPreviews = sharedPools.map((descriptor) => ({
            descriptor,
            formationUnitCount,
            resolvedLevel: resolveFormationSharedPoolLevel(descriptor.group, formationUnitCount),
            totalUsesPerScenario: descriptor.group.sharedPool.totalUsesPerScenario ?? null,
            maxUsesPerUnitPerScenario: descriptor.group.sharedPool.maxUsesPerUnitPerScenario ?? null,
            stacksWithIndividualAbility: descriptor.group.sharedPool.stacksWithIndividualAbility === true,
        }));

        return {
            formation,
            commanderUnitId,
            requirementsFiltered: filterContext.requirementsFiltered,
            requirementsFilterCompositionName: filterContext.requirementsFilterCompositionName,
            requirementsFilterNotice: filterContext.requirementsFilterNotice,
            eligibleUnitIds: baseEligibleUnits.map((unit) => unit.id),
            assignmentsByUnitId: frozenAssignments,
            effectPreviews: previews.map(freezeEffectPreview),
            sharedPoolPreviews,
            formationWideAbilities
        };
    }

    public static reconcileGroupFormationAssignments(
        group: UnitGroup<ASForceUnit>,
        options?: ReconcileFormationAssignmentOptions,
    ): FormationAssignmentPreview {
        const preview = this.previewGroupFormationAssignments(group, options);
        const markModified = options?.markModified ?? true;

        for (const unit of group.units()) {
            const nextFormationAbilities = [...(preview.assignmentsByUnitId.get(unit.id) ?? [])];
            unit.setFormationAbilities(nextFormationAbilities, markModified);
            unit.setFormationCommander(preview.commanderUnitId === unit.id, markModified);
        }

        return preview;
    }
}
