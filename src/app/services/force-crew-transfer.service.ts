// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable } from '@angular/core';
import { ASForceUnit } from '../models/as-force-unit.model';
import { GameSystem } from '../models/common.model';
import type { LoadForceUnit } from '../models/load-force-entry.model';
import {
    forceMemberCommander,
    isCBTForceMember,
    type CBTForceMember,
    type ForceMember,
} from '../models/force-member.model';
import type { CrewAssignmentPosition } from '../models/runtime/crew-assignment';
import { effectiveEntityPilotingSkill } from '../models/entity/utils/battle-value/skill-facts';

/** Copies crew facts between the only two live force-member owners. */
@Injectable({ providedIn: 'root' })
export class ForceCrewTransferService {
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
                piloting: effectiveEntityPilotingSkill(this.entity(created), details.piloting),
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
        if (sourceSystem === GameSystem.AS) {
            if (!(source instanceof ASForceUnit) || !isCBTForceMember(target)) {
                throw new Error('Alpha Strike to CBT transfer requires canonical AS and CBT members');
            }
            const name = source.alias();
            const gunnery = source.getPilotSkill();
            // AS has one skill: it becomes every CBT crew member's gunnery.
            // Only the first crew member receives the AS pilot name; piloting stays pristine.
            await this.replaceCrew(target, (position, index) => ({
                ...position,
                ...(index === 0 && name ? { name } : {}),
                gunnery,
            }));
            return;
        }
        if (!isCBTForceMember(source) || !(target instanceof ASForceUnit)) {
            throw new Error('CBT to Alpha Strike transfer requires canonical CBT and AS members');
        }
        const crew = source.force.getUnitCrewProfile(source.id)?.positions[0];
        if (crew?.name) target.setPilotName(crew.name);
        if (crew) target.setPilotSkill(crew.gunnery);
        target.setFormationCommander(forceMemberCommander(source));
    }

    async transferSameSystem(source: ForceMember, target: ForceMember, system: GameSystem): Promise<void> {
        if (system === GameSystem.AS) {
            if (!(source instanceof ASForceUnit) || !(target instanceof ASForceUnit)) {
                throw new Error('Alpha Strike crew transfer requires Alpha Strike members');
            }
            const name = source.alias();
            if (name) target.setPilotName(name);
            target.setPilotSkill(source.pilotSkill());
            const abilities = source.manualPilotAbilities();
            if (abilities?.length) target.setPilotAbilities([...abilities]);
            target.setFormationAbilities([...source.formationAbilities()]);
            target.setFormationCommander(source.commander());
            return;
        }
        if (!isCBTForceMember(source) || !isCBTForceMember(target)) {
            throw new Error('CBT crew transfer requires canonical CBT members');
        }
        const sourceCrew = source.force.getUnitCrewProfile(source.id);
        if (!sourceCrew) throw new Error(`Missing crew profile for ${source.id}`);
        await this.replaceCrew(target, (position, index) => {
            const value = sourceCrew.positions[index];
            return value ? {
                ...position,
                ...(value.name ? { name: value.name } : {}),
                gunnery: value.gunnery,
                piloting: effectiveEntityPilotingSkill(this.entity(target), value.piloting),
            } : position;
        });
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

    private entity(member: CBTForceMember) {
        const entity = member.force.getUnitSnapshot(member.id)?.entity;
        if (!entity) throw new Error(`Missing Entity for ${member.id}`);
        return entity;
    }
}
