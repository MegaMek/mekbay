// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONTROL_CLASS = 'record-sheet-page-flip-control';
const CONTROL_SIZE = 50;

/** Adds one compact, accessible page switch to every page in a multi-page sheet. */
export function addRecordSheetPageFlipControls(svgs: readonly SVGSVGElement[]): void {
    if (svgs.length < 2) return;
    svgs.forEach((svg, pageIndex) => addRecordSheetPageFlipControl(svg, pageIndex, svgs.length));
}

function recordSheetPageFlipControl(svg: SVGSVGElement): SVGGElement | null {
    return svg.querySelector<SVGGElement>(`:scope > .${CONTROL_CLASS}`);
}

function addRecordSheetPageFlipControl(
    svg: SVGSVGElement,
    pageIndex: number,
    pageCount: number,
): void {
    recordSheetPageFlipControl(svg)?.remove();
    const viewBox = parseViewBox(svg);
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add(CONTROL_CLASS);
    group.classList.add('interactive');
    group.dataset['nextPageIndex'] = String((pageIndex + 1) % pageCount);
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('focusable', 'true');
    group.setAttribute('aria-label', `Show record sheet page ${(pageIndex + 1) % pageCount + 1} of ${pageCount}`);
    group.setAttribute('transform', `translate(${viewBox.x + viewBox.width - CONTROL_SIZE} ${viewBox.y + viewBox.height - CONTROL_SIZE})`);
    group.style.cursor = 'pointer';

    const corner = document.createElementNS(SVG_NS, 'polygon');
    corner.setAttribute('points', `0,${CONTROL_SIZE} ${CONTROL_SIZE},0 ${CONTROL_SIZE},${CONTROL_SIZE}`);
    corner.setAttribute('fill', '#fff');
    corner.setAttribute('stroke', '#000');
    corner.setAttribute('stroke-width', '1.932');
    corner.setAttribute('stroke-linejoin', 'round');
    group.appendChild(corner);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(CONTROL_SIZE * 5 / 7 - 1));
    label.setAttribute('y', String(CONTROL_SIZE * 5 / 7 + 4));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'Arial, sans-serif');
    label.setAttribute('font-size', '12');
    label.setAttribute('font-weight', '700');
    label.setAttribute('pointer-events', 'none');
    label.textContent = `${pageIndex + 1}/${pageCount}`;
    group.appendChild(label);

    const hitTarget = document.createElementNS(SVG_NS, 'polygon');
    hitTarget.setAttribute('points', `0,${CONTROL_SIZE} ${CONTROL_SIZE},0 ${CONTROL_SIZE},${CONTROL_SIZE}`);
    hitTarget.setAttribute('fill', 'transparent');
    hitTarget.setAttribute('pointer-events', 'all');
    group.appendChild(hitTarget);
    svg.appendChild(group);
}

function parseViewBox(svg: SVGSVGElement): Readonly<{ x: number; y: number; width: number; height: number }> {
    const values = (svg.getAttribute('viewBox') ?? '')
        .trim()
        .split(/[\s,]+/u)
        .map(Number);
    if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
        return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
    const width = Number.parseFloat(svg.getAttribute('width') ?? '612');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '792');
    return {
        x: 0,
        y: 0,
        width: Number.isFinite(width) && width > 0 ? width : 612,
        height: Number.isFinite(height) && height > 0 ? height : 792,
    };
}
