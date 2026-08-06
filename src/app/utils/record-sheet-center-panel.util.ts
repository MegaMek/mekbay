// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

const CENTER_MARKER = '[data-mekbay-region="center-panel"]';
const CENTER_IDS = [
    'fluffSinglePilot', 'fluffDualPilot', 'fluffTriplePilot', 'fluffImage',
    'fluff-image-fo', 'fluff-image-injected',
] as const;

/** Finds the generated SVG element that defines the center-panel rectangle. */
export function resolveCenterPanelElement(svg: SVGSVGElement): SVGGraphicsElement | null {
    const marked = svg.querySelector<SVGGraphicsElement>(CENTER_MARKER);
    if (marked) return marked;
    for (const id of CENTER_IDS) {
        const element = svg.getElementById(id);
        if (element instanceof SVGGraphicsElement) return element;
    }
    return null;
}

/** Returns the center-panel reference tables, excluding unrelated side charts. */
export function resolveCenterPanelTables(svg: SVGSVGElement): readonly SVGGraphicsElement[] {
    const tables = [...svg.querySelectorAll<SVGGraphicsElement>('.referenceTable')];
    const center = resolveCenterPanelElement(svg);
    if (!center) return tables;
    const centerBounds = elementClientBounds(center);
    if (!centerBounds) return tables;
    return tables
        .filter(table => {
            const tableBounds = elementClientBounds(table);
            return tableBounds ? rectanglesOverlap(centerBounds, tableBounds) : false;
        });
}

/**
 * Returns the center-panel elements that can receive a center-panel tap.
 *
 * Hidden elements are included so a listener remains available when the
 * center-panel option changes after interaction setup.
 */
export function resolveCenterPanelInteractiveElements(svg: SVGSVGElement): readonly SVGGraphicsElement[] {
    const tables = resolveCenterPanelTables(svg);
    const targets: SVGGraphicsElement[] = [];

    const marked = svg.querySelector<SVGGraphicsElement>(CENTER_MARKER);
    if (marked) targets.push(marked);
    for (const id of CENTER_IDS) {
        const element = svg.getElementById(id);
        if (element instanceof SVGGraphicsElement && !targets.includes(element)) targets.push(element);
    }
    for (const table of tables) {
        if (!targets.includes(table)) targets.push(table);
    }

    return targets;
}

/**
 * Returns center-panel elements that are safe to decorate with a pointer cursor.
 *
 * Keep foreignObject nodes as delegated click targets, but do not mutate their
 * inline styles. iOS WebKit can lose positioned foreignObject compositing when
 * a cursor style changes while night-mode filters and blending are active.
 */
export function resolveCenterPanelCursorElements(svg: SVGSVGElement): readonly SVGGraphicsElement[] {
    return resolveCenterPanelInteractiveElements(svg)
        .filter(element => element.localName !== 'foreignObject');
}

/** Tests whether an event target belongs to a center-panel presentation element. */
export function isCenterPanelTarget(svg: SVGSVGElement, target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return resolveCenterPanelInteractiveElements(svg)
        .some(element => element === target || element.contains(target));
}

/** Tests whether a pointer location is inside the generated center panel. */
export function isPointInCenterPanel(svg: SVGSVGElement, clientX: number, clientY: number): boolean {
    const center = resolveCenterPanelElement(svg);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    if (center) {
        const bounds = elementClientBounds(center);
        if (bounds && containsPoint(bounds, clientX, clientY)) return true;
    }

    return resolveCenterPanelTables(svg)
        .some(table => {
            const tableBounds = elementClientBounds(table);
            return tableBounds ? containsPoint(tableBounds, clientX, clientY) : false;
        });
}

/** Resolves the nearest SVG center panel for an event target and pointer position. */
export function isCenterPanelEvent(event: Event): boolean {
    const target = event.target instanceof Element ? event.target : null;
    const svg = target?.closest('svg');
    if (!(svg instanceof SVGSVGElement)) return false;

    if (isCenterPanelTarget(svg, target)) return true;

    const pointer = event as MouseEvent;
    if (Number.isFinite(pointer.clientX) && Number.isFinite(pointer.clientY)) {
        return isPointInCenterPanel(svg, pointer.clientX, pointer.clientY);
    }

    return false;
}

function containsPoint(bounds: DOMRect, clientX: number, clientY: number): boolean {
    return clientX >= bounds.left && clientX <= bounds.right
        && clientY >= bounds.top && clientY <= bounds.bottom;
}

function elementClientBounds(element: SVGGraphicsElement): DOMRect | null {
    const bounds = element.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) return bounds;

    try {
        const box = element.getBBox();
        const matrix = element.getScreenCTM();
        if (matrix && box.width > 0 && box.height > 0) {
            const points = [
                new DOMPoint(box.x, box.y),
                new DOMPoint(box.x + box.width, box.y),
                new DOMPoint(box.x, box.y + box.height),
                new DOMPoint(box.x + box.width, box.y + box.height),
            ].map(point => point.matrixTransform(matrix));
            const left = Math.min(...points.map(point => point.x));
            const top = Math.min(...points.map(point => point.y));
            const right = Math.max(...points.map(point => point.x));
            const bottom = Math.max(...points.map(point => point.y));
            return new DOMRect(left, top, right - left, bottom - top);
        }

    } catch {
        // Some SVG implementations throw when getBBox() is called on hidden nodes.
    }

    return null;
}

function rectanglesOverlap(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
