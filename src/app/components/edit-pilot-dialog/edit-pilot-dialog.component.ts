// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, Injector, signal, viewChildren, type WritableSignal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogsService } from '../../services/dialogs.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { SkillDropdownPanelComponent, type SkillPreviewEntry } from '../skill-dropdown-panel/skill-dropdown-panel.component';
import { SkillMatrixPanelComponent, type SkillMatrixCell } from '../skill-dropdown-panel/skill-matrix-panel.component';
import { adjustCBTBattleValueForSkills, type CBTSkillUnitFacts } from '../../models/entity/utils/battle-value/rules';
import type { Era } from '../../models/eras.model';
import type { CrewPositionId } from '../../models/entity/entity-identifiers';
import { PilotNameGeneratorService } from '../../services/pilot-name-generator.service';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { PilotNotesFieldComponent } from '../pilot-notes-field/pilot-notes-field.component';
import { PilotPortraitFieldComponent } from '../pilot-portrait-field/pilot-portrait-field.component';
import type { CrewEditAction, CrewEditActions } from '../force-crew/crew-edit-actions';



export interface EditPilotDialogData {
    /** Generator previews have no persistent person to receive these notes. */
    editNotes?: boolean;
    /** Enabled for persistent personnel, including reserves and assigned crew. */
    editPortrait?: boolean;
    personnelActions?: CrewEditActions;
    unitId?: string;
    crew: readonly EditPilotCrewPosition[];
    /** Skills that affect BV but are not editable here, such as LAM aerospace skills. */
    additionalGunnerySkills?: readonly number[];
    additionalPilotingSkills?: readonly number[];
    labelGunnery?: string;
    labelPiloting?: string;
    disablePiloting?: boolean;
    /** Entity-derived override; the editable value remains this person's own rating. */
    fixedPiloting?: number;
    commander?: boolean;
    /** Detached commander context; no force/group/runtime object enters the dialog. */
    commanderContext?: {
        readonly conflictingCommanderDisplayName?: string;
    };
    factionId?: number | null;
    isAerospace?: boolean;
    era?: Era | null;
    /** Pre-skill BV (base + TAG + C3) for BV preview calculation. */
    preSkillBv?: number;
    /** Detached unit facts for effective piloting and BV calculations. */
    skillFacts?: CBTSkillUnitFacts;
}

export interface EditPilotResult {
    action?: CrewEditAction;
    crew: EditPilotCrewPosition[];
    commander: boolean;
}

/** Detached dialog DTO; the dialog never receives a CrewMember instance. */
export interface EditPilotCrewPosition {
    readonly id: CrewPositionId | number;
    readonly name: string;
    readonly notes?: string;
    readonly portrait?: string;
    readonly gunnery: number;
    readonly piloting: number;
    readonly asfGunnery?: number;
    readonly asfPiloting?: number;
}

type CrewSkillType = 'gunnery' | 'piloting';
type CrewSkillField = CrewSkillType | 'asfGunnery' | 'asfPiloting';

interface EditableCrewMember {
    readonly id: CrewPositionId | number;
    readonly asfGunnery?: WritableSignal<number>;
    readonly asfPiloting?: WritableSignal<number>;
    readonly name: WritableSignal<string>;
    readonly notes: WritableSignal<string>;
    readonly portrait: WritableSignal<string | undefined>;
    readonly gunnery: WritableSignal<number>;
    readonly piloting: WritableSignal<number>;
    readonly generatingName: WritableSignal<boolean>;
}

const CREW_NAME_LABELS = ['Pilot Name', 'Gunner Name', 'Officer Name'] as const;
const SKILL_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

export function getSyntheticCrewSkill(
    crew: readonly EditPilotCrewPosition[],
    skillType: CrewSkillType,
    additionalSkills: readonly number[] = [],
): number {
    const asfSkill = skillType === 'gunnery' ? 'asfGunnery' : 'asfPiloting';
    const skills = [
        ...crew.flatMap((member) => [member[skillType], member[asfSkill]].filter((skill): skill is number => skill !== undefined)),
        ...additionalSkills,
    ];
    return skills.length > 0
        ? Math.min(...skills)
        : skillType === 'gunnery' ? 4 : 5;
}

export function buildCrewSkillPreviewEntries(
    crew: readonly EditPilotCrewPosition[],
    crewIndex: number,
    skillField: CrewSkillField,
    calculateBv: (gunnery: number, piloting: number) => number,
    additionalGunnerySkills: readonly number[] = [],
    additionalPilotingSkills: readonly number[] = [],
): SkillPreviewEntry[] {
    const skillType: CrewSkillType = skillField === 'gunnery' || skillField === 'asfGunnery'
        ? 'gunnery'
        : 'piloting';
    const defaultSkill = skillType === 'gunnery' ? 4 : 5;
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
    imports: [NgTemplateOutlet, PilotNotesFieldComponent, PilotPortraitFieldComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass',
        '[class.phone-layout]': 'layoutService.isPhone()',
    },
    templateUrl: './edit-pilot-dialog.component.html',
    styleUrl: './edit-pilot-dialog.component.scss'
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
    readonly layoutService = inject(LayoutService);
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
        notes: signal(member.notes ?? ''),
        portrait: signal(member.portrait),
        gunnery: signal(member.gunnery),
        piloting: signal(member.piloting),
        generatingName: signal(false),
    }));
    selectedGroupCommander = signal<boolean>(this.data.commander ?? false);

    readonly hasBvPreview = this.data.preSkillBv != null && this.data.skillFacts != null;
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
        this.closeSkillDropdowns();
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
        componentRef.setInput('showBv', this.hasBvPreview);
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

    async setGroupCommanderSelected(value: boolean): Promise<void> {
        const requestId = ++this.commanderSelectionRequestId;
        if (value && !this.selectedGroupCommander()) {
            const otherCommanderName = this.data.commanderContext?.conflictingCommanderDisplayName;
            if (otherCommanderName) {
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
        this.overlayManager.closeManagedOverlay('skill-matrix');

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
        componentRef.setInput('showPreview', this.hasBvPreview);
        if (title) componentRef.setInput('title', title);

        outputToObservable(componentRef.instance.selected)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((skill: number) => {
                onSelect(skill);
                this.overlayManager.closeManagedOverlay(key);
            });
    }

    private skillOverlayKey(skillType: CrewSkillField, crewId: CrewPositionId | number): string {
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

    private crewSnapshot(): EditPilotCrewPosition[] {
        return this.crew.map((member) => ({
            id: member.id,
            name: member.name(),
            ...(member.notes() ? { notes: member.notes() } : {}),
            ...(member.portrait() ? { portrait: member.portrait() } : {}),
            gunnery: member.gunnery(),
            piloting: member.piloting(),
            ...(member.asfGunnery === undefined ? {} : { asfGunnery: member.asfGunnery() }),
            ...(member.asfPiloting === undefined ? {} : { asfPiloting: member.asfPiloting() }),
        }));
    }

    private calculateBv(gunnery: number, piloting: number): number {
        if (!this.hasBvPreview) return 0;
        return adjustCBTBattleValueForSkills(
            this.data.preSkillBv!,
            gunnery,
            piloting,
            this.data.skillFacts!,
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
                factionId: this.data.factionId,
                isAerospace: !!this.data.isAerospace,
                isCommander: this.selectedGroupCommander(),
                unitType: this.data.skillFacts?.unitType,
                unitSubtype: this.data.skillFacts?.unitSubtype,
                era: this.data.era?.years,
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

    async submit(action?: CrewEditAction): Promise<void> {
        if (action) {
            const confirmed = await this.dialogsService.requestConfirmation(
                action === 'delete'
                    ? 'Delete this crew member from the force? This cannot be undone.'
                    : 'Unassign this crew member and move them to reserves?',
                action === 'delete' ? 'Delete Crew Member' : 'Unassign Crew Member',
                action === 'delete' ? 'danger' : 'info',
            );
            if (!confirmed || this.destroyRef.destroyed) return;
        }
        this.dialogRef.close({
            ...(action ? { action } : {}),
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
