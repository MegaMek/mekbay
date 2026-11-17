// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CdkDrag } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import type { ForcePerson } from '../../models/force-personnel';
import type { CrewSkillSet } from '../../models/unit-crew-policy';
import type { CrewDragData } from '../../services/crew-assignment.service';
import { RemoveIconComponent } from '../remove-icon/remove-icon.component';
import { CrewProfileComponent, describeCrew } from './crew-profile.component';

/**
 * `compact` is the row card without action buttons, for dense unit rows.
 * `slots` names its station inside the card.
 */
export type CrewLayout = 'compact' | 'cards' | 'rows' | 'slots';

@Component({
  selector: 'crew-card',
  imports: [CdkDrag, CrewProfileComponent, RemoveIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="crew-card"
      [class.compact]="layout() === 'compact'"
      [class.card-layout]="layout() === 'cards'"
      [class.row-layout]="layout() === 'rows'"
      [class.slot-layout]="layout() === 'slots'"
      cdkDrag
      cdkDragRootElement="crew-card"
      [cdkDragData]="dragData()"
      [cdkDragDisabled]="!canMove()"
      [cdkDragStartDelay]="{ touch: 200, mouse: 0 }"
      (cdkDragStarted)="dragging.emit(true)"
      (cdkDragEnded)="dragging.emit(false)"
      (click)="$event.stopPropagation()"
    >
      <button
        class="crew-main"
        type="button"
        [disabled]="!canEdit()"
        (click)="edited.emit()"
        [attr.aria-label]="'Edit ' + description().name + ', ' + description().summary"
        [attr.title]="description().name + ' · ' + description().summary"
      >
        <crew-profile
          [force]="force()"
          [person]="person()"
          [label]="label()"
          [avatarWidth]="layout() === 'cards' || layout() === 'slots' ? 32 : 24"
          [caption]="layout() === 'slots' ? label() : undefined"
          [effectivePiloting]="effectivePiloting()"
          [skillSet]="skillSet()"
          [wounds]="wounds()"
        />
      </button>
      <!-- Only reserves offer deletion here; assigned crew is unassigned or deleted from the pilot dialog. -->
      @if (canDelete() && layout() !== 'compact') {
        <div class="crew-actions" (mousedown)="$event.stopPropagation()" (touchstart)="$event.stopPropagation()">
          <button
            type="button"
            class="icon-action delete"
            title="Delete crew member"
            (click)="deleted.emit()"
            [attr.aria-label]="'Delete ' + description().name"
          >
            <remove-icon />
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .crew-card {
        display: flex;
        align-items: stretch;
        min-width: 0;
        background: #0003;
        border: 1px solid var(--border-color, #ffffff25);
        color: var(--text-color);
        transition: background-color 0.2s;
      }
      .crew-card:hover {
        background: #5050504d;
      }
      .crew-main {
        display: flex;
        min-width: 0;
        flex: 1;
        padding: 4px;
        color: inherit;
        font: inherit;
        border: 0;
        background: transparent;
        cursor: pointer;
      }
      .crew-main:disabled {
        cursor: default;
      }
      .crew-actions {
        display: flex;
        align-items: center;
        padding: 0 8px 0 4px;
      }
      .icon-action {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border: 0;
        background: none;
        color: #999;
        cursor: pointer;
        transition: color 0.2s;
      }
      .icon-action:hover {
        color: var(--text-color);
      }
      .delete:hover {
        color: red;
      }
      .card-layout .crew-actions {
        padding: 0 4px;
        border-left: 1px solid #ffffff12;
      }
      .card-layout .crew-main {
        padding: 8px;
        --crew-line-gap: 5px;
      }
      /* A slot names its station inside; its three lines sit tight. */
      .slot-layout .crew-main {
        padding: 6px 8px;
      }
      :host(.cdk-drag-preview) {
        box-sizing: border-box;
        background: var(--background-color, #252a31);
        box-shadow: 0 6px 20px #0008;
      }
      :host(.cdk-drag-placeholder) {
        opacity: 0.25;
      }
    `,
  ],
})
export class CrewCardComponent {
  readonly force = input.required<Force>();
  readonly person = input.required<ForcePerson>();
  readonly label = input('Unnamed crew');
  readonly layout = input<CrewLayout>('rows');
  readonly canEdit = input(false);
  readonly canMove = input(false);
  readonly effectivePiloting = input<number>();
  readonly skillSet = input<CrewSkillSet>('both');
  readonly wounds = input<number>();
  readonly reason = input<string>();
  /** Shows the delete button; only reserve cards pass it. */
  readonly canDelete = input(false);
  readonly edited = output<void>();
  /** True while this card is being dragged out of its place. */
  readonly dragging = output<boolean>();
  readonly deleted = output<void>();
  readonly description = computed(() =>
    describeCrew(this.force(), this.person(), this.label(), this.skillSet(), this.effectivePiloting(), this.wounds()),
  );
  readonly dragData = computed<CrewDragData>(() => ({
    kind: 'force-person',
    force: this.force(),
    personId: this.person().id,
  }));
}
