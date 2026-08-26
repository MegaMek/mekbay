// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { WeaponEquipment } from '../equipment.model';
import { isWeaponEnhancementEquipment } from '../weapon-enhancement.model';
import type { EquipmentStatus } from '../equipment-status.model';
import type { WeaponType } from '../weapon-types.model';
import {
    PPC_CAPACITOR_COMPATIBLE_FLAG,
    PPC_CAPACITOR_DAMAGE_BONUS,
    PPC_CAPACITOR_FLAG,
    PPC_CAPACITOR_HEAT_BONUS,
    PPC_FLAG,
    isPpcCapacitorCompatibleWeapon,
    isPpcCapacitorEquipment,
} from '../ppc-capacitor.model';
import {
    componentStatusDefinition,
    createComponentStatusDefinition,
    type ComponentStatusDefinition,
} from './component-status';
import {
    componentStateChangeFromReduction,
    type ComponentStateChangeResult,
} from './component-state-change';
import {
    equipmentForComponent,
    mountedEquipmentForComponent,
    type MekRuntimeIndex,
} from './mek-runtime-index';
import {
    createCommandId,
    type CommandId,
    type PpcCapacitorChargeState,
    type PpcCapacitorRuntimeState,
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

export const PPC_CAPACITOR_CHARGING_STATE = 'charging' as const;
export const PPC_CAPACITOR_CHARGED_STATE = 'charged' as const;
export {
    PPC_CAPACITOR_DAMAGE_BONUS,
    PPC_CAPACITOR_HEAT_BONUS,
    isPpcCapacitorCompatibleWeapon,
    isPpcCapacitorEquipment,
} from '../ppc-capacitor.model';

export interface ComponentPpcCapacitorDefinition {
    readonly capacitor: ComponentStatusDefinition;
    readonly weapon: ComponentStatusDefinition;
    readonly relation: {
        readonly kind: 'linked';
        readonly sourceId: ComponentId;
        readonly targetId: ComponentId;
    };
}

export interface ComponentPpcCapacitorFacts {
    readonly capacitorStatus: EquipmentStatus;
    readonly weaponStatus: EquipmentStatus;
    readonly chargeState: PpcCapacitorChargeState | null;
    readonly firedThisTurn: boolean;
}

export interface PpcCapacitorFireTransition {
    readonly capacitorId: ComponentId;
    readonly weaponId: ComponentId;
}

export interface PpcCapacitorRuntimeView {
    componentPpcCapacitor(componentId: ComponentId): PpcCapacitorRuntimeState | undefined;
}

export function createComponentPpcCapacitorDefinition(input: {
    readonly capacitor: ComponentStatusDefinition;
    readonly weapon: ComponentStatusDefinition;
    readonly sourceId: ComponentId;
    readonly targetId: ComponentId;
}): ComponentPpcCapacitorDefinition {
    if (input.sourceId !== input.capacitor.componentId
        || input.targetId !== input.weapon.componentId
        || input.sourceId === input.targetId
        || !isWeaponEnhancementEquipment(input.capacitor.flags)
        || !input.capacitor.flags.has(PPC_CAPACITOR_FLAG)
        || !input.weapon.flags.has(PPC_FLAG)
        || !input.weapon.flags.has(PPC_CAPACITOR_COMPATIBLE_FLAG)) {
        throw new Error('Invalid PPC capacitor relation');
    }
    return Object.freeze({
        capacitor: createComponentStatusDefinition(input.capacitor),
        weapon: createComponentStatusDefinition(input.weapon),
        relation: Object.freeze({
            kind: 'linked' as const,
            sourceId: input.sourceId,
            targetId: input.targetId,
        }),
    });
}

export function ppcCapacitorWeaponId(
    entity: MekEntity,
    index: MekRuntimeIndex,
    capacitorId: ComponentId,
): ComponentId | undefined {
    const weaponId = index.relationships.linkedTargetBySource.get(capacitorId);
    return weaponId !== undefined
        && index.relationships.linkedSourceByTarget.get(weaponId) === capacitorId
        && isPpcCapacitorPair(entity, index, capacitorId, weaponId)
        ? weaponId
        : undefined;
}

export function isPpcCapacitorPair(
    entity: MekEntity,
    index: MekRuntimeIndex,
    capacitorId: ComponentId,
    weaponId: ComponentId,
): boolean {
    const capacitor = mountedEquipmentForComponent(index, capacitorId);
    const weapon = mountedEquipmentForComponent(index, weaponId);
    if (!capacitor || !weapon
        || !capacitor.equipment
        || !weapon.equipment
        || capacitor.allocation.kind !== 'location'
        || weapon.allocation.kind !== 'location'
        || capacitor.location !== weapon.location
        || capacitor.isSplitAcrossLocations
        || weapon.isSplitAcrossLocations
        || !isPpcCapacitorEquipment(capacitor.equipment)
        || !isPpcCapacitorCompatibleWeapon(weapon.equipment)
        || index.relationships.linkedTargetBySource.get(capacitorId) !== weaponId
        || index.relationships.linkedSourceByTarget.get(weaponId) !== capacitorId) return false;
    return weapon.equipment.id !== 'CLERPPC' || entity.year() >= 3101;
}

/** Null means unrelated; false means a capacitor relation exists but is malformed. */
export function ppcCapacitorFireTransition(
    entity: MekEntity,
    index: MekRuntimeIndex,
    weaponId: ComponentId,
): PpcCapacitorFireTransition | null | false {
    const sourceId = index.relationships.linkedSourceByTarget.get(weaponId);
    if (sourceId === undefined || !isPpcCapacitorEquipment(equipmentForComponent(index, sourceId))) {
        return null;
    }
    if (!isPpcCapacitorPair(entity, index, sourceId, weaponId)) return false;
    return Object.freeze({ capacitorId: sourceId, weaponId });
}

export function ppcCapacitorChargingForWeapon(
    index: MekRuntimeIndex,
    runtime: PpcCapacitorRuntimeView,
    weaponId: ComponentId,
): boolean {
    const sourceId = index.relationships.linkedSourceByTarget.get(weaponId);
    if (sourceId === undefined || !isPpcCapacitorEquipment(equipmentForComponent(index, sourceId))) {
        return false;
    }
    const lifecycle = runtime.componentPpcCapacitor(sourceId);
    return lifecycle?.weaponId === weaponId
        && lifecycle.chargeState === PPC_CAPACITOR_CHARGING_STATE;
}

export function componentPpcCapacitorDefinition(
    entity: MekEntity,
    index: MekRuntimeIndex,
    capacitorId: ComponentId,
    weaponId: ComponentId,
): ComponentPpcCapacitorDefinition {
    if (!isPpcCapacitorPair(entity, index, capacitorId, weaponId)) {
        throw new Error(`Component ${capacitorId} is not linked exactly to compatible PPC ${weaponId}`);
    }
    return createComponentPpcCapacitorDefinition({
        capacitor: componentStatusDefinition(index, capacitorId),
        weapon: componentStatusDefinition(index, weaponId),
        sourceId: capacitorId,
        targetId: weaponId,
    });
}

export function componentPpcCapacitorFacts(
    runtime: CBTUnitInstance,
    definition: ComponentPpcCapacitorDefinition,
): ComponentPpcCapacitorFacts {
    const query = runtime.query();
    const state = query.componentPpcCapacitor(definition.capacitor.componentId);
    if (state !== undefined && state.weaponId !== definition.weapon.componentId) {
        throw new Error('Invalid PPC capacitor runtime facts');
    }
    return Object.freeze({
        capacitorStatus: query.componentStatus(definition.capacitor.componentId),
        weaponStatus: query.componentStatus(definition.weapon.componentId),
        chargeState: state?.chargeState ?? null,
        firedThisTurn: state?.firedThisTurn === true,
    });
}

export function setComponentPpcCapacitorCharge(
    runtime: CBTUnitInstance,
    definition: ComponentPpcCapacitorDefinition,
    state: typeof PPC_CAPACITOR_CHARGING_STATE | null,
    commandId: () => CommandId = createCommandId,
): ComponentStateChangeResult {
    return componentStateChangeFromReduction(runtime.dispatch({
        type: 'set-ppc-capacitor-charge',
        commandId: commandId(),
        expectedRevision: runtime.revision(),
        capacitorId: definition.capacitor.componentId,
        weaponId: definition.weapon.componentId,
        state,
    }));
}

export function ppcCapacitorChargedForWeapon(
    entity: MekEntity,
    index: MekRuntimeIndex,
    runtime: Pick<ReturnType<CBTUnitInstance['query']>, 'componentStatus' | 'componentPpcCapacitor'>,
    weaponId: ComponentId,
): boolean {
    const capacitorId = index.relationships.linkedSourceByTarget.get(weaponId);
    if (capacitorId === undefined
        || !isPpcCapacitorPair(entity, index, capacitorId, weaponId)
        || runtime.componentStatus(capacitorId) !== 'available'
        || runtime.componentStatus(weaponId) !== 'available') return false;
    const lifecycle = runtime.componentPpcCapacitor(capacitorId);
    return lifecycle?.weaponId === weaponId
        && lifecycle.chargeState === PPC_CAPACITOR_CHARGED_STATE;
}

export function ppcCapacitorWeaponDamage(
    damage: WeaponEquipment['damage'],
    charged: boolean,
): WeaponEquipment['damage'] {
    if (!charged) return damage;
    if (typeof damage === 'number') return damage + PPC_CAPACITOR_DAMAGE_BONUS;
    return Array.isArray(damage)
        ? damage.map(value => value + PPC_CAPACITOR_DAMAGE_BONUS)
        : damage;
}

export function ppcCapacitorWeaponTypes(
    types: ReadonlySet<WeaponType>,
    charged: boolean,
): ReadonlySet<WeaponType> {
    return charged ? new Set([...types, 'X']) : types;
}

export const PPC_CAPACITOR_CHARGED_COLOR = '#00a8ff';
export const PPC_CAPACITOR_CHARGED_TEXT_COLOR = '#001829';

/** PPC capacitor definition, lifecycle, combat projections, and interaction owner. */
export class PpcCapacitorHandler extends EquipmentInteractionHandler {
    readonly id = 'ppc-capacitor-handler';
    readonly kind = 'ppc-capacitor';
    readonly scope = 'link' as const;
    override readonly flags = [PPC_FLAG] as const;
    override readonly priority = 20;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const definition = this.definition(input);
        return this.applicableToComponentPpcCapacitor(definition)
            ? this.getComponentPpcCapacitorChoices(input.runtime, definition, input.context)
            : [];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const definition = this.definition(input);
        return this.applicableToComponentPpcCapacitor(definition)
            && this.handleComponentPpcCapacitorSelection(input.runtime, definition, choice, context);
    }

    applicableToComponentPpcCapacitor(definition: ComponentPpcCapacitorDefinition): boolean {
        return isWeaponEnhancementEquipment(definition.capacitor.flags)
            && definition.capacitor.flags.has(PPC_CAPACITOR_FLAG)
            && definition.weapon.flags.has(PPC_FLAG)
            && definition.weapon.flags.has(PPC_CAPACITOR_COMPATIBLE_FLAG);
    }

    getComponentPpcCapacitorChoices(
        runtime: CBTUnitInstance,
        definition: ComponentPpcCapacitorDefinition,
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        if (!this.usable(runtime, definition)) return [];
        const facts = componentPpcCapacitorFacts(runtime, definition);
        const active = facts.chargeState !== null;
        return [{
            label: facts.chargeState === PPC_CAPACITOR_CHARGED_STATE
                ? 'Capacitor Charged!'
                : facts.chargeState === PPC_CAPACITOR_CHARGING_STATE
                    ? 'Capacitor Charging..'
                    : 'Charge Capacitor',
            shortLabel: facts.chargeState === PPC_CAPACITOR_CHARGED_STATE
                ? 'Charged!'
                : facts.chargeState === PPC_CAPACITOR_CHARGING_STATE ? 'Charging' : 'Charge',
            value: active ? 'discharged' : PPC_CAPACITOR_CHARGING_STATE,
            active,
            disabled: facts.firedThisTurn,
            ...(active ? {
                colors: {
                    selected: PPC_CAPACITOR_CHARGED_COLOR,
                    selectedText: PPC_CAPACITOR_CHARGED_TEXT_COLOR,
                },
            } : {}),
            displayType: 'toggle',
        }];
    }

    handleComponentPpcCapacitorSelection(
        runtime: CBTUnitInstance,
        definition: ComponentPpcCapacitorDefinition,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (!this.usable(runtime, definition)) return false;
        if (choice.value === PPC_CAPACITOR_CHARGING_STATE) {
            if (componentPpcCapacitorFacts(runtime, definition).firedThisTurn) {
                context.toastService.showToast('A fired PPC cannot charge its capacitor this turn.', 'error');
                return true;
            }
            const result = setComponentPpcCapacitorCharge(runtime, definition, PPC_CAPACITOR_CHARGING_STATE);
            if (result.accepted) context.toastService.showToast('PPC Capacitor charging', 'info');
            return result.accepted;
        }
        if (choice.value === 'discharged') {
            const result = setComponentPpcCapacitorCharge(runtime, definition, null);
            if (result.accepted) context.toastService.showToast('PPC Capacitor discharged', 'info');
            return result.accepted;
        }
        return false;
    }

    private usable(runtime: CBTUnitInstance, definition: ComponentPpcCapacitorDefinition): boolean {
        const facts = componentPpcCapacitorFacts(runtime, definition);
        return this.applicableToComponentPpcCapacitor(definition)
            && facts.capacitorStatus === 'available'
            && facts.weaponStatus === 'available';
    }

    private definition(input: EquipmentInteractionInput): ComponentPpcCapacitorDefinition {
        if (input.relatedComponentId === undefined) throw new Error('PPC capacitor requires an authored link');
        return componentPpcCapacitorDefinition(
            input.entity,
            input.index,
            input.relatedComponentId,
            input.componentId,
        );
    }
}
