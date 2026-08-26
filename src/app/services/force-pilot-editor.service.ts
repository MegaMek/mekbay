// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    EditASPilotDialogComponent,
    type EditASPilotDialogData,
    type EditASPilotResult,
} from '../components/edit-as-pilot-dialog/edit-as-pilot-dialog.component';
import {
    EditPilotDialogComponent,
    type EditPilotDialogData,
    type EditPilotResult,
} from '../components/edit-pilot-dialog/edit-pilot-dialog.component';
import { ASForceUnit } from '../models/as-force-unit.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { UnitGroup } from '../models/force.model';
import type { UnitInstanceId } from '../models/runtime/runtime-state';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';
import { DialogsService } from './dialogs.service';
import { ToastService } from './toast.service';

interface ComparableCrewProfilePosition {
    readonly positionId: string;
    readonly name: string;
    readonly role: string;
    readonly gunnery: number;
    readonly piloting: number;
    readonly asfGunnery?: number;
    readonly asfPiloting?: number;
}

/** Owns the pre-combat crew/pilot editing workflows for both game systems. */
@Injectable({ providedIn: 'root' })
export class ForcePilotEditorService {
    private readonly dialogs = inject(DialogsService);
    private readonly toast = inject(ToastService);

    async editAlphaStrikeUnit(unit: ASForceUnit): Promise<void> {
        if (unit.readOnly()) return;
        await this.editAlphaStrikePilot(unit);
    }

    async editClassicMember(force: CBTForce, instanceId: UnitInstanceId): Promise<void> {
        if (force.readOnly()) return;
        const snapshot = force.getUnitCrewProfile(instanceId);
        if (!snapshot) {
            this.toast.showToast('This unit is no longer available for crew editing.', 'error');
            return;
        }
        if (snapshot.positions.length === 0) {
            this.toast.showToast('This unit has no crew to edit.', 'error');
            return;
        }
        const ref = this.dialogs.createDialog<EditPilotResult | null, EditPilotDialogComponent, EditPilotDialogData>(
            EditPilotDialogComponent,
            {
                data: {
                    unitId: instanceId,
                    crew: snapshot.positions.map(position => ({
                        id: position.positionId,
                        name: position.name,
                        role: position.role,
                        gunnery: position.gunnery,
                        piloting: position.piloting,
                    })),
                    labelGunnery: 'Gunnery Skill',
                    labelPiloting: 'Piloting Skill',
                    disablePiloting: false,
                    factionId: force.faction()?.id,
                    isAerospace: false,
                    era: force.era(),
                },
            },
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;
        const positions = result.crew.flatMap(position => typeof position.id === 'string' ? [{
            positionId: position.id,
            name: position.name,
            role: position.role ?? '',
            gunnery: position.gunnery,
            piloting: position.piloting,
        }] : []);
        if (crewProfilesEqual(snapshot.positions, positions)) return;

        const applied = await force.replaceUnitCrewProfile(instanceId, {
            expectedRevision: snapshot.revision,
            positions,
        });
        if (applied?.accepted) return;
        const message = applied?.reason === 'COMBAT_STARTED'
            ? 'Crew deployment cannot be changed after combat has started.'
            : applied?.reason === 'INVALID_PROFILE'
                ? 'The crew profile is invalid and was not saved.'
                : applied?.reason === 'REDEPLOY_FAILED'
                    ? 'The unit could not be rebuilt; its previous crew profile was kept.'
                    : 'The crew profile changed before it could be saved.';
        this.toast.showToast(message, 'error');
    }

    private async editAlphaStrikePilot(unit: ASForceUnit): Promise<void> {
        const group = unit.getGroup() as UnitGroup<ASForceUnit> | null;
        const ref = this.dialogs.createDialog<EditASPilotResult | null, EditASPilotDialogComponent, EditASPilotDialogData>(
            EditASPilotDialogComponent,
            {
                data: {
                    unitId: unit.id,
                    name: unit.alias() || '',
                    skill: unit.pilotSkill(),
                    abilities: unit.manualPilotAbilities(),
                    formationAbilities: unit.formationAbilities(),
                    commander: unit.commander(),
                    group,
                    factionId: unit.force.faction()?.id,
                    isAerospace: unit.isAerospace(),
                    era: unit.force.era(),
                    unitType: unit.getSummary().type,
                    unitSubtype: unit.getSummary().subtype,
                    unitTypeCode: unit.getSummary().as?.TP,
                    basePv: unit.getSummary().as?.PV,
                },
            },
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        if (result.name !== undefined) {
            const name = result.name.trim() || undefined;
            if (name !== unit.alias()) unit.setPilotName(name);
        }
        if (result.skill !== undefined && result.skill !== unit.pilotSkill()) {
            unit.setPilotSkill(result.skill);
        }
        if (result.abilities !== undefined && abilitiesDiffer(result.abilities, unit.manualPilotAbilities())) {
            unit.setPilotAbilities(result.abilities);
        }
        if (group) {
            FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group, {
                abilityOverrides: result.formationAbilityOverrides ?? new Map([[unit.id, result.formationAbilities]]),
                commanderUnitId: result.commander
                    ? unit.id
                    : group.units().find(candidate => candidate.id !== unit.id && candidate.commander())?.id ?? null,
            });
        } else {
            unit.setFormationAbilities(result.formationAbilities);
            unit.setFormationCommander(result.commander);
        }
    }
}

function crewProfilesEqual(
    left: readonly ComparableCrewProfilePosition[],
    right: readonly ComparableCrewProfilePosition[],
): boolean {
    return left.length === right.length && left.every((position, index) => {
        const candidate = right[index];
        return candidate !== undefined
            && position.positionId === candidate.positionId
            && position.name === candidate.name
            && position.role === candidate.role
            && position.gunnery === candidate.gunnery
            && position.piloting === candidate.piloting
            && position.asfGunnery === candidate.asfGunnery
            && position.asfPiloting === candidate.asfPiloting;
    });
}

function abilitiesDiffer(
    next: readonly (string | { readonly name: string; readonly cost: number; readonly summary: string })[],
    current: readonly (string | { readonly name: string; readonly cost: number; readonly summary: string })[],
): boolean {
    return next.length !== current.length || next.some((ability, index) => {
        const existing = current[index];
        if (typeof ability === 'string' && typeof existing === 'string') return ability !== existing;
        if (typeof ability === 'object' && typeof existing === 'object') {
            return ability.name !== existing.name || ability.cost !== existing.cost || ability.summary !== existing.summary;
        }
        return true;
    });
}
