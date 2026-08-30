// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { GameSystem } from '../../models/common.model';
import type { Force } from '../../models/force.model';
import {
    isCBTForceMember,
    type CBTForceMember,
    type ForceMember,
} from '../../models/force-member.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import {
    adjustEntityBattleValueForSkills,
    effectiveEntityPilotingSkill,
} from '../../models/entity/utils/battle-value/skill-facts';
import { adjustPointValueForSkill } from '../../utils/pv-skill-adjustment.util';
import { OptionsService } from '../../services/options.service';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { ThousandsIntegerInputComponent } from '../thousands-integer-input/thousands-integer-input.component';
import { normalizeBoundedInteger, normalizeBoundedIntegerInput } from '../../utils/bounded-integer-input.util';

interface ForceBudgetOptimizerDialogData {
    force: Force;
}

interface OptimizationChoice {
    member: ForceMember;
    cost: number;
    smartScore: number;
    gunnery?: number;
    piloting?: number;
    skill?: number;
}

interface OptimizationState {
    totalCost: number;
    smartScore: number;
    previous: OptimizationState | null;
    choice: OptimizationChoice | null;
}

interface OptimizationResult {
    totalCost: number;
    smartScore: number;
    choices: OptimizationChoice[];
}

interface RemainingCostBounds {
    min: number;
    max: number;
}

interface CBTSkillPriorities {
    gunnery: number;
    piloting: number;
    balance: number;
}

interface OptimizationChangeSummary {
    detail: string;
}

const MIN_PILOT_SKILL = 0;
const MAX_PILOT_SKILL = 8;
const DEFAULT_MAX_SKILL_DELTA = 1;
const OPTIMIZATION_STATE_LIMIT = 50_000;
const MIN_SKILL_BREAKDOWN_PRIORITY = 1;
const BALANCED_DAMAGE_RATIO = 0.5;

@Component({
    selector: 'force-budget-optimizer-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RangeSliderComponent, ThousandsIntegerInputComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './force-budget-optimizer-dialog.component.html',
    styleUrls: ['./force-budget-optimizer-dialog.component.scss'],
})
export class ForceBudgetOptimizerDialogComponent {
    private readonly dialogRef = inject(DialogRef<null, ForceBudgetOptimizerDialogComponent>);
    private readonly data: ForceBudgetOptimizerDialogData = inject(DIALOG_DATA) as ForceBudgetOptimizerDialogData;
    private readonly optionsService = inject(OptionsService);
    private readonly unitSearchFiltersService = inject(UnitSearchFiltersService);

    readonly force = this.data.force;
    private readonly initialSkillSettings = this.optionsService.options().forceBudgetOptimizerLastSkills;
    readonly minPilotSkill = MIN_PILOT_SKILL;
    readonly maxPilotSkill = MAX_PILOT_SKILL;
    readonly pilotSkillAvailableRange: [number, number] = [MIN_PILOT_SKILL, MAX_PILOT_SKILL];
    readonly targetBudget = signal(this.resolveInitialTargetBudget());
    readonly gunnerySkillRange = signal<[number, number]>(this.resolveInitialGunnerySkillRange());
    readonly pilotingSkillRange = signal<[number, number]>(this.normalizeRange([
        this.initialSkillSettings.piloting.min,
        this.initialSkillSettings.piloting.max,
    ]));
    readonly maxPilotSkillDelta = signal(this.normalizeSkillValue(this.initialSkillSettings.maxDelta));
    readonly resultMessage = signal<string | null>(null);

    readonly isAlphaStrike = computed(() => this.force.gameSystem === GameSystem.ALPHA_STRIKE);
    readonly budgetLabel = computed(() => this.isAlphaStrike() ? 'PV' : 'BV');
    readonly members = computed(() => this.force.members());
    readonly currentTotal = computed(() => {
        return this.members().reduce((total, member) => total + this.memberCost(member), 0);
    });
    readonly targetDifference = computed(() => this.targetBudget() - this.currentTotal());
    readonly optimizing = signal(false);
    readonly canOptimize = computed(() => !this.optimizing() && !this.force.readOnly() && this.members().length > 0);
    readonly maxPilotSkillDeltaActive = computed(() => this.maxPilotSkillDelta() !== DEFAULT_MAX_SKILL_DELTA);

    onTargetBudgetChange(value: number): void {
        this.targetBudget.set(normalizeBoundedInteger(value, {
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
        }));
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
        this.maxPilotSkillDelta.set(normalizeBoundedInteger(input?.value, {
            min: this.minPilotSkill,
            max: this.maxPilotSkill,
            fallback: DEFAULT_MAX_SKILL_DELTA,
        }));
        this.resultMessage.set(null);
        void this.saveSkillSettings();
    }

    onMaxPilotSkillDeltaBlur(event: Event): void {
        const value = normalizeBoundedIntegerInput(event, {
            min: this.minPilotSkill,
            max: this.maxPilotSkill,
            fallback: DEFAULT_MAX_SKILL_DELTA,
        });
        this.maxPilotSkillDelta.set(value);
        void this.saveSkillSettings();
    }

    async optimize(): Promise<void> {
        if (!this.canOptimize()) {
            return;
        }

        const targetBudget = this.targetBudget();
        this.optimizing.set(true);
        this.resultMessage.set('Optimizing...');
        void this.saveSkillSettings();

        try {
            await this.yieldToBrowser();
            const result = await this.findBestOptimization(targetBudget);
            if (!result) {
                this.resultMessage.set('No valid skill combination was found for the selected ranges.');
                return;
            }

            const changedUnits: OptimizationChangeSummary[] = [];
            for (const choice of result.choices) {
                const change = await this.applyChoice(choice);
                if (change) {
                    changedUnits.push(change);
                }
            }

            const budgetLabel = this.budgetLabel();
            const distance = Math.abs(result.totalCost - targetBudget);
            const changedUnitDetails = changedUnits.length < 12 && changedUnits.length > 0
                ? ` ${changedUnits.map(change => change.detail).join(', ')}`
                : '';
            this.resultMessage.set(
                `Optimized ${changedUnits.length} unit${changedUnits.length === 1 ? '' : 's'} to ${result.totalCost.toLocaleString()} ${budgetLabel} (${distance.toLocaleString()} from target).${changedUnitDetails}`
            );
        } finally {
            this.optimizing.set(false);
        }
    }

    dismiss(): void {
        this.dialogRef.close(null);
    }

    private async findBestOptimization(targetBudget: number): Promise<OptimizationResult | null> {
        const optionsByUnit = this.members().map((member) => this.createOptions(member));
        if (optionsByUnit.length === 0 || optionsByUnit.some(options => options.length === 0)) {
            return null;
        }

        const remainingCostBounds = this.buildRemainingCostBounds(optionsByUnit);
        let states: OptimizationState[] = [{ totalCost: 0, smartScore: 0, previous: null, choice: null }];
        let lastYieldAt = performance.now();
        for (let unitIndex = 0; unitIndex < optionsByUnit.length; unitIndex += 1) {
            const unitOptions = optionsByUnit[unitIndex];
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
                        previous: state,
                        choice: option,
                    });
                }
            }
            states = this.pruneStates([...nextStatesByCost.values()], remainingCostBounds[unitIndex + 1], targetBudget);
            if (performance.now() - lastYieldAt > 16) {
                await this.yieldToBrowser();
                lastYieldAt = performance.now();
            }
        }

        const bestState = this.selectBestAffordableState(states, targetBudget);
        if (!bestState) {
            return null;
        }

        return {
            totalCost: bestState.totalCost,
            smartScore: bestState.smartScore,
            choices: this.materializeChoices(bestState),
        };
    }

    private createOptions(member: ForceMember): OptimizationChoice[] {
        if (this.isAlphaStrike() && member instanceof ASForceUnit) {
            return this.createAlphaStrikeOptions(member);
        }
        if (!this.isAlphaStrike() && isCBTForceMember(member)) {
            return this.createCBTOptions(member);
        }
        return [this.createCurrentChoice(member)];
    }

    private createAlphaStrikeOptions(forceUnit: ASForceUnit): OptimizationChoice[] {
        const unit = forceUnit.getSummary();
        const priority = this.getAlphaStrikeSkillPriority(unit);
        const optionsByCost = new Map<number, OptimizationChoice>();
        const [minSkill, maxSkill] = this.gunnerySkillRange();

        for (let skill = minSkill; skill <= maxSkill; skill += 1) {
            const cost = Math.max(0, adjustPointValueForSkill(unit.as.PV, skill));
            const option: OptimizationChoice = {
                member: forceUnit,
                cost,
                skill,
                smartScore: priority * (MAX_PILOT_SKILL - skill),
            };
            this.keepBestOptionForCost(optionsByCost, option);
        }

        return [...optionsByCost.values()];
    }

    private createCBTOptions(member: CBTForceMember): OptimizationChoice[] {
        const entity = member.entity;
        const preSkillBv = member.currentBaseBattleValue() ?? entity.battleValue();
        const priorities = this.getCBTSkillPriorities(entity);
        const optionsByCost = new Map<number, OptimizationChoice>();
        const [minGunnery, maxGunnery] = this.gunnerySkillRange();
        const [minPiloting, maxPiloting] = this.pilotingSkillRange();
        const maxDelta = this.maxPilotSkillDelta();

        for (let gunnery = minGunnery; gunnery <= maxGunnery; gunnery += 1) {
            for (let requestedPiloting = minPiloting; requestedPiloting <= maxPiloting; requestedPiloting += 1) {
                const piloting = effectiveEntityPilotingSkill(entity, requestedPiloting);
                if (Math.abs(gunnery - piloting) > maxDelta) {
                    continue;
                }
                const cost = Math.max(0, adjustEntityBattleValueForSkills(
                    entity,
                    preSkillBv,
                    gunnery,
                    piloting,
                ));
                const option: OptimizationChoice = {
                    member,
                    cost,
                    gunnery,
                    piloting,
                    smartScore: this.getCBTSmartScore(priorities, gunnery, piloting),
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

    private createCurrentChoice(member: ForceMember): OptimizationChoice {
        if (member instanceof ASForceUnit) {
            const skill = member.pilotSkill();
            return {
                member,
                cost: member.getBv(),
                skill,
                smartScore: this.getAlphaStrikeSkillPriority(member.getSummary()) * (MAX_PILOT_SKILL - skill),
            };
        }

        if (isCBTForceMember(member)) {
            const position = member.force.getUnitCrewProfile(member.id)?.positions[0];
            const gunnery = position?.gunnery ?? 4;
            const piloting = position?.piloting ?? 5;
            const priorities = this.getCBTSkillPriorities(member.entity);
            return {
                member,
                cost: this.memberCost(member),
                gunnery,
                piloting,
                smartScore: this.getCBTSmartScore(priorities, gunnery, piloting),
            };
        }

        return { member, cost: this.memberCost(member), smartScore: 0 };
    }

    private async applyChoice(choice: OptimizationChoice): Promise<OptimizationChangeSummary | null> {
        if (choice.member instanceof ASForceUnit && choice.skill !== undefined) {
            const currentSkill = choice.member.pilotSkill();
            if (currentSkill === choice.skill) {
                return null;
            }
            choice.member.setPilotSkill(choice.skill);
            return {
                detail: `${choice.member.getDisplayName()} (${currentSkill}→${choice.skill})`,
            };
        }

        if (isCBTForceMember(choice.member) && choice.gunnery !== undefined && choice.piloting !== undefined) {
            const before = choice.member.force.getUnitCrewProfile(choice.member.id);
            const primary = before?.positions[0];
            if (!before || !primary) return null;
            const currentGunnery = primary.gunnery;
            const currentPiloting = primary.piloting;
            if (currentGunnery === choice.gunnery && currentPiloting === choice.piloting) {
                return null;
            }
            const positions = before.positions.map((position, index) => index === 0 ? {
                ...position,
                gunnery: choice.gunnery!,
                piloting: choice.piloting!,
            } : position);
            const applied = await choice.member.force.replaceUnitCrewProfile(choice.member.id, {
                expectedRevision: before.revision,
                positions,
            });
            if (!applied?.accepted) return null;
            return {
                detail: `${choice.member.entity.displayName()} (${currentGunnery}/${currentPiloting}→${choice.gunnery}/${choice.piloting})`,
            };
        }

        return null;
    }

    private memberCost(member: ForceMember): number {
        if (member instanceof ASForceUnit) return member.getBv();
        return member.adjustedBattleValue() ?? member.entity.battleValue();
    }

    private getCBTSkillPriorities(entity: BaseEntity): CBTSkillPriorities {
        const rangedDamage = entity.rangedWeapons().reduce((total, mount) =>
            total + entity.resolveMountedWeaponDamage(mount).maximum, 0);
        const physicalDamage = entity.equipment().reduce((total, mount) =>
            total + (mount.getPhysicalWeaponDamage()?.value ?? 0), 0)
            + (entity.unitType() === 'Mek' ? entity.tonnage() / 5 : 0);
        return this.skillPriorities(rangedDamage, physicalDamage);
    }

    private getSummarySkillPriorities(unit: UnitSummary): CBTSkillPriorities {
        return this.skillPriorities(
            Math.max(0, unit.dpt || 0),
            this.getPhysicalDamagePerTurn(unit),
        );
    }

    private skillPriorities(rangedDamage: number, physicalDamage: number): CBTSkillPriorities {
        const strongerDamage = Math.max(rangedDamage, physicalDamage);
        const weakerDamage = Math.min(rangedDamage, physicalDamage);
        const balance = strongerDamage > 0 && weakerDamage / strongerDamage >= BALANCED_DAMAGE_RATIO
            ? Math.max(MIN_SKILL_BREAKDOWN_PRIORITY, weakerDamage)
            : 0;

        return {
            gunnery: MIN_SKILL_BREAKDOWN_PRIORITY + rangedDamage,
            piloting: MIN_SKILL_BREAKDOWN_PRIORITY + physicalDamage,
            balance,
        };
    }

    private getAlphaStrikeSkillPriority(unit: UnitSummary): number {
        const priorities = this.getSummarySkillPriorities(unit);
        return priorities.gunnery + priorities.piloting;
    }

    private getCBTSmartScore(priorities: CBTSkillPriorities, gunnery: number, piloting: number): number {
        const gunneryScore = priorities.gunnery * (MAX_PILOT_SKILL - gunnery);
        const pilotingScore = priorities.piloting * (MAX_PILOT_SKILL - piloting);
        const balanceScore = priorities.balance * (MAX_PILOT_SKILL - Math.abs(gunnery - piloting));
        return gunneryScore + pilotingScore + balanceScore;
    }

    private getPhysicalDamagePerTurn(unit: UnitSummary): number {
        const physicalWeaponDamage = unit.comp
            .filter(component => component.t === 'P')
            .reduce((total, component) => total + this.parseDamageValue(component.md), 0);
        const kickDamage = this.canKick(unit) ? Math.max(0, unit.tons || 0) / 5 : 0;
        return physicalWeaponDamage + kickDamage;
    }

    private canKick(unit: UnitSummary): boolean {
        return unit.type === 'Mek';
    }

    private parseDamageValue(value: string | undefined): number {
        const damage = Number(value);
        return Number.isFinite(damage) ? Math.max(0, damage) : 0;
    }

    private buildRemainingCostBounds(optionsByUnit: readonly OptimizationChoice[][]): RemainingCostBounds[] {
        const bounds: RemainingCostBounds[] = new Array(optionsByUnit.length + 1);
        bounds[optionsByUnit.length] = { min: 0, max: 0 };

        for (let index = optionsByUnit.length - 1; index >= 0; index -= 1) {
            const unitOptions = optionsByUnit[index];
            const minCost = Math.min(...unitOptions.map(option => option.cost));
            const maxCost = Math.max(...unitOptions.map(option => option.cost));
            const next = bounds[index + 1];
            bounds[index] = {
                min: next.min + minCost,
                max: next.max + maxCost,
            };
        }

        return bounds;
    }

    private materializeChoices(state: OptimizationState): OptimizationChoice[] {
        const choices: OptimizationChoice[] = [];
        let current: OptimizationState | null = state;
        while (current) {
            if (current.choice) {
                choices.push(current.choice);
            }
            current = current.previous;
        }
        choices.reverse();
        return choices;
    }

    private pruneStates(
        states: OptimizationState[],
        remainingCostBounds: RemainingCostBounds,
        targetBudget: number,
    ): OptimizationState[] {
        if (states.length <= OPTIMIZATION_STATE_LIMIT) {
            return states;
        }

        return states
            .sort((left, right) => this.comparePartialStates(left, right, remainingCostBounds, targetBudget))
            .slice(0, OPTIMIZATION_STATE_LIMIT);
    }

    private comparePartialStates(
        left: OptimizationState,
        right: OptimizationState,
        remainingCostBounds: RemainingCostBounds,
        targetBudget: number,
    ): number {
        const leftReachableDistance = this.getReachableTargetDistance(left, remainingCostBounds, targetBudget);
        const rightReachableDistance = this.getReachableTargetDistance(right, remainingCostBounds, targetBudget);
        if (leftReachableDistance !== rightReachableDistance) {
            return leftReachableDistance - rightReachableDistance;
        }

        const idealPartialCost = targetBudget - ((remainingCostBounds.min + remainingCostBounds.max) / 2);
        const leftIdealDistance = Math.abs(left.totalCost - idealPartialCost);
        const rightIdealDistance = Math.abs(right.totalCost - idealPartialCost);
        if (leftIdealDistance !== rightIdealDistance) {
            return leftIdealDistance - rightIdealDistance;
        }

        if (left.smartScore !== right.smartScore) {
            return right.smartScore - left.smartScore;
        }

        return Math.abs(left.totalCost - targetBudget) - Math.abs(right.totalCost - targetBudget);
    }

    private getReachableTargetDistance(
        state: OptimizationState,
        remainingCostBounds: RemainingCostBounds,
        targetBudget: number,
    ): number {
        const minReachableTotal = state.totalCost + remainingCostBounds.min;
        const maxReachableTotal = state.totalCost + remainingCostBounds.max;
        if (targetBudget < minReachableTotal) {
            return minReachableTotal - targetBudget;
        }
        if (targetBudget > maxReachableTotal) {
            return targetBudget - maxReachableTotal;
        }
        return 0;
    }

    private selectBestAffordableState(states: readonly OptimizationState[], targetBudget: number): OptimizationState | null {
        return states
            .filter(state => state.totalCost <= targetBudget)
            .reduce<OptimizationState | null>((best, state) => {
                if (!best || this.compareStates(state, best, targetBudget) < 0) {
                    return state;
                }
                return best;
            }, null);
    }

    private compareStates(left: OptimizationState, right: OptimizationState, targetBudget: number): number {
        const leftDistance = targetBudget - left.totalCost;
        const rightDistance = targetBudget - right.totalCost;
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

    private resolveInitialTargetBudget(): number {
        const budgetLimit = this.unitSearchFiltersService.bvPvLimit();
        const currentTotal = this.force.members()
            .reduce((total, member) => total + this.memberCost(member), 0);
        return budgetLimit > 0 ? budgetLimit : Math.max(0, currentTotal);
    }

    private yieldToBrowser(): Promise<void> {
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
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
