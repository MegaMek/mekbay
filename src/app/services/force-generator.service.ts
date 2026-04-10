/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Injectable } from '@angular/core';

import { GameSystem } from '../models/common.model';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import { LoadForceEntry, type LoadForceGroup } from '../models/load-force-entry.model';
import type { Options } from '../models/options.model';
import type { Unit } from '../models/units.model';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';

export interface ForceGenerationPreview {
    units: Unit[];
    totalCost: number;
    error: string | null;
}

export interface ForceGenerationRequest {
    eligibleUnits: readonly Unit[];
    gameSystem: GameSystem;
    budgetLimit: number;
    minUnitCount: number;
    maxUnitCount: number;
    gunnery: number;
    piloting: number;
    getWeight?: (unit: Unit) => number;
}

export interface GeneratedForceEntryRequest {
    units: readonly Unit[];
    totalCost: number;
    gameSystem: GameSystem;
    faction?: Faction | null;
    era?: Era | null;
    gunnery: number;
    piloting: number;
    name?: string;
}

export interface ForceGeneratorBudgetLimits {
    classicLimit: number;
    alphaStrikeLimit: number;
}

const DEFAULT_FORCE_GENERATOR_BV_LIMIT = 8000;
const DEFAULT_FORCE_GENERATOR_PV_LIMIT = 300;

function getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return Math.max(0, PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, gunnery));
    }

    return Math.max(0, BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, getEffectivePilotingSkill(unit, piloting)));
}

function getMinimumMetricTotal(
    units: readonly Unit[],
    count: number,
    gameSystem: GameSystem,
    gunnery: number,
    piloting: number,
): number {
    if (count <= 0) {
        return 0;
    }

    return [...units]
        .map((unit) => getBudgetMetric(unit, gameSystem, gunnery, piloting))
        .sort((left, right) => left - right)
        .slice(0, count)
        .reduce((sum, value) => sum + value, 0);
}

function pickWeightedRandomUnit(units: readonly Unit[], getWeight: (unit: Unit) => number): Unit {
    const weights = units.map((unit) => Math.max(0, getWeight(unit)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight <= 0) {
        return units[Math.floor(Math.random() * units.length)];
    }

    let cursor = Math.random() * totalWeight;
    for (let index = 0; index < units.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0) {
            return units[index];
        }
    }

    return units[units.length - 1];
}

@Injectable({
    providedIn: 'root',
})
export class ForceGeneratorService {
    public resolveInitialBudgetLimits(
        options: Pick<Options, 'forceGenLastBVLimit' | 'forceGenLastPVLimit'>,
        unitSearchLimit: number,
        unitSearchGameSystem: GameSystem,
    ): ForceGeneratorBudgetLimits {
        const hasUnitSearchLimit = Number.isFinite(unitSearchLimit) && unitSearchLimit > 0;

        return {
            classicLimit: unitSearchGameSystem === GameSystem.CLASSIC && hasUnitSearchLimit
                ? unitSearchLimit
                : options.forceGenLastBVLimit ?? DEFAULT_FORCE_GENERATOR_BV_LIMIT,
            alphaStrikeLimit: unitSearchGameSystem === GameSystem.ALPHA_STRIKE && hasUnitSearchLimit
                ? unitSearchLimit
                : options.forceGenLastPVLimit ?? DEFAULT_FORCE_GENERATOR_PV_LIMIT,
        };
    }

    public getStoredBudgetOptionKey(gameSystem: GameSystem): 'forceGenLastBVLimit' | 'forceGenLastPVLimit' {
        return gameSystem === GameSystem.ALPHA_STRIKE ? 'forceGenLastPVLimit' : 'forceGenLastBVLimit';
    }

    public getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
        return getBudgetMetric(unit, gameSystem, gunnery, piloting);
    }

    public buildPreview(options: ForceGenerationRequest): ForceGenerationPreview {
        const minUnitCount = Math.max(1, Math.floor(options.minUnitCount));
        const maxUnitCount = Math.max(minUnitCount, Math.floor(options.maxUnitCount));
        const getWeight = options.getWeight ?? (() => 1);

        if (options.eligibleUnits.length < minUnitCount) {
            return {
                units: [],
                totalCost: 0,
                error: `Only ${options.eligibleUnits.length} eligible units match the current filters.`,
            };
        }

        const budgetLimit = options.budgetLimit > 0 ? options.budgetLimit : Number.POSITIVE_INFINITY;
        if (Number.isFinite(budgetLimit)) {
            const minimumMetricTotal = getMinimumMetricTotal(
                options.eligibleUnits,
                minUnitCount,
                options.gameSystem,
                options.gunnery,
                options.piloting,
            );
            if (minimumMetricTotal > budgetLimit) {
                return {
                    units: [],
                    totalCost: 0,
                    error: 'The selected BV/PV limit is too low to satisfy the minimum unit count.',
                };
            }
        }

        const remainingUnits = [...options.eligibleUnits];
        const selectedUnits: Unit[] = [];
        let budgetRemaining = budgetLimit;

        while (selectedUnits.length < minUnitCount) {
            const affordableUnits = Number.isFinite(budgetRemaining)
                ? remainingUnits.filter((unit) => getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting) <= budgetRemaining)
                : remainingUnits;
            if (affordableUnits.length === 0) {
                break;
            }

            const requiredAfterSelection = minUnitCount - selectedUnits.length - 1;
            const viableUnits = requiredAfterSelection > 0 && Number.isFinite(budgetRemaining)
                ? affordableUnits.filter((candidateUnit) => {
                    const candidateMetric = getBudgetMetric(candidateUnit, options.gameSystem, options.gunnery, options.piloting);
                    const remainingAfterPick = remainingUnits.filter((unit) => unit !== candidateUnit);
                    return getMinimumMetricTotal(
                        remainingAfterPick,
                        requiredAfterSelection,
                        options.gameSystem,
                        options.gunnery,
                        options.piloting,
                    ) <= budgetRemaining - candidateMetric;
                })
                : affordableUnits;

            const nextPool = viableUnits.length > 0 ? viableUnits : affordableUnits;
            const nextUnit = pickWeightedRandomUnit(nextPool, getWeight);
            selectedUnits.push(nextUnit);
            budgetRemaining -= getBudgetMetric(nextUnit, options.gameSystem, options.gunnery, options.piloting);
            remainingUnits.splice(remainingUnits.indexOf(nextUnit), 1);
        }

        if (selectedUnits.length < minUnitCount) {
            return {
                units: selectedUnits,
                totalCost: selectedUnits.reduce(
                    (sum, unit) => sum + getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting),
                    0,
                ),
                error: 'Unable to build a force that satisfies the minimum unit count with the current budget.',
            };
        }

        while (selectedUnits.length < maxUnitCount) {
            const affordableUnits = Number.isFinite(budgetRemaining)
                ? remainingUnits.filter((unit) => getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting) <= budgetRemaining)
                : remainingUnits;
            if (affordableUnits.length === 0) {
                break;
            }

            const nextUnit = pickWeightedRandomUnit(affordableUnits, getWeight);
            selectedUnits.push(nextUnit);
            budgetRemaining -= getBudgetMetric(nextUnit, options.gameSystem, options.gunnery, options.piloting);
            remainingUnits.splice(remainingUnits.indexOf(nextUnit), 1);
        }

        return {
            units: selectedUnits,
            totalCost: selectedUnits.reduce(
                (sum, unit) => sum + getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting),
                0,
            ),
            error: null,
        };
    }

    public createForceEntry(options: GeneratedForceEntryRequest): LoadForceEntry | null {
        if (options.units.length === 0) {
            return null;
        }

        const previewGroup: LoadForceGroup = {
            units: options.units.map((unit) => ({
                unit,
                alias: undefined,
                destroyed: false,
                gunnery: options.gameSystem === GameSystem.CLASSIC ? options.gunnery : undefined,
                piloting: options.gameSystem === GameSystem.CLASSIC ? getEffectivePilotingSkill(unit, options.piloting) : undefined,
                skill: options.gameSystem === GameSystem.ALPHA_STRIKE ? options.gunnery : undefined,
            })),
        };

        const faction = options.faction ?? null;
        const era = options.era ?? null;
        const name = options.name?.trim() || ForceNamerUtil.generateForceNameForFaction(faction);

        return new LoadForceEntry({
            instanceId: `generated-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
            timestamp: new Date().toISOString(),
            type: options.gameSystem,
            owned: true,
            cloud: false,
            local: false,
            missing: false,
            name,
            faction,
            era,
            bv: options.gameSystem === GameSystem.CLASSIC ? options.totalCost : undefined,
            pv: options.gameSystem === GameSystem.ALPHA_STRIKE ? options.totalCost : undefined,
            groups: [previewGroup],
        });
    }
}