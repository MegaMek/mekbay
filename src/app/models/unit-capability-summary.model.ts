// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export interface UnitTagCapabilitySummary {
    readonly label: 'TAG' | 'LTAG';
    readonly unavailable: boolean;
}

export interface UnitEcmCapabilitySummary {
    readonly mode: string;
    readonly unavailable: boolean;
}

/** Narrow immutable projection used by TAG and ECM capability badges. */
export interface UnitTagEcmCapabilitySummary {
    readonly tag: UnitTagCapabilitySummary | null;
    readonly ecm: UnitEcmCapabilitySummary | null;
}

export interface UnitTagCapabilityFact {
    readonly light: boolean;
    readonly available: boolean;
}

export interface UnitEcmCapabilityFact {
    readonly mode: string;
    readonly available: boolean;
}

export function createUnitTagEcmCapabilitySummary(input: {
    readonly tag?: UnitTagCapabilitySummary | null;
    readonly ecm?: UnitEcmCapabilitySummary | null;
}): UnitTagEcmCapabilitySummary {
    return Object.freeze({
        tag: input.tag ? Object.freeze({ ...input.tag }) : null,
        ecm: input.ecm ? Object.freeze({ ...input.ecm }) : null,
    });
}

/** Selects the first available capability, retaining the first installed fallback. */
export function resolveUnitTagEcmCapabilitySummary(input: {
    readonly tags: readonly UnitTagCapabilityFact[];
    readonly ecms: readonly UnitEcmCapabilityFact[];
}): UnitTagEcmCapabilitySummary {
    const availableTag = input.tags.find(candidate => candidate.available);
    const selectedTag = availableTag ?? input.tags[0];
    const availableEcm = input.ecms.find(candidate => candidate.available);
    const selectedEcm = availableEcm ?? input.ecms[0];
    return createUnitTagEcmCapabilitySummary({
        tag: selectedTag ? {
            label: selectedTag.light ? 'LTAG' : 'TAG',
            unavailable: !availableTag,
        } : null,
        ecm: selectedEcm ? {
            mode: selectedEcm.mode,
            unavailable: !availableEcm,
        } : null,
    });
}

export function resolveAlphaStrikeTagEcmCapabilitySummary(
    specials: readonly string[],
): UnitTagEcmCapabilitySummary {
    const tag = specials.includes('TAG')
        ? { label: 'TAG' as const, unavailable: false }
        : specials.includes('LTAG')
            ? { label: 'LTAG' as const, unavailable: false }
            : null;
    const mode = specials.find(special => special === 'ECM' || special === 'AECM' || special === 'LECM');
    return createUnitTagEcmCapabilitySummary({
        tag,
        ecm: mode ? { mode, unavailable: false } : null,
    });
}
