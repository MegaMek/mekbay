// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from "./unit-summary.model";
import { type ASSerializedForce, AS_SERIALIZED_FORCE_SCHEMA, type SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, resolveSerializedFormation, UnitGroup } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';
import { LoggerService } from '../services/logger.service';
import { DialogsService } from '../services/dialogs.service';
import {
    DeferredUnitResolutionError,
    type DeferredUnitDescriptor,
} from './persisted-unit-state';



export class ASForce extends Force<ASForceUnit> {
    override gameSystem: GameSystem = GameSystem.ALPHA_STRIKE;
    private deferredUnitDescriptors: DeferredUnitDescriptor[] = [];

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

    public override getDeferredUnitDescriptors(): readonly DeferredUnitDescriptor[] {
        return this.deferredUnitDescriptors;
    }

    private addDeferredUnitDescriptor(descriptor: DeferredUnitDescriptor): void {
        const duplicate = this.deferredUnitDescriptors.some(existing => (
            descriptor.instanceId !== undefined
                ? existing.instanceId === descriptor.instanceId
                : existing.rawLegacyName === descriptor.rawLegacyName
                    && existing.requestedIdentity?.provider === descriptor.requestedIdentity?.provider
                    && existing.requestedIdentity?.uuid === descriptor.requestedIdentity?.uuid
        ));
        if (!duplicate) this.deferredUnitDescriptors.push(descriptor);
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
            this.deferredUnitDescriptors = [];
            this.populateSerializedMetadata(sanitizedData);

            const logger = this.injector.get(LoggerService);
            const parsedGroups: UnitGroup<ASForceUnit>[] = [];
            for (const serializedGroup of sanitizedData.groups) {
                const units: ASForceUnit[] = [];
                for (const serializedUnit of serializedGroup.units) {
                    try {
                        units.push(ASForceUnit.deserialize(
                            serializedUnit,
                            this,
                            this.dataService,
                            this.injector,
                        ));
                    } catch (error) {
                        if (error instanceof DeferredUnitResolutionError) {
                            this.addDeferredUnitDescriptor({
                                ...error.descriptor,
                                instanceId: serializedUnit.id,
                                sourcePayload: structuredClone(serializedUnit) as unknown as DeferredUnitDescriptor['sourcePayload'],
                            });
                            logger.warn(`ASForce.deserialize deferred unit "${serializedUnit.unit}": ${error.message}`);
                            continue;
                        }

                        logger.error(`ASForce.deserialize error on unit "${serializedUnit.unit}": ${error}`);
                        const errorDetail = error instanceof Error ? error.message : String(error);
                        const dialogs = this.injector.get(DialogsService);
                        void dialogs.showError(
                            `Unable to load unit "${serializedUnit.unit}". The unit was skipped.\n\n${errorDetail}`,
                            'Unit Load Error',
                        ).catch(dialogError => {
                            logger.error(`Unable to show unit load error dialog: ${dialogError}`);
                        });
                    }
                }

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
