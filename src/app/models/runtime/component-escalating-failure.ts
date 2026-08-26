// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../equipment-flags.type';
import type { Equipment } from '../equipment.model';
import {
    BLUE_SHIELD_FLAG,
    EMERGENCY_COOLANT_SYSTEM_FLAG,
    JET_BOOSTER_FLAG,
    MASC_FLAG,
    RADICAL_HEAT_SINK_FLAG,
    VIRAL_JAMMER_DECOY_FLAG,
    VIRAL_JAMMER_HOMING_FLAG,
    VIRAL_JAMMER_OPERATING_HEAT,
    escalatingFailureCriticalExplosionDamage,
    isBattleArmorMyomerBoosterEquipment,
    isBlueShieldEquipment,
    isEmergencyCoolantSystemEquipment,
    isJetBoosterEquipment,
    isMascEquipment,
    isRadicalHeatSinkEquipment,
    isSuperchargerEquipment,
    isViralJammerEquipment,
    movementBoosterUsableWhile,
} from '../escalating-equipment.model';

export {
    escalatingFailureCriticalExplosionDamage,
    isBattleArmorMyomerBoosterEquipment,
    isJetBoosterEquipment,
    isMascEquipment,
    isSuperchargerEquipment,
    movementBoosterUsableWhile,
} from '../escalating-equipment.model';
import { isCBTRuleset, type CBTRuleset } from '../cbt-ruleset.model';
import { ImmutableSet } from '../entity/immutable-collections';
import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import {
    ESCALATING_FAILURE_NO_CHECK_TARGET,
    formatEscalatingFailureTarget,
    gameRulesFor,
} from '../rules/game-rules';
import {
    componentStateChangeFromReduction,
    type ComponentStateChangeResult,
} from './component-state-change';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import {
    createCommandId,
    type CommandId,
    type EscalatingFailureSequence,
} from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';
import type { PickerChoice } from '../../components/picker/picker.interface';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';

export const ESCALATING_FAILURE_HANDLER_ID = 'escalating-failure-handler';
export const ESCALATING_FAILURE_DISABLED_CHOICE_VALUE = 'escalating-failure-disabled';
export const MASC_HANDLER_ID = 'masc-handler';
export const RADICAL_HEAT_SINK_HANDLER_ID = 'radical-heat-sink-handler';
export const BLUE_SHIELD_HANDLER_ID = 'blue-shield-handler';
export const RISC_EMERGENCY_COOLANT_SYSTEM_HANDLER_ID = 'risc-emergency-coolant-system-handler';
export const RISC_VIRAL_JAMMER_HANDLER_ID = 'risc-viral-jammer-handler';

export type EscalatingFailureSequenceIndex = number;
export type ComponentEscalatingFailureKind =
    | 'masc'
    | 'radical-heat-sink'
    | 'blue-shield'
    | 'risc-emergency-coolant-system'
    | 'risc-viral-jammer';

export interface ComponentEscalatingFailureProfile {
    readonly kind: ComponentEscalatingFailureKind;
    readonly targets: readonly number[];
    readonly recoversWhenUnused: boolean;
}

export interface ComponentEscalatingFailureDefinition {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly kind: ComponentEscalatingFailureKind;
    readonly targets: readonly number[];
    readonly labels: readonly string[];
    readonly ruleset: CBTRuleset;
    readonly jetBooster: boolean;
    readonly recoversWhenUnused: boolean;
}

export interface ComponentEscalatingFailureFacts {
    readonly sequence: 0 | EscalatingFailureSequence;
    readonly active: boolean;
    readonly status: EquipmentStatus;
    readonly airborne: boolean | null;
}

export function createComponentEscalatingFailureDefinition(input: {
    readonly componentId: ComponentId;
    readonly displayName: string;
    readonly flags: Iterable<EquipmentFlag>;
    readonly ruleset: CBTRuleset;
}): ComponentEscalatingFailureDefinition {
    const displayName = input.displayName.trim();
    const flags = new ImmutableSet(input.flags);
    if (!isCBTRuleset(input.ruleset)) {
        throw new Error(`Unsupported CBT ruleset ${String(input.ruleset)}`);
    }
    const profile = componentEscalatingFailureProfile(flags, input.ruleset);
    if (!displayName || displayName.includes('\0')) {
        throw new Error(`Invalid escalating-failure display name for ${input.componentId}`);
    }
    if (!profile) {
        throw new Error(`Component ${input.componentId} has no escalating-failure rules`);
    }
    const targets = Object.freeze([...profile.targets]);
    const labels = Object.freeze(targets.map((target, index) =>
        target === ESCALATING_FAILURE_NO_CHECK_TARGET
            ? String(index + 1)
            : formatEscalatingFailureTarget(target)));
    return Object.freeze({
        componentId: input.componentId,
        displayName,
        flags,
        kind: profile.kind,
        targets,
        labels,
        ruleset: input.ruleset,
        jetBooster: flags.has(JET_BOOSTER_FLAG),
        recoversWhenUnused: profile.recoversWhenUnused,
    });
}

export function componentEscalatingFailureProfile(
    flags: ReadonlySet<EquipmentFlag>,
    ruleset: CBTRuleset,
): ComponentEscalatingFailureProfile | null {
    const rules = gameRulesFor(ruleset);
    if (flags.has(MASC_FLAG)) return Object.freeze({
        kind: 'masc',
        targets: rules.escalatingFailureTargets,
        recoversWhenUnused: true,
    });
    if (flags.has(RADICAL_HEAT_SINK_FLAG)) return Object.freeze({
        kind: 'radical-heat-sink',
        targets: rules.radicalHeatSinkFailureTargets,
        recoversWhenUnused: true,
    });
    if (flags.has(BLUE_SHIELD_FLAG)) return Object.freeze({
        kind: 'blue-shield',
        targets: rules.blueShieldFailureTargets,
        recoversWhenUnused: false,
    });
    if (flags.has(EMERGENCY_COOLANT_SYSTEM_FLAG)) return Object.freeze({
        kind: 'risc-emergency-coolant-system',
        targets: rules.emergencyCoolantSystemFailureTargets,
        recoversWhenUnused: true,
    });
    if (flags.has(VIRAL_JAMMER_DECOY_FLAG) || flags.has(VIRAL_JAMMER_HOMING_FLAG)) return Object.freeze({
        kind: 'risc-viral-jammer',
        targets: rules.viralJammerFailureTargets,
        recoversWhenUnused: false,
    });
    return null;
}

export function isEscalatingFailureEquipment(
    equipment: Equipment | undefined,
    ruleset: CBTRuleset,
): boolean {
    return equipment !== undefined && componentEscalatingFailureProfile(equipment.flags, ruleset) !== null;
}

/** Feature-owned misc-equipment explosion override; undefined means use ordinary explosive damage. */
export type EscalatingFailureHeatProvider =
    | Readonly<{ readonly kind: 'radical-heat-sink'; readonly componentId: ComponentId }>
    | Readonly<{
        readonly kind: 'coolant-system';
        readonly componentId: ComponentId;
        readonly sourceId: 'radical-heat-sink' | 'risc-emergency-coolant';
        readonly label: 'Radical Heat Sink leak' | 'RISC coolant leak';
    }>
    | Readonly<{ readonly kind: 'viral-jammer'; readonly componentId: ComponentId; readonly heat: 12 }>;

/** Complete heat-provider projection for escalating-failure equipment. */
export function escalatingFailureHeatProviders(
    equipment: Equipment | undefined,
    componentId: ComponentId,
): readonly EscalatingFailureHeatProvider[] {
    if (isRadicalHeatSinkEquipment(equipment)) return Object.freeze([
        Object.freeze({ kind: 'radical-heat-sink' as const, componentId }),
        Object.freeze({
            kind: 'coolant-system' as const,
            componentId,
            sourceId: 'radical-heat-sink' as const,
            label: 'Radical Heat Sink leak' as const,
        }),
    ]);
    if (isEmergencyCoolantSystemEquipment(equipment)) return Object.freeze([
        Object.freeze({
            kind: 'coolant-system' as const,
            componentId,
            sourceId: 'risc-emergency-coolant' as const,
            label: 'RISC coolant leak' as const,
        }),
    ]);
    if (isViralJammerEquipment(equipment)) return Object.freeze([
        Object.freeze({
            kind: 'viral-jammer' as const,
            componentId,
            heat: VIRAL_JAMMER_OPERATING_HEAT,
        }),
    ]);
    return Object.freeze([]);
}

export function componentEscalatingFailureDefinition(
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): ComponentEscalatingFailureDefinition {
    const equipment = equipmentForComponent(index, componentId);
    if (!equipment) {
        throw new Error(`Component ${componentId} has no escalating-failure equipment definition`);
    }
    return createComponentEscalatingFailureDefinition({
        componentId,
        displayName: equipment.shortName || equipment.name,
        flags: equipment.flags,
        ruleset,
    });
}

export function componentEscalatingFailureFacts(
    runtime: CBTUnitInstance,
    definition: ComponentEscalatingFailureDefinition,
): ComponentEscalatingFailureFacts {
    const query = runtime.query();
    const lifecycle = query.componentEscalatingFailure(definition.componentId);
    return Object.freeze({
        sequence: lifecycle?.sequence ?? 0,
        active: lifecycle?.active === true,
        status: query.componentStatus(definition.componentId),
        airborne: query.turnState().airborne,
    });
}

export function canUseEscalatingFailure(
    definition: ComponentEscalatingFailureDefinition,
    airborne: boolean | null,
): boolean {
    return !definition.jetBooster || airborne === true;
}

export function escalatingFailureMovementMultiplierBonus(
    runtime: CBTUnitInstance,
    definition: ComponentEscalatingFailureDefinition,
    airborne: boolean | null,
    canProvidePassiveEffect: boolean,
): number {
    return componentEscalatingFailureFacts(runtime, definition).active
        && canProvidePassiveEffect
        && canUseEscalatingFailure(definition, airborne)
        ? 0.5
        : 0;
}

export function selectComponentEscalatingFailureSequence(
    runtime: CBTUnitInstance,
    definition: ComponentEscalatingFailureDefinition,
    index: EscalatingFailureSequenceIndex,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    return componentStateChangeFromReduction(runtime.dispatch({
        type: 'edit-escalating-failure',
        commandId: commandId(),
        expectedRevision: runtime.revision(),
        componentId: definition.componentId,
        edit: { kind: 'select-sequence', index },
    }));
}

export function setComponentEscalatingFailureStatus(
    runtime: CBTUnitInstance,
    definition: ComponentEscalatingFailureDefinition,
    status: 'available' | 'disabled',
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    return componentStateChangeFromReduction(runtime.dispatch({
        type: 'edit-escalating-failure',
        commandId: commandId(),
        expectedRevision: runtime.revision(),
        componentId: definition.componentId,
        edit: { kind: 'set-status', status },
    }));
}

const ESCALATING_FAILURE_CHOICE_COLORS = {
    selected: 'var(--bt-yellow)',
    selectedText: '#000',
    mutedSelected: 'var(--bt-yellow-background)',
    mutedSelectedText: '#888',
    disabledText: '#888',
};
const ESCALATING_FAILURE_FAILURE_CHOICE_COLORS = {
    ...ESCALATING_FAILURE_CHOICE_COLORS,
    selected: '#f00',
    selectedText: '#fff',
    mutedSelected: '#800',
};

/** Shared lifecycle interaction; concrete equipment classes select one owned profile. */
export class EscalatingFailureHandler extends EquipmentInteractionHandler {
    readonly id: string = ESCALATING_FAILURE_HANDLER_ID;
    readonly kind = 'escalating-failure';
    readonly scope = 'component' as const;
    override readonly priority = 10;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = componentEscalatingFailureDefinition(
            input.index,
            input.componentId,
            input.ruleset,
        );
        return this.applicableToComponentEscalatingFailure(definition)
            ? this.getComponentEscalatingFailureChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = componentEscalatingFailureDefinition(
            input.index,
            input.componentId,
            input.ruleset,
        );
        return this.applicableToComponentEscalatingFailure(definition)
            && this.handleComponentEscalatingFailureSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentEscalatingFailure(_definition: ComponentEscalatingFailureDefinition): boolean {
        return true;
    }

    getComponentEscalatingFailureChoices(
        runtime: CBTUnitInstance,
        definition: ComponentEscalatingFailureDefinition,
        context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        const facts = componentEscalatingFailureFacts(runtime, definition);
        if (!canUseEscalatingFailure(definition, facts.airborne)) return [];
        const usable = facts.status === 'available';
        const sequenceChoices: EquipmentInteractionChoice[] = definition.labels.map((label, index) => ({
            label,
            shortLabel: label,
            value: index,
            failureTarget: definition.targets[index],
            displayType: 'toggle',
            disabled: !usable || index > facts.sequence,
            active: index < facts.sequence,
            selectionTone: index === facts.sequence - 1 && facts.active ? 'selected' : 'muted',
            colors: label === '!!'
                ? ESCALATING_FAILURE_FAILURE_CHOICE_COLORS
                : ESCALATING_FAILURE_CHOICE_COLORS,
            keepOpen: true,
        }));
        const disabled = facts.status === 'disabled';
        const toggleLabel = context.choiceSurface === 'turn-summary'
            ? '✖'
            : disabled ? 'Malfunctioning' : 'Operational';
        return [...sequenceChoices, {
            label: toggleLabel,
            shortLabel: toggleLabel,
            value: ESCALATING_FAILURE_DISABLED_CHOICE_VALUE,
            displayType: 'toggle',
            stateEdit: disabled ? 'enable' : 'disable',
            active: disabled,
            disabled: facts.status === 'destroyed',
            colors: disabled ? ESCALATING_FAILURE_FAILURE_CHOICE_COLORS : undefined,
            tooltipType: disabled ? 'error' : undefined,
        }];
    }

    handleComponentEscalatingFailureSelection(
        runtime: CBTUnitInstance,
        definition: ComponentEscalatingFailureDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (choice.value === ESCALATING_FAILURE_DISABLED_CHOICE_VALUE) {
            const disabled = componentEscalatingFailureFacts(runtime, definition).status === 'disabled';
            const result = setComponentEscalatingFailureStatus(
                runtime,
                definition,
                disabled ? 'available' : 'disabled',
            );
            if (!result.accepted) return false;
            if (result.changed) {
                context.toastService.showToast(
                    `${definition.displayName} ${disabled ? 'is operational' : 'has failed'}`,
                    disabled ? 'info' : 'error',
                );
            }
            return true;
        }
        if (!isEscalatingFailureSequenceIndex(choice.value)) return false;
        const result = selectComponentEscalatingFailureSequence(runtime, definition, choice.value);
        if (!result.accepted) return false;
        if (result.changed) {
            const sequence = componentEscalatingFailureFacts(runtime, definition).sequence;
            context.toastService.showToast(
                `${definition.displayName} ${sequence === 0 ? 'reset' : `sequence ${sequence}`}`,
                'info',
            );
        }
        return true;
    }

    getComponentEscalatingFailureRunMovementMultiplierBonus(
        _runtime: CBTUnitInstance,
        _definition: ComponentEscalatingFailureDefinition,
        _airborne: boolean | null,
        _canProvidePassiveEffect: boolean,
    ): number {
        return 0;
    }
}

export class MascHandler extends EscalatingFailureHandler {
    override readonly id = MASC_HANDLER_ID;
    override readonly flags = [MASC_FLAG] as const;

    override applicableToComponentEscalatingFailure(definition: ComponentEscalatingFailureDefinition): boolean {
        return definition.kind === 'masc';
    }

    override getComponentEscalatingFailureRunMovementMultiplierBonus(
        runtime: CBTUnitInstance,
        definition: ComponentEscalatingFailureDefinition,
        airborne: boolean | null,
        canProvidePassiveEffect: boolean,
    ): number {
        return escalatingFailureMovementMultiplierBonus(
            runtime,
            definition,
            airborne,
            canProvidePassiveEffect,
        );
    }
}

export class RadicalHeatSinkHandler extends EscalatingFailureHandler {
    override readonly id = RADICAL_HEAT_SINK_HANDLER_ID;
    override readonly flags = [RADICAL_HEAT_SINK_FLAG] as const;

    override applicableToComponentEscalatingFailure(definition: ComponentEscalatingFailureDefinition): boolean {
        return definition.kind === 'radical-heat-sink';
    }
}

export class BlueShieldHandler extends EscalatingFailureHandler {
    override readonly id = BLUE_SHIELD_HANDLER_ID;
    override readonly flags = [BLUE_SHIELD_FLAG] as const;

    override applicableToComponentEscalatingFailure(definition: ComponentEscalatingFailureDefinition): boolean {
        return definition.kind === 'blue-shield';
    }
}

export class RiscEmergencyCoolantSystemHandler extends EscalatingFailureHandler {
    override readonly id = RISC_EMERGENCY_COOLANT_SYSTEM_HANDLER_ID;
    override readonly flags = [EMERGENCY_COOLANT_SYSTEM_FLAG] as const;

    override applicableToComponentEscalatingFailure(definition: ComponentEscalatingFailureDefinition): boolean {
        return definition.kind === 'risc-emergency-coolant-system';
    }
}

export class RiscViralJammerHandler extends EscalatingFailureHandler {
    override readonly id = RISC_VIRAL_JAMMER_HANDLER_ID;

    override applicableToComponentEscalatingFailure(definition: ComponentEscalatingFailureDefinition): boolean {
        return definition.kind === 'risc-viral-jammer';
    }
}

function isEscalatingFailureSequenceIndex(value: unknown): value is EscalatingFailureSequenceIndex {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
