// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Fresh damage/repair display time in milliseconds. Zero or negative keeps it until the next change. */
export const RECORD_SHEET_FRESH_DAMAGE_DURATION_MS = 3000;

export interface RecordSheetDamageFacts {
    readonly maximum: number;
    readonly committedRemaining: number;
    readonly previewRemaining: number;
}

interface DamageHighlightTrack {
    facts: RecordSheetDamageFacts;
    previousPreview: number | undefined;
    paint: (previousPreview?: number) => void;
    timer?: ReturnType<typeof setTimeout>;
}

/** One sheet's transient damage highlights. Gameplay state is never changed by expiration. */
export class RecordSheetDamageHighlights {
    private readonly tracks = new Map<SVGElement, DamageHighlightTrack>();

    constructor(private readonly durationMs = RECORD_SHEET_FRESH_DAMAGE_DURATION_MS) {}

    render(
        key: SVGElement,
        facts: RecordSheetDamageFacts,
        markChanges: boolean,
        paint: (previousPreview?: number) => void,
    ): void {
        let track = this.tracks.get(key);
        if (track === undefined) {
            track = { facts, previousPreview: undefined, paint };
            this.tracks.set(key, track);
        } else {
            track.paint = paint;
            if (!markChanges
                || facts.maximum !== track.facts.maximum
                || facts.committedRemaining !== track.facts.committedRemaining
                || facts.previewRemaining !== track.facts.previewRemaining) {
                clearTimeout(track.timer);
                track.timer = undefined;
                track.previousPreview = markChanges ? track.facts.previewRemaining : undefined;
                track.facts = facts;
                if (track.previousPreview !== undefined
                    && track.previousPreview !== facts.previewRemaining
                    && this.durationMs > 0) {
                    const active = track;
                    active.timer = setTimeout(() => {
                        active.timer = undefined;
                        active.previousPreview = undefined;
                        active.paint();
                    }, this.durationMs);
                }
            }
        }
        track.paint(track.previousPreview);
    }

    destroy(): void {
        for (const track of this.tracks.values()) clearTimeout(track.timer);
        this.tracks.clear();
    }
}
