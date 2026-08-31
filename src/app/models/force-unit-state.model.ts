// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import type { ForceUnit } from './force-unit.model';
import { conditionFromSerialized, conditionsForSerialization, normalizeConditionData, type SerializedState, type SerializedCondition, type ConditionData } from './force-serialization';
import type { UnitConditionKey } from './unit-condition.model';
export type { ConditionData } from './force-serialization';

/**
 * Base state class for ForceUnit instances.
 * Contains only common state shared between all game systems (CBT, AS)
 */
export abstract class ForceUnitState {
    public unit: ForceUnit;
    public modified = signal(false);
    public destroyed = signal(false);
    public conditions = signal<Map<UnitConditionKey, ConditionData | undefined>>(new Map());
    public c3Position = signal<{ x: number; y: number } | null>(null);

    constructor(unit: ForceUnit) {
        this.unit = unit;
    }

    public hasCondition(condition: UnitConditionKey): boolean {
        return this.conditions().has(condition) || this.unit.hasComputedCondition(condition);
    }

    public getConditionValue(condition: UnitConditionKey): number | undefined {
        return this.conditions().get(condition)?.value;
    }

    public setCondition(condition: UnitConditionKey, active: boolean): boolean {
        // These conditions can't be set directly, they are computed from other state
        if (this.unit.isComputedCondition(condition)) return false;
        const currentStates = this.conditions();
        if (currentStates.has(condition) === active) return false;

        const nextConditions = new Map(currentStates);
        if (active) {
            nextConditions.set(condition, undefined);
        } else {
            nextConditions.delete(condition);
        }
        this.conditions.set(nextConditions);
        return true;
    }

    public setConditionValue(condition: UnitConditionKey, value: number | undefined): boolean {
        if (this.unit.isComputedCondition(condition)) return false;
        if (value === undefined || !Number.isFinite(value) || value === 0) {
            return this.setCondition(condition, false);
        }

        const currentStates = this.conditions();
        if (currentStates.get(condition)?.value === value) return false;

        const nextStates = new Map(currentStates);
        nextStates.set(condition, { value });
        this.conditions.set(nextStates);
        return true;
    }

    public setConditions(conditions: Iterable<SerializedCondition>): void {
        const nextConditions = new Map<UnitConditionKey, ConditionData | undefined>();
        for (const entry of conditions) {
            const [condition, data] = conditionFromSerialized(entry);
            if (!this.unit.isComputedCondition(condition)) nextConditions.set(condition, data);
        }
        this.conditions.set(nextConditions);
    }

    public conditionsForSerialization(): SerializedCondition[] | undefined {
        const conditions = this.conditions();
        if (conditions.size === 0) return undefined;
        const serializable = new Map(Array.from(conditions.entries())
            .filter(([state]) => !this.unit.isComputedCondition(state))
            .map(([state, data]) => [state, normalizeConditionData(data)]));
        return conditionsForSerialization(serializable);
    }

    abstract update(data: SerializedState): void;
}
