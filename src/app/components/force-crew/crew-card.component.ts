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

/** `compact` is the row card without action buttons, for dense unit rows. */
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
          [avatarWidth]="layout() === 'rows' || layout() === 'compact' ? 24 : 32"
          [effectivePiloting]="effectivePiloting()"
          [skillSet]="skillSet()"
          [wounds]="wounds()"
        />
      </button>
      @if (canMove() && layout() !== 'compact') {
        <div class="crew-actions" (mousedown)="$event.stopPropagation()" (touchstart)="$event.stopPropagation()">
          @if (assigned()) {
            <button
              type="button"
              class="icon-action"
              title="Move to reserves"
              (click)="unassigned.emit()"
              [attr.aria-label]="'Move ' + description().name + ' to reserves'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M15 2a4 4 0 0 0-4 4v1a5 5 0 0 0 2 4v2l-3 1.5A4 4 0 0 0 8 18v4h14v-4a4 4 0 0 0-2-3.5L17 13v-2a5 5 0 0 0 2-4V6a4 4 0 0 0-4-4Z"
                  fill="currentColor"
                />
                <path
                  d="M8 11H1m3-3-3 3 3 3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          }
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
        gap: 4px;
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
      .card-layout .crew-main,
      .slot-layout .crew-main {
        padding: 8px;
        --crew-line-gap: 5px;
      }
      .card-layout .crew-actions,
      .slot-layout .crew-actions {
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding: 0 4px;
        border-left: 1px solid #ffffff12;
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
  readonly assigned = input(false);
  readonly canEdit = input(false);
  readonly canMove = input(false);
  readonly effectivePiloting = input<number>();
  readonly skillSet = input<CrewSkillSet>('both');
  readonly wounds = input<number>();
  readonly reason = input<string>();
  readonly edited = output<void>();
  readonly unassigned = output<void>();
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
