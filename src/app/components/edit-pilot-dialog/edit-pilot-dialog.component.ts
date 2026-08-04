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


import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, Injector, signal, viewChild, viewChildren, type WritableSignal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { UnitGroup } from '../../models/force.model';
import { DialogsService } from '../../services/dialogs.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { SkillDropdownPanelComponent, type SkillPreviewEntry } from '../skill-dropdown-panel/skill-dropdown-panel.component';
import { SkillMatrixPanelComponent, type SkillMatrixCell } from '../skill-dropdown-panel/skill-matrix-panel.component';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import type { Unit } from '../../models/units.model';
import type { Era } from '../../models/eras.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL, type CrewMemberDetails, type SkillType } from '../../models/crew-member.model';
import { PilotNameGeneratorService } from '../../services/pilot-name-generator.service';
import { LoggerService } from '../../services/logger.service';

/*
 * Author: Drake
 */

export interface EditPilotDialogData {
    unitId?: string;
    crew: readonly CrewMemberDetails[];
    /** Skills that affect BV but are not editable here, such as LAM aerospace skills. */
    additionalGunnerySkills?: readonly number[];
    additionalPilotingSkills?: readonly number[];
    labelGunnery?: string;
    labelPiloting?: string;
    disablePiloting?: boolean;
    commander?: boolean;
    group?: UnitGroup<CBTForceUnit> | null;
    factionId?: number | null;
    isAerospace?: boolean;
    era?: Era | null;
    /** Pre-skill BV (base + TAG + C3) for BV preview calculation. */
    preSkillBv?: number;
    /** Unit reference for effective piloting skill calculation. */
    unit?: Unit;
}

export interface EditPilotResult {
    crew: CrewMemberDetails[];
    commander: boolean;
}

type CrewSkillField = SkillType | 'asfGunnery' | 'asfPiloting';

interface EditableCrewMember {
    readonly id: number;
    readonly asfGunnery?: WritableSignal<number>;
    readonly asfPiloting?: WritableSignal<number>;
    readonly name: WritableSignal<string>;
    readonly gunnery: WritableSignal<number>;
    readonly piloting: WritableSignal<number>;
    readonly generatingName: WritableSignal<boolean>;
}

const CREW_NAME_LABELS = ['Pilot Name', 'Gunner Name', 'Officer Name'] as const;
const SKILL_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

export function getSyntheticCrewSkill(
    crew: readonly CrewMemberDetails[],
    skillType: SkillType,
    additionalSkills: readonly number[] = [],
): number {
    const asfSkill = skillType === 'gunnery' ? 'asfGunnery' : 'asfPiloting';
    const skills = [
        ...crew.flatMap((member) => [member[skillType], member[asfSkill]].filter((skill): skill is number => skill !== undefined)),
        ...additionalSkills,
    ];
    return skills.length > 0
        ? Math.min(...skills)
        : skillType === 'gunnery' ? DEFAULT_GUNNERY_SKILL : DEFAULT_PILOTING_SKILL;
}

export function buildCrewSkillPreviewEntries(
    crew: readonly CrewMemberDetails[],
    crewIndex: number,
    skillField: CrewSkillField,
    calculateBv: (gunnery: number, piloting: number) => number,
    additionalGunnerySkills: readonly number[] = [],
    additionalPilotingSkills: readonly number[] = [],
): SkillPreviewEntry[] {
    const skillType: SkillType = skillField === 'gunnery' || skillField === 'asfGunnery'
        ? 'gunnery'
        : 'piloting';
    const defaultSkill = skillType === 'gunnery' ? DEFAULT_GUNNERY_SKILL : DEFAULT_PILOTING_SKILL;
    const calculateCandidate = (value: number): number => {
        const candidateCrew = crew.map((member, index) => index === crewIndex
            ? { ...member, [skillField]: value }
            : member);
        return calculateBv(
            getSyntheticCrewSkill(candidateCrew, 'gunnery', additionalGunnerySkills),
            getSyntheticCrewSkill(candidateCrew, 'piloting', additionalPilotingSkills),
        );
    };
    const baseValue = calculateCandidate(defaultSkill);
    return SKILL_VALUES.map((skill) => {
        const adjustedValue = calculateCandidate(skill);
        return { skill, adjustedValue, delta: adjustedValue - baseValue };
    });
}

@Component({
    selector: 'edit-pilot-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './edit-pilot-dialog.component.html',
    styleUrls: ['./edit-pilot-dialog.component.scss']
})
export class EditPilotDialogComponent {
    private commanderSelectionRequestId = 0;
    nameInputs = viewChildren<ElementRef<HTMLInputElement>>('nameInput');
    gunneryTriggers = viewChildren<ElementRef<HTMLDivElement>>('gunneryTrigger');
    pilotingTriggers = viewChildren<ElementRef<HTMLDivElement>>('pilotingTrigger');
    asfGunneryTriggers = viewChildren<ElementRef<HTMLDivElement>>('asfGunneryTrigger');
    asfPilotingTriggers = viewChildren<ElementRef<HTMLDivElement>>('asfPilotingTrigger');

    public dialogRef = inject(DialogRef<EditPilotResult | null, EditPilotDialogComponent>);
    readonly data: EditPilotDialogData = inject(DIALOG_DATA) as EditPilotDialogData;
    private overlayManager = inject(OverlayManagerService);
    private dialogsService = inject(DialogsService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);
    private pilotNameGenerator = inject(PilotNameGeneratorService);
    private logger = inject(LoggerService);

    readonly crew = this.data.crew.map<EditableCrewMember>((member) => ({
        id: member.id,
        asfGunnery: member.asfGunnery === undefined ? undefined : signal(member.asfGunnery),
        asfPiloting: member.asfPiloting === undefined ? undefined : signal(member.asfPiloting),
        name: signal(member.name),
        gunnery: signal(member.gunnery),
        piloting: signal(member.piloting),
        generatingName: signal(false),
    }));
    selectedGroupCommander = signal<boolean>(this.data.commander ?? false);

    readonly hasBvPreview = !!(this.data.preSkillBv != null && this.data.unit);
    readonly syntheticGunnery = computed(() => getSyntheticCrewSkill(
        this.crewSnapshot(),
        'gunnery',
        this.data.additionalGunnerySkills,
    ));
    readonly syntheticPiloting = computed(() => getSyntheticCrewSkill(
        this.crewSnapshot(),
        'piloting',
        this.data.additionalPilotingSkills,
    ));
    readonly persistedOtherCommander = computed<CBTForceUnit | null>(() => {
        const group = this.data.group;
        const unitId = this.data.unitId;
        if (!group || !unitId) {
            return null;
        }

        return group.units().find((unit) => unit.id !== unitId && unit.commander()) ?? null;
    });

    /** 9x9 BV matrix: matrix[gunnery][piloting] = adjusted BV */
    bvMatrix = computed<number[][]>(() => {
        if (!this.hasBvPreview) return [];
        return SKILL_VALUES.map(gunnery =>
            SKILL_VALUES.map(piloting => this.calculateBv(
                Math.min(gunnery, ...(this.data.additionalGunnerySkills ?? [])),
                Math.min(piloting, ...(this.data.additionalPilotingSkills ?? [])),
            ))
        );
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.closeSkillDropdowns();
            this.overlayManager.closeManagedOverlay('skill-matrix');
        });
    }

    crewNameLabel(index: number): string {
        if (this.crew.length === 1) return 'Name';
        return CREW_NAME_LABELS[index] ?? `Crew Member ${index + 1} Name`;
    }

    toggleGunneryDropdown(index: number): void {
        const member = this.crew[index];
        this.openSkillDropdown(
            this.skillOverlayKey('gunnery', member.id),
            this.gunneryTriggers()[index],
            member.gunnery(),
            this.buildEntries(index, 'gunnery'),
            (skill) => member.gunnery.set(skill),
            this.data.labelGunnery || 'Gunnery Skill'
        );
    }

    togglePilotingDropdown(index: number): void {
        if (this.data.disablePiloting) return;
        const member = this.crew[index];
        this.openSkillDropdown(
            this.skillOverlayKey('piloting', member.id),
            this.pilotingTriggers()[index],
            member.piloting(),
            this.buildEntries(index, 'piloting'),
            (skill) => member.piloting.set(skill),
            this.data.labelPiloting || 'Piloting Skill'
        );
    }

    toggleAsfGunneryDropdown(index: number): void {
        const member = this.crew[index];
        if (!member.asfGunnery) return;
        this.openSkillDropdown(
            this.skillOverlayKey('asfGunnery', member.id),
            this.asfGunneryTriggers()[index],
            member.asfGunnery(),
            this.buildEntries(index, 'asfGunnery'),
            (skill) => member.asfGunnery!.set(skill),
            'Aerospace Gunnery Skill',
        );
    }

    toggleAsfPilotingDropdown(index: number): void {
        const member = this.crew[index];
        if (!member.asfPiloting) return;
        this.openSkillDropdown(
            this.skillOverlayKey('asfPiloting', member.id),
            this.asfPilotingTriggers()[index],
            member.asfPiloting(),
            this.buildEntries(index, 'asfPiloting'),
            (skill) => member.asfPiloting!.set(skill),
            'Aerospace Piloting Skill',
        );
    }

    toggleMatrixView(): void {
        this.overlayManager.closeManagedOverlay('skill-matrix');

        const portal = new ComponentPortal(SkillMatrixPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            'skill-matrix',
            null,
            portal,
            {
                closeOnOutsideClick: true
            }
        );

        componentRef.setInput('matrix', this.bvMatrix());
        componentRef.setInput('selectedGunnery', this.syntheticGunnery());
        componentRef.setInput('selectedPiloting', this.syntheticPiloting());

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((cell: SkillMatrixCell) => {
                this.setAllCrewSkills(cell);
                this.overlayManager.closeManagedOverlay('skill-matrix');
            });
    }

    setAllCrewSkills(cell: SkillMatrixCell): void {
        for (const member of this.crew) {
            member.gunnery.set(cell.gunnery);
            member.asfGunnery?.set(cell.gunnery);
            if (!this.data.disablePiloting) member.piloting.set(cell.piloting);
            if (!this.data.disablePiloting) member.asfPiloting?.set(cell.piloting);
        }
    }

    private formatCommanderDisplayName(unit: CBTForceUnit): string {
        const pilotName = unit.alias()?.trim();
        const unitName = unit.getDisplayName();
        if (pilotName) {
            return `${unitName} (${pilotName})`;
        }
        return unitName;
    }

    async setGroupCommanderSelected(value: boolean): Promise<void> {
        const requestId = ++this.commanderSelectionRequestId;
        if (value && !this.selectedGroupCommander()) {
            const otherCommander = this.persistedOtherCommander();
            if (otherCommander) {
                const otherCommanderName = this.formatCommanderDisplayName(otherCommander);
                const confirmed = await this.dialogsService.requestConfirmation(
                    `${otherCommanderName} is currently marked as the group commander. Making this unit the commander will remove that flag from ${otherCommanderName}. Continue?`,
                    'Replace Group Commander',
                    'warning',
                );
                if (requestId !== this.commanderSelectionRequestId) return;
                if (!confirmed) {
                    this.selectedGroupCommander.set(false);
                    return;
                }
            }
        }

        this.selectedGroupCommander.set(value);
    }

    private openSkillDropdown(
        key: string,
        trigger: ElementRef<HTMLElement>,
        currentSkill: number,
        entries: SkillPreviewEntry[],
        onSelect: (skill: number) => void,
        title?: string
    ): void {
        this.closeSkillDropdowns();

        const portal = new ComponentPortal(SkillDropdownPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay(
            key,
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                matchTriggerWidth: true,
                anchorActiveSelector: '.skill-option.active'
            }
        );

        componentRef.setInput('entries', entries);
        componentRef.setInput('selectedSkill', currentSkill);
        componentRef.setInput('valueLabel', 'BV');
        if (title) componentRef.setInput('title', title);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((skill: number) => {
                onSelect(skill);
                this.overlayManager.closeManagedOverlay(key);
            });
    }

    private skillOverlayKey(skillType: CrewSkillField, crewId: number): string {
        return `skill-${skillType}-dropdown-${crewId}`;
    }

    private closeSkillDropdowns(): void {
        for (const member of this.crew) {
            this.overlayManager.closeManagedOverlay(this.skillOverlayKey('gunnery', member.id));
            this.overlayManager.closeManagedOverlay(this.skillOverlayKey('piloting', member.id));
            this.overlayManager.closeManagedOverlay(this.skillOverlayKey('asfGunnery', member.id));
            this.overlayManager.closeManagedOverlay(this.skillOverlayKey('asfPiloting', member.id));
        }
    }

    private crewSnapshot(): CrewMemberDetails[] {
        return this.crew.map((member) => ({
            id: member.id,
            name: member.name(),
            gunnery: member.gunnery(),
            piloting: member.piloting(),
            ...(member.asfGunnery === undefined ? {} : { asfGunnery: member.asfGunnery() }),
            ...(member.asfPiloting === undefined ? {} : { asfPiloting: member.asfPiloting() }),
        }));
    }

    private calculateBv(gunnery: number, piloting: number): number {
        if (!this.hasBvPreview) return 0;
        return BVCalculatorUtil.calculateAdjustedBV(
            this.data.unit!,
            this.data.preSkillBv!,
            gunnery,
            piloting
        );
    }

    private buildEntries(index: number, skillType: CrewSkillField): SkillPreviewEntry[] {
        if (!this.hasBvPreview) {
            return SKILL_VALUES.map(skill => ({ skill, adjustedValue: 0, delta: 0 }));
        }
        return buildCrewSkillPreviewEntries(
            this.crewSnapshot(),
            index,
            skillType,
            (gunnery, piloting) => this.calculateBv(gunnery, piloting),
            this.data.additionalGunnerySkills,
            this.data.additionalPilotingSkills,
        );
    }

    async fillRandomName(index: number): Promise<void> {
        const member = this.crew[index];
        if (member.generatingName()) return;
        member.generatingName.set(true);
        try {
            const name = await this.pilotNameGenerator.generate({
                factionId: this.data.factionId ?? this.data.group?.force.faction()?.id,
                isAerospace: !!this.data.isAerospace,
                isCommander: this.selectedGroupCommander(),
                unitType: this.data.unit?.type,
                unitSubtype: this.data.unit?.subtype,
                era: this.data.era?.years ?? this.data.group?.force.era()?.years,
            });
            if (!name) {
                this.logger.warn('Pilot name generation returned no name.');
                return;
            }
            const input = this.nameInputs()[index].nativeElement;
            member.name.set(name.slice(0, input.maxLength));
            input.value = member.name();
            input.focus();
            input.select();
        } catch (error) {
            this.logger.warn(`Pilot name generation failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            member.generatingName.set(false);
        }
    }

    clearName(index: number): void {
        const input = this.nameInputs()[index].nativeElement;
        input.value = '';
        this.crew[index].name.set('');
        input.focus();
    }

    onNameInput(index: number, event: Event): void {
        this.crew[index].name.set((event.target as HTMLInputElement).value);
    }

    submit(): void {
        this.dialogRef.close({
            crew: this.crewSnapshot().map((member, index) => ({
                ...member,
                name: member.name.trim(),
                piloting: this.data.disablePiloting ? this.data.crew[index].piloting : member.piloting,
            })),
            commander: this.selectedGroupCommander(),
        });
    }

    close(value: null = null): void {
        this.dialogRef.close(value);
    }
}