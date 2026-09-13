// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, Directive, computed, effect, inject, input } from '@angular/core';
import { CdkDropList, type CdkDrag } from '@angular/cdk/drag-drop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Force } from '../../models/force.model';
import { CrewAssignmentService, type CrewDragData } from '../../services/crew-assignment.service';
import { uuidv7 } from '../../utils/uuid.util';

/** Force headers receive reserves; unit rows receive crew in their first vacant station. */
@Directive({
    selector: '[crewDropForce]',
    hostDirectives: [CdkDropList],
    host: { class: 'crew-drop-target' },
})
export class CrewDropTargetDirective {
    readonly force = input.required<Force>({ alias: 'crewDropForce' });
    readonly unitId = input<string>(undefined, { alias: 'crewDropUnit' });
    private readonly crew = inject(CrewAssignmentService);
    private readonly list = inject(CdkDropList);
    private readonly canReceive = computed(() => this.force().canEditPersonnel()
        && (this.unitId() === undefined || this.crew.firstVacantPosition(this.force(), this.unitId()!) !== undefined));

    constructor() {
        this.list.id = `crew-target-${uuidv7()}`;
        this.list.sortingDisabled = true;
        this.list.enterPredicate = (drag: CdkDrag<CrewDragData>) => this.canReceive()
            && this.crew.canDropPerson(drag.data, this.force());
        effect(onCleanup => onCleanup(this.crew.registerDropList(this.force(), this.list.id)));
        effect(() => {
            this.list.connectedTo = [...this.crew.connectedDropLists()];
            this.list.disabled = !this.canReceive();
        });
        this.list.dropped.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(event => {
            if (event.isPointerOverContainer && this.list.enterPredicate(event.item, this.list)) {
                const unitId = this.unitId();
                if (unitId === undefined) void this.crew.dropInReserves(this.force(), event.item.data, this.crew.reserves(this.force()).length);
                else void this.crew.dropOnUnit(this.force(), event.item.data, unitId);
            }
        });
    }
}
