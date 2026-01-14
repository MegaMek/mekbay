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
import { canAntiMech, NO_ANTIMEK_SKILL } from "../utils/infantry.util";
import { CBTForceUnit } from "./cbt-force-unit.model";
import { ForceUnit } from "./force-unit.model";

export const DEFAULT_GUNNERY_SKILL = 4;
export const DEFAULT_PILOTING_SKILL = 5;

export type SkillType = 'gunnery' | 'piloting';

export class CrewMember {
    private unit: CBTForceUnit;
    private id: number;
    private name: string;
    private gunnerySkill: number;
    private pilotingSkill: number;
    private asfGunnerySkill?: number; // Optional ASF gunnery skill for ASF
    private asfPilotingSkill?: number; // Optional ASF piloting skill for ASF units
    private hits: number;
    private state: 'healthy' | 'unconscious' | 'dead' = 'healthy';

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

    toggleDead() {
        const newState = this.state === 'dead' ? 'healthy' : 'dead';
        if (this.state === newState) return;
        this.state = newState;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    getState(): 'healthy' | 'unconscious' | 'dead' {
        return this.state;
    }

    setState(state: 'healthy' | 'unconscious' | 'dead') {
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
    public serialize(): any {
        return {
            id: this.getId(),
            name: this.getName(),
            gunnerySkill: this.getSkill('gunnery'),
            pilotingSkill: this.getSkill('piloting'),
            asfGunnerySkill: this.getSkill('gunnery', true),
            asfPilotingSkill: this.getSkill('piloting', true),
            hits: this.getHits(),
            state: this.getState() === 'unconscious' ? 1 : this.getState() === 'dead' ? 2 : 0
        };
    }

    /** Deserialize a plain object to a CrewMember instance */
    public static deserialize(data: any, unit: CBTForceUnit): CrewMember {
        const crew = new CrewMember(data.id, unit);
        crew.setName(data.name);
        crew.setSkill('gunnery', data.gunnerySkill);
        const baseUnit = unit.getUnit();
        if (baseUnit.type === 'ProtoMek') {
            crew.setSkill('piloting', DEFAULT_PILOTING_SKILL);
        } else {
            let finalPilotingSkill = data.pilotingSkill;
            if (baseUnit.type === 'Infantry') {
                if (!canAntiMech(baseUnit)) {
                    if (baseUnit.subtype === 'Conventional Infantry') {
                        finalPilotingSkill = NO_ANTIMEK_SKILL;
                    } else {
                        finalPilotingSkill = DEFAULT_PILOTING_SKILL;
                    }
                }
            }
            crew.setSkill('piloting', finalPilotingSkill);
        }
        if (data.asfGunnerySkill !== undefined)
            crew.setSkill('gunnery', data.asfGunnerySkill, true);
        if (data.asfPilotingSkill !== undefined)
            crew.setSkill('piloting', data.asfPilotingSkill, true);
        crew.setHits(data.hits);
        crew.setState(data.state === 1 ? 'unconscious' : data.state === 2 ? 'dead' : 'healthy');
        return crew;
    }

    public update(data: any) {
        if (data.name !== this.name) this.name = data.name;
        if (data.gunnerySkill !== this.gunnerySkill) this.gunnerySkill = data.gunnerySkill;
        if (data.pilotingSkill !== this.pilotingSkill) this.pilotingSkill = data.pilotingSkill;
        if (data.asfGunnerySkill !== this.asfGunnerySkill) this.asfGunnerySkill = data.asfGunnerySkill;
        if (data.asfPilotingSkill !== this.asfPilotingSkill) this.asfPilotingSkill = data.asfPilotingSkill;
        if (data.hits !== this.hits) this.hits = data.hits;

        const newState = data.state === 1 ? 'unconscious' : data.state === 2 ? 'dead' : 'healthy';
        if (newState !== this.state) this.state = newState;
    }
}
