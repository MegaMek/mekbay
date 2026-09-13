// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ElementRef, afterRenderEffect, inject } from '@angular/core';

/** Reveal the saved choice once the picker has loaded and rendered its choices. */
export function scrollToInitialPickerSelection(ready: () => boolean): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef);
  let scrolled = false;
  afterRenderEffect(() => {
    if (scrolled || !ready()) return;
    const selected = host.nativeElement.querySelector<HTMLElement>('.picker-choice.selected');
    if (!selected) return;
    selected.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    scrolled = true;
  });
}
