// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MotiveModes } from '../../models/motiveModes.model';
import type { RecordSheetMovementSelection } from '../../models/runtime/record-sheet-movement';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import type { RecordSheetInteractionHandler } from './record-sheet-interaction';
import { measureSvgTextCanvas } from '../../utils/svg-text.util';

/** Both binders consume the same generated movement controls and runtime facts. */
export function bindRecordSheetMovement(
    svg: SVGSVGElement,
    current: () => RecordSheetMovementSelection,
    context: () => UnitEditContext,
    signal: AbortSignal,
    onInteraction?: RecordSheetInteractionHandler,
): (selection: RecordSheetMovementSelection) => void {
    const entries = [...svg.querySelectorAll<SVGTextElement>('[data-mekbay-move-mode]')].map(value => ({
        value,
        label: svg.getElementById(`${value.id}-label`) as SVGTextElement | null,
        control: svg.querySelector<SVGGElement>(`[data-mekbay-movement-control="${value.id}"]`)!,
        mode: value.dataset['mekbayMoveMode'] as MotiveModes,
        airborne: value.dataset['mekbayMoveAirborne'],
    }));
    const matchesEnvironment = (entry: typeof entries[number], selection: RecordSheetMovementSelection): boolean =>
        entry.airborne === undefined || entry.airborne === String(selection.airborne);

    for (const entry of entries) {
        if (!onInteraction) continue;
        entry.control.setAttribute('role', 'button');
        entry.control.setAttribute('aria-label', entry.label?.textContent ?? entry.value.textContent ?? entry.mode);
        const activate = (event: Event): void => {
            if (svg.classList.contains('print-preview')) return;
            const selection = current();
            const option = selection.options.find(option => option.mode === entry.mode);
            if (!matchesEnvironment(entry, selection) || !option
                || (!option.legal && selection.selectedMode !== entry.mode)) return;
            event.preventDefault();
            event.stopPropagation();
            onInteraction({ kind: 'movement', mode: entry.mode, context: context() }, event);
        };
        entry.control.addEventListener('click', activate, { signal });
        entry.control.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') activate(event);
        }, { signal });
    }
    signal.addEventListener('abort', () => entries.forEach(({ control }) => {
        control.classList.remove('interactive');
        control.removeAttribute('tabindex');
        control.removeAttribute('role');
    }), { once: true });

    return selection => {
        if (entries.length === 0) return;
        const stationary = selection.options.find(option => option.mode === 'stationary');
        const showStationary = onInteraction !== undefined && !svg.classList.contains('print-preview')
            && (stationary?.legal === true || selection.selectedMode === 'stationary');
        svg.getElementById('movementPointsLabel')?.classList.toggle('movementCaptionReplaced', showStationary);
        svg.getElementById('movementPointsLabel')?.classList.toggle('print-only', showStationary);
        for (const entry of entries) {
            const option = selection.options.find(option => option.mode === entry.mode);
            const inEnvironment = matchesEnvironment(entry, selection);
            const selected = inEnvironment && selection.selectedMode === entry.mode;
            const dimmed = !inEnvironment || (selection.selectedMode !== null && !selected);
            for (const node of [entry.value, entry.label]) {
                node?.classList.toggle('currentMoveMode', selected);
                node?.classList.toggle('unusedMoveMode', dimmed);
            }
            const maximumWidth = Number(entry.value.dataset['mekbayMoveValueWidth']);
            if (maximumWidth > 0) {
                if (measureSvgTextCanvas(entry.value, entry.value.textContent ?? '') > maximumWidth) {
                    entry.value.setAttribute('textLength', String(maximumWidth));
                    entry.value.setAttribute('lengthAdjust', 'spacingAndGlyphs');
                } else {
                    entry.value.removeAttribute('textLength');
                    entry.value.removeAttribute('lengthAdjust');
                }
            }
            const visible = entry.mode !== 'stationary' || showStationary;
            if (entry.mode === 'stationary') entry.value.setAttribute('display', visible ? 'inline' : 'none');
            entry.control.setAttribute('display', visible ? 'inline' : 'none');
            const enabled = visible && inEnvironment && option !== undefined
                && (option.legal || selected) && !svg.classList.contains('print-preview');
            entry.control.classList.toggle('interactive', onInteraction !== undefined && enabled);
            entry.control.setAttribute('aria-disabled', String(!enabled));
            entry.control.setAttribute('aria-pressed', String(selected));
            if (onInteraction && enabled) entry.control.setAttribute('tabindex', '0');
            else entry.control.removeAttribute('tabindex');
            const badge = entry.control.querySelector<SVGGElement>('.movementModifier')!;
            badge.setAttribute('display', option && visible && inEnvironment
                && (selection.selectedMode === null || selected) ? 'inline' : 'none');
            badge.querySelector('text')!.textContent = option
                ? `${option.modifier >= 0 ? '+' : ''}${option.modifier}` : '';
        }
    };
}
