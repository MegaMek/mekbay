// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../../models/common.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { calculateAdjustedBV, getEffectivePilotingSkill, getFixedPilotingSkill } from '../../utils/cbt-common.util';
import { adjustPointValueForSkill } from '../../utils/pv-skill-adjustment.util';

export interface SkillRange {
    min: number;
    max: number;
}

export interface SkillSettings {
    gunnery: SkillRange;
    piloting: SkillRange;
    maxDelta: number;
}

interface SkillPair {
    gunnery: number;
    piloting: number;
}

interface SkillCandidate {
    unit: UnitSummary;
    cost: number;
    locked: boolean;
    skill?: number;
    gunnery?: number;
    piloting?: number;
}

export function hasVariableForceGenerationSkillSettings(gameSystem: GameSystem, settings: SkillSettings): boolean {
    return settings.gunnery.min !== settings.gunnery.max
        || (gameSystem === GameSystem.CBT && settings.piloting.min !== settings.piloting.max);
}

export function getForceGenerationCBTSkillPairs(settings: SkillSettings, unit?: UnitSummary): SkillPair[] {
    const pairs: SkillPair[] = [];
    const fixedPiloting = unit ? getFixedPilotingSkill(unit) : null;

    for (let gunnery = settings.gunnery.min; gunnery <= settings.gunnery.max; gunnery += 1) {
        if (fixedPiloting !== null) {
            if (settings.piloting.min <= settings.piloting.max) {
                pairs.push({ gunnery, piloting: fixedPiloting });
            }
            continue;
        }
        for (let piloting = settings.piloting.min; piloting <= settings.piloting.max; piloting += 1) {
            if (Math.abs(gunnery - piloting) <= settings.maxDelta) {
                pairs.push({ gunnery, piloting });
            }
        }
    }
    return pairs;
}

export function getBudgetMetric(unit: UnitSummary, gameSystem: GameSystem, gunnery: number, piloting: number): number {
    return gameSystem === GameSystem.AS
        ? Math.max(0, adjustPointValueForSkill(unit.as.PV, gunnery))
        : Math.max(0, calculateAdjustedBV(unit, unit.bv, gunnery, getEffectivePilotingSkill(unit, piloting)));
}

function createCandidateWithSpecificSkills<T extends SkillCandidate>(candidate: T, gameSystem: GameSystem, gunnery: number, piloting: number): T {
    if (gameSystem === GameSystem.AS) {
        return { ...candidate, cost: getBudgetMetric(candidate.unit, gameSystem, gunnery, piloting), skill: gunnery, gunnery: undefined, piloting: undefined };
    }
    const effectivePiloting = getEffectivePilotingSkill(candidate.unit, piloting);
    return { ...candidate, cost: getBudgetMetric(candidate.unit, gameSystem, gunnery, effectivePiloting), skill: undefined, gunnery, piloting: effectivePiloting };
}

function enumerateCandidateSkillOptions<T extends SkillCandidate>(candidate: T, gameSystem: GameSystem, settings: SkillSettings): T[] {
    if (gameSystem === GameSystem.AS) {
        const options: T[] = [];
        for (let skill = settings.gunnery.min; skill <= settings.gunnery.max; skill += 1) {
            options.push(createCandidateWithSpecificSkills(candidate, gameSystem, skill, settings.piloting.min));
        }
        return options;
    }
    const pairs = getForceGenerationCBTSkillPairs(settings, candidate.unit);
    return pairs.map(({ gunnery, piloting }) => createCandidateWithSpecificSkills(candidate, gameSystem, gunnery, piloting));
}

export function createSkillAdjustedCandidateOptionsForSettings<T extends SkillCandidate>(candidate: T, gameSystem: GameSystem, settings: SkillSettings): T[] {
    if (candidate.locked) {
        return [candidate];
    }
    const options = enumerateCandidateSkillOptions(candidate, gameSystem, settings);
    return options.length > 0 ? options : [candidate];
}

export function createSkillAdjustedCandidateOptions<T extends SkillCandidate>(candidate: T, gameSystem: GameSystem, settings: SkillSettings): T[] {
    return hasVariableForceGenerationSkillSettings(gameSystem, settings)
        ? createSkillAdjustedCandidateOptionsForSettings(candidate, gameSystem, settings)
        : [candidate];
}

export function createLowestCostCandidateForSkillSettings<T extends SkillCandidate>(candidate: T, gameSystem: GameSystem, settings: SkillSettings): T {
    // Fallback repricing intentionally considers every skill, including for a fixed candidate.
    const options = enumerateCandidateSkillOptions(candidate, gameSystem, settings);
    return options.reduce((best, option) => option.cost < best.cost ? option : best, options[0] ?? candidate);
}
