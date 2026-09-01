// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable } from '@angular/core';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionHandlerId,
    type EquipmentInteractionOwnerContext,
    type EquipmentInteractionQueryContext,
    type EquipmentInteractionChoiceBinding,
} from '../models/runtime/equipment-interaction';
import {
    equipmentForComponent,
    type MekRuntimeIndex,
} from '../models/runtime/mek-runtime-index';
import type { CBTUnitInstance } from '../models/runtime/unit-instance';

/**
 * Generic equipment interaction orchestration. It deliberately has no imports,
 * definitions, switches, or type guards for named equipment. Each registered
 * behavior owns applicability, choices, definition construction, and commands.
 */
@Injectable({ providedIn: 'root' })
export class EquipmentInteractionRegistry {
    private readonly handlers = new Map<EquipmentInteractionHandlerId, EquipmentInteractionHandler>();

    register(handler: EquipmentInteractionHandler): void {
        const existing = this.handlers.get(handler.id);
        if (existing) {
            throw new Error(`Handler with id "${handler.id}" is already registered`);
        }
        this.handlers.set(handler.id, handler);
    }

    choices(
        runtime: CBTUnitInstance,
        entity: MekEntity,
        index: MekRuntimeIndex,
        ruleset: CBTRuleset,
        owner: EquipmentInteractionOwnerContext,
        context: EquipmentInteractionQueryContext,
    ): readonly EquipmentInteractionChoiceBinding[] {
        const result: EquipmentInteractionChoiceBinding[] = [];
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

    /** Applies a live choice resolved synchronously by the force owner. */
    select(
        runtime: CBTUnitInstance,
        entity: MekEntity,
        index: MekRuntimeIndex,
        ruleset: CBTRuleset,
        owner: EquipmentInteractionOwnerContext,
        selected: EquipmentInteractionChoiceBinding,
        queryContext: EquipmentInteractionQueryContext,
        commandContext: EquipmentInteractionCommandContext,
    ): boolean | Promise<boolean> {
        const handler = this.handlers.get(selected.handler.id);
        if (handler !== selected.handler || selected.choice.disabled) return false;
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
        result: EquipmentInteractionChoiceBinding[],
        handler: EquipmentInteractionHandler,
        input: EquipmentInteractionInput,
    ): void {
        for (const choice of handler.choices(input)) {
            result.push(Object.freeze({
                kind: handler.kind,
                componentId: input.componentId,
                ...(input.relatedComponentId === undefined
                    ? {}
                    : { relatedComponentId: input.relatedComponentId }),
                handler,
                choice: Object.freeze({ ...choice }),
            }));
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
