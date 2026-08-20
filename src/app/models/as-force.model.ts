// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { Unit } from "./units.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { type ASSerializedUnit, type ASSerializedForce, AS_SERIALIZED_FORCE_SCHEMA, type SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';



export class ASForce extends Force<ASForceUnit> {
    override gameSystem: GameSystem = GameSystem.ALPHA_STRIKE;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): ASForceUnit {
        return new ASForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
    }

    /**
     * Transfers pilot data (name, skill, abilities) from one AS unit to another.
     */
    protected override transferPilotData(fromUnit: ASForceUnit, toUnit: ASForceUnit): void {
        const pilotName = fromUnit.alias();
        if (pilotName) {
            toUnit.setPilotName(pilotName);
        }
        toUnit.setPilotSkill(fromUnit.pilotSkill());
        const abilities = fromUnit.manualPilotAbilities();
        if (abilities && abilities.length > 0) {
            toUnit.setPilotAbilities([...abilities]);
        }
        toUnit.setFormationAbilities([...fromUnit.formationAbilities()]);
        toUnit.setFormationCommander(fromUnit.commander());
    }

    protected override deserializeForceUnit(data: ASSerializedUnit): ASForceUnit {
        return ASForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector);
    }

    protected override sanitizeForceData(data: SerializedForce): SerializedForce {
        return Sanitizer.sanitize(data, AS_SERIALIZED_FORCE_SCHEMA);
    }

    /** Deserialize a plain object to an ASForce instance */
    public static override deserialize(
        data: ASSerializedForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ASForce {
        const force = new ASForce(data.name ?? 'Unnamed Force', dataService, unitInitializer, injector);
        force.populateFromSerialized(data);
        FormationAbilityAssignmentUtil.reconcileForceFormationAssignments(force, { markModified: false });
        return force;
    }

    public override update(data: SerializedForce): void {
        super.update(data);
        FormationAbilityAssignmentUtil.reconcileForceFormationAssignments(this, { markModified: false });
    }

    protected override deserializeFrom(serialized: SerializedForce): ASForce {
        return ASForce.deserialize(
            serialized as ASSerializedForce,
            this.dataService, this.unitInitializer, this.injector
        );
    }
}
