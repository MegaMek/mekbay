// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from "./unit-summary.model";
import { type ASSerializedUnit, type ASSerializedForce, AS_SERIALIZED_FORCE_SCHEMA, type SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, type UnitGroup } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';



export class ASForce extends Force<ASForceUnit> {
    override gameSystem: GameSystem = GameSystem.ALPHA_STRIKE;

    constructor(name: string,
        dataService: DataService,
        injector: Injector) {
        super(name, dataService, injector);
    }

    protected override createForceUnit(unit: UnitSummary): ASForceUnit {
        return new ASForceUnit(unit, this, this.dataService, this.injector);
    }

    protected override projectMembers(): ASForceUnit[] {
        return [...this.units()];
    }

    protected override projectMembersInGroup(group: UnitGroup): ASForceUnit[] {
        const ownedGroup = this.groups().find(candidate => candidate === group);
        return ownedGroup ? [...ownedGroup.units()] : [];
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
        return ASForceUnit.deserialize(data, this, this.dataService, this.injector);
    }

    protected override sanitizeForceData(data: SerializedForce): SerializedForce {
        return Sanitizer.sanitize(data, AS_SERIALIZED_FORCE_SCHEMA);
    }

    /** Deserialize a plain object to an ASForce instance */
    public static override deserialize(
        data: ASSerializedForce,
        dataService: DataService,
        injector: Injector
    ): ASForce {
        const force = new ASForce(data.name ?? 'Unnamed Force', dataService, injector);
        force.populateFromSerialized(data);
        force.groups().forEach((group) => FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group, { markModified: false }));
        return force;
    }

    protected override deserializeFrom(serialized: SerializedForce): ASForce {
        return ASForce.deserialize(
            serialized as ASSerializedForce,
            this.dataService, this.injector
        );
    }
}
