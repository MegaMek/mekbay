// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CdkMenuTrigger, MenuTracker } from '@angular/cdk/menu';

interface MenuTrackerInternals {
    _openMenuTrigger?: CdkMenuTrigger;
}

/** Close component-owned menus and release CDK's otherwise permanent static trigger reference. */
export function closeCdkMenus(triggers: readonly CdkMenuTrigger[]): void {
    const tracker = MenuTracker as unknown as MenuTrackerInternals;
    for (const trigger of triggers) {
        try {
            if (trigger.isOpen()) trigger.close();
            if (tracker._openMenuTrigger === trigger) tracker._openMenuTrigger = undefined;
        } catch {
            // A trigger may already be destroyed while its owning view is being torn down.
        }
    }
}
