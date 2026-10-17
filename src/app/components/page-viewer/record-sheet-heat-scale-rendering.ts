// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { recordSheetHeatEffects } from '../../models/runtime/heat-effect-presentation';
import type { RecordSheetHeatScale } from '../../models/runtime/record-sheet-heat-scale';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import type { RecordSheetBind } from './record-sheet-dom';
import { renderRecordSheetHeatEffects } from './record-sheet-heat-effects';
import type { RecordSheetInteraction } from './record-sheet-interaction';

/** Heat effect table a heat scale follows. */
export type HeatScaleFamily = 'mek' | 'lam' | 'aero';

const HEAT_PROJECTION_ORIGINAL_STROKE = 'data-mekbay-original-projection-stroke';

/** The heat a scale shows: the pending arrow, otherwise the current heat. */
export function displayedHeat(scale: Pick<RecordSheetHeatScale, 'current' | 'pending'>): number {
    return Math.max(0, scale.pending ?? scale.current);
}

/**
 * Heat scale presentation shared by every heat-tracking record sheet: hot cells, effect highlights, the overflow
 * box, the heat panel's pending state, the NOW/NEXT/previous/projection arrows and the projection bar.
 */
export function renderRecordSheetHeatScale(
    svg: SVGSVGElement,
    scale: RecordSheetHeatScale,
    family: HeatScaleFamily,
    bindCell: (element: SVGElement, heat: number) => void,
): void {
    const cells = [...svg.querySelectorAll<SVGElement>('#heatScale .heat[heat]')]
        .map(element => ({ element, heat: Number(element.getAttribute('heat')) }))
        .filter((cell): cell is { element: SVGElement; heat: number } => Number.isFinite(cell.heat));
    const highestHeat = cells.reduce((highest, cell) => Math.max(highest, cell.heat), 0);
    const current = displayedHeat(scale);
    cells.forEach(({ element, heat }) => {
        element.classList.toggle('hot', heat <= current);
        bindCell(element, heat);
    });
    renderRecordSheetHeatEffects(svg, recordSheetHeatEffects(family, current));
    const overflow = svg.querySelector<SVGElement>('#heatScale .overflowFrame');
    overflow?.classList.toggle('hot', current > highestHeat);
    const overflowText = svg.querySelector<SVGElement>('#heatScale .overflowText');
    if (overflowText) overflowText.textContent = current > highestHeat ? String(current) : '';

    const pending = scale.pending;
    const panel = svg.querySelector<SVGElement>('#heatDataPanel');
    panel?.classList.toggle('dirtyHeat', pending !== undefined);
    panel?.classList.toggle('heatApplicationAvailable', pending !== undefined);
    panel?.classList.toggle('hot', pending !== undefined && pending >= scale.current);
    panel?.classList.toggle('cold', pending !== undefined && pending < scale.current);
    renderHeatArrows(svg, scale, highestHeat);
    renderHeatProjectionGraphics(svg, scale, highestHeat);
}

/**
 * The heat panel's controls: the overflow box asks for a heat, APPLY HEAT applies the arrow, and the heat-sink count
 * and pips pick how many heat sinks are active.
 */
export function bindRecordSheetHeatControls(svg: SVGSVGElement, bind: RecordSheetBind, context: () => UnitEditContext): void {
    const control = (kind: 'heat-overflow' | 'apply-heat' | 'heat-sinks-off') => () => Object.freeze({ kind, context: context() });
    // The frame is painted over the transparent button, so both take the click.
    svg.querySelectorAll<SVGElement>('#heatScale .overflowButton, #heatScale .overflowFrame')
        .forEach(element => bind(element, control('heat-overflow'), 'control'));
    svg.querySelectorAll<SVGElement>('#applyHeatButton').forEach(element => bind(element, control('apply-heat'), 'control'));
    svg.querySelectorAll<SVGElement>('#hsCount, .hsPips, [data-mekbay-field="heat-sinks"]')
        .forEach(element => bind(element, control('heat-sinks-off'), 'control'));
}

export interface HeatCellBinding {
    readonly svg: SVGSVGElement;
    readonly onInteraction: (interaction: RecordSheetInteraction, event: Event) => void;
    readonly signal: AbortSignal;
    readonly context: () => UnitEditContext;
    readonly displayedHeat: () => number;
    readonly family: HeatScaleFamily;
}

/**
 * Binds one heat cell until the binding's signal aborts: a click sets its heat, and dragging along the scale previews a
 * heat before setting it. Its events stay on the sheet, so a drag never pans the page.
 */
export function bindRecordSheetHeatCell(element: SVGElement, heat: number, binding: HeatCellBinding): void {
    if (element.dataset['mekbayHeatBound'] === '1') return;
    element.dataset['mekbayHeatBound'] = '1';
    element.classList.add('interactive');
    element.setAttribute('tabindex', '0');
    binding.signal.addEventListener('abort', () => {
        delete element.dataset['mekbayHeatBound'];
        element.classList.remove('interactive');
        element.removeAttribute('tabindex');
    }, { once: true });
    const emit = (interaction: RecordSheetInteraction, event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        binding.onInteraction(interaction, event);
    };
    const interaction = (value = heat): RecordSheetInteraction => Object.freeze({
        kind: 'heat',
        heat: value,
        context: binding.context(),
    });
    const endPreview = (event: Event): void => emit(Object.freeze({
        kind: 'heat-preview-end',
        context: binding.context(),
    }), event);
    const preview = (value: number, target: SVGElement, event: Event): void => emit(Object.freeze({
        kind: 'heat-preview',
        heat: value,
        baselineHeat: binding.displayedHeat(),
        element: target,
        context: binding.context(),
    }), event);
    let suppressClick = false;
    element.addEventListener('click', event => {
        if (suppressClick) {
            suppressClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        emit(interaction(), event);
    }, { signal: binding.signal });
    element.addEventListener('pointerdown', event => {
        if (!(event instanceof PointerEvent) || event.button !== 0) return;
        let selected = heat;
        let moved = false;
        let selectedElement = element;
        let finished = false;
        preview(selected, selectedElement, event);
        element.dispatchEvent(new CustomEvent('svg-interaction-click', { bubbles: true }));
        const cleanup = (): void => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', finish, true);
            window.removeEventListener('pointercancel', cancel, true);
            binding.signal.removeEventListener('abort', abortDrag);
        };
        const move = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const cell = closestHeatCell(binding.svg, moveEvent.clientY);
            if (!cell || cell.heat === selected) return;
            selected = cell.heat;
            selectedElement = cell.element;
            moved = true;
            renderHeatPreview(binding.svg, selected, binding.family);
            preview(selected, selectedElement, moveEvent);
        };
        const finish = (upEvent: PointerEvent): void => {
            if (finished || upEvent.pointerId !== event.pointerId) return;
            finished = true;
            cleanup();
            endPreview(upEvent);
            if (moved) {
                suppressClick = true;
                emit(interaction(selected), upEvent);
            }
        };
        const cancel = (cancelEvent: PointerEvent): void => {
            if (finished || cancelEvent.pointerId !== event.pointerId) return;
            finished = true;
            cleanup();
            renderHeatPreview(binding.svg, binding.displayedHeat(), binding.family);
            endPreview(cancelEvent);
        };
        const abortDrag = (): void => {
            if (finished) return;
            finished = true;
            cleanup();
            renderHeatPreview(binding.svg, binding.displayedHeat(), binding.family);
        };
        window.addEventListener('pointermove', move, { capture: true, passive: false });
        window.addEventListener('pointerup', finish, { capture: true, passive: false });
        window.addEventListener('pointercancel', cancel, { capture: true, passive: false });
        binding.signal.addEventListener('abort', abortDrag, { once: true });
    }, { signal: binding.signal });
    element.addEventListener('keydown', event => {
        if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return;
        emit(interaction(), event);
    }, { signal: binding.signal });
}

function renderHeatArrows(
    svg: SVGSVGElement,
    scale: RecordSheetHeatScale,
    highestHeat: number,
): void {
    const showProjection = scale.automaticProjection;
    updateHeatArrow(svg, highestHeat, 'now-arrow', scale.current, 'current');
    updateHeatArrow(svg, highestHeat, 'next-arrow', scale.pending,
        scale.pending !== undefined && scale.pending >= scale.current ? 'hot' : 'cold');
    updateHeatArrow(svg, highestHeat, 'faded-arrow', scale.previous, 'previous');
    updateHeatArrow(svg, highestHeat, 'projection-arrow', showProjection ? scale.projection : undefined,
        (scale.projection ?? scale.current) > scale.current ? 'projection-hot' : 'projection-cold');
}

type HeatArrowStyle = 'current' | 'hot' | 'cold' | 'previous' | 'projection-hot' | 'projection-cold';

function updateHeatArrow(
    svg: SVGSVGElement,
    highestHeat: number,
    id: string,
    value: number | undefined,
    style: HeatArrowStyle,
): void {
    let arrow = svg.querySelector<SVGPolygonElement>(`#${id}`);
    if (value === undefined) {
        arrow?.remove();
        if (id === 'now-arrow') svg.querySelector('#now-arrow-label')?.remove();
        return;
    }
    const cell = heatElement(svg, value, highestHeat);
    const box = cell ? heatMarkerBox(cell) : null;
    if (!cell || !box) {
        arrow?.remove();
        if (id === 'now-arrow') svg.querySelector('#now-arrow-label')?.remove();
        return;
    }
    if (!arrow) {
        arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrow.setAttribute('id', id);
        arrow.setAttribute('class', 'screen-only');
        cell.parentElement?.appendChild(arrow);
    }
    const x = box.x + box.width + 2;
    const y = box.y + box.height / 2;
    arrow.setAttribute('points', `${x + 8},${y - 5} ${x},${y} ${x + 8},${y + 5}`);
    const projected = style === 'projection-hot' || style === 'projection-cold';
    const color = style === 'hot' || style === 'projection-hot'
        ? 'var(--hot-color)'
        : style === 'cold' || style === 'projection-cold'
            ? 'var(--cold-color)'
            : style === 'previous' ? '#aaa' : '#666';
    arrow.setAttribute('fill', projected || style === 'previous' ? 'none' : color);
    arrow.setAttribute('stroke', style === 'current' ? '#000' : color);
    arrow.setAttribute('stroke-width', '1');
    cell.parentElement?.appendChild(arrow);
    if (id === 'now-arrow') updateNowArrowLabel(cell.parentElement, x + 11, y);
}

function updateNowArrowLabel(parent: Element | null, x: number, y: number): void {
    if (!parent) return;
    let label = parent.querySelector<SVGTextElement>('#now-arrow-label');
    if (!label) {
        label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('id', 'now-arrow-label');
        label.setAttribute('class', 'screen-only');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-size', '5');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('fill', '#000');
        label.setAttribute('pointer-events', 'none');
        label.textContent = 'NOW';
        parent.appendChild(label);
    }
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(y));
    label.setAttribute('transform', `rotate(90 ${x} ${y})`);
}

function renderHeatProjectionGraphics(
    svg: SVGSVGElement,
    scale: RecordSheetHeatScale,
    highestHeat: number,
): void {
    const heatScale = svg.querySelector<SVGGElement>('#heatScale');
    if (!heatScale) return;
    const showProjection = scale.automaticProjection;
    if (showProjection && scale.projection !== undefined) {
        renderHeatProjectionBar(svg, heatScale, scale.current, scale.projection, highestHeat);
        heatScale.querySelector('#heat-projection-target-marker')?.remove();
        heatScale.querySelector('#heat-selected-weapons-target-marker')?.remove();
        return;
    }
    clearHeatProjectionPreview(heatScale);
    updateHeatTargetMarker(svg, heatScale, scale.projection, highestHeat,
        'heat-projection-target-marker', (scale.projection ?? scale.current) > scale.current ? '#d12020' : '#2070d1');
    updateHeatTargetMarker(svg, heatScale, scale.selectedWeapons, highestHeat,
        'heat-selected-weapons-target-marker', 'orange');
}

function renderHeatProjectionBar(
    svg: SVGSVGElement,
    heatScale: SVGGElement,
    current: number,
    projected: number,
    highestHeat: number,
): void {
    updateHeatProjectionOverflow(heatScale, projected, current, highestHeat);
    const startValue = Math.max(0, current);
    const targetValue = Math.max(0, Math.min(highestHeat, projected));
    const start = heatElement(svg, startValue, highestHeat);
    const target = heatElement(svg, targetValue, highestHeat);
    const zero = heatElement(svg, 0, highestHeat);
    const startCenter = start ? heatMarkerCenter(start) : null;
    const targetCenter = target
        ? projected > highestHeat ? heatMarkerTopCenter(target) : heatMarkerCenter(target)
        : null;
    const zeroBox = zero ? heatMarkerBox(zero) : null;
    if (!startCenter || !targetCenter || !zeroBox || projected === current
        || (startValue > highestHeat && projected > highestHeat)) {
        clearHeatProjectionBar(heatScale);
        return;
    }
    let path = heatScale.querySelector<SVGPathElement>('#heat-projection-path');
    if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', 'heat-projection-path');
        path.setAttribute('class', 'screen-only heatProjectionPath');
        path.setAttribute('pointer-events', 'none');
        heatScale.appendChild(path);
    }
    const x = zeroBox.x - 3.8;
    const tipX = zeroBox.x + 4;
    const baseX = tipX - 5;
    const originRightX = baseX + 2.5;
    const barTop = Math.min(startCenter.y, targetCenter.y) - 2;
    const targetTop = targetCenter.y - 2;
    const targetBottom = targetCenter.y + 2;
    const originTop = startCenter.y - 2;
    const originBottom = startCenter.y + 2;
    const overflowArrowCenterX = (x + baseX) / 2;
    const overflowArrowBaseY = barTop + 5;
    const data = projected > highestHeat
        ? `M ${x} ${overflowArrowBaseY} L ${overflowArrowCenterX} ${barTop} L ${baseX} ${overflowArrowBaseY} L ${baseX} ${originTop} L ${originRightX} ${originTop} L ${originRightX} ${originBottom} L ${x} ${originBottom} Z`
        : targetCenter.y < startCenter.y
            ? `M ${x} ${targetTop} L ${baseX} ${targetTop} L ${tipX} ${targetCenter.y} L ${baseX} ${targetBottom} L ${baseX} ${originTop} L ${originRightX} ${originTop} L ${originRightX} ${originBottom} L ${x} ${originBottom} Z`
            : `M ${x} ${originTop} L ${originRightX} ${originTop} L ${originRightX} ${originBottom} L ${baseX} ${originBottom} L ${baseX} ${targetTop} L ${tipX} ${targetCenter.y} L ${baseX} ${targetBottom} L ${x} ${targetBottom} Z`;
    path.setAttribute('d', data);
    path.setAttribute('fill', projected > current ? '#d12020' : '#2070d1');
}

function clearHeatProjectionBar(heatScale: SVGGElement): void {
    heatScale.querySelector('#heat-projection-path')?.remove();
}

function clearHeatProjectionPreview(heatScale: SVGGElement): void {
    clearHeatProjectionBar(heatScale);
    heatScale.querySelector('#heat-projection-overflow-text')?.remove();
    restoreHeatProjectionOverflowStroke(heatScale);
}

function updateHeatProjectionOverflow(
    heatScale: SVGGElement,
    projected: number,
    current: number,
    highestHeat: number,
): void {
    const frame = heatScale.querySelector<SVGElement>('.overflowFrame');
    const button = heatScale.querySelector<SVGElement>('.overflowButton');
    if (!frame || !button) return;
    if (projected <= highestHeat) {
        heatScale.querySelector('#heat-projection-overflow-text')?.remove();
        restoreHeatProjectionOverflowStroke(heatScale);
        return;
    }
    if (!frame.hasAttribute(HEAT_PROJECTION_ORIGINAL_STROKE)) {
        frame.setAttribute(HEAT_PROJECTION_ORIGINAL_STROKE, frame.getAttribute('stroke') ?? '');
    }
    const color = projected < current ? '#2070d1' : '#d12020';
    frame.setAttribute('stroke', color);
    const center = heatMarkerCenter(button);
    if (!center) return;
    let text = heatScale.querySelector<SVGTextElement>('#heat-projection-overflow-text');
    if (!text) {
        text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('id', 'heat-projection-overflow-text');
        text.setAttribute('class', 'screen-only heatProjectionOverflowText');
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', '8');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('pointer-events', 'none');
        heatScale.appendChild(text);
    }
    text.setAttribute('fill', color);
    text.setAttribute('x', String(center.x - 12));
    text.setAttribute('y', String(center.y + 4.5));
    text.textContent = String(Math.round(projected));
}

function restoreHeatProjectionOverflowStroke(heatScale: SVGGElement): void {
    const frame = heatScale.querySelector<SVGElement>('.overflowFrame');
    if (!frame?.hasAttribute(HEAT_PROJECTION_ORIGINAL_STROKE)) return;
    const stroke = frame.getAttribute(HEAT_PROJECTION_ORIGINAL_STROKE);
    if (stroke) frame.setAttribute('stroke', stroke);
    else frame.removeAttribute('stroke');
    frame.removeAttribute(HEAT_PROJECTION_ORIGINAL_STROKE);
}

function updateHeatTargetMarker(
    svg: SVGSVGElement,
    heatScale: SVGGElement,
    value: number | undefined,
    highestHeat: number,
    id: string,
    fill: string,
): void {
    if (value === undefined) {
        heatScale.querySelector(`#${id}`)?.remove();
        return;
    }
    const target = heatElement(svg, Math.max(0, value), highestHeat);
    const zero = heatElement(svg, 0, highestHeat);
    const center = target ? heatMarkerCenter(target) : null;
    const zeroBox = zero ? heatMarkerBox(zero) : null;
    if (!center || !zeroBox) {
        heatScale.querySelector(`#${id}`)?.remove();
        return;
    }
    let marker = heatScale.querySelector<SVGPolygonElement>(`#${id}`);
    if (!marker) {
        marker = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        marker.setAttribute('id', id);
        marker.setAttribute('class', `screen-only ${id === 'heat-selected-weapons-target-marker' ? 'heatSelectedWeaponsTargetMarker' : 'heatProjectionTargetMarker'}`);
        marker.setAttribute('stroke', '#000');
        marker.setAttribute('stroke-width', '0.5');
        marker.setAttribute('pointer-events', 'none');
        heatScale.appendChild(marker);
    }
    const tipX = zeroBox.x + 4;
    marker.setAttribute('fill', fill);
    marker.setAttribute('points', `${tipX},${center.y} ${tipX - 8},${center.y - 2.5} ${tipX - 8},${center.y + 2.5}`);
    heatScale.appendChild(marker);
}

function heatElement(svg: SVGSVGElement, value: number, highestHeat: number): SVGElement | null {
    if (value > highestHeat) {
        return svg.querySelector<SVGElement>('#heatScale .overflowButton');
    }
    return svg.querySelector<SVGElement>(`#heatScale .heat[heat="${Math.max(0, value)}"]`);
}

function heatMarkerBox(element: SVGElement): Readonly<{ x: number; y: number; width: number; height: number }> | null {
    const values = ['x', 'y', 'width', 'height'].map(name => element.getAttribute(name));
    if (values.every(value => value !== null)) {
        const [x, y, width, height] = values.map(Number);
        if ([x, y, width, height].every(Number.isFinite)) {
            return Object.freeze({ x, y, width, height });
        }
    }
    try {
        const box = (element as SVGGraphicsElement).getBBox();
        return Object.freeze({ x: box.x, y: box.y, width: box.width, height: box.height });
    } catch {
        return null;
    }
}

function heatMarkerCenter(element: SVGElement): Readonly<{ x: number; y: number }> | null {
    const box = heatMarkerBox(element);
    return box ? Object.freeze({ x: box.x + box.width / 2, y: box.y + box.height / 2 }) : null;
}

function heatMarkerTopCenter(element: SVGElement): Readonly<{ x: number; y: number }> | null {
    const box = heatMarkerBox(element);
    return box ? Object.freeze({ x: box.x + box.width / 2, y: box.y - 1 }) : null;
}

function closestHeatCell(svg: SVGSVGElement, clientY: number): { readonly element: SVGElement; readonly heat: number } | null {
    let closest: { readonly element: SVGElement; readonly heat: number } | null = null;
    let distance = Number.POSITIVE_INFINITY;
    svg.querySelectorAll<SVGElement>('#heatScale .heat[heat]').forEach(element => {
        const heat = Number(element.getAttribute('heat'));
        if (!Number.isFinite(heat)) return;
        const rect = element.getBoundingClientRect();
        const candidateDistance = Math.abs(clientY - (rect.top + rect.height / 2));
        if (candidateDistance >= distance) return;
        distance = candidateDistance;
        closest = { element, heat };
    });
    return closest;
}

function renderHeatPreview(svg: SVGSVGElement, heat: number, family: HeatScaleFamily): void {
    svg.querySelectorAll<SVGElement>('#heatScale .heat[heat]').forEach(element => {
        const value = Number(element.getAttribute('heat'));
        element.classList.toggle('hot', Number.isFinite(value) && value <= heat);
    });
    renderRecordSheetHeatEffects(svg, recordSheetHeatEffects(family, heat));
}
