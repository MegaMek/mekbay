// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

const PRESENTATION_PROPERTIES = [
    'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variation-settings',
    'letter-spacing', 'word-spacing', 'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'text-decoration', 'text-transform', 'white-space', 'mix-blend-mode', 'isolation',
    'paint-order', 'opacity', 'visibility', 'display', 'filter', 'clip-path', 'mask',
    'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'color-interpolation-filters',
];

/** Freeze the displayed card's theme before detaching it from Angular and its host CSS. */
export function snapshotAlphaStrikeCard(svg: SVGSVGElement): SVGSVGElement {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const sources = [svg, ...svg.querySelectorAll<SVGElement>('*')];
    const targets = [clone, ...clone.querySelectorAll<SVGElement>('*')];
    sources.forEach((source, index) => {
        const computed = getComputedStyle(source);
        const target = targets[index];
        for (const property of PRESENTATION_PROPERTIES) {
            // Computed SVG references become document URLs. Keep references local to the exported SVG.
            const value = computed.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^"')]+)["']?\)/g, 'url(#$1)');
            if (value) target.style.setProperty(property, value);
        }
    });
    clone.querySelectorAll('[data-screen-only], .screen-only').forEach(element => element.remove());
    const { width, height } = svg.viewBox.baseVal;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.style.removeProperty('width');
    clone.style.removeProperty('height');
    return clone;
}
