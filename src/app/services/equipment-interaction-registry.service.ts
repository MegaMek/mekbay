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
import { PickerChoice, PickerValue } from '../components/picker/picker.interface';
import { MountedEquipment } from '../models/force-unit.model';
import { ToastService } from './toast.service';

/**
 * Context passed to handlers containing additional information
 */
export interface HandlerContext {
    toastService: ToastService;
}

/**
 * A picker choice with handler identification
 */
export interface HandlerChoice extends PickerChoice {
    /** Internal identifier linking this choice to its handler */
    _handlerId?: string;
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
     * The equipment flag this handler responds to ('F_ECM', 'F_MASC', etc.)
     */
    abstract readonly flag: string;
    
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
     * @returns true if the picker should close, false to keep it open
     */
    abstract handleSelection(equipment: MountedEquipment, value: PickerValue, context: HandlerContext): boolean;
    
    /**
     * Cycle through available choices
     * @param equipment The mounted equipment
     * @param context Handler context
     * @param currentValue The current value (optional, will use equipment.state if not provided)
     * @returns The next choice, or null if no choices available
     */
    cycleChoice(
        equipment: MountedEquipment,
        context: HandlerContext,
        currentValue?: PickerValue
    ): PickerChoice | null {
        const choices = this.getChoices(equipment, context);
        if (!choices || choices.length === 0) return null;
        
        // Filter out disabled choices
        const enabledChoices = choices.filter(c => !c.disabled);
        if (enabledChoices.length === 0) return null;
        
        const value = currentValue ?? equipment.state;
        const currentIndex = enabledChoices.findIndex(c => c.value === value);
        
        // If current value not found or is last, return first choice
        if (currentIndex === -1 || currentIndex === enabledChoices.length - 1) {
            return enabledChoices[0];
        }
        
        // Return next choice
        return enabledChoices[currentIndex + 1];
    }
    
    /**
     * Cycle and apply the next choice
     * @param equipment The mounted equipment
     * @param context Handler context
     * @returns true if a cycle occurred, false otherwise
     */
    cycleAndApply(equipment: MountedEquipment, context: HandlerContext): boolean {
        const nextChoice = this.cycleChoice(equipment, context);
        if (nextChoice) {
            this.handleSelection(equipment, nextChoice.value, context);
            return true;
        }
        return false;
    }
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
        if (this.handlers.has(handler.id)) {
            throw new Error(`Handler with id "${handler.id}" is already registered`);
        }
        this.handlers.set(handler.id, handler);
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
        if (!equipment.equipment?.flags) return [];
        
        const applicableHandlers = Array.from(this.handlers.values())
            .filter(handler => equipment.equipment!.flags.has(handler.flag));
        
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
                    _handlerId: handler.id
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
    ): boolean {
        if (!choice._handlerId) {
            console.warn('Choice missing handler ID, cannot process');
            return false;
        }
        
        const handler = this.handlers.get(choice._handlerId);
        if (!handler) {
            console.warn(`Handler "${choice._handlerId}" not found`);
            return false;
        }
        
        return handler.handleSelection(equipment, choice.value, context);
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