// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  Injector,
  signal,
  viewChildren,
  type WritableSignal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogsService } from '../../services/dialogs.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import {
  SkillDropdownPanelComponent,
  type SkillPreviewEntry,
} from '../skill-dropdown-panel/skill-dropdown-panel.component';
import { SkillMatrixPanelComponent, type SkillMatrixCell } from '../skill-dropdown-panel/skill-matrix-panel.component';
import { adjustCBTBattleValueForSkills, type CBTSkillUnitFacts } from '../../models/entity/utils/battle-value/rules';
import type { Era } from '../../models/eras.model';
import type { CrewPositionId } from '../../models/entity/entity-identifiers';
import { PilotNameCatalogService } from '../../services/catalogs/pilot-name-catalog.service';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { PilotNotesFieldComponent } from '../pilot-notes-field/pilot-notes-field.component';
import { PilotPortraitFieldComponent } from '../pilot-portrait-field/pilot-portrait-field.component';
import type { CrewEditAction, CrewEditActions } from '../force-crew/crew-edit-actions';
import { MAX_CREW_WOUNDS } from '../../models/crew-member.model';
import type { CrewSkillSet } from '../../models/unit-crew-policy';

export interface EditPilotDialogData {
  /** Omitted for detached generator previews whose primary pair is already unit-specific. */
  skillSet?: CrewSkillSet;
  editWounds?: boolean;
  unitTracksWounds?: boolean;
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
  readonly wounds?: number;
  readonly gunnery: number;
  readonly piloting: number;
  readonly aeroGunnery?: number;
  readonly aeroPiloting?: number;
}

type CrewSkillType = 'gunnery' | 'piloting';
type CrewSkillField = CrewSkillType | 'aeroGunnery' | 'aeroPiloting';

interface EditableCrewMember {
  readonly id: CrewPositionId | number;
  readonly aeroGunnery?: WritableSignal<number>;
  readonly aeroPiloting?: WritableSignal<number>;
  readonly name: WritableSignal<string>;
  readonly notes: WritableSignal<string>;
  readonly portrait: WritableSignal<string | undefined>;
  readonly wounds: WritableSignal<number>;
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
  skillSet: CrewSkillSet = 'both',
): number {
  const aeroSkill = skillType === 'gunnery' ? 'aeroGunnery' : 'aeroPiloting';
  const skills = [
    ...crew.flatMap((member) =>
      (skillSet === 'ground'
        ? [member[skillType]]
        : skillSet === 'aerospace'
          ? [member[aeroSkill]]
          : [member[skillType], member[aeroSkill]]
      ).filter((skill): skill is number => skill !== undefined),
    ),
    ...additionalSkills,
  ];
  return skills.length > 0 ? Math.min(...skills) : skillType === 'gunnery' ? 4 : 5;
}

export function buildCrewSkillPreviewEntries(
  crew: readonly EditPilotCrewPosition[],
  crewIndex: number,
  skillField: CrewSkillField,
  calculateBv: (gunnery: number, piloting: number) => number,
  additionalGunnerySkills: readonly number[] = [],
  additionalPilotingSkills: readonly number[] = [],
  skillSet: CrewSkillSet = 'both',
): SkillPreviewEntry[] {
  const skillType: CrewSkillType = skillField === 'gunnery' || skillField === 'aeroGunnery' ? 'gunnery' : 'piloting';
  const defaultSkill = skillType === 'gunnery' ? 4 : 5;
  const calculateCandidate = (value: number): number => {
    const candidateCrew = crew.map((member, index) =>
      index === crewIndex ? { ...member, [skillField]: value } : member,
    );
    return calculateBv(
      getSyntheticCrewSkill(candidateCrew, 'gunnery', additionalGunnerySkills, skillSet),
      getSyntheticCrewSkill(candidateCrew, 'piloting', additionalPilotingSkills, skillSet),
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
  styleUrl: './edit-pilot-dialog.component.scss',
})
export class EditPilotDialogComponent {
  private commanderSelectionRequestId = 0;
  nameInputs = viewChildren<ElementRef<HTMLInputElement>>('nameInput');
  gunneryTriggers = viewChildren<ElementRef<HTMLDivElement>>('gunneryTrigger');
  pilotingTriggers = viewChildren<ElementRef<HTMLDivElement>>('pilotingTrigger');
  aeroGunneryTriggers = viewChildren<ElementRef<HTMLDivElement>>('aeroGunneryTrigger');
  aeroPilotingTriggers = viewChildren<ElementRef<HTMLDivElement>>('aeroPilotingTrigger');

  public dialogRef = inject(DialogRef<EditPilotResult | null, EditPilotDialogComponent>);
  readonly data: EditPilotDialogData = inject(DIALOG_DATA) as EditPilotDialogData;
  readonly showGroundSkills = this.data.skillSet !== 'aerospace';
  readonly showAerospaceSkills = this.data.skillSet !== 'ground';
  readonly layoutService = inject(LayoutService);
  private overlayManager = inject(OverlayManagerService);
  private dialogsService = inject(DialogsService);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private pilotNames = inject(PilotNameCatalogService);
  private logger = inject(LoggerService);

  readonly crew = this.data.crew.map<EditableCrewMember>((member) => ({
    id: member.id,
    aeroGunnery: member.aeroGunnery === undefined ? undefined : signal(member.aeroGunnery),
    aeroPiloting: member.aeroPiloting === undefined ? undefined : signal(member.aeroPiloting),
    name: signal(member.name),
    notes: signal(member.notes ?? ''),
    portrait: signal(member.portrait),
    wounds: signal(member.wounds ?? 0),
    gunnery: signal(member.gunnery),
    piloting: signal(member.piloting),
    generatingName: signal(false),
  }));
  selectedGroupCommander = signal<boolean>(this.data.commander ?? false);
  readonly maxCrewWounds = MAX_CREW_WOUNDS;
  readonly woundsSegments = Array.from({ length: MAX_CREW_WOUNDS }, (_, index) => index + 1);

  setWounds(index: number, wounds: number): void {
    this.crew[index].wounds.update((current) => (current === wounds ? wounds - 1 : wounds));
  }

  readonly hasBvPreview = this.data.preSkillBv != null && this.data.skillFacts != null;
  /** Preview changing only the selected skill pair, retaining the other skills. */
  private buildBvMatrix(skillSet: 'ground' | 'aerospace'): number[][] {
    if (!this.hasBvPreview) return [];
    const crew = this.crewSnapshot();
    const gunneryField = skillSet === 'ground' ? 'gunnery' : 'aeroGunnery';
    const pilotingField = skillSet === 'ground' ? 'piloting' : 'aeroPiloting';
    return SKILL_VALUES.map((gunnery) =>
      SKILL_VALUES.map((piloting) => {
        const candidateCrew = crew.map((member) => ({
          ...member,
          ...(member[gunneryField] === undefined ? {} : { [gunneryField]: gunnery }),
          ...(member[pilotingField] === undefined || this.data.disablePiloting ? {} : { [pilotingField]: piloting }),
        }));
        return this.calculateBv(
          getSyntheticCrewSkill(candidateCrew, 'gunnery', this.data.additionalGunnerySkills, this.data.skillSet),
          getSyntheticCrewSkill(candidateCrew, 'piloting', this.data.additionalPilotingSkills, this.data.skillSet),
        );
      }),
    );
  }

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
      this.data.labelGunnery || 'Gunnery Skill',
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
      this.data.labelPiloting || 'Piloting Skill',
    );
  }

  toggleAeroGunneryDropdown(index: number): void {
    const member = this.crew[index];
    if (!member.aeroGunnery) return;
    this.openSkillDropdown(
      this.skillOverlayKey('aeroGunnery', member.id),
      this.aeroGunneryTriggers()[index],
      member.aeroGunnery(),
      this.buildEntries(index, 'aeroGunnery'),
      (skill) => member.aeroGunnery!.set(skill),
      'Aerospace Gunnery Skill',
    );
  }

  toggleAeroPilotingDropdown(index: number): void {
    if (this.data.disablePiloting) return;
    const member = this.crew[index];
    if (!member.aeroPiloting) return;
    this.openSkillDropdown(
      this.skillOverlayKey('aeroPiloting', member.id),
      this.aeroPilotingTriggers()[index],
      member.aeroPiloting(),
      this.buildEntries(index, 'aeroPiloting'),
      (skill) => member.aeroPiloting!.set(skill),
      'Aerospace Piloting Skill',
    );
  }

  toggleMatrixView(skillSet: 'ground' | 'aerospace'): void {
    this.closeSkillDropdowns();
    this.overlayManager.closeManagedOverlay('skill-matrix');

    const portal = new ComponentPortal(SkillMatrixPanelComponent, null, this.injector);

    const { componentRef } = this.overlayManager.createManagedOverlay('skill-matrix', null, portal, {
      closeOnOutsideClick: true,
    });

    componentRef.setInput('matrix', this.buildBvMatrix(skillSet));
    componentRef.setInput('showBv', this.hasBvPreview);
    const crew = this.crewSnapshot();
    componentRef.setInput('selectedGunnery', getSyntheticCrewSkill(crew, 'gunnery', [], skillSet));
    componentRef.setInput('selectedPiloting', getSyntheticCrewSkill(crew, 'piloting', [], skillSet));

    outputToObservable(componentRef.instance.selected)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cell: SkillMatrixCell) => {
        this.setAllCrewSkills(cell, skillSet);
        this.overlayManager.closeManagedOverlay('skill-matrix');
      });
  }

  setAllCrewSkills(cell: SkillMatrixCell, skillSet: 'ground' | 'aerospace'): void {
    const gunneryField = skillSet === 'ground' ? 'gunnery' : 'aeroGunnery';
    const pilotingField = skillSet === 'ground' ? 'piloting' : 'aeroPiloting';
    for (const member of this.crew) {
      member[gunneryField]?.set(cell.gunnery);
      if (!this.data.disablePiloting) member[pilotingField]?.set(cell.piloting);
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
    title?: string,
  ): void {
    this.closeSkillDropdowns();
    this.overlayManager.closeManagedOverlay('skill-matrix');

    const portal = new ComponentPortal(SkillDropdownPanelComponent, null, this.injector);

    const { componentRef } = this.overlayManager.createManagedOverlay(key, trigger, portal, {
      closeOnOutsideClick: true,
      matchTriggerWidth: true,
      anchorActiveSelector: '.skill-option.active',
    });

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
      this.overlayManager.closeManagedOverlay(this.skillOverlayKey('aeroGunnery', member.id));
      this.overlayManager.closeManagedOverlay(this.skillOverlayKey('aeroPiloting', member.id));
    }
  }

  private crewSnapshot(): EditPilotCrewPosition[] {
    return this.crew.map((member) => ({
      id: member.id,
      name: member.name(),
      ...(member.notes() ? { notes: member.notes() } : {}),
      ...(member.portrait() ? { portrait: member.portrait() } : {}),
      ...(this.data.editWounds ? { wounds: member.wounds() } : {}),
      gunnery: member.gunnery(),
      piloting: member.piloting(),
      ...(member.aeroGunnery === undefined ? {} : { aeroGunnery: member.aeroGunnery() }),
      ...(member.aeroPiloting === undefined ? {} : { aeroPiloting: member.aeroPiloting() }),
    }));
  }

  private calculateBv(gunnery: number, piloting: number): number {
    if (!this.hasBvPreview) return 0;
    return adjustCBTBattleValueForSkills(this.data.preSkillBv!, gunnery, piloting, this.data.skillFacts!);
  }

  private buildEntries(index: number, skillType: CrewSkillField): SkillPreviewEntry[] {
    if (!this.hasBvPreview) {
      return SKILL_VALUES.map((skill) => ({ skill, adjustedValue: 0, delta: 0 }));
    }
    return buildCrewSkillPreviewEntries(
      this.crewSnapshot(),
      index,
      skillType,
      (gunnery, piloting) => this.calculateBv(gunnery, piloting),
      this.data.additionalGunnerySkills,
      this.data.additionalPilotingSkills,
      this.data.skillSet,
    );
  }

  async fillRandomName(index: number): Promise<void> {
    const member = this.crew[index];
    if (member.generatingName()) return;
    member.generatingName.set(true);
    try {
      const name = await this.pilotNames.generateName({
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
