// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import { merge } from 'rxjs';

import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../../../models/mek-sheet-binding';
import type { CBTMekForceMember } from '../../../models/force-member.model';
import type { MekRecordSheetSnapshot } from '../../../models/runtime/mek-record-sheet';
import { LoggerService } from '../../../services/logger.service';
import {
    bindMekRecordSheet,
    type MekRecordSheetBinding,
} from '../mek-record-sheet-binder';
import { PageViewerMekInteractionService } from './page-viewer-mek-interaction.service';

interface BoundMekSheet {
    readonly member: CBTMekForceMember;
    readonly svg: SVGSVGElement;
    readonly binding: MekRecordSheetBinding;
    readonly subscription: { unsubscribe(): void };
}

/** Binds Entity + typed runtime state to the established page-viewer SVG. */
@Injectable()
export class PageViewerMekRuntimeService {
    private readonly interactions = inject(PageViewerMekInteractionService);
    private readonly logger = inject(LoggerService);
    private readonly bound = new Map<string, BoundMekSheet>();

    bind(member: CBTMekForceMember, svg: SVGSVGElement): boolean {
        const existing = this.bound.get(member.id);
        if (existing?.svg === svg && existing.member === member) {
            this.render(member);
            return true;
        }
        this.destroyBinding(member.id);

        const snapshot = this.requiredSnapshot(member);
        svg.classList.toggle('read-only', member.force.readOnly());
        const binding = bindMekRecordSheet(
            svg,
            MM_DATA_MEK_SHEET_BINDING_MANIFEST,
            snapshot,
            member.force.readOnly()
                ? undefined
                : (interaction, event) => this.interactions.handle(member, interaction, event),
        );
        const subscription = merge(member.force.changed, member.force.sessionChanged).subscribe(changedUnitIds => {
            if (changedUnitIds?.includes(member.id) ?? true) this.render(member);
        });
        this.bound.set(member.id, { member, svg, binding, subscription });
        return true;
    }

    isPickerOpen(unitId: string): boolean {
        return this.interactions.isPickerOpen(unitId);
    }

    cleanupUnused(keepUnitIds: ReadonlySet<string>): void {
        for (const unitId of [...this.bound.keys()]) {
            if (!keepUnitIds.has(unitId)) this.destroyBinding(unitId);
        }
    }

    clear(): void {
        for (const unitId of [...this.bound.keys()]) this.destroyBinding(unitId);
        this.interactions.clear();
    }

    private requiredSnapshot(member: CBTMekForceMember): MekRecordSheetSnapshot {
        const snapshot = member.mekRecordSheetSnapshot();
        if (!snapshot) throw new Error('The selected Mek is no longer admitted');
        return snapshot;
    }

    private render(member: CBTMekForceMember): void {
        const current = this.bound.get(member.id);
        const snapshot = member.mekRecordSheetSnapshot();
        if (!current || current.member !== member || !snapshot) return;
        const issues = current.binding.render(snapshot);
        if (issues.length > 0) {
            this.logger.warn(`Record-sheet layout omissions for ${snapshot.identity.displayName}: ${issues.join('; ')}`);
        }
    }

    private destroyBinding(unitId: string): void {
        const current = this.bound.get(unitId);
        if (!current) return;
        current.subscription.unsubscribe();
        current.binding.destroy();
        this.bound.delete(unitId);
        this.interactions.cleanup(unitId);
    }
}
