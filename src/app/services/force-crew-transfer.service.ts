// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable } from '@angular/core';
import { ASForceUnit } from '../models/as-force-unit.model';
import { GameSystem } from '../models/common.model';
import type { LoadForceUnit } from '../models/load-force-entry.model';
import {
    isCBTForceMember,
    type CBTForceMember,
    type ForceMember,
} from '../models/force-member.model';
import type { CrewAssignmentPosition } from '../models/runtime/crew-assignment';
import type { Force } from '../models/force.model';
import { compareCrewPositionIds, type ForcePerson } from '../models/force-personnel';
import { asCrewPositionId } from '../models/entity/entity-identifiers';

interface CopiedCrewMember {
    readonly positionId: string;
    readonly profile: Omit<ForcePerson, 'id'>;
}

/** Copies crew facts between the only two live force-member owners. */
@Injectable({ providedIn: 'root' })
export class ForceCrewTransferService {
    /** Insert/import and game-system conversion create independent copies. */
    copyUnassignedPersonnel(source: Force, target: Force): void {
        const assigned = new Set(source.personnel().assignments.map(assignment => assignment.personId));
        for (const person of source.personnel().people) {
            if (assigned.has(person.id)) continue;
            const { id: _id, ...profile } = person;
            if (!target.addUnassignedPerson(profile)) throw new Error('Could not copy unassigned personnel');
        }
    }

    async applyGeneratedOverrides(created: ForceMember, input: LoadForceUnit): Promise<void> {
        if (created instanceof ASForceUnit) {
            if (input.alias) created.setPilotName(input.alias);
            if (input.commander) created.setFormationCommander(true, false);
            return;
        }
        if (!isCBTForceMember(created)) throw new Error('Unsupported force-member owner');
        const overrides = new Map((input.crew ?? []).map(details => [details.id, details] as const));
        await this.replaceCrew(created, (position, index) => {
            const details = overrides.get(index);
            if (details) return {
                ...position,
                name: details.name,
                gunnery: details.gunnery,
                piloting: details.piloting,
            };
            return index === 0 && !input.crew?.length && input.alias
                ? { ...position, name: input.alias }
                : position;
        });
    }

    async transferCrossSystem(
        source: ForceMember,
        target: ForceMember,
        sourceSystem: GameSystem,
        targetSystem: GameSystem,
    ): Promise<void> {
        if (sourceSystem === targetSystem) return this.transferSameSystem(source, target, sourceSystem);
        const people = this.assignedPeople(source);
        if (source instanceof ASForceUnit && isCBTForceMember(target)) {
            const pilot = people[0];
            const stations = target.force.getUnitCrewProfile(target.id)?.positions;
            if (!stations) throw new Error('Missing target crew profile');
            // Preserve the existing conversion: AS skill supplies every gunner,
            // while the named pilot occupies the first available station.
            const gunnery = pilot?.profile.gunnery ?? 4;
            const crew: CopiedCrewMember[] = !pilot ? [] : stations.map((station, index) => ({
                positionId: station.positionId as string,
                profile: index === 0
                    ? { ...pilot.profile, piloting: pilot.profile.piloting ?? station.piloting }
                    : { gunnery, piloting: station.piloting },
            }));
            if (pilot && crew.length === 0) crew.push({ positionId: 'pilot', profile: pilot.profile });
            await this.replaceCopiedCrew(target, crew);
            return;
        }
        if (!isCBTForceMember(source) || !(target instanceof ASForceUnit)) {
            throw new Error('Cross-system crew conversion requires canonical AS and CBT members');
        }
        await this.replaceCopiedCrew(target, people.map((person, index) => ({
            positionId: index === 0 ? 'pilot' : person.positionId,
            profile: person.profile,
        })));
    }

    async transferSameSystem(source: ForceMember, target: ForceMember, system: GameSystem): Promise<void> {
        if (system === GameSystem.AS) {
            if (!(source instanceof ASForceUnit) || !(target instanceof ASForceUnit)) {
                throw new Error('Alpha Strike crew transfer requires Alpha Strike members');
            }
            target.setFormationAbilities([...source.formationAbilities()]);
            // Detached candidates receive their existing person in the paired
            // owner move. Allocating here would leak people on cancelled moves.
            if (!target.force.units().includes(target)) return;
        } else if (!isCBTForceMember(source) || !isCBTForceMember(target)) {
            throw new Error('CBT crew transfer requires canonical CBT members');
        }
        await this.replaceCopiedCrew(target, this.assignedPeople(source));
    }

    private assignedPeople(member: ForceMember): readonly CopiedCrewMember[] {
        const snapshot = member.force.personnel();
        const people = new Map(snapshot.people.map(person => [person.id, person]));
        const runtime = isCBTForceMember(member) ? member.force.getUnitSnapshot(member.id) : null;
        if (isCBTForceMember(member) && !runtime) throw new Error('Missing source crew runtime');
        return snapshot.assignments.filter(assignment => assignment.unitId === member.id)
            .sort((left, right) => compareCrewPositionIds(left.positionId, right.positionId))
            .map(assignment => {
                const { id: _id, ...profile } = people.get(assignment.personId)!;
                if (runtime) {
                    const health = runtime.query.crewState(asCrewPositionId(assignment.positionId));
                    profile.health = health.isPristine() ? undefined : health.toRuntimeState();
                }
                return { positionId: assignment.positionId, profile };
            });
    }

    /** New conversion/import targets replace generated occupants; unmatched people become reserves. */
    private async replaceCopiedCrew(
        target: ForceMember,
        crew: readonly { readonly positionId: string; readonly profile: Omit<ForcePerson, 'id'> }[],
    ): Promise<void> {
        if (target instanceof ASForceUnit && !target.force.units().includes(target)) {
            throw new Error('Crew copies require an admitted target');
        }
        if (!await target.force.replaceCopiedUnitPersonnel(target.id, crew)) throw new Error('Could not copy personal facts');
    }

    private async replaceCrew(
        target: CBTForceMember,
        update: (position: CrewAssignmentPosition, index: number) => CrewAssignmentPosition,
    ): Promise<void> {
        const before = target.force.getUnitCrewProfile(target.id);
        if (!before) throw new Error(`Missing crew profile for ${target.id}`);
        const result = await target.force.replaceUnitCrewProfile(
            target.id,
            before.positions.map(update),
        );
        if (!result) throw new Error(`Could not update crew profile for ${target.id}`);
    }

}
