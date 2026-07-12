
import { signal } from '@angular/core';
import type { ForceUnit } from './force-unit.model';
import { conditionFromSerialized, conditionsForSerialization, normalizeConditionData, normalizeConditionKey, type SerializedState, type SerializedCondition, type ConditionData } from './force-serialization';
export type { ConditionData } from './force-serialization';

/**
 * Base state class for ForceUnit instances.
 * Contains only common state shared between all game systems (CBT, AS)
 */
export abstract class ForceUnitState {
    public unit: ForceUnit;
    public modified = signal(false);
    public destroyed = signal(false);
    public conditions = signal<Map<string, ConditionData | undefined>>(new Map());
    public c3Position = signal<{ x: number; y: number } | null>(null);

    constructor(unit: ForceUnit) {
        this.unit = unit;
    }

    public hasCondition(condition: string): boolean {
        const normalizedCondition = this.normalizeCondition(condition);
        return this.conditions().has(normalizedCondition) || this.unit.hasComputedCondition(normalizedCondition);
    }

    public getConditionValue(condition: string): number | undefined {
        return this.conditions().get(this.normalizeCondition(condition))?.value;
    }

    public setCondition(condition: string, active: boolean): boolean {
        const normalizedCondition = this.normalizeCondition(condition);
        if (!normalizedCondition) return false;
        // These conditions can't be set directly, they are computed from other state
        if (this.unit.isComputedCondition(normalizedCondition)) return false;
        const currentStates = this.conditions();
        if (currentStates.has(normalizedCondition) === active) return false;

        const nextConditions = new Map(currentStates);
        if (active) {
            nextConditions.set(normalizedCondition, undefined);
        } else {
            nextConditions.delete(normalizedCondition);
        }
        this.conditions.set(nextConditions);
        return true;
    }

    public setConditionValue(condition: string, value: number | undefined): boolean {
        const normalizedCondition = this.normalizeCondition(condition);
        if (!normalizedCondition) return false;
        if (this.unit.isComputedCondition(normalizedCondition)) return false;
        if (value === undefined || !Number.isFinite(value) || value === 0) {
            return this.setCondition(normalizedCondition, false);
        }

        const currentStates = this.conditions();
        if (currentStates.get(normalizedCondition)?.value === value) return false;

        const nextStates = new Map(currentStates);
        nextStates.set(normalizedCondition, { value });
        this.conditions.set(nextStates);
        return true;
    }

    public setConditions(conditions: Iterable<SerializedCondition>): void {
        const nextConditions = new Map<string, ConditionData | undefined>();
        for (const entry of conditions) {
            const parsed = conditionFromSerialized(entry);
            if (!parsed) continue;
            const [condition, data] = parsed;
            if (condition && !this.unit.isComputedCondition(condition)) nextConditions.set(condition, data);
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

    private normalizeCondition(condition: string): string {
        return normalizeConditionKey(condition) ?? '';
    }

    abstract update(data: SerializedState): void;
}
