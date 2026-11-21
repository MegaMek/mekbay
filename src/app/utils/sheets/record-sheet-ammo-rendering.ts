// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { layoutRecordSheetAmmo } from '../record-sheet-ammo.util';
import { measureSvgTextCanvas } from '../svg-text.util';

/** One group of ammo lines: the bins one kind of CASE protects, or the unprotected ones, under their own prefix. */
export interface RecordSheetAmmoSection {
    readonly prefix: string;
    readonly entries: readonly string[];
    /** The bins' components, so a live sheet can total them again. */
    readonly componentIds: readonly string[];
}

interface AmmoProfileMetrics {
    readonly width: number;
    readonly fontSize: number;
}

interface AmmoProfileGeometry extends AmmoProfileMetrics {
    readonly x: number;
    /** Baseline of the final row; additional rows grow upward into the inventory. */
    readonly y: number;
    readonly lineHeight: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const AMMO_FONT = 'Roboto, Arial, sans-serif';

/** Marks rows authored as if the ammo profile were empty; they rise by the profile's height. */
export function markAmmoBefore(group: SVGGElement): void {
    group.setAttribute('data-ammo-before', '');
}

export function measureRecordSheetAmmoProfile(
    sections: readonly Pick<RecordSheetAmmoSection, 'prefix' | 'entries'>[],
    options: AmmoProfileMetrics,
) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('font-size', String(options.fontSize));
    text.setAttribute('font-family', AMMO_FONT);
    text.setAttribute('font-weight', 'normal');
    const layouts = sections.map(section => layoutRecordSheetAmmo(section.entries, options.width,
        value => measureSvgTextCanvas(text, value), section.prefix));
    // One horizontal scale for the whole profile
    return {
        lines: layouts.flatMap(layout => layout.lines),
        widths: layouts.flatMap(layout => layout.widths),
        scale: Math.min(1, ...layouts.map(layout => layout.scale)),
    };
}

export function appendRecordSheetAmmoProfile(
    parent: SVGElement,
    sections: readonly RecordSheetAmmoSection[],
    options: AmmoProfileGeometry,
): SVGGElement {
    const profile = document.createElementNS(SVG_NS, 'g');
    profile.id = 'ammoProfile';
    profile.setAttribute('data-x', String(options.x));
    profile.setAttribute('data-y', String(options.y));
    profile.setAttribute('data-width', String(options.width));
    profile.setAttribute('data-font-size', String(options.fontSize));
    profile.setAttribute('data-line-height', String(options.lineHeight));
    profile.setAttribute('data-sections', JSON.stringify(sections.map(({ prefix, componentIds }) => ({ prefix, componentIds }))));
    parent.appendChild(profile);
    updateRecordSheetAmmoProfile(profile, sections);
    return profile;
}

/** The printed sections' prefixes and bins, in print order. */
export function recordSheetAmmoProfileSections(profile: SVGElement): readonly Pick<RecordSheetAmmoSection, 'prefix' | 'componentIds'>[] {
    return JSON.parse(profile.getAttribute('data-sections') ?? '[]');
}

/** Rebuild only ammo rows; retain the group's interaction handlers and layout anchors. */
export function updateRecordSheetAmmoProfile(
    profile: SVGElement,
    sections: readonly Pick<RecordSheetAmmoSection, 'prefix' | 'entries'>[],
    interactive = false,
): void {
    const x = Number(profile.getAttribute('data-x'));
    const y = Number(profile.getAttribute('data-y'));
    const width = Number(profile.getAttribute('data-width'));
    const fontSize = Number(profile.getAttribute('data-font-size'));
    const lineHeight = Number(profile.getAttribute('data-line-height'));
    const layout = measureRecordSheetAmmoProfile(sections, { width, fontSize });
    profile.replaceChildren(...layout.lines.map((value, index) => {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y - (layout.lines.length - 1 - index) * lineHeight));
        text.setAttribute('font-size', String(fontSize));
        text.setAttribute('font-family', AMMO_FONT);
        text.textContent = value;
        if (layout.scale < 1) {
            text.setAttribute('textLength', String(layout.widths[index] * layout.scale));
            text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
        return text;
    }));

    const height = layout.lines.length * lineHeight;
    if (interactive && height > 0) {
        const hitArea = document.createElementNS(SVG_NS, 'rect');
        hitArea.setAttribute('class', 'inventoryEntryButton');
        hitArea.setAttribute('x', String(x));
        hitArea.setAttribute('y', String(y - height + lineHeight - fontSize));
        hitArea.setAttribute('width', String(width));
        hitArea.setAttribute('height', String(height));
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('pointer-events', 'all');
        profile.prepend(hitArea);
    }
    const parent = profile.parentElement;
    parent?.querySelectorAll<SVGGElement>(':scope > [data-ammo-before]').forEach(group => {
        group.setAttribute('transform', `translate(0 ${-height})`);
    });
}
