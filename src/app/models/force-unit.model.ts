// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, computed, type Injector, type Signal, type WritableSignal } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from "./unit-summary.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import type { SerializedUnit } from './force-serialization';
import type { Force, UnitGroup } from './force.model';
import type { ForceUnitState } from './force-unit-state.model';
import type { ConditionData } from './force-unit-state.model';
import type { CrewMember } from './crew-member.model';
import { uuidv7 } from '../utils/uuid.util';
import type { C3Component } from './c3-network.model';


export abstract class ForceUnit {
    protected unit: UnitSummary; // Original unit data
    private _forceRef = signal<Force>(null!);
    protected readonly _formationCommander = signal<boolean>(false);
    id: string;
    updatedTs: number = 0;
    initialized = false;

    /**
     * The force this unit belongs to.
     * Backed by a signal so that computed properties (e.g. readOnly)
     * automatically react when the unit is moved to a different force.
     */
    get force(): Force { return this._forceRef(); }
    set force(value: Force) { this._forceRef.set(value); }

    // Dependencies for deferred loading
    protected dataService: DataService;
    protected unitInitializer: UnitInitializerService;
    protected injector: Injector;
    isLoaded: WritableSignal<boolean> = signal(false);
    public disabledSaving: boolean = false;
    phaseTrigger = signal(0); // Used to trigger change detection on phase changes

    protected abstract state: ForceUnitState;

    readOnly = computed(() => this.force.owned() === false);
    readonly commander = this._formationCommander.asReadonly();

    abstract readonly alias: Signal<string | undefined>;

    constructor(unit: UnitSummary,
        force: Force,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ) {
        this.id = uuidv7();
        this.force = force;
        this.unit = unit;

        this.dataService = dataService;
        this.unitInitializer = unitInitializer;
        this.injector = injector;
    }

    destroy() {
    }

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

    get conditions(): ReadonlyMap<string, ConditionData | undefined> {
        return this.state.conditions();
    }

    getConditions(): ReadonlyMap<string, ConditionData | undefined> {
        return this.state.conditions();
    }

    getCondition(condition: string): boolean {
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

    isComputedCondition(_condition: string): boolean {
        return false;
    }

    hasComputedCondition(_condition: string): boolean {
        return false;
    }

    setCondition(condition: string, active: boolean) {
        if (!this.state.setCondition(condition, active)) return;
        this.setModified();
    }

    /** Get/set the C3 visual editor position for this unit */
    get c3Position() {
        return this.state.c3Position;
    }

    setC3Position(pos: { x: number; y: number } | null) {
        this.state.c3Position.set(pos);
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

    getUnit(): UnitSummary {
        return this.unit;
    }

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

    /** Get crew members - abstract, must be implemented by subclasses */
    abstract getCrewMembers: Signal<CrewMember[]>;

    abstract repairAll(): void;

    abstract update(data: SerializedUnit): void;

    abstract serialize(): SerializedUnit;

    /** Deserialize a plain object to a ForceUnit instance - must be implemented by subclasses */
    public static deserialize(
        _data: SerializedUnit,
        _force: Force,
        _dataService: DataService,
        _unitInitializer: UnitInitializerService,
        _injector: Injector
    ): ForceUnit {
        throw new Error('ForceUnit.deserialize must be implemented by subclass');
    }

    public getEquipmentRegistry() {
        return this.dataService.getEquipmentRegistry();
    }

}
