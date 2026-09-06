// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ConventionalInfantryCombatProfile } from '../../models/rules/conventional-infantry-combat-rules';
import { INFANTRY_STRENGTH_ART } from './infantry-strength-art';
import {
INFANTRY_STRENGTH_CELL_COUNT,
projectInfantryStrengthCells,
type InfantryStrengthCell,
type InfantryStrengthFacts,
} from './infantry-strength-projection';
import { appendEmbeddedRasterUse } from './record-sheet-embedded-art';
import { addText,formatNumber,setAttributes,svgElement } from './record-sheet-svg-rendering';

export const INFANTRY_STRENGTH_DISPLAY_ID = 'infantryStrengthDisplay';
const TRACK_WIDTH = 451.4;
const CELL_WIDTH = TRACK_WIDTH / INFANTRY_STRENGTH_CELL_COUNT;
const GLYPH_WIDTH = 13.047;
const GLYPH_HEIGHT = 29.58;

export interface InfantryStrengthRenderHandle {
    readonly element: SVGGElement;
    selection(): number | null;
}

export interface InfantryStrengthDisplay {
    readonly cells: readonly InfantryStrengthRenderHandle[];
    render(profile: ConventionalInfantryCombatProfile | undefined, facts: InfantryStrengthFacts, markChanges: boolean): void;
}

/** Owns the generated cells and latest strength-change highlights. Never reads gameplay facts from SVG. */
export function createInfantryStrengthDisplay(
    svg: SVGSVGElement,
    host: SVGGElement,
): InfantryStrengthDisplay {
    host.replaceChildren();
    let current: readonly InfantryStrengthCell[] = [];
    let previousFacts: InfantryStrengthFacts | undefined;
    let freshFrom: number | undefined;
    const cells = Array.from({ length: INFANTRY_STRENGTH_CELL_COUNT }, (_, index) => {
        const element = svgElement('g');
        setAttributes(element, { class: 'infantry-strength-cell', transform: `translate(${formatNumber(index * CELL_WIDTH)} 0)` });
        const label = addText(element, '', 3, 8.4, { size: 6.2 });
        const glyph = svgElement('g');
        glyph.setAttribute('class', 'infantry-strength-art');
        element.appendChild(glyph);
        const damage = addText(element, '', 7.523, 51.747, { size: 7.2, anchor: 'middle' });
        const hitArea = svgElement('rect');
        setAttributes(hitArea, { x: 0, y: 0, width: CELL_WIDTH, height: 57.114, fill: 'transparent' });
        element.appendChild(hitArea);
        host.appendChild(element);
        return {
            element, label, glyph, damage,
            selection: (): number | null => current[index]?.available === true ? current[index]!.strength : null,
        };
    });
    const rangeModifiers = Array.from({ length: 22 }, (_, distance) =>
        addText(host, '', 65.356 + distance * 17.816, 78.532, { size: 6.2, anchor: 'middle' }));
    const underwaterLabel = addText(host, 'Underwater:', 3, 88.4, { size: 6.2, weight: 700 });
    const underwaterModifiers = Array.from({ length: 22 }, (_, distance) =>
        addText(host, '', 65.356 + distance * 17.816, 88.4, { size: 6.2, anchor: 'middle' }));

    const paint = (profile: ConventionalInfantryCombatProfile | undefined, facts: InfantryStrengthFacts, before?: number): void => {
        current = projectInfantryStrengthCells(facts, before);
        cells.forEach((cell, index) => {
            const projected = current[index]!;
            cell.label.textContent = String(projected.strength);
            cell.element.setAttribute('opacity', projected.available ? '1' : '0.18');
            cell.element.setAttribute('aria-disabled', String(!projected.available));
            cell.element.setAttribute('aria-label', projected.available
                ? `Infantry strength ${projected.strength} of ${facts.maximum}` : 'Unused strength cell');
            cell.damage.textContent = projected.available && profile !== undefined
                ? String(profile.damageByStrength[projected.strength] ?? '—') : '—';
            cell.damage.classList.toggle('disabled-text', projected.committedDamaged);
            cell.glyph.replaceChildren();
            const state = projected.available ? projected.state : 'alive';
            appendEmbeddedRasterUse(svg, cell.glyph, INFANTRY_STRENGTH_ART[state],
                { x: 1, y: 9.4, width: GLYPH_WIDTH, height: GLYPH_HEIGHT }, `infantry-strength-${state}`);
        });
        rangeModifiers.forEach((label, distance) => {
            label.textContent = formatModifier(profile?.rangeModifiers[distance]);
        });
        const underwater = profile?.underwaterRangeModifiers;
        underwaterLabel.style.display = underwater ? '' : 'none';
        underwaterModifiers.forEach((label, distance) => {
            label.style.display = underwater ? '' : 'none';
            label.textContent = formatModifier(underwater?.[distance]);
        });
    };
    return {
        cells: Object.freeze(cells.map(({ element, selection }) => Object.freeze({ element, selection }))),
        render(profile, facts, markChanges): void {
            // Unchanged redraws must preserve the highlight from the latest strength change.
            if (!markChanges
                || facts.maximum !== previousFacts?.maximum
                || facts.committedRemaining !== previousFacts?.committedRemaining
                || facts.previewRemaining !== previousFacts?.previewRemaining) {
                freshFrom = markChanges ? previousFacts?.previewRemaining : undefined;
            }
            paint(profile, facts, freshFrom);
            previousFacts = facts;
        },
    };
}

function formatModifier(value: number | null | undefined): string {
    return value == null ? '—' : value > 0 ? `+${value}` : String(value);
}
