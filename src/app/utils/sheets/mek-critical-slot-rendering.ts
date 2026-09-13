// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { measureSvgTextCanvas } from '../svg-text.util';
import { formatNumber } from './record-sheet-svg-rendering';

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
