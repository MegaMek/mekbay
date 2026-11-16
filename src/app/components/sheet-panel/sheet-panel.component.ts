// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A record sheet panel for the UI: a framed box under a pointed title tab. */
@Component({
  selector: 'sheet-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', '[attr.aria-label]': 'heading()' },
  template: `<span class="sheet-tab"
      ><span>{{ heading() }}</span></span
    ><ng-content />`,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      margin-top: 15px;
      padding: 22px 10px 10px;
      border: 1px solid #8b8b8b;
      border-radius: 0 10px 0 0;
    }

    /* The record sheet's title tab, inverted: pointed at both ends on the sheet's 56.31 degree
           slope (cut = height / 3) and centred on the top border. As on the sheet, the frame wraps
           only the tab's upper half: a 1px outline and a 3px gap, drawn as pseudo-elements because
           a clipped box cannot outline itself. Each tip inset is the perpendicular inset / sin(56.31). */
    .sheet-tab {
      position: absolute;
      top: -15px;
      /* The left border runs into the tab's left point, as the sheet's frame does. */
      left: -1px;
      padding: 4px 4.8px;
    }

    .sheet-tab::before,
    .sheet-tab::after {
      content: '';
      position: absolute;
    }

    /* Outline: the upper half, ending on the border line at both points. */
    .sheet-tab::before {
      inset: 0;
      background: #8b8b8b;
      clip-path: polygon(0 50%, 9.67px 0, calc(100% - 9.67px) 0, 100% 50%);
    }

    /* Gap: also hides the border line where it would cross under the tab. */
    .sheet-tab::after {
      inset: 1px 1.2px;
      background: var(--background-color-menu);
      clip-path: polygon(0 50%, 9px 0, calc(100% - 9px) 0, 100% 50%, 100% calc(50% + 1px), 0 calc(50% + 1px));
    }

    .sheet-tab > span {
      position: relative;
      z-index: 1;
      display: block;
      padding: 0 14px;
      background: #e9e6df;
      clip-path: polygon(0 50%, 7px 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 7px 100%);
      color: #111;
      font-size: 0.85em;
      font-weight: 800;
      line-height: 21px;
      text-transform: uppercase;
      white-space: nowrap;
    }
  `,
})
export class SheetPanelComponent {
  readonly heading = input.required<string>();
}
