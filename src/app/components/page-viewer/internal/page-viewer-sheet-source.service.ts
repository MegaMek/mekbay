// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable } from '@angular/core';

import {
    RecordSheetSourceService,
    type RecordSheetSourceMode,
} from '../../../services/record-sheet-source.service';
import type { PageViewerMember } from './types';

interface RetainedSheet {
    readonly svg: SVGSVGElement;
}

/** Loads pristine sheet artwork. Runtime state is bound separately and never read from the SVG. */
@Injectable()
export class PageViewerSheetSourceService {
    private readonly retained = new Map<string, RetainedSheet>();
    private readonly pending = new Map<string, Promise<void>>();

    constructor(private readonly source: RecordSheetSourceService) { }

    mode(): RecordSheetSourceMode {
        return this.source.mode();
    }

    async load(member: PageViewerMember): Promise<void> {
        const mode = this.mode();
        const key = this.key(member, mode);
        if (this.retained.has(key)) return;
        const existing = this.pending.get(key);
        if (existing) return existing;
        const pending = this.loadRetained(member, key, mode).finally(() => this.pending.delete(key));
        this.pending.set(key, pending);
        return pending;
    }

    svg(member: PageViewerMember): SVGSVGElement | null {
        return this.retained.get(this.key(member, this.mode()))?.svg ?? null;
    }

    clear(): void {
        this.retained.clear();
        this.pending.clear();
    }

    private async loadRetained(
        member: PageViewerMember,
        key: string,
        mode: RecordSheetSourceMode,
    ): Promise<void> {
        const unit = member.force.getUnitSnapshot(member.id);
        if (!unit) throw new Error('The selected Classic unit is no longer admitted');
        const result = await this.source.load(member.summary, unit.entity, {}, mode);
        const svg = result.svgs[0];
        if (!svg) throw new Error(`No record-sheet artwork is available for ${member.summary.name}`);
        if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
        svg.removeAttribute('id');
        svg.setAttribute('aria-label', `${member.summary.name} record sheet`);
        this.retained.set(key, Object.freeze({ svg }));
    }

    private key(member: PageViewerMember, mode: RecordSheetSourceMode): string {
        return `${mode}\u0000${member.force.instanceId() ?? 'unsaved'}\u0000${member.id}\u0000${member.summary.hash}`;
    }
}
