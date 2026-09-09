// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';

import { RecordSheetSourceService } from '../../../services/record-sheet-source.service';
import { OptionsService } from '../../../services/options.service';
import { UnitFluffImageService } from '../../../services/catalogs/unit-fluff-image.service';
import type { PageViewerMember } from './types';
import { addRecordSheetPageFlipControls } from './record-sheet-page-flip';

/** Lazily generates a member-owned sheet. Runtime state is bound separately. */
@Injectable()
export class PageViewerSheetSourceService {
    private readonly source = inject(RecordSheetSourceService);
    private readonly fluffImages = inject(UnitFluffImageService);
    private readonly options = inject(OptionsService);

    async load(member: PageViewerMember): Promise<void> {
        await this.fluffImages.initialize();
        const fluffImageUrl = this.fluffImages.resolveEntityUrl(member.entity);
        const pipLayout = this.options.options().recordSheetPipLayout;
        const pageFormat = this.options.options().printAllOptions.paperSize;
        const showQuirks = this.options.options().CBTOptionalRules?.quirks !== false;
        const pages = await member.loadRecordSheets(async () => {
            const unit = member.force.getUnitSnapshot(member.id);
            if (!unit) throw new Error('The selected CBT unit is no longer admitted');
            const result = await this.source.load(unit.entity, { pipLayout, showQuirks, format: pageFormat, pageFormat, fluffImageUrl });
            if (result.svgs.length === 0) {
                throw new Error(`No record sheet is available for ${member.entity.displayName()}`);
            }
            if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
            const svgs = result.svgs.map(svg => {
                svg.removeAttribute('id');
                return svg;
            });
            return svgs;
        }, pipLayout, pageFormat, showQuirks, fluffImageUrl);
        addRecordSheetPageFlipControls(pages);
    }
}
