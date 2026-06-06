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
 * MechWarrior, BattleMek, `Mech and AeroTech are registered trademarks
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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { GameSystem } from '../../models/common.model';
import type { Force } from '../../models/force.model';
import type { ForceUnit } from '../../models/force-unit.model';
import type { Unit } from '../../models/units.model';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { getEffectivePilotingSkill } from '../../utils/cbt-common.util';
import { PVCalculatorUtil } from '../../utils/pv-calculator.util';
import { OptionsService } from '../../services/options.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { ThousandsIntegerInputComponent } from '../thousands-integer-input/thousands-integer-input.component';

interface ForceBudgetOptimizerDialogData {
    force: Force;
}

interface OptimizationChoice {
    forceUnit: ForceUnit;
    cost: number;
    smartScore: number;
    gunnery?: number;
    piloting?: number;
    skill?: number;
}

interface OptimizationState {
    totalCost: number;
    smartScore: number;
    choices: OptimizationChoice[];
}

const MIN_PILOT_SKILL = 0;
const MAX_PILOT_SKILL = 8;
const DEFAULT_MAX_SKILL_DELTA = 1;
const OPTIMIZATION_STATE_LIMIT = 5_000;

@Component({
    selector: 'force-budget-optimizer-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, RangeSliderComponent, ThousandsIntegerInputComponent],
    templateUrl: './force-budget-optimizer-dialog.component.html',
    styleUrls: ['./force-budget-optimizer-dialog.component.scss'],
})
export class ForceBudgetOptimizerDialogComponent {
    private readonly dialogRef = inject(DialogRef<null, ForceBudgetOptimizerDialogComponent>);
    private readonly data: ForceBudgetOptimizerDialogData = inject(DIALOG_DATA) as ForceBudgetOptimizerDialogData;
    private readonly optionsService = inject(OptionsService);

    readonly force = this.data.force;
    private readonly initialSkillSettings = this.optionsService.options().forceBudgetOptimizerLastSkills;
    readonly minPilotSkill = MIN_PILOT_SKILL;
    readonly maxPilotSkill = MAX_PILOT_SKILL;
    readonly pilotSkillAvailableRange: [number, number] = [MIN_PILOT_SKILL, MAX_PILOT_SKILL];
    readonly targetBudget = signal(Math.max(0, this.force.totalBv()));
    readonly gunnerySkillRange = signal<[number, number]>(this.resolveInitialGunnerySkillRange());
    readonly pilotingSkillRange = signal<[number, number]>(this.normalizeRange([
        this.initialSkillSettings.piloting.min,
        this.initialSkillSettings.piloting.max,
    ]));
    readonly maxPilotSkillDelta = signal(this.normalizeSkillValue(this.initialSkillSettings.maxDelta));
    readonly resultMessage = signal<string | null>(null);

    readonly isAlphaStrike = computed(() => this.force.gameSystem === GameSystem.ALPHA_STRIKE);
    readonly budgetLabel = computed(() => this.isAlphaStrike() ? 'PV' : 'BV');
    readonly currentTotal = computed(() => this.force.totalBv());
    readonly targetDifference = computed(() => this.targetBudget() - this.currentTotal());
    readonly canOptimize = computed(() => !this.force.readOnly() && this.force.units().length > 0);
    readonly maxPilotSkillDeltaActive = computed(() => this.maxPilotSkillDelta() !== DEFAULT_MAX_SKILL_DELTA);

    onTargetBudgetChange(value: number): void {
        this.targetBudget.set(Math.max(0, Math.round(value || 0)));
        this.resultMessage.set(null);
    }

    onGunnerySkillRangeChange(range: [number, number]): void {
        this.gunnerySkillRange.set(this.normalizeRange(range));
        this.resultMessage.set(null);
        void this.saveSkillSettings();
    }

    onPilotingSkillRangeChange(range: [number, number]): void {
        this.pilotingSkillRange.set(this.normalizeRange(range));
        this.resultMessage.set(null);
        void this.saveSkillSettings();
    }

    onMaxPilotSkillDeltaChange(event: Event): void {
        const input = event.target as HTMLInputElement | null;
        this.maxPilotSkillDelta.set(this.normalizeSkillValue(Number(input?.value ?? DEFAULT_MAX_SKILL_DELTA)));
        this.resultMessage.set(null);
        void this.saveSkillSettings();
    }

    onMaxPilotSkillDeltaBlur(event: Event): void {
        const input = event.target as HTMLInputElement | null;
        const value = this.normalizeSkillValue(Number(input?.value ?? DEFAULT_MAX_SKILL_DELTA));
        this.maxPilotSkillDelta.set(value);
        if (input) {
            input.value = String(value);
        }
        void this.saveSkillSettings();
    }

    optimize(): void {
        if (!this.canOptimize()) {
            return;
        }

        void this.saveSkillSettings();

        const result = this.findBestOptimization();
        if (!result) {
            this.resultMessage.set('No valid skill combination was found for the selected ranges.');
            return;
        }

        let changedUnits = 0;
        for (const choice of result.choices) {
            if (this.applyChoice(choice)) {
                changedUnits += 1;
            }
        }

        const budgetLabel = this.budgetLabel();
        const distance = Math.abs(result.totalCost - this.targetBudget());
        this.resultMessage.set(
            `Optimized ${changedUnits} unit${changedUnits === 1 ? '' : 's'} to ${result.totalCost.toLocaleString()} ${budgetLabel} (${distance.toLocaleString()} from target).`
        );
    }

    dismiss(): void {
        this.dialogRef.close(null);
    }

    private findBestOptimization(): OptimizationState | null {
        const optionsByUnit = this.force.units().map((forceUnit) => this.createOptions(forceUnit));
        if (optionsByUnit.length === 0 || optionsByUnit.some(options => options.length === 0)) {
            return null;
        }

        let states: OptimizationState[] = [{ totalCost: 0, smartScore: 0, choices: [] }];
        for (const unitOptions of optionsByUnit) {
            const nextStatesByCost = new Map<number, OptimizationState>();
            for (const state of states) {
                for (const option of unitOptions) {
                    const nextTotalCost = state.totalCost + option.cost;
                    const nextSmartScore = state.smartScore + option.smartScore;
                    const incumbent = nextStatesByCost.get(nextTotalCost);
                    if (incumbent && incumbent.smartScore >= nextSmartScore) {
                        continue;
                    }
                    nextStatesByCost.set(nextTotalCost, {
                        totalCost: nextTotalCost,
                        smartScore: nextSmartScore,
                        choices: [...state.choices, option],
                    });
                }
            }
            states = this.pruneStates([...nextStatesByCost.values()]);
        }

        return states.reduce<OptimizationState | null>((best, state) => {
            if (!best || this.compareStates(state, best) < 0) {
                return state;
            }
            return best;
        }, null);
    }

    private createOptions(forceUnit: ForceUnit): OptimizationChoice[] {
        if (this.isAlphaStrike() && forceUnit instanceof ASForceUnit) {
            return this.createAlphaStrikeOptions(forceUnit);
        }
        if (!this.isAlphaStrike() && forceUnit instanceof CBTForceUnit) {
            return this.createClassicOptions(forceUnit);
        }
        return [this.createCurrentChoice(forceUnit)];
    }

    private createAlphaStrikeOptions(forceUnit: ASForceUnit): OptimizationChoice[] {
        const unit = forceUnit.getUnit();
        const priority = this.getPilotingPriority(unit);
        const optionsByCost = new Map<number, OptimizationChoice>();
        const [minSkill, maxSkill] = this.gunnerySkillRange();

        for (let skill = minSkill; skill <= maxSkill; skill += 1) {
            const cost = Math.max(0, PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, skill));
            const option: OptimizationChoice = {
                forceUnit,
                cost,
                skill,
                smartScore: priority * (MAX_PILOT_SKILL - skill),
            };
            this.keepBestOptionForCost(optionsByCost, option);
        }

        return [...optionsByCost.values()];
    }

    private createClassicOptions(forceUnit: CBTForceUnit): OptimizationChoice[] {
        const unit = forceUnit.getUnit();
        const preSkillBv = forceUnit.getBaseBv() + forceUnit.tagBV() + forceUnit.c3Tax() + forceUnit.externalStoresBv();
        const priority = this.getPilotingPriority(unit);
        const optionsByCost = new Map<number, OptimizationChoice>();
        const [minGunnery, maxGunnery] = this.gunnerySkillRange();
        const [minPiloting, maxPiloting] = this.pilotingSkillRange();
        const maxDelta = this.maxPilotSkillDelta();

        for (let gunnery = minGunnery; gunnery <= maxGunnery; gunnery += 1) {
            for (let requestedPiloting = minPiloting; requestedPiloting <= maxPiloting; requestedPiloting += 1) {
                const piloting = getEffectivePilotingSkill(unit, requestedPiloting);
                if (Math.abs(gunnery - piloting) > maxDelta) {
                    continue;
                }
                const cost = Math.max(0, BVCalculatorUtil.calculateAdjustedBV(unit, preSkillBv, gunnery, piloting));
                const option: OptimizationChoice = {
                    forceUnit,
                    cost,
                    gunnery,
                    piloting,
                    smartScore: priority * (MAX_PILOT_SKILL - piloting) + (MAX_PILOT_SKILL - gunnery),
                };
                this.keepBestOptionForCost(optionsByCost, option);
            }
        }

        return [...optionsByCost.values()];
    }

    private keepBestOptionForCost(optionsByCost: Map<number, OptimizationChoice>, option: OptimizationChoice): void {
        const incumbent = optionsByCost.get(option.cost);
        if (!incumbent || option.smartScore > incumbent.smartScore) {
            optionsByCost.set(option.cost, option);
        }
    }

    private createCurrentChoice(forceUnit: ForceUnit): OptimizationChoice {
        if (forceUnit instanceof ASForceUnit) {
            const skill = forceUnit.pilotSkill();
            return {
                forceUnit,
                cost: forceUnit.getBv(),
                skill,
                smartScore: this.getPilotingPriority(forceUnit.getUnit()) * (MAX_PILOT_SKILL - skill),
            };
        }

        if (forceUnit instanceof CBTForceUnit) {
            const gunnery = forceUnit.gunnerySkill();
            const piloting = forceUnit.pilotingSkill();
            return {
                forceUnit,
                cost: forceUnit.getBv(),
                gunnery,
                piloting,
                smartScore: this.getPilotingPriority(forceUnit.getUnit()) * (MAX_PILOT_SKILL - piloting) + (MAX_PILOT_SKILL - gunnery),
            };
        }

        return { forceUnit, cost: forceUnit.getBv(), smartScore: 0 };
    }

    private applyChoice(choice: OptimizationChoice): boolean {
        if (choice.forceUnit instanceof ASForceUnit && choice.skill !== undefined) {
            if (choice.forceUnit.pilotSkill() === choice.skill) {
                return false;
            }
            choice.forceUnit.setPilotSkill(choice.skill);
            return true;
        }

        if (choice.forceUnit instanceof CBTForceUnit && choice.gunnery !== undefined && choice.piloting !== undefined) {
            const crew = choice.forceUnit.getCrewMembers();
            const pilot = crew[0];
            const gunner = crew.length > 1 ? crew[1] : pilot;
            if (!pilot || !gunner) {
                return false;
            }

            let changed = false;
            if (gunner.getSkill('gunnery') !== choice.gunnery) {
                gunner.setSkill('gunnery', choice.gunnery);
                changed = true;
            }
            if (pilot.getSkill('piloting') !== choice.piloting) {
                pilot.setSkill('piloting', choice.piloting);
                changed = true;
            }
            return changed;
        }

        return false;
    }

    private getPilotingPriority(unit: Unit): number {
        const physicalBonus = this.hasPhysicalOrMeleeCapability(unit) ? 1_000_000 : 0;
        const speed = Math.max(unit.run2 ?? unit.run ?? 0, unit.jump ?? 0);
        return physicalBonus + Math.round(unit.tons * 100) + speed;
    }

    private hasPhysicalOrMeleeCapability(unit: Unit): boolean {
        return unit.comp.some(component => component.t === 'P')
            || (unit.as?.specials ?? []).includes('MEL');
    }

    private pruneStates(states: OptimizationState[]): OptimizationState[] {
        if (states.length <= OPTIMIZATION_STATE_LIMIT) {
            return states;
        }

        return states
            .sort((left, right) => this.compareStates(left, right))
            .slice(0, OPTIMIZATION_STATE_LIMIT);
    }

    private compareStates(left: OptimizationState, right: OptimizationState): number {
        const target = this.targetBudget();
        const leftDistance = Math.abs(left.totalCost - target);
        const rightDistance = Math.abs(right.totalCost - target);
        if (leftDistance !== rightDistance) {
            return leftDistance - rightDistance;
        }
        if (left.smartScore !== right.smartScore) {
            return right.smartScore - left.smartScore;
        }
        return Math.abs(left.totalCost - this.currentTotal()) - Math.abs(right.totalCost - this.currentTotal());
    }

    private resolveInitialGunnerySkillRange(): [number, number] {
        const range = this.force.gameSystem === GameSystem.ALPHA_STRIKE
            ? this.initialSkillSettings.skill
            : this.initialSkillSettings.gunnery;
        return this.normalizeRange([range.min, range.max]);
    }

    private async saveSkillSettings(): Promise<void> {
        const [gunneryOrSkillMin, gunneryOrSkillMax] = this.gunnerySkillRange();
        const [pilotingMin, pilotingMax] = this.pilotingSkillRange();
        const current = this.optionsService.options().forceBudgetOptimizerLastSkills;
        const next = {
            gunnery: this.isAlphaStrike()
                ? current.gunnery
                : { min: gunneryOrSkillMin, max: gunneryOrSkillMax },
            piloting: { min: pilotingMin, max: pilotingMax },
            skill: this.isAlphaStrike()
                ? { min: gunneryOrSkillMin, max: gunneryOrSkillMax }
                : current.skill,
            maxDelta: this.maxPilotSkillDelta(),
        };

        await this.optionsService.setOption('forceBudgetOptimizerLastSkills', next);
    }

    private normalizeRange(range: [number, number]): [number, number] {
        const min = this.normalizeSkillValue(range[0]);
        const max = this.normalizeSkillValue(range[1]);
        return min <= max ? [min, max] : [max, min];
    }

    private normalizeSkillValue(value: number): number {
        if (!Number.isFinite(value)) {
            return DEFAULT_MAX_SKILL_DELTA;
        }
        return Math.max(MIN_PILOT_SKILL, Math.min(MAX_PILOT_SKILL, Math.round(value)));
    }
}