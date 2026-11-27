// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CdkDropList, type CdkDrag, type CdkDragDrop } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import { isCBTForceMember } from '../../models/force-member.model';
import { unitTracksPilotWounds, unitCrewSkillSet } from '../../models/unit-crew-policy';
import { effectiveEntityPilotingSkill } from '../../models/entity/utils/battle-value/skill-facts';
import { CrewAssignmentService, type CrewDragData } from '../../services/crew-assignment.service';
import { uuidv7 } from '../../utils/uuid.util';
import { CrewCardComponent, type CrewLayout } from './crew-card.component';
import { PilotSelectorComponent } from './pilot-selector.component';

@Component({
  selector: 'crew-slot',
  imports: [CdkDropList, CrewCardComponent, PilotSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="crew-slot"
      (click)="$event.stopPropagation()"
      [attr.title]="policy().reason"
    >
      <div
        class="slot-body"
        cdkDropList
        [id]="dropId"
        [cdkDropListConnectedTo]="connectedLists()"
        [cdkDropListSortingDisabled]="true"
        [cdkDropListDisabled]="!canMove()"
        [cdkDropListEnterPredicate]="canDrop"
        (cdkDropListDropped)="drop($event)"
      >
      @if (person(); as occupant) {
        <crew-card
          [force]="force()"
          [person]="occupant"
          [label]="label()"
          [layout]="layout()"
          [canEdit]="policy().canEdit"
          [canMove]="canMove()"
          [reason]="policy().reason"
          [effectivePiloting]="effectivePiloting()"
          [skillSet]="skillSet()"
          [wounds]="wounds()"
          (edited)="crew.edit(force(), occupant.id)"
          (dragging)="vacated.set($event)"
        />
      }
      <!-- While its occupant is dragged away, the station shows the vacancy it would leave;
           the CDK placeholder then is not the only child and hides. -->
      @if (!person() || vacated()) {
        <pilot-selector
          [force]="force()"
          [unitId]="unitId()"
          [positionId]="positionId()"
          [label]="label()"
          [layout]="layout()"
          [disabled]="!canMove()"
        />
      }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      /* A card dragged over this station only highlights it, and the station a card left shows
         its vacancy instead, so CDK's placeholder clone is never the only child and stays hidden. */
      :host ::ng-deep .slot-body > .cdk-drag-placeholder:not(:only-child) {
        display: none;
      }
      .slot-body.cdk-drop-list-receiving {
        outline: 1px dashed var(--bt-yellow);
        outline-offset: -1px;
      }
      .slot-body.cdk-drop-list-dragging {
        outline: 1px solid var(--bt-yellow);
        outline-offset: -1px;
        background: var(--bt-yellow-background);
      }
    `,
  ],
})
export class CrewSlotComponent {
  readonly force = input.required<Force>();
  readonly unitId = input.required<string>();
  readonly positionId = input.required<string>();
  readonly label = input('Pilot');
  readonly layout = input<CrewLayout>('rows');
  readonly crew = inject(CrewAssignmentService);
  readonly dropId = `crew-slot-${uuidv7()}`;
  /** The occupant is being dragged out of this station. */
  readonly vacated = signal(false);
  readonly policy = computed(() => this.force().getUnitCrewPolicy(this.unitId()));
  readonly person = computed(() => this.force().getAssignedPerson(this.unitId(), this.positionId()));
  readonly skillSet = computed(() => {
    const member = this.force().members().find(candidate => candidate.id === this.unitId());
    return isCBTForceMember(member) ? unitCrewSkillSet(member.entity.unitType(), member.entity.unitSubtype()) : 'ground';
  });
  readonly effectivePiloting = computed(() => {
    const member = this.force()
      .members()
      .find((candidate) => candidate.id === this.unitId());
    return isCBTForceMember(member)
      ? effectiveEntityPilotingSkill(member.entity, this.skillSet() === 'aerospace'
          ? this.person()?.aeroPiloting ?? 5 : this.person()?.piloting ?? 5)
      : undefined;
  });
  readonly wounds = computed(() => {
    const member = this.force()
      .members()
      .find((candidate) => candidate.id === this.unitId());
    if (!isCBTForceMember(member) || !unitTracksPilotWounds(member.entity.unitType())) return undefined;
    const snapshot =
      member.entity.entityType === 'Mek' ? member.mekRecordSheetSnapshot() : member.nonMekRecordSheetSnapshot();
    return snapshot?.crew.find((position) => position.positionId === this.positionId())?.state.wounds;
  });
  readonly canMove = computed(() => this.policy().kind === 'swappable' && this.policy().canEdit);
  readonly connectedLists = computed(() => [...this.crew.connectedDropLists()]);
  readonly canDrop = (drag: CdkDrag<CrewDragData>): boolean =>
    this.canMove() && this.crew.canDropPerson(drag.data, this.force());

  constructor() {
    effect((onCleanup) => onCleanup(this.crew.registerDropList(this.force(), this.dropId)));
  }

  drop(event: CdkDragDrop<unknown, unknown, CrewDragData>): void {
    if (event.isPointerOverContainer && this.canDrop(event.item))
      void this.crew.dropOnUnit(this.force(), event.item.data, this.unitId(), this.positionId());
  }
}
