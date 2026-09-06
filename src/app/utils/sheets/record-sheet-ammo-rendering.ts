// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { layoutRecordSheetAmmo } from '../record-sheet-ammo.util';
import { measureSvgTextCanvas } from '../svg-text.util';

interface AmmoProfileMetrics {
    readonly width: number;
    readonly fontSize: number;
    readonly prefix?: string;
}

interface AmmoProfileGeometry extends AmmoProfileMetrics {
    readonly x: number;
    /** Baseline of the final row; additional rows grow upward into the inventory. */
    readonly y: number;
    readonly lineHeight: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const AMMO_FONT = 'Roboto, Arial, sans-serif';

export function measureRecordSheetAmmoProfile(entries: readonly string[], options: AmmoProfileMetrics) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('font-size', String(options.fontSize));
    text.setAttribute('font-family', AMMO_FONT);
    text.setAttribute('font-weight', 'normal');
    return layoutRecordSheetAmmo(entries, options.width,
        value => measureSvgTextCanvas(text, value), options.prefix);
}

export function appendRecordSheetAmmoProfile(
    parent: SVGElement,
    entries: readonly string[],
    options: AmmoProfileGeometry,
): SVGGElement {
    const profile = document.createElementNS(SVG_NS, 'g');
    profile.id = 'ammoProfile';
    profile.setAttribute('data-x', String(options.x));
    profile.setAttribute('data-y', String(options.y));
    profile.setAttribute('data-width', String(options.width));
    profile.setAttribute('data-font-size', String(options.fontSize));
    profile.setAttribute('data-line-height', String(options.lineHeight));
    profile.setAttribute('data-prefix', options.prefix ?? 'Ammo:');
    parent.appendChild(profile);
    updateRecordSheetAmmoProfile(profile, entries);
    return profile;
}

/** Rebuild only ammo rows; retain the group's interaction handlers and layout anchors. */
export function updateRecordSheetAmmoProfile(
    profile: SVGElement,
    entries: readonly string[],
    interactive = false,
): void {
    const x = Number(profile.getAttribute('data-x'));
    const y = Number(profile.getAttribute('data-y'));
    const width = Number(profile.getAttribute('data-width'));
    const fontSize = Number(profile.getAttribute('data-font-size'));
    const lineHeight = Number(profile.getAttribute('data-line-height'));
    const prefix = profile.getAttribute('data-prefix') ?? 'Ammo:';
    const layout = measureRecordSheetAmmoProfile(entries, { width, fontSize, prefix });
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
    parent?.querySelectorAll<SVGGElement>(':scope > [data-ammo-inventory]').forEach(group => {
        const top = Number(group.getAttribute('data-top'));
        const bottom = Number(group.getAttribute('data-bottom')) - height;
        const contentBottom = Number(group.getAttribute('data-content-bottom'));
        const scale = contentBottom > top ? Math.min(1, Math.max(0, bottom - top) / (contentBottom - top)) : 1;
        group.setAttribute('transform', `translate(0 ${top * (1 - scale)}) scale(1 ${scale})`);
    });
}
