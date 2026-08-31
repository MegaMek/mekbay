// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';

import { RecordSheetSourceService } from '../../../services/record-sheet-source.service';
import type { PageViewerMember } from './types';

/** Lazily generates a member-owned sheet. Runtime state is bound separately. */
@Injectable()
export class PageViewerSheetSourceService {
    private readonly source = inject(RecordSheetSourceService);

    async load(member: PageViewerMember): Promise<void> {
        await member.loadRecordSheet(async () => {
            const unit = member.force.getUnitSnapshot(member.id);
            if (!unit) throw new Error('The selected Classic unit is no longer admitted');
            const identity = member.force.getUnitSourceIdentity(member.id);
            const result = await this.source.load(unit.entity, {}, {
                ...(identity ? { design: identity } : {}),
            });
            const svg = result.svgs[0];
            if (!svg) throw new Error(`No record sheet is available for ${member.entity.displayName()}`);
            if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
            svg.removeAttribute('id');
            svg.setAttribute('aria-label', `${member.entity.displayName()} record sheet`);
            return svg;
        });
    }
}
