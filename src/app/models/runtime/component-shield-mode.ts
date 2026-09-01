// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { Equipment } from '../equipment.model';
import { isShieldEquipment } from '../entity/utils/physical-weapon';
import { SHIELD_FLAG } from '../entity/utils/physical-weapon-kernel';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { isMekLocation, type MekLocation } from '../entity/types';
import { componentLocationIds, equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import type { MekUnitQueryPort } from './unit-instance';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
} from './equipment-interaction';
import { createCommandId } from './runtime-state';

export const SHIELD_INACTIVE_MODE = 'None';
export const SHIELD_ACTIVE_MODE = 'Active';
export const SHIELD_PASSIVE_MODE = 'Passive';

export type ShieldMode =
    | typeof SHIELD_INACTIVE_MODE
    | typeof SHIELD_ACTIVE_MODE
    | typeof SHIELD_PASSIVE_MODE;

export interface ShieldModeOption {
    readonly label: string;
    readonly value: ShieldMode;
}

const CORE_SHIELD_OPTIONS = Object.freeze<ShieldModeOption[]>([
    Object.freeze({ label: 'Lowered', value: SHIELD_INACTIVE_MODE }),
    Object.freeze({ label: 'Raised', value: SHIELD_ACTIVE_MODE }),
]);
const TW_SHIELD_OPTIONS = Object.freeze<ShieldModeOption[]>([
    Object.freeze({ label: 'Inactive', value: SHIELD_INACTIVE_MODE }),
    Object.freeze({ label: 'Active', value: SHIELD_ACTIVE_MODE }),
    Object.freeze({ label: 'Passive', value: SHIELD_PASSIVE_MODE }),
]);

export function shieldModeOptions(ruleset: CBTRuleset): readonly ShieldModeOption[] {
    return ruleset === 'core-2026' ? CORE_SHIELD_OPTIONS : TW_SHIELD_OPTIONS;
}

export function shieldComponentModes(
    equipment: Equipment | undefined,
    ruleset: CBTRuleset,
): Readonly<{ readonly modes: readonly ShieldMode[]; readonly defaultMode: typeof SHIELD_INACTIVE_MODE }> | null {
    if (!isShieldEquipment(equipment)) return null;
    return Object.freeze({
        modes: Object.freeze(shieldModeOptions(ruleset).map(option => option.value)),
        defaultMode: SHIELD_INACTIVE_MODE,
    });
}

export function isShieldMode(value: unknown, ruleset: CBTRuleset): value is ShieldMode {
    return shieldModeOptions(ruleset).some(option => option.value === value);
}

/** Whether the selected shield arc prevents attacks from one mount location. */
export function shieldProtectsLocation(
    mode: ShieldMode,
    ruleset: CBTRuleset,
    arm: 'LA' | 'RA',
    location: MekLocation,
    rearMounted = false,
): boolean {
    switch (mode) {
        case SHIELD_ACTIVE_MODE:
            if (ruleset === 'core-2026') {
                if (rearMounted || location === 'HD') return false;
                if (location === 'CT') return true;
                return arm === 'LA'
                    ? location === 'LA' || location === 'LT' || location === 'LL'
                    : location === 'RA' || location === 'RT' || location === 'RL';
            }
            if (location === 'CT') return !rearMounted;
            if (location === 'HD') return true;
            return arm === 'LA'
                ? location === 'LA' || location === 'LT' || location === 'LL'
                : location === 'RA' || location === 'RT' || location === 'RL';
        case SHIELD_PASSIVE_MODE:
            return !rearMounted && (arm === 'LA'
                ? location === 'LA' || location === 'LT'
                : location === 'RA' || location === 'RT');
        case SHIELD_INACTIVE_MODE:
            return location === arm;
    }
}

export interface ShieldAttackRuntimePort extends Pick<
    MekUnitQueryPort,
    'componentMode' | 'componentStatus' | 'mekShields'
> { }

export function shieldBlocksComponentAttack(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: ShieldAttackRuntimePort,
    componentId: ComponentId,
): boolean {
    const component = index.components.get(componentId);
    if (component?.kind !== 'equipment') return false;
    return shieldBlocksLocations(
        entity,
        index,
        ruleset,
        runtime,
        componentLocationIds(index, componentId).map(id => index.locations.get(id)?.code).filter(isDefined),
        component.mount.rearMounted,
    );
}

export function shieldBlocksIntrinsicAttack(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: ShieldAttackRuntimePort,
    locations: readonly string[],
): boolean {
    return shieldBlocksLocations(
        entity,
        index,
        ruleset,
        runtime,
        locations.filter(isMekLocation),
        false,
    );
}

/** Total Warfare's passive/inactive shield penalty for a ranged mounted weapon. */
export function shieldWeaponToHitAdjustment(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: ShieldAttackRuntimePort,
    componentId: ComponentId,
): Readonly<{ readonly kind: 'add'; readonly label: string; readonly modifier: number }> | null {
    if (ruleset !== 'total-warfare') return null;
    const component = index.components.get(componentId);
    if (component?.kind !== 'equipment') return null;
    const locations = componentLocationIds(index, componentId)
        .map(id => index.locations.get(id)?.code)
        .filter(isDefined);
    const rearMounted = component.mount.rearMounted;
    let inactiveArm: 'LA' | 'RA' | null = null;
    for (const shield of operationalShields(entity, index, runtime)) {
        const mode = selectedShieldMode(runtime, shield.componentId, ruleset);
        if (!locations.some(location => shieldProtectsLocation(
            mode,
            ruleset,
            shield.locationCode,
            location,
            rearMounted,
        ))) continue;
        if (mode === SHIELD_PASSIVE_MODE) {
            return Object.freeze({
                kind: 'add' as const,
                label: `Passive Shield (${shield.locationCode})`,
                modifier: 2,
            });
        }
        if (mode === SHIELD_INACTIVE_MODE) inactiveArm ??= shield.locationCode;
    }
    return inactiveArm === null ? null : Object.freeze({
        kind: 'add' as const,
        label: `Shield (${inactiveArm})`,
        modifier: 1,
    });
}

export class ShieldModeHandler extends EquipmentInteractionHandler {
    readonly id = 'shield-mode-handler';
    readonly kind = 'shield-mode';
    readonly scope = 'component' as const;
    override readonly flags: readonly EquipmentFlag[] = [SHIELD_FLAG];
    override readonly priority = 100;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isShieldEquipment(equipment)) return [];
        const options = shieldModeOptions(input.ruleset);
        const selected = selectedShieldMode(input.runtime.query(), input.componentId, input.ruleset);
        return [Object.freeze({
            label: 'Mode',
            value: selected,
            displayType: 'dropdown' as const,
            choices: options.map(option => ({ ...option })),
            keepOpen: true,
            action: 'change-mode' as const,
            disabled: input.runtime.query().componentStatus(input.componentId) !== 'available',
        })];
    }

    override select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        _context: EquipmentInteractionCommandContext,
    ): boolean {
        const equipment = equipmentForComponent(input.index, input.componentId);
        if (!isShieldEquipment(equipment) || !isShieldMode(choice.value, input.ruleset)) return false;
        if (input.runtime.query().componentMode(input.componentId) === choice.value) return true;
        return input.runtime.dispatch({
            type: 'set-component-mode',
            componentId: input.componentId,
            mode: choice.value,
        }).accepted;
    }
}

function shieldBlocksLocations(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: ShieldAttackRuntimePort,
    locations: readonly MekLocation[],
    rearMounted: boolean,
): boolean {
    if (locations.length === 0) return false;
    return operationalShields(entity, index, runtime).some(shield =>
        selectedShieldMode(runtime, shield.componentId, ruleset) === SHIELD_ACTIVE_MODE
        && locations.some(location => shieldProtectsLocation(
            SHIELD_ACTIVE_MODE,
            ruleset,
            shield.locationCode,
            location,
            rearMounted,
        )));
}

function operationalShields(
    _entity: MekEntity,
    index: MekRuntimeIndex,
    runtime: ShieldAttackRuntimePort,
): readonly Readonly<{ readonly componentId: ComponentId; readonly locationCode: 'LA' | 'RA' }>[] {
    const projection = runtime.mekShields('committed');
    if (projection.kind !== 'supported') return [];
    return projection.shields.filter(shield => shield.operational
        && runtime.componentStatus(shield.componentId, 'committed') === 'available'
        && index.components.has(shield.componentId));
}

function selectedShieldMode(
    runtime: Pick<MekUnitQueryPort, 'componentMode'>,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): ShieldMode {
    const mode = runtime.componentMode(componentId);
    return isShieldMode(mode, ruleset) ? mode : SHIELD_INACTIVE_MODE;
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}
