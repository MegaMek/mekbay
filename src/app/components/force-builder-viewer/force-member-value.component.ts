// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ForceMember } from '../../models/force-member.model';
import { OptionsService } from '../../services/options.service';
import { formatForceMembersBvPv } from '../../utils/force-viewer-bv-pv-display.util';

/** Keeps runtime BV/PV updates local instead of invalidating the full force viewer. */
@Component({
    selector: 'force-member-value',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '{{ value() }}',
})
export class ForceMemberValueComponent {
    private readonly options = inject(OptionsService);

    readonly members = input.required<readonly ForceMember[]>();

    readonly value = computed(() => {
        const members = this.members();
        return formatForceMembersBvPv(
            members,
            this.options.options().forceViewerBVPVDisplay,
            this.options.options().forceViewerBVPVDisplayDamage,
        );
    });
}
