// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable } from '@angular/core';
import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionDialogsService,
    type EquipmentInteractionInput,
    type EquipmentInteractionKind,
    type EquipmentInteractionNotifications,
    type EquipmentInteractionOwnerContext,
    type EquipmentInteractionQueryContext,
    type EquipmentInteractionToastService,
    type V2EquipmentInteractionChoiceBinding,
} from '../models/runtime/equipment-interaction';
import {
    equipmentForComponent,
    type MekRuntimeIndex,
} from '../models/runtime/mek-runtime-index';
import type { CBTUnitInstance } from '../models/runtime/unit-instance';

export {
    EquipmentInteractionHandler,
    type V2EquipmentInteractionChoiceBinding,
} from '../models/runtime/equipment-interaction';

export type HandlerQueryContext = EquipmentInteractionQueryContext;
export type HandlerCommandContext = EquipmentInteractionCommandContext;
export type HandlerToastService = EquipmentInteractionToastService;
export type HandlerDialogsService = EquipmentInteractionDialogsService;
export type HandlerNotifications = EquipmentInteractionNotifications;
export type HandlerChoice = import('../models/runtime/equipment-interaction').EquipmentInteractionChoice;
export type HandlerInput = EquipmentInteractionInput;
export type V2EquipmentInteractionContext = EquipmentInteractionOwnerContext;
export type V2EquipmentInteractionKind = EquipmentInteractionKind;
export type RegisteredEquipmentInteractionHandler = EquipmentInteractionHandler;

export function createHandlerQueryContext(
    equipmentCatalog: EquipmentRegistry,
    choiceSurface?: HandlerQueryContext['choiceSurface'],
): HandlerQueryContext {
    return choiceSurface === undefined
        ? { equipmentCatalog }
        : { equipmentCatalog, choiceSurface };
}

export function createHandlerCommandContext(
    equipmentCatalog: EquipmentRegistry,
    toastService: HandlerToastService,
    dialogsService: HandlerDialogsService,
    configureC3Network?: () => void,
): HandlerCommandContext {
    return {
        equipmentCatalog,
        toastService,
        dialogsService,
        ...(configureC3Network === undefined ? {} : { configureC3Network }),
    };
}

/**
 * Generic equipment interaction orchestration. It deliberately has no imports,
 * definitions, switches, or type guards for named equipment. Each registered
 * behavior owns applicability, choices, definition construction, and commands.
 */
export class EquipmentInteractionRegistry {
    private readonly handlers = new Map<string, EquipmentInteractionHandler>();

    register(handler: EquipmentInteractionHandler): void {
        const existing = this.handlers.get(handler.id);
        if (existing) {
            const error = new Error(`Handler with id "${handler.id}" is already registered`);
            console.error([
                `Duplicate equipment handler registration attempted for "${handler.id}".`,
                `Existing handler: ${existing.constructor.name}.`,
                `Attempted handler: ${handler.constructor.name}.`,
                error.stack ?? error.message,
            ].join('\n'));
            throw error;
        }
        this.handlers.set(handler.id, handler);
    }

    unregister(handlerId: string): void {
        this.handlers.delete(handlerId);
    }

    getHandler(handlerId: string): EquipmentInteractionHandler | undefined {
        return this.handlers.get(handlerId);
    }

    getAllHandlers(): readonly EquipmentInteractionHandler[] {
        return Object.freeze([...this.handlers.values()]);
    }

    getV2EquipmentInteractionChoices(
        runtime: CBTUnitInstance,
        entity: MekEntity,
        index: MekRuntimeIndex,
        ruleset: CBTRuleset,
        owner: V2EquipmentInteractionContext,
        context: HandlerQueryContext,
    ): readonly V2EquipmentInteractionChoiceBinding[] {
        const result: V2EquipmentInteractionChoiceBinding[] = [];
        const handlers = this.sortedHandlers();

        for (const [componentId, component] of sortedEntries(index.components)) {
            if (component.kind !== 'equipment' || !component.mount.equipment) continue;
            for (const handler of handlers) {
                if (handler.scope !== 'component'
                    || !hasRequiredFlags(component.mount.equipment.flags, handler.flags)) continue;
                this.collect(result, handler, {
                    runtime,
                    entity,
                    index,
                    ruleset,
                    owner,
                    componentId,
                    context,
                });
            }
        }

        for (const [sourceId, targetId] of sortedEntries(index.relationships.linkedTargetBySource)) {
            const sourceFlags = equipmentForComponent(index, sourceId)?.flags;
            const targetFlags = equipmentForComponent(index, targetId)?.flags;
            for (const handler of handlers) {
                if (handler.scope !== 'link'
                    || !hasRequiredLinkFlags(sourceFlags, targetFlags, handler.flags)) continue;
                this.collect(result, handler, {
                    runtime,
                    entity,
                    index,
                    ruleset,
                    owner,
                    componentId: targetId,
                    relatedComponentId: sourceId,
                    context,
                });
            }
        }
        return Object.freeze(result);
    }

    /** Rebuilds and revalidates an offered choice immediately before mutation. */
    handleV2EquipmentInteractionChoice(
        runtime: CBTUnitInstance,
        entity: MekEntity,
        index: MekRuntimeIndex,
        ruleset: CBTRuleset,
        owner: V2EquipmentInteractionContext,
        selected: V2EquipmentInteractionChoiceBinding,
        queryContext: HandlerQueryContext,
        commandContext: HandlerCommandContext,
    ): boolean | Promise<boolean> {
        const handler = this.handlers.get(selected.handler.id);
        if (handler !== selected.handler || selected.choice.disabled) return false;
        const current = this.getV2EquipmentInteractionChoices(
            runtime,
            entity,
            index,
            ruleset,
            owner,
            queryContext,
        ).find(candidate => candidate.kind === selected.kind
            && candidate.componentId === selected.componentId
            && candidate.relatedComponentId === selected.relatedComponentId
            && candidate.handler === selected.handler
            && samePickerChoiceOrOfferedOption(candidate.choice, selected.choice));
        if (!current || current.choice.disabled) return false;

        return handler.select({
            runtime,
            entity,
            index,
            ruleset,
            owner,
            componentId: selected.componentId,
            ...(selected.relatedComponentId === undefined
                ? {}
                : { relatedComponentId: selected.relatedComponentId }),
            context: queryContext,
        }, selected.choice, commandContext);
    }

    private sortedHandlers(): readonly EquipmentInteractionHandler[] {
        return [...this.handlers.values()].sort((left, right) =>
            right.priority - left.priority || left.id.localeCompare(right.id));
    }

    private collect(
        result: V2EquipmentInteractionChoiceBinding[],
        handler: EquipmentInteractionHandler,
        input: EquipmentInteractionInput,
    ): void {
        try {
            for (const choice of handler.choices(input)) {
                result.push(Object.freeze({
                    kind: handler.kind,
                    componentId: input.componentId,
                    ...(input.relatedComponentId === undefined
                        ? {}
                        : { relatedComponentId: input.relatedComponentId }),
                    actionComponentId: input.componentId,
                    handler,
                    choice: Object.freeze({ ...choice, _handler: handler }),
                }));
            }
        } catch {
            // A malformed or inapplicable component fails closed. The owning
            // behavior is the only code allowed to interpret its definition.
        }
    }
}

function sortedEntries<K extends string, V>(map: ReadonlyMap<K, V>): readonly (readonly [K, V])[] {
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function hasRequiredFlags(flags: ReadonlySet<string>, required: readonly string[]): boolean {
    return required.every(flag => flags.has(flag));
}

function hasRequiredLinkFlags(
    source: ReadonlySet<string> | undefined,
    target: ReadonlySet<string> | undefined,
    required: readonly string[],
): boolean {
    return required.every(flag => source?.has(flag) === true || target?.has(flag) === true);
}

function samePickerChoice(left: PickerChoice, right: PickerChoice): boolean {
    return left.value === right.value
        && left.label === right.label
        && left.shortLabel === right.shortLabel
        && left.displayType === right.displayType;
}

function samePickerChoiceOrOfferedOption(offered: PickerChoice, selected: PickerChoice): boolean {
    if (samePickerChoice(offered, selected)) return true;
    return offered.choices?.some(option => option.disabled !== true
        && option.value === selected.value
        && option.label === selected.label) === true;
}

@Injectable({ providedIn: 'root' })
export class EquipmentInteractionRegistryService {
    private readonly registry = new EquipmentInteractionRegistry();

    getRegistry(): EquipmentInteractionRegistry {
        return this.registry;
    }
}
