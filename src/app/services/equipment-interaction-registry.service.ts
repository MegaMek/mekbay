// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';
import type { PickerChoice, PickerValue } from '../components/picker/picker.interface';
import type { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { Toast, ToastService } from './toast.service';
import type { DialogsService } from './dialogs.service';
import type { AmmoEquipment } from '../models/equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import type { InventoryControlAmmoMatcher, InventoryControlDisplayData, InventoryControlDisplayEffectOptions, InventoryControlRules, InventoryControlToHitContext } from '../utils/inventory-control.util';
import type { WeaponDamage } from '../models/equipment.model';
import type { InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { TurnState } from '../models/turn-state.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import type { InventoryControlPhysicalDamageEffect } from '../utils/inventory-control-physical-damage.util';
import type { AerospaceAttackValues } from '../utils/aerospace-range.util';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { Force } from '../models/force.model';
import type { EquipmentAction, EquipmentStateEdit } from '../models/cbt-force-unit.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { EquipmentStatus } from '../models/equipment-status.model';
import type { HeatDissipationState } from '../models/rules/heat-management';

export interface HandlerQueryContext {
    readonly equipmentCatalog: EquipmentRegistry;
    readonly getStatus: (equipment: MountedEquipment) => EquipmentStatus;
    readonly matchesAmmo: InventoryControlAmmoMatcher;
    readonly canProvidePassiveEffect: (equipment: MountedEquipment) => boolean;
    readonly isReadOnly: (equipment: MountedEquipment) => boolean;
    readonly choiceSurface?: 'critical' | 'inventory' | 'turn-summary';
}

export interface CriticalDelayedExplosionContext {
    readonly mountedCriticalSlots: (entry: MountedEquipment) => number;
    readonly componentCriticalHits: (entry: MountedEquipment) => number;
    readonly effectiveMaximumWeaponDamage: (entry: MountedWeapon) => number;
}

/** A component explosion which its handler can cancel before phase-end damage commits. */
export interface CriticalDelayedExplosion {
    readonly source: MountedEquipment;
    readonly equipment: string;
    readonly rawDamage: number;
    readonly destroyEntries?: readonly MountedEquipment[];
}

/** Presence means the handler owns explosion eligibility for this critical hit. */
export interface CriticalDelayedExplosionHandling {
    readonly explosion: CriticalDelayedExplosion | null;
}

/** Returns the original set when no change is needed. */
export function setEffectiveWeaponType(
    types: ReadonlySet<WeaponType>,
    type: WeaponType,
    enabled: boolean,
): ReadonlySet<WeaponType> {
    if (types.has(type) === enabled) return types;
    const nextTypes = new Set(types);
    if (enabled) nextTypes.add(type);
    else nextTypes.delete(type);
    return nextTypes;
}

export function createHandlerQueryContext(
    equipmentCatalog: EquipmentRegistry,
    choiceSurface?: HandlerQueryContext['choiceSurface']
): HandlerQueryContext {
    const context: HandlerQueryContext = {
        equipmentCatalog,
        getStatus: equipment => equipment.owner.getEquipmentStatus(equipment),
        matchesAmmo: (equipment, ammo, mode) => equipment.owner.matchesInventoryControlAmmo(equipment, ammo, mode),
        canProvidePassiveEffect: equipment => equipment.owner.canPerformEquipmentAction(equipment, 'provide-passive-effect'),
        isReadOnly: equipment => equipment.owner.readOnly(),
    };
    return choiceSurface === undefined
        ? context
        : { ...context, choiceSurface };
}

export interface HandlerCommandContext {
    readonly equipmentCatalog: EquipmentRegistry;
    readonly toastService: HandlerToastService;
    readonly dialogsService: HandlerDialogsService;
}

export interface HandlerToastService {
    showToast: ToastService['showToast'];
    toasts(): readonly Toast[];
}

export type HandlerNotifications = Pick<HandlerToastService, 'showToast'>;

export interface HandlerDialogsService {
    createDialog: DialogsService['createDialog'];
    showError: DialogsService['showError'];
    showNoticeHtml: DialogsService['showNoticeHtml'];
}

export function createHandlerCommandContext(
    equipmentCatalog: EquipmentRegistry,
    toastService: HandlerToastService,
    dialogsService: HandlerDialogsService
): HandlerCommandContext {
    return { equipmentCatalog, toastService, dialogsService };
}

/**
 * A picker choice with handler identification
 */
export interface HandlerChoice extends PickerChoice {
    /** Internal identifier linking this choice to its handler */
    _handler?: EquipmentInteractionHandler;
    /** Concrete operational permission; ordinary mode choices default to `change-mode`. */
    action?: EquipmentAction;
    /** Recovery/state edit uses explicit edit permission instead of operational gating. */
    stateEdit?: EquipmentStateEdit;
    /** Non-mutating navigation that remains useful on a read-only unit. */
    readOnlySafe?: boolean;
    /** Numeric 2D6 target for an escalating-failure step; 0 means no check and 13 means automatic failure. */
    failureTarget?: number;
}

export interface ToHitAdjustmentContext extends InventoryControlToHitContext {
    parent?: MountedEquipment;
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
    readonly flags: EquipmentFlag[] = [];

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
    abstract getChoices(equipment: MountedEquipment, context: HandlerQueryContext): HandlerChoice[] | null;
    
    /**
     * Handles the selection of a choice
     * @param equipment The mounted equipment
     * @param value The selected picker value
     * @param context Additional context information
     * @returns true if the picker should close, false to keep it open (can be async)
     */
    abstract handleSelection(equipment: MountedEquipment, value: PickerChoice, context: HandlerCommandContext): boolean | Promise<boolean>;

    /**
     * Hook called after a mounted equipment entry is fired/consumed from the weapons panel.
     */
    afterInventoryControlFire?(equipment: MountedEquipment): void | Promise<void>;

    /**
     * Hook called immediately before pending equipment and critical-slot damage is committed.
     */
    beforeEquipmentStateCommit?(equipment: MountedEquipment): void;

    /** Declares a rules/state-specific Mek explosion that this handler owns through phase end. */
    getCriticalDelayedExplosion?(
        hitEntry: MountedEquipment,
        explosionContext: CriticalDelayedExplosionContext,
        context: HandlerQueryContext,
    ): CriticalDelayedExplosionHandling | null;

    /**
     * Hook called when the owning unit ends its turn.
     */
    onEndTurn?(equipment: MountedEquipment, notifications: HandlerNotifications): void;

    /** Hook called when a loaded force's reactive runtime state changes. */
    onForceRuntimeChanged?(force: Force, notifications: HandlerNotifications): void;

    /**
     * Hook called while building an inventory-control row display.
     */
    applyInventoryControlDisplayEffects?(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerQueryContext
    ): InventoryControlDisplayData;

    /** Applies equipment mode/state to an aerospace weapon's attack values. */
    applyInventoryControlAerospaceAttackValueEffects?(
        equipment: MountedEquipment,
        values: AerospaceAttackValues,
        context: HandlerQueryContext
    ): AerospaceAttackValues;

    /**
     * Applies equipment-state modifiers to a weapon's unformatted damage value.
     */
    applyInventoryControlDamageEffects?(
        equipment: MountedEquipment,
        damage: WeaponDamage,
        damageContext: InventoryControlDamageContext,
        context: HandlerQueryContext
    ): WeaponDamage;

    /** Applies equipment mode/state to a physical weapon's base damage policy. */
    applyInventoryControlPhysicalDamageEffects?(
        equipment: MountedEquipment,
        effect: InventoryControlPhysicalDamageEffect,
        context: HandlerQueryContext
    ): InventoryControlPhysicalDamageEffect;

    /** Applies equipment-state modifiers to typed weapon firing heat. */
    applyInventoryControlHeatEffects?(equipment: MountedEquipment, effect: InventoryControlHeatEffect, context: HandlerQueryContext): InventoryControlHeatEffect;

    /** Applies equipment-specific multipliers to the number of ammo rounds consumed when firing. */
    applyInventoryControlAmmoConsumption?(equipment: MountedEquipment, count: number, context: HandlerQueryContext): number;

    /** Supplies typed selectable heat for physical or miscellaneous equipment. */
    getInventoryControlHeatEffect?(equipment: MountedEquipment, context: HandlerQueryContext): InventoryControlHeatEffect | null;

    /**
     * Hook called for linked equipment while building a parent entry's inventory-control row display.
     */
    applyLinkedInventoryControlDisplayEffects?(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerQueryContext
    ): InventoryControlDisplayData;

    /** Applies a linked enhancement's modifiers to typed weapon firing heat. */
    applyLinkedInventoryControlHeatEffects?(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        effect: InventoryControlHeatEffect,
        context: HandlerQueryContext
    ): InventoryControlHeatEffect;

    /** Adds or removes effective weapon types based on the weapon's own state. */
    applyInventoryControlWeaponTypes?(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerQueryContext
    ): ReadonlySet<WeaponType>;

    /**
     * Adds or removes effective weapon types contributed by linked equipment state.
     */
    applyLinkedWeaponTypes?(
        equipment: MountedEquipment,
        parent: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerQueryContext
    ): ReadonlySet<WeaponType>;

    /**
     * Hook called while filtering ammo options for a selected inventory-control mode.
     */
    matchesInventoryAmmo?(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, context: HandlerQueryContext): boolean | null;

    /** Returns typed adjustments to an entry's effective to-hit profile. */
    getToHitAdjustments?(
        equipment: MountedEquipment,
        adjustmentContext: ToHitAdjustmentContext,
        context: HandlerQueryContext
    ): readonly ToHitAdjustment[];

    /**
     * Hook called while collecting turn heat sources from inventory entries.
     */
    getInventoryHeatSources?(
        equipment: MountedEquipment,
        turnState: TurnState,
        context: HandlerQueryContext
    ): UnitHeatSource[];

    /**
     * Hook called while calculating active run movement multiplier bonuses.
     */
    getRunMovementMultiplierBonus?(
        equipment: MountedEquipment,
        turnState: TurnState,
        context: HandlerQueryContext
    ): number;

    /** Adds equipment-state bonuses to the unit's current heat-dissipation capacity. */
    getHeatDissipationBonus?(
        equipment: MountedEquipment,
        dissipation: HeatDissipationState,
        context: HandlerQueryContext
    ): number;

    /**
     * Hook called when equipment-specific modes can veto aimed shots.
     */
    canPerformAimedShot?(equipment: MountedEquipment, context: HandlerQueryContext): boolean | null;

    /** Equipment-specific veto for selecting an inventory entry to fire. */
    isInventoryControlSelectable?(equipment: MountedEquipment, context: HandlerQueryContext): boolean | null;
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

    getAllHandlers(): readonly EquipmentInteractionHandler[] {
        return [...this.handlers.values()];
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
    getChoices(equipment: MountedEquipment, context: HandlerQueryContext): HandlerChoice[] {
        const handlers = this.getHandlers(equipment);
        const allChoices: HandlerChoice[] = [];
        
        for (const handler of handlers) {
            const choices = handler.getChoices(equipment, context);
            if (choices) {
                // Tag each choice with the handler ID
                const taggedChoices = choices.map(choice => ({
                    ...choice,
                    disabled: choice.disabled || !this.canDispatchChoice(equipment, choice),
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
        context: HandlerCommandContext
    ): boolean | Promise<boolean> {
        if (!choice._handler || choice.disabled || !this.canDispatchChoice(equipment, choice)) {
            return false;
        }

        return choice._handler.handleSelection(equipment, choice, context);
    }

    private canDispatchChoice(equipment: MountedEquipment, choice: HandlerChoice): boolean {
        if (equipment.owner.readOnly() && !choice.readOnlySafe) return false;
        return choice.stateEdit
            ? equipment.owner.canEditEquipmentState(equipment, choice.stateEdit)
            : equipment.owner.canPerformEquipmentAction(equipment, choice.action ?? 'change-mode');
    }

    async afterInventoryControlFire(equipment: MountedEquipment): Promise<void> {
        for (const handler of this.getHandlers(equipment)) {
            await handler.afterInventoryControlFire?.(equipment);
        }
    }

    beforeEquipmentStateCommit(equipment: MountedEquipment): void {
        for (const handler of this.getHandlers(equipment)) {
            handler.beforeEquipmentStateCommit?.(equipment);
        }
    }

    getCriticalDelayedExplosion(
        hitEntry: MountedEquipment,
        explosionContext: CriticalDelayedExplosionContext,
        context: HandlerQueryContext,
    ): CriticalDelayedExplosionHandling | null {
        for (const handler of this.handlers.values()) {
            const explosion = handler.getCriticalDelayedExplosion?.(
                hitEntry,
                explosionContext,
                context,
            );
            if (explosion) return explosion;
        }
        return null;
    }

    onEndTurn(equipment: MountedEquipment, notifications: HandlerNotifications): void {
        for (const handler of this.getHandlers(equipment)) {
            handler.onEndTurn?.(equipment, notifications);
        }
    }

    onForceRuntimeChanged(force: Force, notifications: HandlerNotifications): void {
        for (const handler of this.handlers.values()) {
            handler.onForceRuntimeChanged?.(force, notifications);
        }
    }

    applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions,
        context: HandlerQueryContext
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

    applyInventoryControlAerospaceAttackValueEffects(
        equipment: MountedEquipment,
        values: AerospaceAttackValues,
        context: HandlerQueryContext
    ): AerospaceAttackValues {
        let nextValues = values;
        for (const handler of this.getHandlers(equipment)) {
            nextValues = handler.applyInventoryControlAerospaceAttackValueEffects?.(equipment, nextValues, context)
                ?? nextValues;
        }
        return nextValues;
    }

    applyWeaponTypes(
        equipment: MountedEquipment,
        types: ReadonlySet<WeaponType>,
        context: HandlerQueryContext
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
        damage: WeaponDamage,
        damageContext: InventoryControlDamageContext,
        context: HandlerQueryContext
    ): WeaponDamage {
        let nextDamage = damage;
        for (const handler of this.getHandlers(equipment)) {
            nextDamage = handler.applyInventoryControlDamageEffects?.(equipment, nextDamage, damageContext, context) ?? nextDamage;
        }
        return nextDamage;
    }

    applyInventoryControlPhysicalDamageEffects(
        equipment: MountedEquipment,
        effect: InventoryControlPhysicalDamageEffect,
        context: HandlerQueryContext
    ): InventoryControlPhysicalDamageEffect {
        let nextEffect = effect;
        for (const handler of this.getHandlers(equipment)) {
            nextEffect = handler.applyInventoryControlPhysicalDamageEffects?.(equipment, nextEffect, context) ?? nextEffect;
        }
        return nextEffect;
    }

    applyInventoryControlHeatEffects(equipment: MountedEquipment, effect: InventoryControlHeatEffect, context: HandlerQueryContext): InventoryControlHeatEffect {
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

    applyInventoryControlAmmoConsumption(equipment: MountedEquipment, count: number, context: HandlerQueryContext): number {
        let nextCount = count;
        for (const handler of this.getHandlers(equipment)) {
            nextCount = handler.applyInventoryControlAmmoConsumption?.(equipment, nextCount, context) ?? nextCount;
        }
        return nextCount;
    }

    getInventoryControlHeatEffect(equipment: MountedEquipment, context: HandlerQueryContext): InventoryControlHeatEffect | null {
        for (const handler of this.getHandlers(equipment)) {
            const effect = handler.getInventoryControlHeatEffect?.(equipment, context);
            if (effect) return effect;
        }
        return null;
    }

    matchesInventoryAmmo(equipment: MountedEquipment, ammo: AmmoEquipment, mode: string | null, context: HandlerQueryContext): boolean | null {
        for (const handler of this.getHandlers(equipment)) {
            const result = handler.matchesInventoryAmmo?.(equipment, ammo, mode, context);
            if (result !== undefined && result !== null) return result;
        }
        return null;
    }

    getToHitAdjustments(
        equipment: MountedEquipment,
        context: HandlerQueryContext,
        attackContext: InventoryControlToHitContext = {},
    ): ToHitAdjustment[] {
        const adjustmentContext: ToHitAdjustmentContext = { ...attackContext };
        const adjustments = this.getHandlers(equipment)
            .flatMap(handler => handler.getToHitAdjustments?.(equipment, adjustmentContext, context) ?? []);
        for (const linked of equipment.linkedWith ?? []) {
            for (const handler of this.getHandlers(linked)) {
                adjustments.push(...(handler.getToHitAdjustments?.(linked, { ...adjustmentContext, parent: equipment }, context) ?? []));
            }
        }
        return adjustments;
    }

    canPerformAimedShot(equipment: MountedEquipment, context: HandlerQueryContext): boolean {
        return this.getHandlers(equipment)
            .every(handler => handler.canPerformAimedShot?.(equipment, context) !== false);
    }

    isInventoryControlSelectable(equipment: MountedEquipment, context: HandlerQueryContext): boolean {
        return this.getHandlers(equipment)
            .every(handler => handler.isInventoryControlSelectable?.(equipment, context) !== false);
    }

    inventoryControlRules(context: HandlerQueryContext): InventoryControlRules {
        return {
            applyDisplayEffects: (equipment, display, options) => this.applyInventoryControlDisplayEffects(equipment, display, options, context),
            applyAerospaceAttackValueEffects: (equipment, values) =>
                this.applyInventoryControlAerospaceAttackValueEffects(equipment, values, context),
            applyDamageEffects: (equipment, damage, options) => this.applyInventoryControlDamageEffects(equipment, damage, options, context),
            applyPhysicalDamageEffects: (equipment, effect) => this.applyInventoryControlPhysicalDamageEffects(equipment, effect, context),
            resolveHeatEffect: equipment => this.getInventoryControlHeatEffect(equipment, context),
            applyHeatEffects: (equipment, heat) => this.applyInventoryControlHeatEffects(equipment, heat, context),
            applyWeaponTypes: (equipment, types) => this.applyWeaponTypes(equipment, types, context),
            matchesAmmo: (equipment, ammo, mode) => this.matchesInventoryAmmo(equipment, ammo, mode, context),
            resolveToHitAdjustments: (equipment, attackContext) => this.getToHitAdjustments(equipment, context, attackContext),
            isSelectable: equipment => this.isInventoryControlSelectable(equipment, context)
        };
    }

    getInventoryHeatSources(
        inventory: readonly MountedEquipment[],
        turnState: TurnState,
        context: HandlerQueryContext
    ): UnitHeatSource[] {
        return inventory.flatMap(equipment => this.getHandlers(equipment)
            .flatMap(handler => handler.getInventoryHeatSources?.(equipment, turnState, context) ?? []));
    }

    getRunMovementMultiplierBonus(
        inventory: readonly MountedEquipment[],
        turnState: TurnState,
        context: HandlerQueryContext
    ): number {
        return inventory.reduce((total, equipment) => total + this.getHandlers(equipment)
            .reduce((equipmentTotal, handler) => equipmentTotal + (handler.getRunMovementMultiplierBonus?.(equipment, turnState, context) ?? 0), 0), 0);
    }

    getHeatDissipationBonus(
        inventory: readonly MountedEquipment[],
        dissipation: HeatDissipationState,
        context: HandlerQueryContext
    ): number {
        return inventory.reduce((total, equipment) => total + this.getHandlers(equipment)
            .reduce((equipmentTotal, handler) => equipmentTotal
                + (handler.getHeatDissipationBonus?.(equipment, dissipation, context) ?? 0), 0), 0);
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
