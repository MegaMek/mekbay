/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Injectable } from '@angular/core';
import type { PickerChoice, PickerValue } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToastService } from './toast.service';
import type { DialogsService } from './dialogs.service';
import type { DataService } from './data.service';
import type { AmmoEquipment, WeaponType } from '../models/equipment.model';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions, InventoryControlRules } from '../utils/inventory-control.util';
import type { InventoryControlDamage, InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { TurnState } from '../models/turn-state.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';

/**
 * Context passed to handlers containing additional information
 */
export interface HandlerContext {
    toastService: ToastService;
    dialogsService: DialogsService;
    dataService: DataService;
    choiceSurface?: 'critical' | 'inventory' | 'turn-summary';
}

/**
 * A picker choice with handler identification
 */
export interface HandlerChoice extends PickerChoice {
    /** Internal identifier linking this choice to its handler */
    _handler?: EquipmentInteractionHandler;
}

export interface ToHitAdjustmentContext {
    parent?: MountedEquipment;
    selectedAmmo?: AmmoEquipment | null;
}

/**
 * Abstract base class for equipment interaction handlers
 */
export abstract class EquipmentInteractionHandler {
    /**
     * Unique identifier for this handler
     */
    abstract readonly id: string;
    
    /**
     * The equipment flags this handler responds to ('F_ECM', 'F_MASC', etc.). If multiple flags, it has to match all.
     */
    readonly flags: string[] = [];

    /**
     * Optional method to determine if this handler applies to the given equipment
     */
    applicableTo?(equipment: MountedEquipment): boolean;
    
    /**
     * Priority for this handler (higher = checked first)
     */
    readonly priority: number = 0;
    
    /**
     * Generates picker choices for this equipment type
     * @param equipment The mounted equipment
     * @param context Additional context information
     * @returns Array of picker choices, or null if this handler doesn't apply
     */
    abstract getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] | null;
    
    /**
     * Handles the selection of a choice
     * @param equipment The mounted equipment
     * @param value The selected picker value
     * @param context Additional context information
     * @returns true if the picker should close, false to keep it open (can be async)
     */
    abstract handleSelection(equipment: MountedEquipment, value: PickerChoice, context: HandlerContext): boolean | Promise<boolean>;

    /**
     * Hook called after a mounted equipment entry is fired/consumed from the weapons panel.
     */
    afterInventoryControlFire?(equipment: MountedEquipment, context: HandlerContext): void | Promise<void>;

    /**
     * Hook called when the owning unit ends its turn.
     */
    onEndTurn?(equipment: MountedEquipment, context: HandlerContext): void;

    /**
     * Hook called while building an inventory-control row display.
     */
    applyInventoryControlDisplayEffects?(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerContext
    ): InventoryControlDisplayData;

    /**
     * Applies equipment-state modifiers to a weapon's unformatted damage value.
     */
    applyInventoryControlDamageEffects?(
        equipment: MountedEquipment,
        damage: InventoryControlDamage,
        damageContext: InventoryControlDamageContext,
        context: HandlerContext
    ): InventoryControlDamage;

    /** Applies equipment-state modifiers to typed weapon firing heat. */
    applyInventoryControlHeatEffects?(equipment: MountedEquipment, effect: InventoryControlHeatEffect, context: HandlerContext): InventoryControlHeatEffect;

    /**
     * Hook called for linked equipment while building a parent entry's inventory-control row display.
     */
    applyLinkedInventoryControlDisplayEffects?(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerContext
    ): InventoryControlDisplayData;

    /** Applies a linked enhancement's modifiers to typed weapon firing heat. */
    applyLinkedInventoryControlHeatEffects?(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        effect: InventoryControlHeatEffect,
        context: HandlerContext
    ): InventoryControlHeatEffect;

    /** Adds or removes effective weapon types based on the weapon's own state. */
    applyInventoryControlWeaponTypes?(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerContext
    ): ReadonlySet<WeaponType>;

    /**
     * Adds or removes effective weapon types contributed by linked equipment state.
     */
    applyLinkedWeaponTypes?(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerContext
    ): ReadonlySet<WeaponType>;

    /**
     * Hook called while filtering ammo options for a selected inventory-control mode.
     */
    matchesInventoryAmmo?(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, context: HandlerContext): boolean | null;

    /** Returns typed adjustments to an entry's effective to-hit profile. */
    getToHitAdjustments?(
        equipment: MountedEquipment,
        adjustmentContext: ToHitAdjustmentContext,
        context: HandlerContext
    ): readonly ToHitAdjustment[];

    /**
     * Hook called while collecting turn heat sources from inventory entries.
     */
    getInventoryHeatSources?(equipment: MountedEquipment, turnState: TurnState): UnitHeatSource[];

    /**
     * Hook called while calculating active run movement multiplier bonuses.
     */
    getRunMovementMultiplierBonus?(equipment: MountedEquipment, turnState: TurnState): number;

    /**
     * Hook called when equipment-specific modes can veto aimed shots.
     */
    canPerformAimedShot?(equipment: MountedEquipment, context: HandlerContext): boolean | null;

    /** Equipment-specific veto for selecting an inventory entry to fire. */
    isInventoryControlSelectable?(equipment: MountedEquipment, context: HandlerContext): boolean | null;
}

/**
 * Registry for equipment interaction handlers
 */
export class EquipmentInteractionRegistry {
    private handlers: Map<string, EquipmentInteractionHandler> = new Map();
    
    /**
     * Register a new handler
     */
    register(handler: EquipmentInteractionHandler): void {
        const existingHandler = this.handlers.get(handler.id);
        if (existingHandler) {
            const error = new Error(`Handler with id "${handler.id}" is already registered`);
            this.logDuplicateRegistration(handler, existingHandler, error);
            throw error;
        }
        this.handlers.set(handler.id, handler);
    }

    private logDuplicateRegistration(
        handler: EquipmentInteractionHandler,
        existingHandler: EquipmentInteractionHandler,
        error: Error
    ): void {
        console.error([
            `Duplicate equipment handler registration attempted for "${handler.id}".`,
            `Existing handler: ${existingHandler.constructor.name}.`,
            `Attempted handler: ${handler.constructor.name}.`,
            error.stack ?? error.message
        ].join('\n'));
    }
    
    /**
     * Unregister a handler
     */
    unregister(handlerId: string): void {
        this.handlers.delete(handlerId);
    }
    
    /**
     * Get a specific handler by ID
     */
    getHandler(handlerId: string): EquipmentInteractionHandler | undefined {
        return this.handlers.get(handlerId);
    }
    
    /**
     * Get all applicable handlers for an equipment, sorted by priority
     */
    getHandlers(equipment: MountedEquipment): EquipmentInteractionHandler[] {
        const applicableHandlers = Array.from(this.handlers.values())
            .filter(handler => {
                const flagsMatch = handler.flags.length === 0
                    || (!!equipment.equipment?.flags && handler.flags.every(flag => equipment.equipment!.flags.has(flag)));
                return flagsMatch && (!handler.applicableTo || handler.applicableTo(equipment));
            });
            
        // Sort by priority (descending)
        applicableHandlers.sort((a, b) => b.priority - a.priority);
        
        return applicableHandlers;
    }
    
    /**
     * Generate all choices for an equipment, tagged with handler IDs
     */
    getChoices(equipment: MountedEquipment, context: HandlerContext): HandlerChoice[] {
        const handlers = this.getHandlers(equipment);
        const allChoices: HandlerChoice[] = [];
        
        for (const handler of handlers) {
            const choices = handler.getChoices(equipment, context);
            if (choices) {
                // Tag each choice with the handler ID
                const taggedChoices = choices.map(choice => ({
                    ...choice,
                    _handler: handler
                }));
                allChoices.push(...taggedChoices);
            }
        }
        
        return allChoices;
    }
    
    /**
     * Handle a selection for an equipment using the appropriate handler
     */
    handleSelection(
        equipment: MountedEquipment, 
        choice: HandlerChoice,
        context: HandlerContext
    ): boolean | Promise<boolean> {
        if (!choice._handler) {
            return false;
        }

        return choice._handler.handleSelection(equipment, choice, context);
    }

    async afterInventoryControlFire(equipment: MountedEquipment, context: HandlerContext): Promise<void> {
        for (const handler of this.getHandlers(equipment)) {
            await handler.afterInventoryControlFire?.(equipment, context);
        }
    }

    onEndTurn(equipment: MountedEquipment, context: HandlerContext): void {
        for (const handler of this.getHandlers(equipment)) {
            handler.onEndTurn?.(equipment, context);
        }
    }

    applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerContext
    ): InventoryControlDisplayData {
        let nextDisplay = display;
        for (const handler of this.getHandlers(equipment)) {
            nextDisplay = handler.applyInventoryControlDisplayEffects?.(equipment, nextDisplay, options, context) ?? nextDisplay;
        }
        for (const linked of equipment.linkedWith ?? []) {
            for (const handler of this.getHandlers(linked)) {
                nextDisplay = handler.applyLinkedInventoryControlDisplayEffects?.(linked, equipment, nextDisplay, options, context) ?? nextDisplay;
            }
        }
        return nextDisplay;
    }

    applyWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerContext
    ): ReadonlySet<WeaponType> {
        let nextTypes = types;
        for (const handler of this.getHandlers(equipment)) {
            nextTypes = handler.applyInventoryControlWeaponTypes?.(equipment, nextTypes, context) ?? nextTypes;
        }
        for (const linked of equipment.linkedWith ?? []) {
            for (const handler of this.getHandlers(linked)) {
                nextTypes = handler.applyLinkedWeaponTypes?.(linked, equipment, nextTypes, context) ?? nextTypes;
            }
        }
        return nextTypes;
    }

    applyInventoryControlDamageEffects(
        equipment: MountedEquipment,
        damage: InventoryControlDamage,
        damageContext: InventoryControlDamageContext,
        context: HandlerContext
    ): InventoryControlDamage {
        let nextDamage = damage;
        for (const handler of this.getHandlers(equipment)) {
            nextDamage = handler.applyInventoryControlDamageEffects?.(equipment, nextDamage, damageContext, context) ?? nextDamage;
        }
        return nextDamage;
    }

    applyInventoryControlHeatEffects(equipment: MountedEquipment, effect: InventoryControlHeatEffect, context: HandlerContext): InventoryControlHeatEffect {
        let nextEffect = effect;
        for (const handler of this.getHandlers(equipment)) {
            nextEffect = handler.applyInventoryControlHeatEffects?.(equipment, nextEffect, context) ?? nextEffect;
        }
        for (const linked of equipment.linkedWith ?? []) {
            for (const handler of this.getHandlers(linked)) {
                nextEffect = handler.applyLinkedInventoryControlHeatEffects?.(linked, equipment, nextEffect, context) ?? nextEffect;
            }
        }
        return nextEffect;
    }

    matchesInventoryAmmo(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, context: HandlerContext): boolean | null {
        for (const handler of this.getHandlers(equipment)) {
            const result = handler.matchesInventoryAmmo?.(equipment, ammo, mode, context);
            if (result !== undefined && result !== null) return result;
        }
        return null;
    }

    getToHitAdjustments(
        equipment: MountedEquipment,
        context: HandlerContext,
        selectedAmmo?: AmmoEquipment | null
    ): ToHitAdjustment[] {
        const adjustments = this.getHandlers(equipment)
            .flatMap(handler => handler.getToHitAdjustments?.(equipment, { selectedAmmo }, context) ?? []);
        for (const linked of equipment.linkedWith ?? []) {
            for (const handler of this.getHandlers(linked)) {
                adjustments.push(...(handler.getToHitAdjustments?.(linked, { parent: equipment, selectedAmmo }, context) ?? []));
            }
        }
        return adjustments;
    }

    canPerformAimedShot(equipment: MountedEquipment, context: HandlerContext): boolean {
        return this.getHandlers(equipment)
            .every(handler => handler.canPerformAimedShot?.(equipment, context) !== false);
    }

    isInventoryControlSelectable(equipment: MountedEquipment, context: HandlerContext): boolean {
        return this.getHandlers(equipment)
            .every(handler => handler.isInventoryControlSelectable?.(equipment, context) !== false);
    }

    inventoryControlRules(context: HandlerContext): InventoryControlRules {
        return {
            applyDisplayEffects: (equipment, display, options) => this.applyInventoryControlDisplayEffects(equipment, display, options, context),
            applyDamageEffects: (equipment, damage, options) => this.applyInventoryControlDamageEffects(equipment, damage, options, context),
            applyHeatEffects: (equipment, heat) => this.applyInventoryControlHeatEffects(equipment, heat, context),
            applyWeaponTypes: (equipment, types) => this.applyWeaponTypes(equipment, types, context),
            matchesAmmo: (equipment, ammo, mode) => this.matchesInventoryAmmo(equipment, ammo, mode, context),
            resolveToHitAdjustments: (equipment, selectedAmmo) => this.getToHitAdjustments(equipment, context, selectedAmmo),
            isSelectable: equipment => this.isInventoryControlSelectable(equipment, context)
        };
    }

    getInventoryHeatSources(inventory: readonly MountedEquipment[], turnState: TurnState): UnitHeatSource[] {
        return inventory.flatMap(equipment => this.getHandlers(equipment)
            .flatMap(handler => handler.getInventoryHeatSources?.(equipment, turnState) ?? []));
    }

    getRunMovementMultiplierBonus(inventory: readonly MountedEquipment[], turnState: TurnState): number {
        return inventory.reduce((total, equipment) => total + this.getHandlers(equipment)
            .reduce((equipmentTotal, handler) => equipmentTotal + (handler.getRunMovementMultiplierBonus?.(equipment, turnState) ?? 0), 0), 0);
    }
}

/**
 * Singleton service that provides a centralized equipment interaction registry.
 * This allows handlers to be registered from anywhere in the application.
 */
@Injectable({
    providedIn: 'root'
})
export class EquipmentInteractionRegistryService {
    private readonly registry: EquipmentInteractionRegistry;

    constructor() {
        this.registry = new EquipmentInteractionRegistry();
    }

    /**
     * Get the shared registry instance
     */
    getRegistry(): EquipmentInteractionRegistry {
        return this.registry;
    }
}