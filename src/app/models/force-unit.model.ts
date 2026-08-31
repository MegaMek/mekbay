// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, computed, type Injector, type Signal, type WritableSignal } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from "./unit-summary.model";
import type { SerializedUnit } from './force-serialization';
import type { Force, UnitGroup } from './force.model';
import type { ForceUnitState } from './force-unit-state.model';
import type { ConditionData } from './force-unit-state.model';
import { uuidv7 } from '../utils/uuid.util';
import type { C3Component } from './c3-network.model';
import type { UnitDefinitionResolutionWitness } from './persisted-unit-state';
import type { UnitTagEcmCapabilitySummary } from './unit-capability-summary.model';
import type { UnitConditionKey } from './unit-condition.model';


export abstract class ForceUnit {
    protected unit: UnitSummary; // Original unit data
    private _forceRef = signal<Force>(null!);
    protected readonly _formationCommander = signal<boolean>(false);
    id: string;
    updatedTs: number = 0;
    initialized = false;
    /** Compatibility witness from UUID-first catalog resolution; source drift is diagnostic, never rejection. */
    definitionResolution?: UnitDefinitionResolutionWitness;

    /**
     * The force this unit belongs to.
     * Backed by a signal so that computed properties (e.g. readOnly)
     * automatically react when the unit is moved to a different force.
     */
    get force(): Force { return this._forceRef(); }
    set force(value: Force) { this._forceRef.set(value); }

    // Dependencies for deferred loading
    protected dataService: DataService;
    protected injector: Injector;
    isLoaded: WritableSignal<boolean> = signal(false);
    public disabledSaving: boolean = false;
    phaseTrigger = signal(0); // Used to trigger change detection on phase changes

    protected abstract state: ForceUnitState;

    readOnly = computed(() => typeof this.force.readOnly === 'function'
        ? this.force.readOnly()
        : this.force.owned() === false);
    readonly commander = this._formationCommander.asReadonly();

    abstract readonly alias: Signal<string | undefined>;

    constructor(unit: UnitSummary,
        force: Force,
        dataService: DataService,
        injector: Injector
    ) {
        this.id = uuidv7();
        this.force = force;
        this.unit = unit;

        this.dataService = dataService;
        this.injector = injector;
    }

    destroy() {}

    public abstract load(): Promise<void>;

    getDisplayName() {
        return (this.unit.chassis + ' ' + this.unit.model).trim();
    }

    getNotificationDisplayName() {
        const pilotName = this.alias()?.trim();
        const unitName = this.getDisplayName();
        return pilotName ? `${unitName} (${pilotName})` : unitName;
    }

    get modified(): boolean {
        return this.state.modified();
    }

    setModified() {
        if (this.disabledSaving) return;
        this.state.modified.set(true);
        this.updatedTs = Date.now();
        this.force.emitChanged();
    }

    get destroyed(): boolean {
        return this.state.destroyed();
    }

    setDestroyed(destroyed: boolean) {
        this.state.destroyed.set(destroyed);
    }

    get shutdown(): boolean {
        return this.state.hasCondition('shutdown');
    }

    get conditions(): ReadonlyMap<UnitConditionKey, ConditionData | undefined> {
        return this.state.conditions();
    }

    getConditions(): ReadonlyMap<UnitConditionKey, ConditionData | undefined> {
        return this.state.conditions();
    }

    getCondition(condition: UnitConditionKey): boolean {
        return this.state.hasCondition(condition);
    }

    /** Runtime availability hook used by the force-level C3 graph. */
    isC3EndpointOperational(_componentIndex: number, _component?: C3Component): boolean {
        return !this.destroyed;
    }

    /** CBT overrides this; Alpha Strike does not apply CBT C3 jamming rules. */
    isC3Jammed(): boolean {
        return false;
    }

    isComputedCondition(_condition: UnitConditionKey): boolean {
        return false;
    }

    hasComputedCondition(_condition: UnitConditionKey): boolean {
        return false;
    }

    setCondition(condition: UnitConditionKey, active: boolean) {
        if (!this.state.setCondition(condition, active)) return;
        this.setModified();
    }

    /** Get/set the C3 visual editor position for this unit */
    get c3Position() {
        return this.state.c3Position;
    }

    /**
     * Applies a standalone visual-layout edit through the owning Force. A
     * shared or retired unit must not be mutated first and merely have the
     * eventual Force emission rejected.
     */
    setC3Position(pos: { x: number; y: number } | null): boolean {
        const next = pos === null ? null : { x: pos.x, y: pos.y };
        const current = this.state.c3Position();
        if ((current === null && next === null)
            || (current !== null && next !== null
                && current.x === next.x && current.y === next.y)) return false;
        if (this.disabledSaving
            || this.readOnly()
            || !this.force.groups().some(group =>
                group.force === this.force && group.units().some(unit => unit === this))) return false;
        this.state.c3Position.set(next);
        this.state.modified.set(true);
        this.updatedTs = Date.now();
        this.force.emitChanged();
        return true;
    }

    /** @internal Exact Force-owned multi-unit C3 transaction only. */
    protected applyC3PositionFromOwnerTransaction(pos: { x: number; y: number } | null): void {
        this.state.c3Position.set(pos === null ? null : { x: pos.x, y: pos.y });
    }

    setFormationCommander(value: boolean, markModified: boolean = true): void {
        if (this._formationCommander() === value) {
            return;
        }

        this._formationCommander.set(value);
        if (markModified) {
            this.setModified();
        }
    }

    getSummary(): UnitSummary {
        return this.unit;
    }

    /** Unloaded Alpha Strike/formation adapter; Classic members supply Entity instead. */
    getFormationSummary(): UnitSummary {
        return this.unit;
    }

    /** Alpha Strike adapter for the summary-free shared C3 rules surface. */
    getC3Specials(): readonly string[] {
        return this.unit.as.specials ?? [];
    }

    /** Alpha Strike adapter for the shared C3 editor's display-only fields. */
    getC3Presentation() {
        return Object.freeze({
            chassis: this.unit.chassis,
            model: this.unit.model,
            icon: this.unit.icon,
            tons: this.unit.tons,
            walk: this.unit.walk,
        });
    }

    /** Immutable capability projection; concrete authority stays behind this query. */
    abstract getTagEcmCapabilitySummary(): UnitTagEcmCapabilitySummary;

    getGroup(): UnitGroup<ForceUnit> | null {
        return this.force.groups().find(group => 
            group.units().some(u => u === this)
        ) ?? null;
    }

    abstract getBaseBv: Signal<number>;

    /** BV/PV after force modifiers, but before the final skill adjustment. */
    abstract getPreSkillBv: Signal<number>;

    abstract getBv: Signal<number>;

    abstract getPilotStats: Signal<any>;

    abstract repairAll(): void;

    abstract update(data: SerializedUnit): void;

    abstract serialize(): SerializedUnit;

    public getEquipmentRegistry() {
        return this.dataService.getEquipmentRegistry();
    }

}
