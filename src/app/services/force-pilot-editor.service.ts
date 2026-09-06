// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { EditASPilotDialogComponent, type EditASPilotDialogData, type EditASPilotResult } from '../components/edit-as-pilot-dialog/edit-as-pilot-dialog.component';
import { EditPilotDialogComponent, type EditPilotDialogData, type EditPilotResult } from '../components/edit-pilot-dialog/edit-pilot-dialog.component';
import type { CrewEditAction, CrewEditActions } from '../components/force-crew/crew-edit-actions';
import { ASForceUnit } from '../models/as-force-unit.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { Force, UnitGroup } from '../models/force.model';
import type { ForcePerson } from '../models/force-personnel';
import { GameSystem } from '../models/common.model';
import { asCrewPositionId } from '../models/entity/entity-identifiers';
import { isCBTForceMember } from '../models/force-member.model';
import { classicSkillFactsForEntity } from '../models/entity/utils/battle-value/skill-facts';
import { fixedCBTPilotingSkill } from '../models/entity/utils/battle-value/rules';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';
import { DialogsService } from './dialogs.service';
import { ToastService } from './toast.service';

/** Pilot dialogs edit persistent people; formation choices remain unit/group facts. */
@Injectable({ providedIn: 'root' })
export class ForcePilotEditorService {
    private readonly dialogs = inject(DialogsService);
    private readonly toast = inject(ToastService);

    async editAlphaStrikeUnit(unit: ASForceUnit): Promise<void> {
        if (!unit.force.getUnitCrewPolicy(unit.id).canEdit) return;
        const person = unit.pilot();
        if (person) await this.editPerson(unit.force, person.id);
        else await this.editUnitCrew(unit.force, unit.id);
    }

    async editCBTMember(force: CBTForce, instanceId: string): Promise<void> {
        const policy = force.getUnitCrewPolicy(instanceId);
        if (!policy.canEdit) return;
        const onlyPosition = policy.positions.length === 1 ? policy.positions[0] : undefined;
        const person = onlyPosition && force.getAssignedPerson(instanceId, onlyPosition.positionId);
        if (person) await this.editPerson(force, person.id);
        else await this.editUnitCrew(force, instanceId);
    }

    async editPerson(force: Force, personId: string): Promise<void> {
        if (!force.canEditPersonnel()) return;
        const person = force.personnel().people.find(candidate => candidate.id === personId);
        if (!person) return;
        const assignment = force.personnel().assignments.find(candidate => candidate.personId === personId);
        if (assignment && !force.getUnitCrewPolicy(assignment.unitId).canEdit) return;
        if (force.gameSystem === GameSystem.AS) {
            const unit = assignment && force.units().find(candidate => candidate.id === assignment.unitId);
            await this.editAlphaStrikePerson(force, person, unit instanceof ASForceUnit ? unit : undefined);
        } else {
            const member = assignment && force.members().find(candidate => candidate.id === assignment.unitId);
            const skillFacts = isCBTForceMember(member) ? classicSkillFactsForEntity(member.entity) : undefined;
            const ref = this.dialogs.createDialog<EditPilotResult | null, EditPilotDialogComponent, EditPilotDialogData>(EditPilotDialogComponent, {
                data: {
                    unitId: assignment?.unitId,
                    editNotes: true,
                    editPortrait: true,
                    crew: [{ id: asCrewPositionId(assignment?.positionId ?? 'reserve'), name: person.name ?? '',
                        notes: person.notes, portrait: person.portrait, gunnery: person.gunnery ?? 4, piloting: person.piloting ?? 5 }],
                    personnelActions: this.actions(force, personId),
                    commander: person.commander,
                    ...(assignment ? { commanderContext: {} } : {}),
                    labelGunnery: 'Gunnery Skill', labelPiloting: 'Piloting Skill',
                    skillFacts,
                    ...(isCBTForceMember(member) && skillFacts ? {
                        fixedPiloting: fixedCBTPilotingSkill(skillFacts) ?? undefined,
                        preSkillBv: (member.currentBaseBattleValue() ?? member.entity.battleValue())
                            + (member.tagBattleValue() ?? 0) + (member.c3BattleValue() ?? 0),
                        isAerospace: skillFacts.unitType === 'Aero',
                    } : {}),
                    factionId: force.faction()?.id, era: force.era(),
                },
            });
            const result = await firstValueFrom(ref.closed);
            if (!result) return;
            if (result.action) { await this.applyAction(force, personId, result.action); return; }
            const edited = result.crew[0];
            if (!edited) return;
            await this.savePerson(force, personId, { name: edited.name.trim() || undefined, notes: edited.notes || undefined,
                portrait: edited.portrait,
                gunnery: edited.gunnery, piloting: edited.piloting, commander: result.commander ? true : undefined });
        }
    }

    private async editUnitCrew(force: Force, unitId: string): Promise<void> {
        // This dialog composes the shared controls, which call this service only
        // when a particular person is edited. Load it after service construction.
        const { UnitCrewDialogComponent } = await import('../components/force-crew/unit-crew-dialog.component');
        await firstValueFrom(this.dialogs.createDialog(UnitCrewDialogComponent, { data: { force, unitId } }).closed);
    }

    private actions(force: Force, personId: string): CrewEditActions {
        const assignment = force.personnel().assignments.find(candidate => candidate.personId === personId);
        const policy = assignment && force.getUnitCrewPolicy(assignment.unitId);
        const canMove = force.canEditPersonnel() && (!policy || (policy.canEdit && policy.kind === 'swappable'));
        return { canUnassign: canMove && !!assignment, canDelete: canMove };
    }

    private async applyAction(force: Force, personId: string, action: CrewEditAction): Promise<void> {
        const assignment = force.personnel().assignments.find(candidate => candidate.personId === personId);
        const applied = action === 'delete' ? await force.deletePerson(personId)
            : assignment ? await force.unassignPerson(assignment.unitId, assignment.positionId) : false;
        if (!applied) this.failed();
    }

    private async editAlphaStrikePerson(force: Force, person: ForcePerson, unit?: ASForceUnit): Promise<void> {
        const group = unit?.getGroup() as UnitGroup<ASForceUnit> | null | undefined;
        const summary = unit?.getSummary();
        const ref = this.dialogs.createDialog<EditASPilotResult | null, EditASPilotDialogComponent, EditASPilotDialogData>(EditASPilotDialogComponent, {
            data: {
                unitId: unit?.id ?? person.id, name: person.name ?? '', notes: person.notes, portrait: person.portrait,
                editNotes: true,
                editPortrait: true,
                skill: person.gunnery ?? 4, abilities: structuredClone([...(person.abilities ?? [])]),
                personnelActions: this.actions(force, person.id),
                formationAbilities: unit?.formationAbilities(), commander: person.commander, group,
                factionId: force.faction()?.id, isAerospace: unit?.isAerospace(), era: force.era(),
                unitType: summary?.type, unitSubtype: summary?.subtype, unitTypeCode: summary?.as?.TP, basePv: summary?.as?.PV,
            },
        });
        const result = await firstValueFrom(ref.closed);
        if (!result) return;
        if (result.action) { await this.applyAction(force, person.id, result.action); return; }
        const applied = await this.savePerson(force, person.id, { name: result.name.trim() || undefined, notes: result.notes || undefined,
            portrait: result.portrait,
            gunnery: result.skill, abilities: result.abilities, commander: result.commander ? true : undefined });
        if (!applied || !unit || unit.pilot()?.id !== person.id) return;
        if (group) {
            FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group, {
                abilityOverrides: result.formationAbilityOverrides ?? new Map([[unit.id, result.formationAbilities]]),
                commanderUnitId: result.commander ? unit.id
                    : group.units().find(candidate => candidate.id !== unit.id && candidate.commander())?.id ?? null,
            });
        } else {
            unit.setFormationAbilities(result.formationAbilities);
            unit.setFormationCommander(result.commander);
        }
    }

    private async savePerson(force: Force, personId: string, patch: Partial<Omit<ForcePerson, 'id'>>): Promise<boolean> {
        const applied = await force.updatePerson(personId, patch);
        if (!applied) this.failed();
        return applied;
    }

    private failed(): void { this.toast.showToast('The crew change could not be saved.', 'error'); }
}
