// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Force } from '../../models/force.model';
import type { ForcePerson } from '../../models/force-personnel';
import { GameSystem } from '../../models/common.model';
import { MAX_CREW_WOUNDS } from '../../models/crew-member.model';
import type { CrewSkillSet } from '../../models/unit-crew-policy';
import { CommanderIconComponent } from '../commander-icon/commander-icon.component';
import { CrewPortraitComponent, PERSON_SILHOUETTE_PATH } from '../crew-portrait/crew-portrait.component';
import { EdgeBadgeComponent } from '../edge-badge/edge-badge.component';

export interface CrewDescription {
  readonly name: string;
  readonly isAS: boolean;
  readonly gunnery: number;
  readonly piloting: number;
  /** Skills plus the personal facts the face shows only as marks. */
  readonly summary: string;
}

/** What a face shows, shared with the tooltip and accessible name of whatever hosts it. */
export function describeCrew(
  force: Force,
  person: ForcePerson,
  label: string,
  skillSet: CrewSkillSet,
  effectivePiloting: number | undefined,
  wounds: number | undefined,
): CrewDescription {
  const isAS = force.gameSystem === GameSystem.AS;
  const aerospace = skillSet === 'aerospace';
  const gunnery = !isAS && aerospace ? (person.aeroGunnery ?? 4) : (person.gunnery ?? 4);
  const personalPiloting = aerospace ? (person.aeroPiloting ?? 5) : (person.piloting ?? 5);
  const piloting = effectivePiloting ?? personalPiloting;
  const skills = isAS
    ? `Skill ${person.gunnery ?? 4}`
    : `${aerospace ? 'Aerospace' : 'Ground'} Gunnery ${gunnery}, Piloting ${piloting}` +
      (piloting !== personalPiloting ? ` (personal Piloting ${personalPiloting})` : '') +
      (skillSet === 'both'
        ? `; Aerospace Gunnery ${person.aeroGunnery ?? 4}, Piloting ${person.aeroPiloting ?? 5}`
        : '');
  return {
    name: person.name || label,
    isAS,
    gunnery,
    piloting,
    summary: [
      skills,
      ...(person.commander ? ['Commander'] : []),
      ...(person.edge ? [`Edge ${person.edge}`] : []),
      ...(wounds === undefined ? [] : [`Hits taken ${wounds}/${MAX_CREW_WOUNDS}`]),
    ].join(', '),
  };
}

/** The face of one person: portrait, commander mark, name, Edge, wounds and skills. */
@Component({
  selector: 'crew-profile',
  imports: [CommanderIconComponent, CrewPortraitComponent, EdgeBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="crew-avatar" [style.width.px]="avatarWidth()" [style.height.px]="avatarWidth() * 1.25">
      @if (person().portrait) {
        <crew-portrait [name]="person().portrait" [width]="avatarWidth()" />
      } @else {
        <svg class="silhouette" viewBox="0 0 256 320" aria-hidden="true" focusable="false">
          <path [attr.d]="silhouette" />
        </svg>
      }
    </span>
    <span class="crew-text">
      @if (caption()) {
        <span class="crew-caption">{{ caption() }}</span>
      }
      <span class="crew-title">
        @if (person().commander) {
          <commander-icon class="commander" />
        }
        <span class="crew-name" [class.unnamed]="caption() && !person().name">{{
          caption() && !person().name ? 'Unnamed' : description().name
        }}</span>
        <edge-badge [value]="person().edge ?? 0" />
      </span>
      <span class="crew-meta">
        @if (wounds() !== undefined) {
          <span class="wounds-bar" aria-hidden="true">
            @for (segment of woundsSegments; track segment) {
              <span class="wounds-segment" [class.filled]="segment <= wounds()!"></span>
            }
          </span>
        }
        <span class="crew-skills"
          ><span class="long"
            >{{ description().isAS ? 'Skill ' : skillSet() === 'aerospace' ? 'ASF G ' : 'G '
            }}{{ description().gunnery }}
            @if (!description().isAS) {
              / P {{ description().piloting }}
            }
            @if (!description().isAS && skillSet() === 'both') {
              · ASF G {{ person().aeroGunnery ?? 4 }} / P {{ person().aeroPiloting ?? 5 }}
            }</span
          ><span class="short"
            >{{ description().gunnery }}
            @if (!description().isAS) {
              /{{ description().piloting }}
            }
          </span></span
        >
      </span>
    </span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      flex: 1;
      gap: 8px;
      min-width: 0;
      text-align: left;
      container-type: inline-size;
    }
    .crew-avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    /* A person without a portrait: the same outline as the empty portrait field. */
    .silhouette {
      display: block;
      width: 100%;
      height: 100%;
      color: var(--text-color-secondary);
      fill: currentColor;
      fill-opacity: 0.12;
      stroke: currentColor;
      stroke-width: 12;
      stroke-linejoin: round;
    }
    .crew-text {
      display: flex;
      flex: 1;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      gap: var(--crew-line-gap, 1px);
    }
    .crew-caption {
      color: var(--text-color-tertiary, #888);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.12em;
      line-height: 11px;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .crew-name.unnamed {
      color: var(--text-color-secondary);
      font-style: italic;
    }
    .crew-title,
    .crew-meta {
      display: flex;
      align-items: center;
      min-width: 0;
    }
    .crew-title {
      gap: 5px;
      height: 16px;
    }
    .crew-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      line-height: 16px;
    }
    .commander {
      width: 9px;
      color: var(--bt-yellow);
    }
    .crew-meta {
      gap: 8px;
      height: 13px;
    }
    .crew-skills {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-color-secondary);
      font-size: 11px;
      line-height: 13px;
    }
    .wounds-bar {
      display: flex;
      flex-shrink: 0;
      gap: 2px;
    }
    .wounds-segment {
      box-sizing: border-box;
      width: 7px;
      height: 9px;
      border: 1px solid var(--border-color, #ffffff40);
      background: #0003;
    }
    .wounds-segment.filled {
      border-color: var(--damage-color);
      background: var(--damage-color);
    }
    .short {
      display: none;
    }
    /* Narrow seats keep the name and wounds; skills shorten and Edge drops its label. */
    @container (max-width: 130px) {
      .long {
        display: none;
      }
      .short {
        display: inline;
      }
      .crew-meta {
        gap: 5px;
      }
      .wounds-segment {
        width: 5px;
        height: 8px;
      }
      edge-badge ::ng-deep .label {
        display: none;
      }
    }
  `,
})
export class CrewProfileComponent {
  readonly force = input.required<Force>();
  readonly person = input.required<ForcePerson>();
  readonly label = input('Unnamed crew');
  readonly avatarWidth = input(24);
  readonly effectivePiloting = input<number>();
  readonly skillSet = input<CrewSkillSet>('both');
  readonly wounds = input<number>();
  /** Seat name shown above the person's name; an unnamed person then reads "Unnamed". */
  readonly caption = input<string>();
  readonly silhouette = PERSON_SILHOUETTE_PATH;
  readonly woundsSegments = Array.from({ length: MAX_CREW_WOUNDS }, (_, index) => index + 1);
  readonly description = computed(() =>
    describeCrew(this.force(), this.person(), this.label(), this.skillSet(), this.effectivePiloting(), this.wounds()),
  );
}
