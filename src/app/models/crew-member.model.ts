// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getEffectivePilotingSkill } from "../utils/cbt-common.util";
import type { CBTForceUnit } from "./cbt-force-unit.model";
import type { SerializedCrewMember } from './force-serialization';

export const DEFAULT_GUNNERY_SKILL = 4;
export const DEFAULT_PILOTING_SKILL = 5;
export const DEAD_CREW_HIT_THRESHOLD = 6;
export const CRIPPLED_CREW_HIT_THRESHOLD = 4;
const CONSCIOUSNESS_SCALE = [3, 5, 7, 10, 11];

function normalizeCrewHits(hits: number): number {
    if (!Number.isFinite(hits)) return 0;
    return Math.min(DEAD_CREW_HIT_THRESHOLD, Math.max(0, Math.trunc(hits)));
}

export function getConsciousnessTarget(hits: number): number | null {
    return CONSCIOUSNESS_SCALE[Math.trunc(hits) - 1] ?? null;
}

export function getConsciousnessHitCount(target: number): number | null {
    const hitIndex = CONSCIOUSNESS_SCALE.indexOf(Math.trunc(target));
    return hitIndex < 0 ? null : hitIndex + 1;
}

export type SkillType = 'gunnery' | 'piloting';
export type CrewMemberState = 'healthy' | 'ejected' | 'unconscious' | 'dead' | 'killed' | 'stunned';
type StoredCrewMemberState = CrewMemberState;

/** Crew who can currently operate the unit or make a skill check. */
export function isCrewMemberAvailable(state: CrewMemberState): boolean {
    return state === 'healthy';
}

/** Crew still present in the unit and affected by unit-wide damage or fall checks. */
export function isCrewMemberAboard(state: CrewMemberState): boolean {
    return state !== 'ejected' && state !== 'dead' && state !== 'killed';
}

export interface CrewMemberDetails {
    id: number;
    name: string;
    gunnery: number;
    piloting: number;
    asfGunnery?: number;
    asfPiloting?: number;
}

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

    getConsciousnessTarget() {
        return getConsciousnessTarget(this.getHits());
    }

    toggleUnconscious() {
        const newState = this.state === 'unconscious' ? 'healthy' : 'unconscious';
        this.unit.setCrewState(this.id, newState);
    }

    isDead(): boolean {
        return this.state === 'dead' || this.unit.rules.isCrewCockpitDestroyed(this.getId());
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
        if (this.isDead() && state !== 'dead') return;
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
        const normalized = normalizeCrewHits(hits);
        if (normalized === this.hits) return;
        this.hits = normalized;
        if (normalized < DEAD_CREW_HIT_THRESHOLD && this.state === 'dead') this.state = 'healthy';
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    /** Serialize this CrewMember instance to a plain object */
    public serialize(): SerializedCrewMember {
        const isLandAirMek = this.unit.getUnit().subtype === 'Land-Air BattleMek';
        return {
            id: this.getId(),
            name: this.getName(),
            gunnerySkill: this.getSkill('gunnery'),
            pilotingSkill: this.getSkill('piloting'),
            ...(isLandAirMek ? {
                asfGunnerySkill: this.getSkill('gunnery', true),
                asfPilotingSkill: this.getSkill('piloting', true),
            } : {}),
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
        const hits = normalizeCrewHits(data.hits);
        if (hits !== this.hits) {
            this.hits = hits;
            if (hits < DEAD_CREW_HIT_THRESHOLD && this.state === 'dead') this.state = 'healthy';
        }

        const newState = CrewMember.deserializeStoredState(data.state, this.unit);
        if ((!this.isDead() || newState === 'dead') && newState !== this.state) this.state = newState;
    }

    private static deserializeStoredState(state: number, unit: CBTForceUnit): StoredCrewMemberState {
        if (state === 1) return 'unconscious';
        if (state === 2) return 'dead';
        if (state === 3) return 'ejected';
        if (state === 4) return 'killed';
        if (state === 5) return 'stunned';
        return 'healthy';
    }

    private serializeState(): number {
        if (this.state === 'unconscious') return 1;
        if (this.state === 'dead') return 2;
        if (this.state === 'ejected') return 3;
        if (this.state === 'killed') return 4;
        if (this.state === 'stunned') return 5;
        return 0;
    }
}
