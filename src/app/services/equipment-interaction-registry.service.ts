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
import type { MountedEquipment } from '../models/force-serialization';
import type { ToastService } from './toast.service';
import type { DialogsService } from './dialogs.service';
import type { DataService } from './data.service';
import type { AmmoEquipment } from '../models/equipment.model';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions, InventoryControlRules } from '../utils/inventory-control.util';
import type { TurnState } from '../models/turn-state.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';

/**
 * Context passed to handlers containing additional information
 */
export interface HandlerContext {
    toastService: ToastService;
    dialogsService: DialogsService;
    dataService: DataService;
}

/**
 * A picker choice with handler identification
 */
export interface HandlerChoice extends PickerChoice {
    /** Internal identifier linking this choice to its handler */
    _handler?: EquipmentInteractionHandler;
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
     * Hook called while building an inventory-control row display.
     */
    applyInventoryControlDisplayEffects?(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerContext
    ): InventoryControlDisplayData;

    /**
     * Hook called while filtering ammo options for a selected inventory-control mode.
     */
    matchesInventoryAmmo?(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, context: HandlerContext): boolean | null;

    /**
     * Hook called for linked equipment while resolving a parent weapon's to-hit modifier.
     */
    getLinkedEquipmentHitModifier?(equipment: MountedEquipment, parent: MountedEquipment, selectedAmmo?: AmmoEquipment | null): number | null;

    /**
     * Hook called while collecting turn heat sources from inventory entries.
     */
    getInventoryHeatSources?(equipment: MountedEquipment, turnState: TurnState): UnitHeatSource[];
}

/**
 * Registry for equipment interaction handlers
 */
class EquipmentInteractionRegistry {
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
        return nextDisplay;
    }

    matchesInventoryAmmo(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, context: HandlerContext): boolean | null {
        for (const handler of this.getHandlers(equipment)) {
            const result = handler.matchesInventoryAmmo?.(equipment, ammo, mode, context);
            if (result !== undefined && result !== null) return result;
        }
        return null;
    }

    getLinkedEquipmentHitModifier(equipment: MountedEquipment, selectedAmmo?: AmmoEquipment | null): number {
        return equipment.linkedWith?.reduce((total, linked) => {
            const modifier = this.getHandlers(linked)
                .reduce((sum, handler) => sum + (handler.getLinkedEquipmentHitModifier?.(linked, equipment, selectedAmmo) ?? 0), 0);
            return total + modifier;
        }, 0) ?? 0;
    }

    inventoryControlRules(context: HandlerContext): InventoryControlRules {
        return {
            applyDisplayEffects: (equipment, display, options) => this.applyInventoryControlDisplayEffects(equipment, display, options, context),
            matchesAmmo: (equipment, ammo, mode) => this.matchesInventoryAmmo(equipment, ammo, mode, context),
            resolveLinkedHitModifier: (equipment, selectedAmmo) => this.getLinkedEquipmentHitModifier(equipment, selectedAmmo)
        };
    }

    getInventoryHeatSources(inventory: readonly MountedEquipment[], turnState: TurnState): UnitHeatSource[] {
        return inventory.flatMap(equipment => this.getHandlers(equipment)
            .flatMap(handler => handler.getInventoryHeatSources?.(equipment, turnState) ?? []));
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