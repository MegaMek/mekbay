// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitComponent, UnitSummary } from "./unit-summary.model";
import { type ASSerializedForce, AS_SERIALIZED_FORCE_SCHEMA, type SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, MAX_UNITS, resolveSerializedFormation, UnitGroup } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';
import { C3NetworkEditor } from './c3-network-editor';
import { C3Network } from './c3-network.model';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';



export class ASForce extends Force<ASForceUnit> {
    override gameSystem: GameSystem = GameSystem.ALPHA_STRIKE;

    constructor(name: string,
        dataService: DataService,
        injector: Injector) {
        super(name, dataService, injector);
    }

    private createForceUnit(unit: UnitSummary): ASForceUnit {
        return new ASForceUnit(unit, this, this.dataService, this.injector);
    }

    /** Creates a detached Alpha Strike unit for an explicit cross-system transfer. */
    public createCompatibleUnit(unit: UnitSummary): ASForceUnit {
        return this.createForceUnit(captureUnitForAdmission(unit));
    }

    public addUnit(unit: UnitSummary, targetGroup?: UnitGroup<ASForceUnit>): ASForceUnit {
        if (targetGroup !== undefined
            && (targetGroup.force !== this || !this.groups().includes(targetGroup))) {
            throw new Error('The requested target group is not owned by this force');
        }
        if (this.units().length >= MAX_UNITS) {
            throw new Error(`Cannot add more than ${MAX_UNITS} units to a single force`);
        }
        if (!this.loading && this.readOnly()) {
            throw new Error(`Force "${this.name}" is read-only`);
        }

        const forceUnit = this.createForceUnit(captureUnitForAdmission(unit));
        const intentReserved = !this.loading;
        if (intentReserved) this.reserveForceOwnerMutationIntent();
        if (this.groups().length === 0) {
            this.groups.set([new UnitGroup<ASForceUnit>(this)]);
        }
        const groups = this.groups();
        const group = targetGroup ?? groups[groups.length - 1];
        group.units.set([...group.units(), forceUnit]);
        if (this.instanceId()) {
            if (intentReserved) this.emitChangedFromReservedIntent();
            else this.emitChanged();
        } else if (intentReserved) {
            this.advanceForceOwnerGeneration();
        }
        return forceUnit;
    }

    /** Replaces one exact grouped AS unit while preserving its pilot assignment. */
    public replaceUnit(
        originalUnit: ASForceUnit,
        newUnitData: UnitSummary,
    ): { newUnit: ASForceUnit; group: UnitGroup<ASForceUnit> } | null {
        if (!this.isWholeOwnerActive() || this.readOnly()) return null;

        let originalGroup: UnitGroup<ASForceUnit> | null = null;
        let originalIndex = -1;
        for (const group of this.groups()) {
            const index = group.units().findIndex(unit => unit === originalUnit);
            if (index === -1) continue;
            originalGroup = group;
            originalIndex = index;
            break;
        }
        if (originalGroup === null || originalIndex === -1 || originalUnit.force !== this) return null;

        const newForceUnit = this.createForceUnit(captureUnitForAdmission(newUnitData));
        newForceUnit.disabledSaving = true;
        try {
            this.transferPilotData(originalUnit, newForceUnit);
        } finally {
            newForceUnit.disabledSaving = false;
        }

        this.reserveForceOwnerMutationIntent();
        const currentNetworks = this._c3Networks();
        if (currentNetworks.length > 0 && new C3Network(currentNetworks).isUnitConnected(originalUnit.id)) {
            this._c3Networks.set(C3NetworkEditor.removeUnit(currentNetworks, originalUnit.id).networks);
        }
        const groupUnits = [...originalGroup.units()];
        groupUnits.splice(originalIndex, 1, newForceUnit);
        originalGroup.units.set(groupUnits);
        if (this.instanceId()) this.emitChangedFromReservedIntent();
        return { newUnit: newForceUnit, group: originalGroup };
    }

    public removeEmptyGroups(): void {
        if (this.readOnly()) return;
        const groups = this.groups();
        const removedGroupIds = new Set(
            groups.filter(group => group.units().length === 0).map(group => group.id),
        );
        if (removedGroupIds.size === 0) return;
        const nonEmptyGroups = groups.filter(group => group.units().length > 0);
        this.reserveForceOwnerMutationIntent();
        for (const group of nonEmptyGroups) {
            if (group.formationTargetGroupId() !== null
                && removedGroupIds.has(group.formationTargetGroupId()!)) {
                group.formationTargetGroupId.set(null);
            }
        }
        this.groups.set(nonEmptyGroups);
        if (this.instanceId()) this.emitChangedFromReservedIntent();
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
    private transferPilotData(fromUnit: ASForceUnit, toUnit: ASForceUnit): void {
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

    /** Installs a current Alpha Strike grouped record into this owner. */
    private populateFromSerialized(data: ASSerializedForce): void {
        if (data.version !== 2
            || data.type !== GameSystem.ALPHA_STRIKE
            || data.cbt !== undefined
            || typeof data.instanceId !== 'string'
            || !data.instanceId.trim()
            || typeof data.timestamp !== 'string'
            || !data.timestamp
            || typeof data.name !== 'string'
            || !Array.isArray(data.groups)) {
            throw new Error('Invalid current Alpha Strike force record');
        }

        const sanitizedData = Sanitizer.sanitize(data, AS_SERIALIZED_FORCE_SCHEMA);
        this.loading = true;
        try {
            this.populateSerializedMetadata(sanitizedData);

            const parsedGroups: UnitGroup<ASForceUnit>[] = [];
            for (const serializedGroup of sanitizedData.groups) {
                const units = serializedGroup.units.map(serializedUnit => ASForceUnit.deserialize(
                    serializedUnit,
                    this,
                    this.dataService,
                    this.injector,
                ));

                const group = new UnitGroup<ASForceUnit>(this);
                group.id = serializedGroup.id;
                group.setName(serializedGroup.name, false);
                group.color = serializedGroup.color ?? '';
                group.formationLock = serializedGroup.formationLock || undefined;
                group.formation.set(resolveSerializedFormation(
                    serializedGroup.formationId,
                    group.formationLock,
                    this.gameSystem,
                ));
                group.formationTargetGroupId.set(serializedGroup.formationTargetGroupId ?? null);
                group.units.set(units);
                parsedGroups.push(group);
            }

            this.groups.set(parsedGroups);
            for (const group of parsedGroups) {
                const targetGroupId = group.formationTargetGroupId();
                if (targetGroupId !== null
                    && (targetGroupId === group.id
                        || !parsedGroups.some(candidate => candidate.id === targetGroupId))) {
                    group.formationTargetGroupId.set(null);
                }
            }
            this.setNetwork(sanitizedData.c3Networks ?? []);
        } finally {
            this.loading = false;
        }
    }

    /** Deserialize a plain object to an ASForce instance */
    public static deserialize(
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

/** Detaches mutable summary data while retaining catalog-owned Equipment profiles. */
function captureUnitForAdmission(unit: UnitSummary): UnitSummary {
    const { comp, ...structural } = unit;
    return {
        ...structuredClone(structural),
        comp: comp.map(captureUnitComponentForAdmission),
    };
}

function captureUnitComponentForAdmission(component: UnitComponent): UnitComponent {
    const { eq, bay, ...structural } = component;
    return {
        ...structuredClone(structural),
        ...(eq === undefined ? {} : { eq }),
        ...(bay === undefined ? {} : { bay: bay.map(captureUnitComponentForAdmission) }),
    };
}
