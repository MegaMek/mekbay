// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, computed, type Injector, type Signal, type WritableSignal } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from "./unit-summary.model";
import type { ASSerializedUnit } from './force-serialization';
import type { Force, UnitGroup } from './force.model';
import type { ForceUnitState } from './force-unit-state.model';
import type { ConditionData } from './force-unit-state.model';
import { uuidv7 } from '../utils/uuid.util';
import type { C3Component } from './c3-network.model';
import type { UnitTagEcmCapabilitySummary } from './unit-capability-summary.model';
import type { UnitConditionKey } from './unit-condition.model';

/** @internal Friend capability for the synchronous Force-owned C3 transaction. */
export const applyForceUnitOwnerC3Position = Symbol('applyForceUnitOwnerC3Position');

export abstract class ForceUnit {
    protected unit: UnitSummary; // Original unit data
    private _forceRef = signal<Force>(null!);
    protected readonly _formationCommander = signal<boolean>(false);
    id: string;
    updatedTs: number = 0;
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

    public abstract load(): Promise<void>;

    getDisplayName() {
        return (this.unit.chassis + ' ' + this.unit.model).trim();
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

    getConditions(): ReadonlyMap<UnitConditionKey, ConditionData | undefined> {
        return this.state.conditions();
    }

    /** Runtime availability hook used by the force-level C3 graph. */
    isC3EndpointOperational(_componentIndex: number, _component?: C3Component): boolean {
        return !this.destroyed;
    }

    /** CBT overrides this; Alpha Strike does not apply CBT C3 jamming rules. */
    isC3Jammed(): boolean {
        return false;
    }

    /** C3 visual editor position, mutated only by the Force-owned transaction. */
    get c3Position() {
        return this.state.c3Position;
    }

    public [applyForceUnitOwnerC3Position](pos: { x: number; y: number } | null): void {
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

    /** Alpha Strike formation and organization rules read the retained catalog facts. */
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

    abstract getPilotStats: Signal<number>;

    abstract repairAll(): void;

    abstract update(data: ASSerializedUnit): void;

    abstract serialize(): ASSerializedUnit;

}
