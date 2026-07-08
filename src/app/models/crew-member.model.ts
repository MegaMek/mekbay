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
import { getEffectivePilotingSkill } from "../utils/cbt-common.util";
import type { CBTForceUnit } from "./cbt-force-unit.model";
import type { SerializedCrewMember } from './force-serialization';

export const DEFAULT_GUNNERY_SKILL = 4;
export const DEFAULT_PILOTING_SKILL = 5;
export const DEAD_CREW_HIT_THRESHOLD = 6;
export const CRIPPLED_CREW_HIT_THRESHOLD = 4;

export type SkillType = 'gunnery' | 'piloting';
export type CrewMemberState = 'healthy' | 'ejected' | 'unconscious' | 'dead' | 'killed' | 'stunned';
type StoredCrewMemberState = Exclude<CrewMemberState, 'dead'>;

export class CrewMember {
    private unit: CBTForceUnit;
    private id: number;
    private name: string;
    private gunnerySkill: number;
    private pilotingSkill: number;
    private asfGunnerySkill?: number; // Optional ASF gunnery skill for ASF
    private asfPilotingSkill?: number; // Optional ASF piloting skill for ASF units
    private hits: number;
    private state: StoredCrewMemberState = 'healthy';

    constructor(id: number, unit: CBTForceUnit) {
        this.unit = unit;
        this.id = id;
        this.name = '';
        this.gunnerySkill = 4;
        this.pilotingSkill = 5;
        this.hits = 0;
    }

    getId(): number {
        return this.id;
    }

    toggleUnconscious() {
        const newState = this.state === 'unconscious' ? 'healthy' : 'unconscious';
        if (this.state === newState) return;
        this.state = newState;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    isDead(): boolean {
        return this.hits >= DEAD_CREW_HIT_THRESHOLD || this.unit.isCockpitDestroyed();
    }

    isCrippled(): boolean {
        if (this.isDead()) return false; // is already dead...
        if (this.state === 'ejected') return false; // the pilot is already gone!
        return (this.hits >= CRIPPLED_CREW_HIT_THRESHOLD);
    }

    getState(): CrewMemberState {
        if (this.isDead()) return 'dead';
        return this.state;
    }

    setState(state: StoredCrewMemberState) {
        if (this.state === state) return;
        this.state = state;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    setSkill(skillType: SkillType, skillValue: number, asf: boolean = false) {
        if (asf) {
            if (skillType === 'piloting') {
                this.asfPilotingSkill = skillValue;
            } else {
                this.asfGunnerySkill = skillValue;
            }
        } else {
            if (skillType === 'piloting') {
                this.pilotingSkill = skillValue;
            } else {
                this.gunnerySkill = skillValue;
            }
        }
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    getSkill(skillType: SkillType, asf: boolean = false): number {
        if (skillType === 'gunnery') {
            const value = asf ? this.asfGunnerySkill : this.gunnerySkill;
            if (value === undefined || value === null) {
                return DEFAULT_GUNNERY_SKILL;
            }
            return value;
        }
        const value = asf ? this.asfPilotingSkill : this.pilotingSkill;
        if (value === undefined || value === null) {
            return DEFAULT_PILOTING_SKILL;
        }
        return value;
    }

    getName(): string {
        return this.name || '';
    }

    setName(name: string) {
        if (name === this.name) return;
        this.name = name;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    getHits(): number {
        return this.hits;
    }

    setHits(hits: number) {
        if (hits === this.hits) return;
        this.hits = hits;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    /** Serialize this CrewMember instance to a plain object */
    public serialize(): SerializedCrewMember {
        return {
            id: this.getId(),
            name: this.getName(),
            gunnerySkill: this.getSkill('gunnery'),
            pilotingSkill: this.getSkill('piloting'),
            asfGunnerySkill: this.getSkill('gunnery', true),
            asfPilotingSkill: this.getSkill('piloting', true),
            hits: this.getHits(),
            state: this.serializeState()
        };
    }

    /** Deserialize a plain object to a CrewMember instance */
    public static deserialize(data: SerializedCrewMember, unit: CBTForceUnit): CrewMember {
        const crew = new CrewMember(data.id, unit);
        crew.setName(data.name);
        crew.setSkill('gunnery', data.gunnerySkill);
        const baseUnit = unit.getUnit();
        crew.setSkill('piloting', getEffectivePilotingSkill(baseUnit, data.pilotingSkill));
        if (data.asfGunnerySkill !== undefined)
            crew.setSkill('gunnery', data.asfGunnerySkill, true);
        if (data.asfPilotingSkill !== undefined)
            crew.setSkill('piloting', data.asfPilotingSkill, true);
        crew.setHits(data.hits);
        crew.setState(CrewMember.deserializeStoredState(data.state, unit));
        return crew;
    }

    public update(data: SerializedCrewMember) {
        if (data.name !== this.name) this.name = data.name;
        if (data.gunnerySkill !== this.gunnerySkill) this.gunnerySkill = data.gunnerySkill;
        if (data.pilotingSkill !== this.pilotingSkill) this.pilotingSkill = data.pilotingSkill;
        if (data.asfGunnerySkill !== this.asfGunnerySkill) this.asfGunnerySkill = data.asfGunnerySkill;
        if (data.asfPilotingSkill !== this.asfPilotingSkill) this.asfPilotingSkill = data.asfPilotingSkill;
        if (data.hits !== this.hits) this.hits = data.hits;

        const newState = CrewMember.deserializeStoredState(data.state, this.unit);
        if (newState !== this.state) this.state = newState;
    }

    private static deserializeStoredState(state: number, unit: CBTForceUnit): StoredCrewMemberState {
        if (state === 1) return 'unconscious';
        // 'dead' (2) is excluded, we derive it
        if (state === 3) return 'ejected';
        if (state === 4) return 'killed';
        if (state === 5) return 'stunned';
        return 'healthy';
    }

    private serializeState(): number {
        if (this.state === 'unconscious') return 1;
        // 'dead' (2) is excluded, we derive it
        if (this.state === 'ejected') return 3;
        if (this.state === 'killed') return 4;
        if (this.state === 'stunned') return 5;
        return 0;
    }
}
