// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { MountedWeapon, type MountedEquipment } from '../models/mounted-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import { EQUIPMENT_HEAT_SOURCE_GROUP, type UnitHeatSource } from '../models/rules/unit-type-rules';
import {
    EquipmentInteractionHandler,
    setEffectiveWeaponType,
    type HandlerCommandContext,
    type HandlerQueryContext,
    type CriticalDelayedExplosionContext,
    type CriticalDelayedExplosionHandling,
} from '../services/equipment-interaction-registry.service';
import type { WeaponDamage } from '../models/equipment.model';
import { isPpcCapacitorCompatibleWeapon } from '../models/entity/utils/equipment-link-rules';
import type { InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import type { WeaponType } from '../models/weapon-types.model';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { CriticalSlot } from '../models/force-serialization';
import {
    cancelPendingMekComponentExplosion,
    resolvePendingMekComponentExplosion,
} from '../utils/mek-critical-hit.util';

export const PPC_CAPACITOR_STATE_KEY = 'ppc_capacitor_state';
export const PPC_CAPACITOR_CHARGING_STATE = 'charging';
export const PPC_CAPACITOR_CHARGED_STATE = 'charged';
export const PPC_CAPACITOR_FIRED_STATE_KEY = 'ppc_capacitor_fired';
export const PPC_CAPACITOR_HEAT_BONUS = 5;
export const PPC_CAPACITOR_DAMAGE_BONUS = 5;
export const PPC_CAPACITOR_CHARGED_COLOR = '#00a8ff';
export const PPC_CAPACITOR_CHARGED_TEXT_COLOR = '#001829';

export class PpcCapacitorHandler extends EquipmentInteractionHandler {
    readonly id = 'ppc-capacitor-handler';
    override readonly flags: EquipmentFlag[] = ['F_PPC'];
    override readonly priority = 20;

    getChoices(equipment: MountedEquipment, context: HandlerQueryContext): PickerChoice[] {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor, context.getStatus)) return [];

        const state = ppcCapacitorState(capacitor);
        const active = state !== null;
        return [{
            label: state === PPC_CAPACITOR_CHARGED_STATE
                ? 'Capacitor Charged!'
                : state === PPC_CAPACITOR_CHARGING_STATE ? 'Capacitor Charging..' : 'Charge Capacitor',
            shortLabel: state === PPC_CAPACITOR_CHARGED_STATE
                ? 'Charged!'
                : state === PPC_CAPACITOR_CHARGING_STATE ? 'Charging' : 'Charge',
            value: active ? 'discharged' : PPC_CAPACITOR_CHARGING_STATE,
            active,
            disabled: capacitor.states.has(PPC_CAPACITOR_FIRED_STATE_KEY),
            colors: active ? { selected: PPC_CAPACITOR_CHARGED_COLOR, selectedText: PPC_CAPACITOR_CHARGED_TEXT_COLOR } : undefined,
            displayType: 'toggle'
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerCommandContext): boolean {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor, getCanonicalOwnerStatus)) return true;

        const charging = choice.value === PPC_CAPACITOR_CHARGING_STATE;
        const discharging = choice.value === 'discharged';
        if (charging && capacitor.states.has(PPC_CAPACITOR_FIRED_STATE_KEY)) {
            context.toastService.showToast('A fired PPC cannot charge its capacitor this turn.', 'error');
            return true;
        }
        if (setPpcCapacitorState(capacitor, charging ? PPC_CAPACITOR_CHARGING_STATE : null)) {
            capacitor.owner.setInventoryEntry(capacitor);
            if (charging) capacitor.owner.turnState().markEquipmentStateChanged();
        }
        if (discharging) cancelPendingMekComponentExplosion(equipment);
        context.toastService.showToast(`PPC Capacitor ${charging ? 'charging' : 'discharged'}`, 'info');
        return true;
    }

    override afterInventoryControlFire(equipment: MountedEquipment): void {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isCompatiblePpcCapacitorLink(equipment, capacitor)) return;
        const discharged = setPpcCapacitorState(capacitor, null);
        const markedFired = capacitor.setState(PPC_CAPACITOR_FIRED_STATE_KEY, '1');
        const changed = discharged || markedFired;
        if (changed) {
            capacitor.owner.setInventoryEntry(capacitor);
        }
    }

    override onEndTurn(equipment: MountedEquipment): void {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isCompatiblePpcCapacitorLink(equipment, capacitor)) return;
        let changed = capacitor.deleteState(PPC_CAPACITOR_FIRED_STATE_KEY);
        const state = ppcCapacitorState(capacitor);
        if ((hasPendingDestruction(equipment)
            || hasPendingDestruction(capacitor)
            || !isPpcCapacitorUsable(equipment, capacitor, getCanonicalOwnerStatus)) && state !== null) {
            changed = setPpcCapacitorState(capacitor, null) || changed;
        } else if (state === PPC_CAPACITOR_CHARGING_STATE) {
            changed = setPpcCapacitorState(capacitor, PPC_CAPACITOR_CHARGED_STATE) || changed;
        }
        if (changed) capacitor.owner.setInventoryEntry(capacitor);
    }

    override isInventoryControlSelectable(equipment: MountedEquipment, context: HandlerQueryContext): boolean | null {
        const capacitor = linkedPpcCapacitor(equipment);
        return capacitor
            && isPpcCapacitorUsable(equipment, capacitor, context.getStatus)
            && ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGING_STATE
            ? false
            : null;
    }

    override applyInventoryControlHeatEffects(equipment: MountedEquipment, effect: InventoryControlHeatEffect, context: HandlerQueryContext): InventoryControlHeatEffect {
        return chargedLinkedPpcCapacitor(equipment, context.getStatus)
            ? { ...effect, value: effect.value + PPC_CAPACITOR_HEAT_BONUS }
            : effect;
    }

    override applyInventoryControlDamageEffects(
        equipment: MountedEquipment,
        damage: WeaponDamage,
        _damageContext: InventoryControlDamageContext,
        context: HandlerQueryContext
    ): WeaponDamage {
        return chargedLinkedPpcCapacitor(equipment, context.getStatus)
            ? {
                ...damage,
                values: damage.values.map(value => value + PPC_CAPACITOR_DAMAGE_BONUS),
                maximum: damage.maximum + PPC_CAPACITOR_DAMAGE_BONUS,
            }
            : damage;
    }

    override applyInventoryControlWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerQueryContext
    ): ReadonlySet<WeaponType> {
        return setEffectiveWeaponType(
            types,
            'X',
            chargedLinkedPpcCapacitor(equipment, context.getStatus) !== null,
        );
    }

    override getCriticalDelayedExplosion(
        hitEntry: MountedEquipment,
        explosionContext: CriticalDelayedExplosionContext,
        context: HandlerQueryContext,
    ): CriticalDelayedExplosionHandling | null {
        const weapon = ppcWeaponForCriticalHit(hitEntry);
        if (!weapon) return null;

        const capacitor = linkedPpcCapacitor(weapon);
        if (!capacitor || (hitEntry !== weapon && hitEntry !== capacitor)) return null;
        if (!isPpcCapacitorUsable(weapon, capacitor, context.getStatus)
            || !isPpcCapacitorCharged(capacitor)) return { explosion: null };
        if (explosionContext.componentCriticalHits(weapon) > 0
            || explosionContext.componentCriticalHits(capacitor) > 0) return { explosion: null };

        const rawDamage = weapon.owner.gameRules.id === 'core2026'
            ? (explosionContext.mountedCriticalSlots(weapon)
                + explosionContext.mountedCriticalSlots(capacitor)) * 2
            : explosionContext.effectiveMaximumWeaponDamage(weapon);
        return {
            explosion: {
                source: weapon,
                equipment: `${weapon.getDisplayName()} + ${capacitor.getDisplayName()}`,
                rawDamage: Math.max(0, rawDamage),
                destroyEntries: [weapon, capacitor],
            },
        };
    }

    override beforeEquipmentStateCommit(equipment: MountedEquipment): void {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isCompatiblePpcCapacitorLink(equipment, capacitor)) return;
        const explosion = resolvePendingMekComponentExplosion(
            equipment,
            capacitor.states.has(PPC_CAPACITOR_FIRED_STATE_KEY),
        );
        if (explosion && setPpcCapacitorState(capacitor, null)) {
            capacitor.owner.setInventoryEntry(capacitor);
        }
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        _turnState: TurnState,
        context: HandlerQueryContext
    ): UnitHeatSource[] {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor
            || !isPpcCapacitorUsable(equipment, capacitor, context.getStatus)
            || ppcCapacitorState(capacitor) === null) return [];
        return [{
            id: `ppc-capacitor:${equipment.id}`,
            label: 'PPC Capacitor',
            value: PPC_CAPACITOR_HEAT_BONUS,
            group: EQUIPMENT_HEAT_SOURCE_GROUP,
            replacedByFiringEntryId: ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGED_STATE
                ? equipment.id
                : undefined
        }];
    }
}

function isPpcCapacitor(entry: MountedEquipment): boolean {
    return entry.equipment?.hasFlag('F_WEAPON_ENHANCEMENT') === true
        && entry.equipment.hasFlag('F_PPC_CAPACITOR');
}

function linkedPpcCapacitor(weapon: MountedEquipment): MountedEquipment | null {
    return weapon.linkedWith?.find(isPpcCapacitor) ?? null;
}

function ppcWeaponForCriticalHit(hitEntry: MountedEquipment): MountedWeapon | null {
    if (hitEntry instanceof MountedWeapon) {
        return hitEntry.equipment?.hasFlag('F_PPC') === true ? hitEntry : null;
    }
    if (!isPpcCapacitor(hitEntry)) return null;

    if (hitEntry.parent instanceof MountedWeapon
        && hitEntry.parent.linkedWith?.includes(hitEntry)
        && isCompatiblePpcCapacitorLink(hitEntry.parent, hitEntry)) return hitEntry.parent;

    return hitEntry.owner.getInventory().find((candidate): candidate is MountedWeapon =>
        candidate instanceof MountedWeapon
        && candidate.linkedWith?.includes(hitEntry) === true
        && isCompatiblePpcCapacitorLink(candidate, hitEntry)) ?? null;
}

type EquipmentStatusQuery = HandlerQueryContext['getStatus'];

function isPpcCapacitorUsable(
    weapon: MountedEquipment,
    capacitor: MountedEquipment,
    getStatus: EquipmentStatusQuery
): boolean {
    return isCompatiblePpcCapacitorLink(weapon, capacitor)
        && getStatus(weapon) === 'available'
        && getStatus(capacitor) === 'available';
}

function getCanonicalOwnerStatus(equipment: MountedEquipment) {
    return equipment.owner.getEquipmentStatus(equipment);
}

function isCompatiblePpcCapacitorLink(weapon: MountedEquipment, capacitor: MountedEquipment): boolean {
    return isPpcCapacitor(capacitor)
        && weapon.equipment != null
        && isPpcCapacitorCompatibleWeapon(weapon.equipment);
}

function isPpcCapacitorCharged(capacitor: MountedEquipment): boolean {
    return ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGED_STATE;
}

function ppcCapacitorState(capacitor: MountedEquipment): typeof PPC_CAPACITOR_CHARGING_STATE | typeof PPC_CAPACITOR_CHARGED_STATE | null {
    const state = capacitor.states.get(PPC_CAPACITOR_STATE_KEY);
    return state === PPC_CAPACITOR_CHARGING_STATE || state === PPC_CAPACITOR_CHARGED_STATE ? state : null;
}

function chargedLinkedPpcCapacitor(
    weapon: MountedEquipment,
    getStatus: EquipmentStatusQuery
): MountedEquipment | null {
    const capacitor = linkedPpcCapacitor(weapon);
    if (!capacitor || !isPpcCapacitorUsable(weapon, capacitor, getStatus)) return null;
    return isPpcCapacitorCharged(capacitor) ? capacitor : null;
}

function currentCriticalSlots(equipment: MountedEquipment): CriticalSlot[] {
    return equipment.critSlots?.flatMap(slot => equipment.owner.findCurrentCriticalSlot(slot) ?? []) ?? [];
}

function hasPendingDestruction(equipment: MountedEquipment): boolean {
    const criticalSlots = currentCriticalSlots(equipment);
    return criticalSlots.length > 0
        ? criticalSlots.some(slot => !!slot.destroying && !slot.destroyed)
        : equipment.isDestroying();
}

function setPpcCapacitorState(
    capacitor: MountedEquipment,
    state: typeof PPC_CAPACITOR_CHARGING_STATE | typeof PPC_CAPACITOR_CHARGED_STATE | null
): boolean {
    if (state !== null) return capacitor.setState(PPC_CAPACITOR_STATE_KEY, state);
    return capacitor.deleteState(PPC_CAPACITOR_STATE_KEY);
}
