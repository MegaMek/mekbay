// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekConversionMode } from '../../models/mek-conversion-mode';
import type { MotiveModes } from '../../models/motiveModes.model';
import type { RecordSheetMovementSelection } from '../../models/runtime/record-sheet-movement';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import type { RecordSheetInteractionHandler } from './record-sheet-interaction';
import { measureSvgTextCanvas } from '../../utils/svg-text.util';

/**
 * Both binders consume the same generated movement controls and runtime facts. A LAM's or QuadVee's sheet prints one
 * column of movement per conversion mode: only the current mode's columns are live, and a mode's heading selects it.
 */
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
        conversion: value.dataset['mekbayMoveConversion'],
    }));
    const headings = [...svg.querySelectorAll<SVGTextElement>('[data-mekbay-conversion-mode]')].map(heading => ({
        heading,
        mode: heading.dataset['mekbayConversionMode'] as MekConversionMode,
        control: svg.querySelector<SVGGElement>(
            `[data-mekbay-conversion-control="${heading.dataset['mekbayConversionMode']}"]`)!,
    }));
    type Entry = typeof entries[number];
    const inConversionMode = (entry: Entry, selection: RecordSheetMovementSelection): boolean =>
        entry.conversion === undefined || selection.conversion === undefined
            || entry.conversion === selection.conversion.mode;
    /** The option an entry stands for: its movement mode, in its conversion mode and its air/ground state. */
    const optionFor = (entry: Entry, selection: RecordSheetMovementSelection) =>
        inConversionMode(entry, selection)
            ? selection.options.find(option => option.mode === entry.mode
                && (entry.airborne === undefined
                    || entry.airborne === String(option.airborne ?? selection.airborne)))
            : undefined;
    const isSelected = (entry: Entry, selection: RecordSheetMovementSelection): boolean =>
        selection.selectedMode === entry.mode && inConversionMode(entry, selection)
            && (entry.airborne === undefined || entry.airborne === String(selection.airborne));
    const bindControl = (control: SVGGElement, label: string, activate: (event: Event) => void): void => {
        control.setAttribute('role', 'button');
        control.setAttribute('aria-label', label);
        control.addEventListener('click', activate, { signal });
        control.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') activate(event);
        }, { signal });
    };

    if (onInteraction) {
        for (const entry of entries) {
            bindControl(entry.control, entry.label?.textContent ?? entry.value.textContent ?? entry.mode, event => {
                if (svg.classList.contains('print-preview')) return;
                const selection = current();
                const option = optionFor(entry, selection);
                if (!option || (!option.legal && !isSelected(entry, selection))) return;
                event.preventDefault();
                event.stopPropagation();
                const airborne = entry.airborne === undefined ? option.airborne : entry.airborne === 'true';
                onInteraction({
                    kind: 'movement',
                    mode: entry.mode,
                    ...(airborne === undefined ? {} : { airborne }),
                    context: context(),
                }, event);
            });
        }
        for (const { heading, mode, control } of headings) {
            bindControl(control, heading.textContent ?? mode, event => {
                const conversion = current().conversion;
                if (svg.classList.contains('print-preview') || !conversion?.modes.includes(mode)
                    || conversion.mode === mode) return;
                event.preventDefault();
                event.stopPropagation();
                onInteraction({ kind: 'conversion-mode', mode, context: context() }, event);
            });
        }
    }
    signal.addEventListener('abort', () => [...entries, ...headings].forEach(({ control }) => {
        control.classList.remove('interactive');
        control.removeAttribute('tabindex');
        control.removeAttribute('role');
    }), { once: true });

    const renderControl = (control: SVGGElement, enabled: boolean, pressed: boolean): void => {
        control.classList.toggle('interactive', onInteraction !== undefined && enabled);
        control.setAttribute('aria-disabled', String(!enabled));
        control.setAttribute('aria-pressed', String(pressed));
        if (onInteraction && enabled) control.setAttribute('tabindex', '0');
        else control.removeAttribute('tabindex');
    };

    return selection => {
        const live = !svg.classList.contains('print-preview');
        for (const { heading, mode, control } of headings) {
            const currentMode = selection.conversion?.mode === mode;
            heading.classList.toggle('currentConversionMode', currentMode);
            heading.classList.toggle('unusedMoveMode', selection.conversion !== undefined && !currentMode);
            control.setAttribute('display', onInteraction ? 'inline' : 'none');
            renderControl(control, live && !currentMode && selection.conversion?.modes.includes(mode) === true,
                currentMode);
        }
        if (entries.length === 0) return;
        const stationary = selection.options.find(option => option.mode === 'stationary');
        const showStationary = onInteraction !== undefined && live
            && (stationary !== undefined || selection.selectedMode === 'stationary');
        svg.getElementById('movementPointsLabel')?.classList.toggle('movementCaptionReplaced', showStationary);
        svg.getElementById('movementPointsLabel')?.classList.toggle('print-only', showStationary);
        for (const entry of entries) {
            const option = optionFor(entry, selection);
            // An entry tied to an air/ground state is live when its mode offers that state.
            const inEnvironment = inConversionMode(entry, selection)
                && (entry.airborne === undefined || option !== undefined);
            const selected = inEnvironment && isSelected(entry, selection);
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
            renderControl(entry.control,
                visible && inEnvironment && option !== undefined && (option.legal || selected) && live, selected);
            const badge = entry.control.querySelector<SVGGElement>('.movementModifier')!;
            badge.setAttribute('display', option && visible && inEnvironment
                && (selection.selectedMode === null || selected) ? 'inline' : 'none');
            badge.querySelector('text')!.textContent = option
                ? `${option.modifier >= 0 ? '+' : ''}${option.modifier}` : '';
        }
    };
}
