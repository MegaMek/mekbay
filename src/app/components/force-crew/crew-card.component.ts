// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CdkDrag } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import type { ForcePerson } from '../../models/force-personnel';
import { GameSystem } from '../../models/common.model';
import { MAX_CREW_WOUNDS } from '../../models/crew-member.model';
import type { CrewSkillSet } from '../../models/unit-crew-policy';
import type { CrewDragData } from '../../services/crew-assignment.service';
import { CrewPortraitComponent } from '../crew-portrait/crew-portrait.component';

export type CrewLayout = 'compact' | 'cards' | 'rows' | 'slots';

@Component({
  selector: 'crew-card',
  imports: [CdkDrag, CrewPortraitComponent],
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
        [attr.aria-label]="'Edit ' + displayName() + ', ' + skillLabel()"
        [attr.title]="displayName() + ' · ' + skillLabel()"
      >
        @if (person().portrait) {
          <crew-portrait
            [name]="person().portrait"
            [width]="layout() === 'cards' ? 40 : 28"
          />
        } @else {
          <img src="/images/helmet.svg" width="28" height="28" alt="" />
        }
        <span class="crew-profile"
          ><span class="crew-name">{{ displayName() }}</span>
          <span class="crew-skills"
            >{{ isAS() ? 'Skill ' : skillSet() === 'aerospace' ? 'ASF G ' : 'G ' }}{{ displayedGunnery() }}
            @if (!isAS()) {
              / P {{ displayedPiloting() }}
            }
            @if (!isAS() && skillSet() === 'both') {
              · ASF G {{ person().aeroGunnery ?? 4 }} / P {{ person().aeroPiloting ?? 5 }}
            }
            @if (person().commander) {
              <span class="commander" title="Commander" aria-label="Commander">★</span>
            }
          </span>
          @if (wounds() !== undefined) {
            <span class="crew-health">
            <span class="crew-wounds-label">Wounds {{ wounds()! }}/{{ maxCrewWounds }}</span>
            <span
              class="wounds-bar"
              role="meter"
              aria-label="Pilot Wounds"
              aria-valuemin="0"
              [attr.aria-valuemax]="maxCrewWounds"
              [attr.aria-valuenow]="maxCrewWounds - wounds()!"
            >
              @for (segment of woundsSegments; track segment) {
                <span class="wounds-segment" [class.filled]="segment <= wounds()!" aria-hidden="true"></span>
              }
            </span>
            </span>
          }
        </span>
      </button>
      @if (canMove() && layout() !== 'compact') {
        <div class="crew-actions" (mousedown)="$event.stopPropagation()" (touchstart)="$event.stopPropagation()">
          @if (assigned()) {
            <button
              type="button"
              class="icon-action"
              title="Move to reserves"
              (click)="unassigned.emit()"
              [attr.aria-label]="'Move ' + displayName() + ' to reserves'"
            >
              ↗
            </button>
          }
          <button
            type="button"
            class="icon-action delete"
            title="Delete crew member"
            (click)="deleted.emit()"
            [attr.aria-label]="'Delete ' + displayName()"
          >
            ×
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
        background: #0002;
        border: 1px solid var(--border-color, #ffffff25);
        color: var(--text-color);
      }
      .crew-main {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1;
        padding: 5px 8px;
        color: inherit;
        border: 0;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .crew-main:disabled {
        cursor: default;
      }
      .crew-main:not(:disabled):hover {
        background: #ffffff0a;
      }
      .crew-main img, crew-portrait {
        flex-shrink: 0;
      }
      .crew-profile {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
      }
      .crew-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.85em;
      }
      .crew-skills {
        color: var(--text-color-secondary);
        font-size: 0.75em;
        white-space: nowrap;
      }
      .crew-health {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 3px;
      }
      .crew-wounds-label {
        color: var(--text-color-secondary);
        font-size: 0.75em;
        white-space: nowrap;
      }
      .wounds-bar {
        display: flex;
        gap: 3px;
        width: 72px;
        flex-shrink: 0;
      }
      .wounds-segment {
        flex: 1;
        height: 8px;
        border: 1px solid var(--border-color, #ffffff40);
        background: #0003;
      }
      .wounds-segment.filled {
        background: var(--damage-color);
      }
      .commander {
        color: var(--bt-yellow);
        margin-left: 4px;
      }
      .crew-actions {
        display: flex;
        align-items: center;
        gap: 1px;
        padding: 2px;
      }
      .icon-action {
        border: 0;
        background: transparent;
        color: var(--text-color-secondary);
        width: 26px;
        height: 30px;
        cursor: pointer;
      }
      .icon-action:hover {
        color: var(--text-color);
        background: #ffffff10;
      }
      .delete:hover {
        color: #ff6868;
      }
      .compact {
        border: 0;
        background: transparent;
        width: 36px;
      }
      .compact .crew-main {
        padding: 4px;
        justify-content: center;
      }
      .compact .crew-main img {
        width: 28px;
        height: 28px;
      }
      .compact .crew-profile {
        display: none;
      }
      .card-layout, .slot-layout {
        align-items: center;
        min-height: 58px;
        box-sizing: border-box;
      }
      .card-layout .crew-main, .slot-layout .crew-main {
        padding: 8px;
      }
      .card-layout .crew-actions, .slot-layout .crew-actions {
        flex-direction: column;
        border-left: 1px solid #ffffff12;
      }
      .card-layout .icon-action, .slot-layout .icon-action {
        height: 24px;
      }
      .card-layout .crew-profile, .slot-layout .crew-profile {
        flex: 1;
        overflow: hidden;
      }
      .card-layout .crew-skills, .slot-layout .crew-skills {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row-layout .crew-profile {
        flex: 1;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        overflow: hidden;
      }
      .row-layout .crew-name {
        flex: 1;
        min-width: 36px;
      }
      .row-layout .crew-skills {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row-layout .crew-health {
        margin: 0;
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
  readonly maxCrewWounds = MAX_CREW_WOUNDS;
  readonly woundsSegments = Array.from({ length: MAX_CREW_WOUNDS }, (_, index) => index + 1);
  readonly reason = input<string>();
  readonly edited = output<void>();
  readonly unassigned = output<void>();
  readonly deleted = output<void>();
  readonly displayName = computed(() => this.person().name || this.label());
  readonly isAS = computed(() => this.force().gameSystem === GameSystem.AS);
  readonly displayedGunnery = computed(() => !this.isAS() && this.skillSet() === 'aerospace'
    ? this.person().aeroGunnery ?? 4 : this.person().gunnery ?? 4);
  readonly personalPiloting = computed(() => this.skillSet() === 'aerospace' ? this.person().aeroPiloting ?? 5 : this.person().piloting ?? 5);
  readonly displayedPiloting = computed(() => this.effectivePiloting() ?? this.personalPiloting());
  readonly skillLabel = computed(() =>
    this.isAS()
      ? `Skill ${this.person().gunnery ?? 4}`
      : `${this.skillSet() === 'aerospace' ? 'Aerospace' : 'Ground'} Gunnery ${this.displayedGunnery()}, Piloting ${this.displayedPiloting()}` +
        (this.displayedPiloting() !== this.personalPiloting()
          ? ` (personal Piloting ${this.personalPiloting()})`
          : '') + (this.skillSet() === 'both' ? `; Aerospace Gunnery ${this.person().aeroGunnery ?? 4}, Piloting ${this.person().aeroPiloting ?? 5}` : ''),
  );
  readonly dragData = computed<CrewDragData>(() => ({
    kind: 'force-person',
    force: this.force(),
    personId: this.person().id,
  }));
}
