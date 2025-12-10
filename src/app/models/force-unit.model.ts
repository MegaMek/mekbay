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

import { signal, computed, Injector, Signal } from '@angular/core';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../services/unit-initializer.service';
import { generateUUID } from '../services/ws.service';
import { SerializedUnit } from './force-serialization';
import { Force } from './force.model';
import { ForceUnitState } from './force-unit-state.model';
import { CrewMember } from './crew-member.model';

/*
 * Author: Drake
 */
export abstract class ForceUnit {
    protected unit: Unit; // Original unit data
    force: Force;
    id: string;
    initialized = false;

    // Dependencies for deferred loading
    protected dataService: DataService;
    protected unitInitializer: UnitInitializerService;
    protected injector: Injector;
    protected isLoaded: boolean = false;
    public disabledSaving: boolean = false;
    phaseTrigger = signal(0); // Used to trigger change detection on phase changes

    protected abstract state: ForceUnitState;

    readOnly = computed(() => this.force.owned() === false);

    abstract readonly alias: Signal<string | undefined>;

    constructor(unit: Unit,
        force: Force,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ) {
        this.id = generateUUID();
        this.force = force;
        this.unit = structuredClone(unit);

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

    get modified(): boolean {
        return this.state.modified();
    }

    setModified() {
        if (this.disabledSaving) return;
        this.state.modified.set(true);
        this.force.emitChanged();
    }

    get destroyed(): boolean {
        return this.state.destroyed();
    }

    setDestroyed(destroyed: boolean) {
        this.state.destroyed.set(destroyed);
    }

    get shutdown(): boolean {
        return this.state.shutdown();
    }

    setShutdown(shutdown: boolean) {
        this.state.shutdown.set(shutdown);
    }

    /** Get/set the C3 visual editor position for this unit */
    get c3Position() {
        return this.state.c3Position;
    }

    setC3Position(pos: { x: number; y: number } | null) {
        this.state.c3Position.set(pos);
    }

    getUnit(): Unit {
        return this.unit;
    }

    getBv = computed<number>(() => {
        return this.unit.bv;
    })

    abstract getPilotStats: Signal<any>;

    /** Get crew members - abstract, must be implemented by subclasses */
    abstract getCrewMembers: Signal<CrewMember[]>;

    abstract repairAll(): void;

    abstract update(data: SerializedUnit): void;

    abstract serialize(): SerializedUnit;

    /** Deserialize a plain object to a ForceUnit instance - must be implemented by subclasses */
    public static deserialize(
        data: SerializedUnit,
        force: Force,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ForceUnit {
        throw new Error('ForceUnit.deserialize must be implemented by subclass');
    }

    public getAvailableEquipment() {
        return this.dataService.getEquipment(this.unit.type);
    }

}
