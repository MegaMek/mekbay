// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { measureSvgTextCanvas } from '../svg-text.util';
import { fitRecordSheetTextLine, formatNumber, svgElement } from './record-sheet-svg-rendering';

/** Fraction of a row above its first baseline where an equipment bracket starts. */
export const MEK_CRITICAL_BRACKET_TOP = 0.6;

/**
 * CORE-2026 - AC/2
 * Keep the extra-hit square immediately after the displayed critical-slot name.
 * */
export function positionMekCriticalExtraHitPip(text: SVGTextElement, pip: SVGElement): void {
  const width = text.hasAttribute('textLength')
    ? Number(text.getAttribute('textLength'))
    : measureSvgTextCanvas(text, text.textContent ?? '');
  const fontSize = Number(text.getAttribute('font-size'));
  pip.setAttribute('x', formatNumber(Number(text.getAttribute('x')) + width + fontSize * 0.2));
}

/**
 * Writes a critical slot's lines into its label, one tspan per line when there are several,
 * condensing each line to the width the generator recorded on the label.
 * {@link flowMekCriticalLocation} then spaces the lines and moves the rows below.
 */
export function writeMekCriticalSlotLines(label: SVGTextElement, lines: readonly string[]): void {
  const maxWidth = Number(label.getAttribute('data-mekbay-max-width'));
  const size = Number(label.getAttribute('font-size'));
  const fit = (element: SVGTextContentElement, value: string): void => {
    if (maxWidth > 0) fitRecordSheetTextLine(element, value, size, maxWidth);
  };
  if (lines.length === 1) {
    label.textContent = lines[0];
    fit(label, lines[0]);
    return;
  }
  label.removeAttribute('textLength');
  label.removeAttribute('lengthAdjust');
  label.replaceChildren(...lines.map(line => {
    const tspan = svgElement('tspan');
    tspan.setAttribute('x', label.getAttribute('x') ?? '0');
    tspan.textContent = line;
    fit(tspan, line);
    return tspan;
  }));
}

/**
 * Lays out one location's critical rows after their lines are written. A slot with several
 * lines pushes the rows below it, their brackets and the location's roll labels down into the
 * free space under the column; only when that space runs out does the row pitch tighten.
 * The generated positions are the reference, so the layout can be reapplied at any time.
 */
export function flowMekCriticalLocation(criticalGroup: SVGElement): void {
  const rows = [...criticalGroup.querySelectorAll<SVGGElement>(':scope > .critRow')];
  if (rows.length < 2) return;
  const baselines = rows.map(row => Number(row.querySelector(':scope > text')?.getAttribute('y')));
  const step = baselines[1] - baselines[0];
  const lineCounts = rows.map(row => Math.max(1, row.querySelectorAll('.critSlot > text > tspan').length));
  const extraLines = lineCounts.reduce((total, count) => total + count - 1, 0);
  const slack = Number(criticalGroup.getAttribute('data-mekbay-row-slack')) || 0;
  const pitch = Math.min(step, ((rows.length - 1) * step + slack) / (rows.length - 1 + extraLines));
  const shifts: number[] = [];
  let linesAbove = 0;
  rows.forEach((row, index) => {
    shifts.push((index + linesAbove) * pitch - index * step);
    linesAbove += lineCounts[index] - 1;
    translateY(row, shifts[index]);
    row.querySelectorAll('.critSlot > text > tspan').forEach((tspan, line) => {
      if (line > 0) tspan.setAttribute('dy', formatNumber(pitch));
    });
    row.querySelector('.critSlot > .critSlot-bg-rect')
      ?.setAttribute('height', formatNumber(step + (lineCounts[index] - 1) * pitch));
  });
  const lastLineShift = (index: number): number => shifts[index] + (lineCounts[index] - 1) * pitch;

  criticalGroup.querySelectorAll<SVGElement>(':scope > .critical-equipment-bracket').forEach(bracket => {
    const [first, last] = (bracket.getAttribute('data-mekbay-slots') ?? '').split(' ').map(Number);
    const top = baselines[first] - MEK_CRITICAL_BRACKET_TOP * step;
    const height = baselines[last] - top;
    const scale = (height + shifts[last] - shifts[first]) / height;
    const offset = top + shifts[first] - scale * top;
    if (shifts[first] === 0 && shifts[last] === 0) bracket.removeAttribute('transform');
    else bracket.setAttribute('transform', `matrix(1 0 0 ${formatNumber(scale)} 0 ${formatNumber(offset)})`);
  });

  const location = criticalGroup.getAttribute('data-loc');
  criticalGroup.parentElement
    ?.querySelectorAll<SVGElement>(`.critical-roll-range[data-mekbay-roll-loc="${location}"]`)
    .forEach((label, half) => {
      const first = half * 6;
      const last = first + 5;
      if (last < rows.length) translateY(label, (shifts[first] + lastLineShift(last)) / 2);
    });
}

function translateY(element: SVGElement, offset: number): void {
  if (Math.abs(offset) < 1e-6) element.removeAttribute('transform');
  else element.setAttribute('transform', `translate(0 ${formatNumber(offset)})`);
}
