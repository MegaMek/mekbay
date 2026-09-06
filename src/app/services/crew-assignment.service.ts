// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject, signal } from '@angular/core';
import type { Force } from '../models/force.model';
import type { ForcePerson } from '../models/force-personnel';
import { ForcePilotEditorService } from './force-pilot-editor.service';
import { ToastService } from './toast.service';

export interface CrewDragData {
    readonly kind: 'force-person';
    readonly force: Force;
    readonly personId: string;
}

/** UI actions delegate ownership and eligibility to Force; no crew rules live here. */
@Injectable({ providedIn: 'root' })
export class CrewAssignmentService {
    private readonly editor = inject(ForcePilotEditorService);
    private readonly toast = inject(ToastService);
    private readonly dropLists = signal<ReadonlyMap<Force, readonly string[]>>(new Map());

    /** Component lifetimes own registration; crew drops never connect to unit/group lists. */
    registerDropList(force: Force, id: string): () => void {
        this.dropLists.update(current => new Map(current).set(force, [...(current.get(force) ?? []), id]));
        return () => this.dropLists.update(current => {
            const next = new Map(current);
            const ids = (next.get(force) ?? []).filter(candidate => candidate !== id);
            if (ids.length) next.set(force, ids);
            else next.delete(force);
            return next;
        });
    }

    connectedDropLists(force: Force): readonly string[] {
        return this.dropLists().get(force) ?? [];
    }

    reserves(force: Force): readonly ForcePerson[] {
        const personnel = force.personnel();
        const assigned = new Set(personnel.assignments.map(assignment => assignment.personId));
        return personnel.people.filter(person => !assigned.has(person.id));
    }

    async edit(force: Force, personId: string): Promise<void> {
        await this.editor.editPerson(force, personId);
    }

    async assign(force: Force, personId: string, unitId: string, positionId: string): Promise<void> {
        if (force.getAssignedPerson(unitId, positionId)?.id === personId) return;
        this.report(await force.assignPersonToUnit(personId, unitId, positionId));
    }

    async unassign(force: Force, unitId: string, positionId: string): Promise<void> {
        this.report(await force.unassignPerson(unitId, positionId));
    }

    async moveToReserves(force: Force, personId: string): Promise<void> {
        const assignment = force.personnel().assignments.find(candidate => candidate.personId === personId);
        if (assignment) await this.unassign(force, assignment.unitId, assignment.positionId);
    }

    async create(force: Force, unitId?: string, positionId?: string): Promise<void> {
        const person = unitId !== undefined && positionId !== undefined
            ? await force.createPersonForUnit(unitId, positionId)
            : force.addUnassignedPerson({ gunnery: 4, piloting: 5 });
        this.report(person !== null);
    }

    async delete(force: Force, personId: string): Promise<void> {
        this.report(await force.deletePerson(personId));
    }

    private report(success: boolean): void {
        if (!success) this.toast.showToast('The crew change could not be applied. Please try again.', 'error');
    }
}
