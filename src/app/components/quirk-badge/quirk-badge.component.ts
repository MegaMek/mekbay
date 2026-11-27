// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Quirk } from '../../models/quirks.model';
import { TooltipDirective } from '../../directives/tooltip.directive';

@Component({
  selector: 'quirk-badge',
  imports: [TooltipDirective],
  template: `<span
    class="quirk"
    [class.positive]="!quirk()?.unresolved && quirk()?.type === 'positive'"
    [class.negative]="!quirk()?.unresolved && quirk()?.type === 'negative'"
    [class.muted]="muted()"
    [tooltip]="quirk()?.description || null"
  >
    {{ name() || quirk()?.name }}<ng-content />
  </span>`,
  styles: [
    `
      :host {
        display: inline-flex;
        max-width: 100%;
      }
      .quirk {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: help;
        font-size: 0.9em;
        border: 1px solid gray;
        background: #202020b0;
        border-radius: 4px;
        padding: 0 4px;
        box-sizing: border-box;
        position: relative;
        overflow-wrap: anywhere;
      }
      .positive {
        border-color: green;
        background: #3c5331;
      }
      .negative {
        border-color: red;
        background: #452420;
      }
      .muted {
        background: transparent;
        color: var(--text-color-secondary, #999);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuirkBadgeComponent {
  readonly quirk = input<Quirk>();
  readonly name = input('');
  /** Keeps the positive/negative border but drops the fill for suppressed assignments. */
  readonly muted = input(false);
}
