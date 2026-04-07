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

import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild, computed, DestroyRef, Injector } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { PILOT_ABILITIES, type PilotAbility, type ASCustomPilotAbility, getAbilityLimitsForSkill, type PilotAbilityLimits, getAbilityDetails } from '../../models/pilot-abilities.model';
import type { ASForceUnit } from '../../models/as-force-unit.model';
import { COMMAND_ABILITIES } from '../../models/command-abilities.model';
import type { UnitGroup } from '../../models/force.model';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { DialogsService } from '../../services/dialogs.service';
import { AbilityDropdownPanelComponent } from './ability-dropdown-panel.component';
import { CustomAbilityDialogComponent } from './custom-ability-dialog.component';
import { SkillDropdownPanelComponent, type SkillPreviewEntry } from '../skill-dropdown-panel/skill-dropdown-panel.component';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GameSystem, formatRulesReference, type RulesReference } from '../../models/common.model';
import type { ASUnitTypeCode } from '../../models/units.model';
import { PVCalculatorUtil } from '../../utils/pv-calculator.util';
import { DEFAULT_GUNNERY_SKILL } from '../../models/crew-member.model';
import {
    FormationAbilityAssignmentUtil,
    type FormationAssignmentPreview,
    type FormationEffectPreview,
    type UnsupportedFormationEffectDescriptor,
} from '../../utils/formation-ability-assignment.util';

/*
 * Author: Drake
 */

/** Represents either a standard ability (by ID) or a custom ability (object) */
export type AbilitySelection = string | ASCustomPilotAbility;

export interface EditASPilotDialogData {
    unitId: string;
    name: string;
    skill: number;
    abilities: AbilitySelection[]; // Array of ability IDs or custom abilities
    formationAbilities?: string[];
    commander?: boolean;
    group?: UnitGroup<ASForceUnit> | null;
    /** The unit's AS type code (e.g. 'BM', 'CV') for filtering abilities by unitTypeFilter. */
    unitTypeCode?: ASUnitTypeCode;
    /** Base PV at skill 4 for PV preview calculation. */
    basePv?: number;
}

export interface EditASPilotResult {
    name: string;
    skill: number;
    abilities: AbilitySelection[]; // Array of ability IDs or custom abilities
    formationAbilities: string[];
    formationAbilityOverrides?: Map<string, string[]>;
    commander: boolean;
}

@Component({
    selector: 'edit-as-pilot-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './edit-as-pilot-dialog.component.html',
    styleUrl: './edit-as-pilot-dialog.component.scss'
})
export class EditASPilotDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    skillTrigger = viewChild.required<ElementRef<HTMLDivElement>>('skillTrigger');

    dropdownTrigger0 = viewChild<ElementRef<HTMLButtonElement>>('dropdownTrigger0');
    dropdownTrigger1 = viewChild<ElementRef<HTMLButtonElement>>('dropdownTrigger1');
    dropdownTrigger2 = viewChild<ElementRef<HTMLButtonElement>>('dropdownTrigger2');

    public dialogRef = inject(DialogRef<EditASPilotResult | null, EditASPilotDialogComponent>);
    readonly data: EditASPilotDialogData = inject(DIALOG_DATA) as EditASPilotDialogData;
    private overlayManager = inject(OverlayManagerService);
    private dialogsService = inject(DialogsService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);
    readonly formatRuleReference = formatRulesReference;

    availableAbilities = signal<PilotAbility[]>(PILOT_ABILITIES);
    selectedAbilities = signal<(AbilitySelection | null)[]>([null, null, null]);
    selectedFormationAbilities = signal<string[]>([]);
    selectedFormationCommander = signal<boolean>(false);
    formationAbilityOverrides = signal<Map<string, string[]>>(new Map());
    openDropdown = signal<number | null>(null);
    openFormationDropdownKey = signal<string | null>(null);
    currentSkill = signal<number>(4);

    private readonly hasPvPreview = this.data.basePv != null;

    skillEntries = computed<SkillPreviewEntry[]>(() => {
        if (!this.hasPvPreview) {
            return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(skill => ({ skill, adjustedValue: 0, delta: 0 }));
        }
        const basePv = this.data.basePv!;
        const baselineValue = PVCalculatorUtil.calculateAdjustedPV(basePv, DEFAULT_GUNNERY_SKILL);
        return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(skill => {
            const adjustedValue = PVCalculatorUtil.calculateAdjustedPV(basePv, skill);
            return { skill, adjustedValue, delta: adjustedValue - baselineValue };
        });
    });

    abilityLimits = computed<PilotAbilityLimits>(() => {
        return getAbilityLimitsForSkill(this.currentSkill());
    });

    currentAbilityCount = computed(() => {
        return this.selectedAbilities().filter(a => a !== null).length;
    });

    effectiveCommanderUnitId = computed<string | null>(() => {
        if (!this.data.group) {
            return this.selectedFormationCommander() ? this.data.unitId : null;
        }

        if (this.selectedFormationCommander()) {
            return this.data.unitId;
        }

        return this.data.group.units().find((unit) =>
            unit.id !== this.data.unitId && unit.commander()
        )?.id ?? null;
    });

    formationPreview = computed<FormationAssignmentPreview | null>(() => {
        if (!this.data.group) {
            return null;
        }

        return FormationAbilityAssignmentUtil.previewGroupFormationAssignments(this.data.group, {
            abilityOverrides: this.buildFormationAbilityOverrides(),
            commanderUnitId: this.effectiveCommanderUnitId(),
        });
    });

    formationEffectPreviews = computed<FormationEffectPreview[]>(() => {
        return [...(this.formationPreview()?.effectPreviews ?? [])];
    });

    unsupportedFormationEffects = computed<UnsupportedFormationEffectDescriptor[]>(() => {
        return [...(this.formationPreview()?.unsupportedEffects ?? [])];
    });

    hasAutoGrantedFormationEffects = computed<boolean>(() => {
        return this.unsupportedFormationEffects().some((effect) => effect.reason === 'auto-command-ability');
    });

    hasResettableFormationAssignments = computed<boolean>(() => {
        if (!this.data.group) {
            return false;
        }

        const overrides = this.buildFormationAbilityOverrides();
        if (!overrides) {
            return false;
        }

        return this.data.group.units().some((unit) => {
            const requestedAbilityIds = overrides.has(unit.id)
                ? overrides.get(unit.id) ?? []
                : unit.formationAbilities();
            return requestedAbilityIds.length > 0;
        });
    });

    persistedOtherCommander = computed<ASForceUnit | null>(() => {
        if (!this.data.group) {
            return null;
        }

        return this.data.group.units().find((unit) =>
            unit.id !== this.data.unitId && unit.commander()
        ) ?? null;
    });

    persistedOtherCommanderName = computed<string | null>(() => {
        const commander = this.persistedOtherCommander();
        if (!commander) {
            return null;
        }

        return this.formatCommanderDisplayName(commander);
    });

    formationCommanderSummary = computed<string>(() => {
        if (this.selectedFormationCommander()) {
            return 'This unit is designated as the group commander.';
        }

        const otherCommanderName = this.persistedOtherCommanderName();
        if (otherCommanderName) {
            return `Current group commander: ${otherCommanderName}.`;
        }

        return 'No commander is currently selected for this group.';
    });

    formationCommanderWarning = computed<string | null>(() => {
        if (this.selectedFormationCommander()) {
            return null;
        }

        const otherCommanderName = this.persistedOtherCommanderName();
        if (!otherCommanderName) {
            return null;
        }

        return `Selecting this unit will remove the commander flag from ${otherCommanderName} and may also remove commander-only formation abilities from that unit.`;
    });

    private formatCommanderDisplayName(unit: ASForceUnit): string {
        const pilotName = unit.alias()?.trim();
        const unitName = unit.getDisplayName();
        if (pilotName) {
            return `${unitName} (${pilotName})`;
        }
        return unitName;
    }

    remainingCost = computed(() => {
        return this.abilityLimits().maxCost - this.totalCost();
    });

    totalCost = computed(() => {
        return this.selectedAbilities().reduce((sum, ability) => {
            if (!ability) return sum;
            if (this.isCustomAbility(ability)) {
                return sum + ability.cost;
            }
            const standardAbility = this.getAbilityById(ability);
            return sum + (standardAbility?.cost || 0);
        }, 0);
    });

    constructor() {
        // Initialize skill first (needed for limits calculation)
        this.currentSkill.set(this.data.skill);
        this.selectedFormationAbilities.set([...(this.data.formationAbilities ?? [])]);
        this.selectedFormationCommander.set(this.data.commander ?? false);

        // Initialize with existing abilities from data (max 3 slots)
        const initialAbilities: (AbilitySelection | null)[] = [null, null, null];
        if (this.data.abilities && this.data.abilities.length > 0) {
            for (let i = 0; i < Math.min(this.data.abilities.length, 3); i++) {
                initialAbilities[i] = this.data.abilities[i] || null;
            }
        }
        this.selectedAbilities.set(initialAbilities);
        this.normalizeFormationSelectionState();

        // Cleanup overlays when dialog is destroyed
        this.destroyRef.onDestroy(() => {
            this.closeDropdownOverlay();
            this.closeFormationDropdownOverlay();
            this.closeCustomAbilityOverlay();
            this.overlayManager.closeManagedOverlay('skill-dropdown');
        });
    }

    /** Type guard: check if an ability selection is a custom ability */
    isCustomAbility(ability: AbilitySelection | null): ability is ASCustomPilotAbility {
        return ability !== null && typeof ability === 'object';
    }

    /** Get display info for any ability selection */
    getAbilityDisplayInfo(ability: AbilitySelection | null): { name: string; cost: number; summary: string; isCustom: boolean; rulesRef?: RulesReference[]; unitTypeInvalid: boolean } | null {
        if (!ability) return null;
        
        if (this.isCustomAbility(ability)) {
            return {
                name: ability.name,
                cost: ability.cost,
                summary: ability.summary,
                isCustom: true,
                unitTypeInvalid: false
            };
        }
        
        const standardAbility = this.getAbilityById(ability);
        if (!standardAbility) return null;
        
        const details = getAbilityDetails(standardAbility, GameSystem.ALPHA_STRIKE);
        const unitTypeCode = this.data.unitTypeCode;
        const unitTypeInvalid = !!(unitTypeCode && details.unitTypeFilter?.length && !details.unitTypeFilter.includes(unitTypeCode));
        return {
            name: standardAbility.name,
            cost: standardAbility.cost,
            summary: details.summary[0],
            isCustom: false,
            rulesRef: details.rulesRef,
            unitTypeInvalid
        };
    }

    private getDropdownTrigger(slot: number): ElementRef<HTMLButtonElement> | undefined {
        switch (slot) {
            case 0: return this.dropdownTrigger0();
            case 1: return this.dropdownTrigger1();
            case 2: return this.dropdownTrigger2();
            default: return undefined;
        }
    }

    private closeDropdownOverlay(): void {
        this.overlayManager.closeManagedOverlay('ability-dropdown');
        this.openDropdown.set(null);
    }

    private closeFormationDropdownOverlay(): void {
        this.overlayManager.closeManagedOverlay('formation-ability-dropdown');
        this.openFormationDropdownKey.set(null);
    }

    private closeCustomAbilityOverlay(): void {
        this.overlayManager.closeManagedOverlay('custom-ability-dialog');
    }

    private buildFormationAbilityOverrides(currentAbilityIds: string[] = this.selectedFormationAbilities()): Map<string, string[]> | undefined {
        if (!this.data.group) {
            return undefined;
        }

        const overrides = new Map<string, string[]>();
        for (const [unitId, abilityIds] of this.formationAbilityOverrides()) {
            overrides.set(unitId, [...abilityIds]);
        }
        overrides.set(this.data.unitId, [...new Set(currentAbilityIds)]);
        return overrides;
    }

    private snapshotFormationAbilityOverrides(): Map<string, string[]> | undefined {
        const overrides = this.buildFormationAbilityOverrides();
        if (!overrides) {
            return undefined;
        }

        return new Map([...overrides].map(([unitId, abilityIds]) => [unitId, [...abilityIds]]));
    }

    getAbilityById(id: string | null): PilotAbility | undefined {
        if (!id) return undefined;
        return PILOT_ABILITIES.find(a => a.id === id);
    }

    isAbilitySelected(id: string): boolean {
        return this.selectedAbilities().some(ability => ability === id);
    }

    getFormationAbilityById(id: string): PilotAbility | undefined {
        return PILOT_ABILITIES.find((ability) => ability.id === id);
    }

    getFormationAbilityDisplayInfo(id: string): { name: string; summary: string; rulesRef?: RulesReference[] } | null {
        const ability = this.getFormationAbilityById(id);
        if (!ability) {
            return null;
        }

        const details = getAbilityDetails(ability, GameSystem.ALPHA_STRIKE);
        return {
            name: ability.name,
            summary: details.summary[0] ?? '',
            rulesRef: details.rulesRef,
        };
    }

    /** Check if an ability can be afforded within remaining cost budget */
    canAffordAbility(cost: number): boolean {
        return cost <= this.remainingCost();
    }

    /** Check if another ability slot can be used */
    canAddMoreAbilities(): boolean {
        return this.currentAbilityCount() < this.abilityLimits().maxAbilities;
    }

    /** Handle skill input change to update limits */
    toggleSkillDropdown(): void {
        this.closeDropdownOverlay();
        this.closeFormationDropdownOverlay();
        this.overlayManager.closeManagedOverlay('skill-dropdown');

        const trigger = this.skillTrigger();
        if (!trigger) return;

        const portal = new ComponentPortal(SkillDropdownPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            'skill-dropdown',
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                matchTriggerWidth: true,
                anchorActiveSelector: '.skill-option.active'
            }
        );

        componentRef.setInput('entries', this.skillEntries());
        componentRef.setInput('selectedSkill', this.currentSkill());
        componentRef.setInput('valueLabel', 'PV');
        componentRef.setInput('title', 'Skill');

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((skill: number) => {
                this.currentSkill.set(skill);
                this.enforceAbilityLimits();
                this.overlayManager.closeManagedOverlay('skill-dropdown');
            });
    }

    /** Remove abilities that exceed current skill limits */
    private enforceAbilityLimits(): void {
        const limits = this.abilityLimits();
        const abilities = [...this.selectedAbilities()];
        let changed = false;

        // Remove abilities beyond max count (from the end)
        const activeAbilities = abilities.filter(a => a !== null);
        if (activeAbilities.length > limits.maxAbilities) {
            let removed = 0;
            for (let i = abilities.length - 1; i >= 0 && removed < activeAbilities.length - limits.maxAbilities; i--) {
                if (abilities[i] !== null) {
                    abilities[i] = null;
                    removed++;
                    changed = true;
                }
            }
        }

        // Check if total cost exceeds limit and remove from end
        let totalCost = this.calculateTotalCost(abilities);
        while (totalCost > limits.maxCost) {
            for (let i = abilities.length - 1; i >= 0; i--) {
                if (abilities[i] !== null) {
                    abilities[i] = null;
                    changed = true;
                    break;
                }
            }
            totalCost = this.calculateTotalCost(abilities);
        }

        if (changed) {
            this.selectedAbilities.set(abilities);
        }
    }

    private calculateTotalCost(abilities: (AbilitySelection | null)[]): number {
        return abilities.reduce((sum, ability) => {
            if (!ability) return sum;
            if (this.isCustomAbility(ability)) {
                return sum + ability.cost;
            }
            const standardAbility = this.getAbilityById(ability);
            return sum + (standardAbility?.cost || 0);
        }, 0);
    }

    toggleDropdown(slot: number): void {
        if (this.openDropdown() === slot) {
            this.closeDropdownOverlay();
            return;
        }

        // Close any existing dropdown first
        this.closeFormationDropdownOverlay();
        this.closeDropdownOverlay();

        const trigger = this.getDropdownTrigger(slot);
        if (!trigger) return;

        // Get disabled ability IDs (standard abilities already selected in other slots)
        const disabledIds = this.selectedAbilities()
            .filter((ability, idx): ability is string => 
                ability !== null && typeof ability === 'string' && idx !== slot
            );

        const portal = new ComponentPortal(AbilityDropdownPanelComponent, null, this.injector);
        
        const { componentRef } = this.overlayManager.createManagedOverlay(
            'ability-dropdown',
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'ability-dropdown-overlay',
                matchTriggerWidth: true,
                anchorActiveSelector: '.dropdown-option:first-child'
            }
        );

        componentRef.setInput('abilities', this.availableAbilities());
        componentRef.setInput('disabledIds', disabledIds);
        componentRef.setInput('remainingCost', this.remainingCost());
        if (this.data.unitTypeCode) {
            componentRef.setInput('unitTypeCode', this.data.unitTypeCode);
        }

        // Handle standard ability selection - cleanup when dialog closes
        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((abilityId: string) => {
            this.selectAbility(slot, abilityId);
            this.closeDropdownOverlay();
        });

        // Handle custom ability request - cleanup when dialog closes
        outputToObservable(componentRef.instance.addCustom).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.closeDropdownOverlay();
            this.openCustomAbilityDialog(slot);
        });

        this.openDropdown.set(slot);
    }

    getFormationDropdownAbilities(effect: FormationEffectPreview): PilotAbility[] {
        return effect.descriptor.abilityIds
            .map((abilityId) => this.getFormationAbilityById(abilityId))
            .filter((ability): ability is PilotAbility => ability !== undefined);
    }

    getFormationEffectSlots(effect: FormationEffectPreview): (string | null)[] {
        const assignedAbilityIds = this.getFormationEffectAssignedAbilityIds(effect);

        switch (effect.descriptor.group.selection) {
            case 'choose-one':
                return [assignedAbilityIds[0] ?? null];
            case 'choose-each':
                return Array.from({ length: effect.maxPerUnit }, (_, index) => assignedAbilityIds[index] ?? null);
            case 'all':
                return Array.from({ length: Math.max(effect.descriptor.abilityIds.length, 1) }, (_, index) => assignedAbilityIds[index] ?? null);
            default:
                return assignedAbilityIds.length > 0 ? [...assignedAbilityIds] : [null];
        }
    }

    private canSelectFormationAbility(effect: FormationEffectPreview, slot: number, abilityId: string): boolean {
        const assignedAbilityIds = this.getFormationEffectAssignedAbilityIds(effect);
        const currentAbilityId = assignedAbilityIds[slot] ?? null;
        if (currentAbilityId === abilityId) {
            return true;
        }

        if (assignedAbilityIds.includes(abilityId)) {
            return false;
        }

        if (effect.descriptor.group.selection === 'all') {
            return this.canToggleFormationEffect(effect);
        }

        return this.canToggleFormationAbility(effect, abilityId);
    }

    getFormationDropdownDisabledIds(effect: FormationEffectPreview, slot: number): string[] {
        return effect.descriptor.abilityIds.filter((abilityId) => !this.canSelectFormationAbility(effect, slot, abilityId));
    }

    canOpenFormationAbilitySlot(effect: FormationEffectPreview, slot: number): boolean {
        if (this.isFormationEffectAutoAssigned(effect)) {
            return false;
        }

        return this.getFormationDropdownAbilities(effect)
            .some((ability) => this.canSelectFormationAbility(effect, slot, ability.id));
    }

    toggleFormationDropdown(effect: FormationEffectPreview, slot: number, triggerButton: HTMLButtonElement): void {
        const dropdownKey = `${effect.descriptor.key}:${slot}`;
        if (this.openFormationDropdownKey() === dropdownKey) {
            this.closeFormationDropdownOverlay();
            return;
        }

        this.closeDropdownOverlay();
        this.closeFormationDropdownOverlay();

        const abilities = this.getFormationDropdownAbilities(effect);
        if (abilities.length === 0) {
            return;
        }

        const portal = new ComponentPortal(AbilityDropdownPanelComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay(
            'formation-ability-dropdown',
            new ElementRef(triggerButton),
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'ability-dropdown-overlay',
                matchTriggerWidth: true,
                anchorActiveSelector: '.dropdown-option:first-child'
            }
        );

        componentRef.setInput('abilities', abilities);
        componentRef.setInput('disabledIds', this.getFormationDropdownDisabledIds(effect, slot));
        componentRef.setInput('remainingCost', Number.MAX_SAFE_INTEGER);
        componentRef.setInput('allowCustom', false);
        componentRef.setInput('showCost', false);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((abilityId: string) => {
                this.selectFormationAbility(effect, slot, abilityId);
                this.closeFormationDropdownOverlay();
            });

        this.openFormationDropdownKey.set(dropdownKey);
    }

    selectFormationAbility(effect: FormationEffectPreview, slot: number, abilityId: string): void {
        if (!this.canSelectFormationAbility(effect, slot, abilityId)) {
            return;
        }

        const nextAbilityIds = new Set(this.selectedFormationAbilities());

        switch (effect.descriptor.group.selection) {
            case 'all':
                effect.descriptor.abilityIds.forEach((effectAbilityId) => nextAbilityIds.add(effectAbilityId));
                break;
            case 'choose-one':
                effect.descriptor.abilityIds.forEach((effectAbilityId) => nextAbilityIds.delete(effectAbilityId));
                nextAbilityIds.add(abilityId);
                break;
            case 'choose-each': {
                const assignedAbilityIds = this.getFormationEffectAssignedAbilityIds(effect);
                const nextAssignedAbilityIds = [...assignedAbilityIds];
                nextAssignedAbilityIds[slot] = abilityId;
                effect.descriptor.abilityIds.forEach((effectAbilityId) => nextAbilityIds.delete(effectAbilityId));
                nextAssignedAbilityIds
                    .filter((selectedAbilityId): selectedAbilityId is string => !!selectedAbilityId)
                    .forEach((selectedAbilityId) => nextAbilityIds.add(selectedAbilityId));
                break;
            }
        }

        this.applyFormationAbilityOverride([...nextAbilityIds]);
    }

    removeFormationAbility(effect: FormationEffectPreview, slot: number): void {
        const nextAbilityIds = new Set(this.selectedFormationAbilities());

        if (effect.descriptor.group.selection === 'all' || effect.descriptor.group.selection === 'choose-one') {
            effect.descriptor.abilityIds.forEach((effectAbilityId) => nextAbilityIds.delete(effectAbilityId));
        } else {
            const abilityId = this.getFormationEffectAssignedAbilityIds(effect)[slot];
            if (!abilityId) {
                return;
            }
            nextAbilityIds.delete(abilityId);
        }

        this.applyFormationAbilityOverride([...nextAbilityIds]);
    }

    private openCustomAbilityDialog(slot: number, existingAbility?: ASCustomPilotAbility): void {
        const portal = new ComponentPortal(CustomAbilityDialogComponent, null, this.injector);
        
        const { componentRef } = this.overlayManager.createManagedOverlay(
            'custom-ability-dialog',
            null, // centered
            portal,
            {
                hasBackdrop: true,
                backdropClass: 'cdk-overlay-dark-backdrop',
                closeOnOutsideClick: true
            }
        );

        // Set initial ability if editing
        if (existingAbility) {
            componentRef.setInput('initialAbility', existingAbility);
        }

        // Handle submission - cleanup when dialog closes
        outputToObservable(componentRef.instance.submitted).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((customAbility: ASCustomPilotAbility) => {
            this.selectAbility(slot, customAbility);
            this.closeCustomAbilityOverlay();
        });

        // Handle cancellation - cleanup when dialog closes
        outputToObservable(componentRef.instance.cancelled).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.closeCustomAbilityOverlay();
        });
    }

    /** Opens the edit dialog for a custom ability in the specified slot */
    editCustomAbility(slot: number): void {
        const ability = this.selectedAbilities()[slot];
        if (this.isCustomAbility(ability)) {
            this.openCustomAbilityDialog(slot, ability);
        }
    }

    selectAbility(slot: number, ability: AbilitySelection | null): void {
        // For standard abilities, don't allow selecting an already selected one
        if (typeof ability === 'string' && this.isAbilitySelected(ability) && this.selectedAbilities()[slot] !== ability) {
            return;
        }

        const abilities = [...this.selectedAbilities()];
        abilities[slot] = ability;
        this.selectedAbilities.set(abilities);
    }

    removeAbility(slot: number): void {
        const abilities = [...this.selectedAbilities()];
        abilities[slot] = null;
        this.selectedAbilities.set(abilities);
    }

    isFormationEffectEligible(effect: FormationEffectPreview): boolean {
        return effect.candidateUnitIds.includes(this.data.unitId);
    }

    getFormationEffectAssignedAbilityIds(effect: FormationEffectPreview): string[] {
        return [...(effect.assignedByUnitId.get(this.data.unitId) ?? [])];
    }

    isFormationEffectAutoAssigned(effect: FormationEffectPreview): boolean {
        if (effect.descriptor.group.selection !== 'all') {
            return false;
        }

        switch (effect.descriptor.group.distribution) {
            case 'all':
            case 'conditional':
            case 'remainder':
            case 'role-filtered':
            case 'commander':
                return true;
            default:
                return false;
        }
    }

    canToggleFormationEffect(effect: FormationEffectPreview): boolean {
        const assignedAbilityIds = this.getFormationEffectAssignedAbilityIds(effect);
        if (assignedAbilityIds.length > 0) {
            return true;
        }

        if (!this.isFormationEffectEligible(effect)) {
            return false;
        }

        return effect.recipientLimit == null || effect.recipientUnitIds.length < effect.recipientLimit;
    }

    canToggleFormationAbility(effect: FormationEffectPreview, abilityId: string): boolean {
        if (!this.isFormationEffectEligible(effect)) {
            return false;
        }

        const assignedAbilityIds = this.getFormationEffectAssignedAbilityIds(effect);
        if (assignedAbilityIds.includes(abilityId)) {
            return true;
        }

        if (effect.descriptor.group.selection === 'choose-one') {
            const otherRecipients = effect.recipientUnitIds.some((unitId) => unitId !== this.data.unitId);
            if (otherRecipients && effect.lockedAbilityId && effect.lockedAbilityId !== abilityId) {
                return false;
            }
        }

        if (assignedAbilityIds.length >= effect.maxPerUnit) {
            return false;
        }

        if (effect.recipientLimit != null && effect.recipientUnitIds.length >= effect.recipientLimit && assignedAbilityIds.length === 0) {
            return false;
        }

        if (effect.descriptor.group.distribution === 'fixed-pairs') {
            const assignedCount = effect.recipientUnitIds.filter((unitId) =>
                (effect.assignedByUnitId.get(unitId) ?? []).includes(abilityId)
            ).length;
            if (assignedCount >= 2) {
                return false;
            }

            const distinctAbilityIds = new Set(
                effect.recipientUnitIds.flatMap((unitId) => effect.assignedByUnitId.get(unitId) ?? [])
            );
            if (!distinctAbilityIds.has(abilityId) && distinctAbilityIds.size >= (effect.descriptor.group.count ?? 0)) {
                return false;
            }
        }

        return true;
    }

    getFormationSelectionLabel(effect: FormationEffectPreview): string {
        switch (effect.descriptor.group.selection) {
            case 'choose-one':
                return 'Choose one ability for each recipient set';
            case 'choose-each':
                return effect.maxPerUnit > 1
                    ? `Choose up to ${effect.maxPerUnit} abilities per recipient`
                    : 'Each recipient chooses individually';
            case 'all':
                return 'Assign all listed abilities together';
            default:
                return effect.descriptor.group.selection;
        }
    }

    getFormationDistributionLabel(effect: FormationEffectPreview): string {
        switch (effect.descriptor.group.distribution) {
            case 'all':
                return 'All eligible units';
            case 'half-round-down':
                return `Up to half (${effect.recipientLimit ?? 0})`;
            case 'half-round-up':
                return `Up to half (${effect.recipientLimit ?? 0})`;
            case 'percent-75':
                return `75% of eligible units (${effect.recipientLimit ?? 0})`;
            case 'up-to-50-percent':
                return `Up to 50% (${effect.recipientLimit ?? 0})`;
            case 'fixed':
                return `Up to ${effect.descriptor.group.count ?? 0} units`;
            case 'fixed-pairs':
                return `${effect.descriptor.group.count ?? 0} pairs`;
            case 'conditional':
                return effect.descriptor.group.condition ?? 'Conditional';
            case 'remainder':
                return 'Remaining eligible units';
            case 'role-filtered':
                return `${effect.descriptor.group.roleFilter ?? 'Matching'} role units`;
            case 'commander':
                return 'Commander only';
            default:
                return effect.descriptor.group.distribution;
        }
    }

    getFormationEffectSummary(effect: FormationEffectPreview): string {
        return `${this.getFormationSelectionLabel(effect)}. ${this.getFormationDistributionLabel(effect)}.`;
    }

    getFormationEffectUnavailableText(effect: FormationEffectPreview): string {
        const preview = this.formationPreview();
        if (preview && !preview.eligibleUnitIds.includes(this.data.unitId)) {
            return preview.requirementsFilterNotice
                ?? 'This unit is excluded from formation bonus eligibility by the group structure.';
        }

        if (effect.descriptor.group.excludeCommander && this.selectedFormationCommander()) {
            return 'Commander units cannot receive this formation bonus.';
        }

        switch (effect.descriptor.group.distribution) {
            case 'commander':
                return 'Only the selected commander can receive this formation bonus.';
            case 'role-filtered':
                return `Only ${effect.descriptor.group.roleFilter ?? 'matching'} role units can receive this formation bonus.`;
            case 'conditional':
                return effect.descriptor.group.condition ?? 'This unit does not satisfy the formation bonus condition.';
            case 'remainder':
                return 'Only units not already assigned an earlier formation bonus in this sequence can receive this effect.';
            default:
                return 'This unit is not eligible for this formation bonus.';
        }
    }

    getUnsupportedFormationEffectNotice(effect: UnsupportedFormationEffectDescriptor): string {
        if (effect.reason === 'shared-pool') {
            return `${effect.sourceFormationName}: shared-pool SPAs are tracked at the formation level and are not assigned per unit here.`;
        }

        if (effect.reason === 'auto-command-ability') {
            const names = (effect.group.commandAbilityIds ?? [])
                .map((commandAbilityId) => COMMAND_ABILITIES.find((ability) => ability.id === commandAbilityId)?.name ?? commandAbilityId)
                .join(' • ');
            return `${effect.sourceFormationName}: ${names} is automatically granted to the full formation and does not require per-unit assignment.`;
        }

        return `${effect.sourceFormationName}: command abilities are formation-level effects and are not edited in Warrior Data.`;
    }

    async setFormationCommanderSelected(value: boolean): Promise<void> {
        if (value && !this.selectedFormationCommander()) {
            const otherCommanderName = this.persistedOtherCommanderName();
            if (otherCommanderName) {
                const confirmed = await this.dialogsService.requestConfirmation(
                    `${otherCommanderName} is currently marked as the group commander. Making this unit the commander will remove that flag from ${otherCommanderName} and may also remove commander-only formation abilities from that unit. Continue?`,
                    'Replace Group Commander',
                    'warning',
                );
                if (!confirmed) {
                    this.selectedFormationCommander.set(false);
                    return;
                }
            }
        }

        this.selectedFormationCommander.set(value);
        this.normalizeFormationSelectionState();
    }

    async confirmResetFormationAssignments(): Promise<void> {
        if (!this.data.group || !this.hasResettableFormationAssignments()) {
            return;
        }

        this.closeDropdownOverlay();
        this.closeFormationDropdownOverlay();
        this.closeCustomAbilityOverlay();
        this.overlayManager.closeManagedOverlay('skill-dropdown');

        const confirmed = await this.dialogsService.requestConfirmation(
            'This will clear all stored formation ability assignments for every unit in this group. Automatic formation bonuses will be recalculated immediately and may still appear afterward. Continue?',
            'Reset Formation Assignments',
            'warning',
        );

        if (!confirmed) {
            return;
        }

        const overrides = new Map<string, string[]>();
        for (const unit of this.data.group.units()) {
            overrides.set(unit.id, []);
        }

        this.formationAbilityOverrides.set(overrides);
        this.selectedFormationAbilities.set([]);
        this.normalizeFormationSelectionState();
    }

    private applyFormationAbilityOverride(abilityIds: string[]): void {
        if (!this.data.group) {
            this.selectedFormationAbilities.set([...new Set(abilityIds)]);
            return;
        }

        const nextAbilityIds = [...new Set(abilityIds)];
        const preview = FormationAbilityAssignmentUtil.previewGroupFormationAssignments(this.data.group, {
            abilityOverrides: this.buildFormationAbilityOverrides(nextAbilityIds),
            commanderUnitId: this.effectiveCommanderUnitId(),
        });
        this.selectedFormationAbilities.set(nextAbilityIds);
        this.selectedFormationCommander.set(preview.commanderUnitId === this.data.unitId);
    }

    private normalizeFormationSelectionState(): void {
        const preview = this.formationPreview();
        if (!preview) {
            return;
        }

        const isCommander = preview.commanderUnitId === this.data.unitId;
        if (this.selectedFormationCommander() !== isCommander) {
            this.selectedFormationCommander.set(isCommander);
        }
    }

    submit() {
        const name = this.nameInput().nativeElement.value.trim();
        const skill = this.currentSkill();
        const abilities = this.selectedAbilities().filter((a): a is AbilitySelection => a !== null);
        const preview = this.formationPreview();
        this.dialogRef.close({
            name,
            skill,
            abilities,
            formationAbilities: [...(preview?.assignmentsByUnitId.get(this.data.unitId) ?? this.selectedFormationAbilities())],
            formationAbilityOverrides: this.snapshotFormationAbilityOverrides(),
            commander: preview?.commanderUnitId === this.data.unitId || this.selectedFormationCommander(),
        });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}
