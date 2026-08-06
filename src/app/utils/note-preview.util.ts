// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const NOTE_PREVIEW_LINE_COUNT = 2;

function getNormalizedNoteLines(note: string | null | undefined): string[] {
    const normalizedNote = (note ?? '').trim();
    return normalizedNote ? normalizedNote.split(/\r?\n/) : [];
}

export function hasVisibleNoteText(note: string | null | undefined): boolean {
    return getNormalizedNoteLines(note).length > 0;
}