// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isMobileHpgEquipment } from '../aerospace-support-equipment.model';
import type { Equipment } from '../equipment.model';
import { isEquipmentForPlatform } from '../equipment-platform.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { PickerChoice } from '../../components/picker/picker.interface';
import { equipmentForComponent } from './mek-runtime-index';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
} from './equipment-interaction';

export const HPG_IDLE_MODE = 'idle';
export const HPG_CHARGING_MODE = 'charging';
export const HPG_CHARGED_MODE = 'charged';
export const HPG_TRANSMITTING_MODE = 'transmitting';
export const HPG_COOLDOWN_3_MODE = 'cooldown-3';
export const HPG_COOLDOWN_2_MODE = 'cooldown-2';
export const HPG_COOLDOWN_1_MODE = 'cooldown-1';

export type MobileHpgMode =
    | typeof HPG_IDLE_MODE
    | typeof HPG_CHARGING_MODE
    | typeof HPG_CHARGED_MODE
    | typeof HPG_TRANSMITTING_MODE
    | typeof HPG_COOLDOWN_3_MODE
    | typeof HPG_COOLDOWN_2_MODE
    | typeof HPG_COOLDOWN_1_MODE;

export const MOBILE_HPG_MODES: readonly MobileHpgMode[] = Object.freeze([
    HPG_IDLE_MODE,
    HPG_CHARGING_MODE,
    HPG_CHARGED_MODE,
    HPG_TRANSMITTING_MODE,
    HPG_COOLDOWN_3_MODE,
    HPG_COOLDOWN_2_MODE,
    HPG_COOLDOWN_1_MODE,
]);

export interface MobileHpgModeDefinition {
    readonly modes: readonly MobileHpgMode[];
    readonly defaultMode: typeof HPG_IDLE_MODE;
}

export interface MobileHpgActionFacts {
    readonly fusionEngine: boolean;
    readonly selectedWeaponAttack: boolean;
    readonly movementMode: string | null;
    readonly movementDistance: number;
}

export interface MobileHpgComponentFact {
    readonly componentId: ComponentId;
    readonly equipment: Equipment;
    readonly mode?: string;
    readonly operational: boolean;
}

export type MobileHpgModeChangeReason =
    | 'NO_FUSION_ENGINE'
    | 'WEAPON_ATTACK_SELECTED'
    | 'MUST_SPEND_ZERO_MP'
    | 'INVALID_TRANSITION';

export function mobileHpgComponentModes(
    equipment: Equipment | null | undefined,
): MobileHpgModeDefinition | null {
    return isMobileHpgEquipment(equipment)
        ? Object.freeze({ modes: MOBILE_HPG_MODES, defaultMode: HPG_IDLE_MODE })
        : null;
}

export function mobileHpgMode(value: string | undefined): MobileHpgMode {
    return isMobileHpgMode(value) ? value : HPG_IDLE_MODE;
}

export function isMobileHpgMode(value: unknown): value is MobileHpgMode {
    return typeof value === 'string' && MOBILE_HPG_MODES.includes(value as MobileHpgMode);
}

export function isGroundMobileHpgEquipment(
    equipment: Equipment | null | undefined,
): boolean {
    return isMobileHpgEquipment(equipment) && isEquipmentForPlatform(equipment, 'mek');
}

export function mobileHpgCooldownTurns(value: string | undefined): 0 | 1 | 2 | 3 {
    switch (mobileHpgMode(value)) {
        case HPG_COOLDOWN_3_MODE: return 3;
        case HPG_COOLDOWN_2_MODE: return 2;
        case HPG_COOLDOWN_1_MODE: return 1;
        default: return 0;
    }
}

export function isMobileHpgBlockingWeaponAttacks(value: string | undefined): boolean {
    const mode = mobileHpgMode(value);
    return mode === HPG_CHARGING_MODE || mode === HPG_TRANSMITTING_MODE;
}

export function isGroundMobileHpgBlockingMovement(
    equipment: Equipment | null | undefined,
    value: string | undefined,
): boolean {
    return isGroundMobileHpgEquipment(equipment)
        && mobileHpgMode(value) === HPG_TRANSMITTING_MODE;
}

export function mobileHpgBlocksWeaponAttacks(
    facts: readonly MobileHpgComponentFact[],
): boolean {
    return facts.some(fact => fact.operational && isMobileHpgBlockingWeaponAttacks(fact.mode));
}

export function mobileHpgBlocksMovement(
    facts: readonly MobileHpgComponentFact[],
): boolean {
    return facts.some(fact => fact.operational
        && isGroundMobileHpgBlockingMovement(fact.equipment, fact.mode));
}

export function mobileHpgModeChangeReason(
    equipment: Equipment | null | undefined,
    currentValue: string | undefined,
    requestedValue: string,
    facts: MobileHpgActionFacts,
): MobileHpgModeChangeReason | null {
    if (!isMobileHpgEquipment(equipment) || !isMobileHpgMode(requestedValue)) {
        return 'INVALID_TRANSITION';
    }
    if (!facts.fusionEngine) return 'NO_FUSION_ENGINE';
    const current = mobileHpgMode(currentValue);
    const groundMobile = isGroundMobileHpgEquipment(equipment);
    const allowed = groundMobile
        ? (current === HPG_IDLE_MODE && requestedValue === HPG_CHARGING_MODE)
            || (current === HPG_CHARGED_MODE && requestedValue === HPG_TRANSMITTING_MODE)
        : (current === HPG_IDLE_MODE && requestedValue === HPG_TRANSMITTING_MODE)
            || (current === HPG_TRANSMITTING_MODE && requestedValue === HPG_IDLE_MODE);
    if (!allowed) return 'INVALID_TRANSITION';
    if ((requestedValue === HPG_CHARGING_MODE || requestedValue === HPG_TRANSMITTING_MODE)
        && facts.selectedWeaponAttack) return 'WEAPON_ATTACK_SELECTED';
    if (groundMobile
        && requestedValue === HPG_TRANSMITTING_MODE
        && (facts.movementMode !== 'stationary' || facts.movementDistance !== 0)) {
        return 'MUST_SPEND_ZERO_MP';
    }
    return null;
}

export function settleMobileHpgMode(
    equipment: Equipment | null | undefined,
    value: string | undefined,
    largeSupportVehicle: boolean,
): MobileHpgMode {
    const current = mobileHpgMode(value);
    if (!isGroundMobileHpgEquipment(equipment)) return current;
    switch (current) {
        case HPG_CHARGING_MODE: return HPG_CHARGED_MODE;
        case HPG_TRANSMITTING_MODE:
            return largeSupportVehicle ? HPG_IDLE_MODE : HPG_COOLDOWN_3_MODE;
        case HPG_COOLDOWN_3_MODE: return HPG_COOLDOWN_2_MODE;
        case HPG_COOLDOWN_2_MODE: return HPG_COOLDOWN_1_MODE;
        case HPG_COOLDOWN_1_MODE: return HPG_IDLE_MODE;
        default: return current;
    }
}

export function mobileHpgOperatingHeat(
    equipment: Equipment | null | undefined,
    value: string | undefined,
    operational: boolean,
    fusionEngine: boolean,
): number {
    if (!operational || !fusionEngine || !isMobileHpgEquipment(equipment)) return 0;
    const mode = mobileHpgMode(value);
    const groundMobile = isGroundMobileHpgEquipment(equipment);
    return mode === HPG_TRANSMITTING_MODE || (groundMobile && mode === HPG_CHARGING_MODE)
        ? groundMobile ? 20 : 40
        : 0;
}

/** Direct Mek interaction owner; the reducer remains the authority for every transition. */
export class MobileHpgHandler extends EquipmentInteractionHandler {
    readonly id = 'mobile-hpg-handler';
    readonly kind = 'mobile-hpg';
    readonly scope = 'component' as const;
    override readonly priority = 20;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!equipment || !isMobileHpgEquipment(equipment)) return [];
        const state = mobileHpgMode(input.runtime.query().componentMode(input.componentId));
        const facts = actionFacts(input);
        const choice = hpgChoice(equipment, state);
        const reason = choice.value === state
            ? 'INVALID_TRANSITION'
            : mobileHpgModeChangeReason(equipment, state, String(choice.value), facts);
        return [Object.freeze({
            ...choice,
            disabled: reason !== null,
            displayType: 'toggle' as const,
            action: 'activate' as const,
        })];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!equipment || !isMobileHpgEquipment(equipment) || !isMobileHpgMode(choice.value)) return false;
        const state = mobileHpgMode(input.runtime.query().componentMode(input.componentId));
        const offered = hpgChoice(equipment, state);
        if (choice.value !== offered.value) return false;
        const reason = mobileHpgModeChangeReason(equipment, state, choice.value, actionFacts(input));
        if (reason !== null) {
            context.toastService.showToast(hpgModeChangeMessage(reason), 'error');
            return true;
        }
        const result = input.runtime.dispatch({
            type: 'set-component-mode',
            componentId: input.componentId,
            mode: choice.value,
        });
        if (!result.accepted) return false;
        if (result.changed) {
            context.toastService.showToast(
                `${equipment.shortName || equipment.name}: ${offered.label}`,
                'info',
            );
        }
        return true;
    }
}

function actionFacts(input: EquipmentInteractionInput): MobileHpgActionFacts {
    const state = input.runtime.snapshot();
    const movement = state.movementPsr.movement;
    return Object.freeze({
        fusionEngine: input.entity.mountedEngine().isFusion,
        selectedWeaponAttack: [...state.attackerTargeting.components.values()]
            .some(component => component.selection !== undefined),
        movementMode: movement?.mode ?? 'stationary',
        movementDistance: movement?.distance ?? 0,
    });
}

function hpgChoice(
    equipment: Equipment,
    state: MobileHpgMode,
): EquipmentInteractionChoice {
    if (!isGroundMobileHpgEquipment(equipment)) {
        const transmitting = state === HPG_TRANSMITTING_MODE;
        return Object.freeze({
            label: transmitting ? 'Stop HPG Transmission' : 'Start HPG Transmission',
            value: transmitting ? HPG_IDLE_MODE : HPG_TRANSMITTING_MODE,
            active: transmitting,
        });
    }
    if (state === HPG_IDLE_MODE) {
        return Object.freeze({ label: 'Charge HPG', value: HPG_CHARGING_MODE, active: false });
    }
    if (state === HPG_CHARGED_MODE) {
        return Object.freeze({ label: 'Transmit HPG', value: HPG_TRANSMITTING_MODE, active: false });
    }
    const cooldown = mobileHpgCooldownTurns(state);
    if (cooldown > 0) {
        return Object.freeze({ label: `HPG Cooldown (${cooldown})`, value: state, active: false });
    }
    return Object.freeze({
        label: state === HPG_CHARGING_MODE ? 'HPG Charging…' : 'HPG Transmitting…',
        value: state,
        active: true,
    });
}

function hpgModeChangeMessage(reason: MobileHpgModeChangeReason): string {
    switch (reason) {
        case 'NO_FUSION_ENGINE': return 'A Mobile HPG requires a fusion engine';
        case 'WEAPON_ATTACK_SELECTED':
            return 'An HPG cannot charge or transmit in a turn with weapon attacks';
        case 'MUST_SPEND_ZERO_MP':
            return 'A Ground-Mobile HPG can transmit only after spending 0 MP';
        case 'INVALID_TRANSITION': return 'The Mobile HPG cannot change state now';
    }
}
