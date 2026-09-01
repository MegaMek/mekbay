// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';

import { RecordSheetSourceService } from '../../../services/record-sheet-source.service';
import type { PageViewerMember } from './types';
import { addRecordSheetPageFlipControls } from './record-sheet-page-flip';

/** Lazily generates a member-owned sheet. Runtime state is bound separately. */
@Injectable()
export class PageViewerSheetSourceService {
    private readonly source = inject(RecordSheetSourceService);

    async load(member: PageViewerMember): Promise<void> {
        const pages = await member.loadRecordSheets(async () => {
            const unit = member.force.getUnitSnapshot(member.id);
            if (!unit) throw new Error('The selected CBT unit is no longer admitted');
            const result = await this.source.load(unit.entity);
            if (result.svgs.length === 0) {
                throw new Error(`No record sheet is available for ${member.entity.displayName()}`);
            }
            if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
            const svgs = result.svgs.map(svg => {
                svg.removeAttribute('id');
                return svg;
            });
            return svgs;
        });
        addRecordSheetPageFlipControls(pages);
    }
}
