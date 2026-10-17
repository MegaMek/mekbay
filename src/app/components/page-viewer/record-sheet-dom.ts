// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CrewPositionId } from '../../models/entity/entity-identifiers';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import type {
    CrewStateDefinition,
    UnitConditionDefinition,
} from '../../models/unit-status-presentation';
import { updateRecordSheetAmmoProfile } from '../../utils/sheets/record-sheet-ammo-rendering';
import type { RecordSheetDamageHighlights } from '../../utils/sheets/record-sheet-damage-highlights';
import { recordSheetAmmoEntries, setAttributes, svgElement } from '../../utils/sheets/record-sheet-svg-rendering';
import type { RecordSheetInteraction, RecordSheetInteractionHandler } from './record-sheet-interaction';

/**
 * How a bound sheet element answers input: a damage `target` takes the selectable highlight and answers a secondary
 * click too; a `value` mark (critical boxes, record cells) answers both clicks without the highlight; a `control`
 * answers only the primary click; a `press` control answers the primary pointer press, so the picker it opens can
 * follow that same drag.
 */
export type RecordSheetBindRole = 'target' | 'value' | 'control' | 'press';

/** Binds one sheet element to the interaction it currently stands for. */
export type RecordSheetBind = (
    element: SVGElement,
    interaction: () => RecordSheetInteraction | null,
    role?: RecordSheetBindRole,
) => void;

/**
 * The one way every record sheet binds its elements. A read-only sheet binds nothing. Each element is bound once, its
 * events stay on the sheet, and aborting `signal` removes everything binding added.
 */
export function createRecordSheetBind(
    signal: AbortSignal,
    onInteraction: RecordSheetInteractionHandler | undefined,
): RecordSheetBind {
    return (element, interaction, role = 'target') => {
        if (!onInteraction || element.dataset['mekbayBound'] === '1') return;
        element.dataset['mekbayBound'] = '1';
        element.classList.add('interactive');
        if (role === 'target') element.classList.add('selectable');
        element.setAttribute('tabindex', '0');
        signal.addEventListener('abort', () => {
            delete element.dataset['mekbayBound'];
            element.classList.remove('interactive', 'selectable');
            element.removeAttribute('tabindex');
        }, { once: true });
        const emit = (event: Event): void => {
            if (element.style.display === 'none') return;
            event.preventDefault();
            event.stopPropagation();
            const selected = interaction();
            if (selected) onInteraction(selected, event);
        };
        if (role === 'press') {
            element.addEventListener('pointerdown', event => {
                if (event instanceof PointerEvent && event.button === 0) emit(event);
            }, { signal });
        } else {
            element.addEventListener('click', event => {
                if (event.button === 0) emit(event);
            }, { signal });
        }
        if (role === 'target' || role === 'value') element.addEventListener('contextmenu', emit, { signal });
        element.addEventListener('keydown', event => {
            if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) emit(event);
        }, { signal });
    };
}

/**
 * The elements that take a location's damage: its paperdoll contours when drawn, otherwise its pip hit areas, otherwise
 * its pips. Whatever does not take the damage lets clicks through.
 */
export function recordSheetDamageTargets(
    locations: readonly SVGElement[],
    hitAreas: readonly SVGElement[],
    pips: readonly SVGElement[],
): readonly SVGElement[] {
    if (locations.length > 0) {
        hitAreas.forEach(hitArea => { hitArea.style.pointerEvents = 'none'; });
        pips.forEach(pip => { pip.style.pointerEvents = 'none'; });
        return locations;
    }
    // Paperdoll geometry owns damage interaction even if a location is omitted.
    if (pips.some(pip => pip.closest('[data-mekbay-paperdoll="1"]'))
        || hitAreas.some(area => area.closest('[data-mekbay-paperdoll="1"]'))) {
        hitAreas.forEach(element => { element.style.pointerEvents = 'none'; });
        pips.forEach(element => { element.style.pointerEvents = 'none'; });
        return [];
    }
    if (hitAreas.length > 0) {
        hitAreas.forEach(element => { element.style.pointerEvents = ''; });
        pips.forEach(element => { element.style.pointerEvents = 'none'; });
        return hitAreas;
    }
    pips.forEach(element => { element.style.pointerEvents = ''; });
    return pips;
}

const CREW_SKILL_CONTROLS = Object.freeze([
    ['gunnery', 'gunnery'],
    ['piloting', 'piloting'],
    ['aero-gunnery', 'aeroGunnery'],
    ['aero-piloting', 'aeroPiloting'],
] as const);

/**
 * One crew seat's wound marks and controls: the name opens the person, skills open their picker, a wound mark sets the
 * wounds (clicking the current count lowers it by one) and the state button opens the state menu. A vacant seat shows
 * no wounds and offers only its name and state.
 */
export function renderRecordSheetCrewControls(
    svg: SVGSVGElement,
    position: Readonly<{
        occurrence: number;
        positionId: CrewPositionId;
        effectiveState: string;
        state: Readonly<{ wounds: number }>;
    }>,
    bind: RecordSheetBind,
    context: () => UnitEditContext,
    currentWounds: () => number,
): void {
    const crewId = position.occurrence;
    const positionId = position.positionId;
    const vacant = position.effectiveState === 'vacant';
    svg.querySelectorAll<SVGElement>(`.crewNameButton[crewId="${crewId}"]`).forEach(button => bind(button,
        () => Object.freeze({ kind: 'crew-profile', positionId, context: context() }), 'control'));
    if (!vacant) {
        for (const [control, skill] of CREW_SKILL_CONTROLS) {
            svg.querySelectorAll<SVGElement>(`.crewSkillButton[crewId="${crewId}"][skill="${control}"]`)
                .forEach(button => bind(button,
                    () => Object.freeze({ kind: 'crew-skill', positionId, skill, context: context() }), 'control'));
        }
    }
    for (let wounds = 1; wounds <= 6; wounds++) {
        const marker = svg.querySelector<SVGElement>(`.crewHit[crewId="${crewId}"][hit="${wounds}"]`);
        if (!marker) continue;
        marker.style.display = vacant ? 'none' : '';
        marker.classList.toggle('damaged', wounds <= position.state.wounds);
        if (vacant) continue;
        bind(marker, () => Object.freeze({
            kind: 'crew-wounds',
            positionId,
            wounds: currentWounds() === wounds ? wounds - 1 : wounds,
            context: context(),
        }), 'control');
    }
    svg.querySelectorAll<SVGElement>(`.crewStateButton[crewId="${crewId}"]`).forEach(button => bind(button,
        () => Object.freeze({ kind: 'crew-state-menu', positionId, context: context() }), 'control'));
}

/** Writes the sheet's ammo totals, one line per munition, from the unit's ammo bins. */
export function renderRecordSheetAmmoProfile(
    svg: SVGSVGElement,
    bins: readonly Readonly<{ ammo?: Readonly<{ displayName: string; remaining: number }> }>[],
    interactive: boolean,
): void {
    const profile = svg.querySelector<SVGElement>('#ammoProfile');
    if (!profile) return;
    updateRecordSheetAmmoProfile(profile, recordSheetAmmoEntries(bins.flatMap(bin =>
        bin.ammo === undefined ? [] : [[bin.ammo.displayName, bin.ammo.remaining] as const])), interactive);
}

/** The paperdoll's random-hit buttons only show a roll, so read-only sheets keep them through the presentation bind. */
export function bindRecordSheetRandomHit(
    svg: SVGSVGElement,
    bindPresentation: RecordSheetBind,
    context: () => UnitEditContext,
): void {
    svg.querySelectorAll<SVGElement>('[data-mekbay-random-hit="1"]').forEach(element => bindPresentation(element,
        () => Object.freeze({ kind: 'random-hit', element, context: context() }), 'press'));
}

/** The ammo profile and the weapon openers open the equipment dialog on their tab. */
export function bindRecordSheetEquipmentOpeners(
    svg: SVGSVGElement,
    bind: RecordSheetBind,
    context: () => UnitEditContext,
): void {
    const open = (tab: 'weapons' | 'ammo') => () => Object.freeze({ kind: 'open-equipment' as const, tab, context: context() });
    svg.querySelectorAll<SVGElement>('#ammoProfile').forEach(element => bind(element, open('ammo'), 'control'));
    svg.querySelectorAll<SVGElement>('[data-mekbay-open-equipment="weapons"]')
        .forEach(element => bind(element, open('weapons'), 'control'));
}

export function renderRecordSheetPips(
    highlights: RecordSheetDamageHighlights,
    pips: readonly SVGElement[],
    maximum: number,
    committedRemaining: number,
    previewRemaining: number,
    markChanges = false,
): void {
    if (pips.length === 0) return;
    highlights.render(pips[0], { maximum, committedRemaining, previewRemaining }, markChanges, previousPreview => {
        const committedDamage = maximum - committedRemaining;
        const previewDamage = maximum - previewRemaining;
        pips.forEach((pip, index) => {
            const ordinal = index + 1;
            pip.style.display = ordinal <= maximum ? '' : 'none';
            const damaged = ordinal <= previewDamage;
            pip.classList.toggle('damaged', damaged);
            pip.classList.toggle('fresh', previousPreview !== undefined
                && damaged !== (ordinal <= maximum - previousPreview));
            pip.classList.toggle('pending',
                ordinal > Math.min(committedDamage, previewDamage)
                && ordinal <= Math.max(committedDamage, previewDamage));
        });
    });
}

export function renderRecordSheetDestroyed(svg: SVGSVGElement, destroyed: boolean): void {
    const overlay = svg.querySelector('#destroyed-overlay');
    if (!destroyed) {
        overlay?.remove();
        return;
    }
    if (overlay) return;

    const label = svgElement('text');
    setAttributes(label, {
        id: 'destroyed-overlay', x: '50%', y: '40%',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 86, 'font-weight': 800, 'letter-spacing': 2.5,
        fill: '#f00', stroke: '#000', 'stroke-width': 5,
        'stroke-linejoin': 'round', 'paint-order': 'stroke fill',
        'pointer-events': 'none', 'aria-label': 'Unit destroyed',
        style: 'font-family: "Roboto", "Arial", sans-serif; '
            + 'transform-box: fill-box; transform-origin: center; transform: rotate(12deg)',
    });
    label.textContent = 'DESTROYED';
    svg.appendChild(label);
}

/** Shared condition presentation for authored and polyfilled record sheets. */
export function renderRecordSheetConditions(
    svg: SVGSVGElement,
    activeConditions: readonly string[],
    definitions: readonly UnitConditionDefinition[],
): void {
    const active = new Set(activeConditions);
    let offset = 0;
    svg.querySelectorAll<SVGElement>('.unitConditionButton')
        .forEach(button => button.classList.add('edit-only'));
    for (const condition of definitions) {
        const isActive = active.has(condition.key);
        svg.querySelectorAll<SVGElement>(`.unitConditionButton[condition="${attributeValue(condition.key)}"]`)
            .forEach(button => {
                button.style.display = '';
                button.classList.toggle('active', isActive);
                button.style.setProperty('--unit-condition-active-color', condition.color);
                button.querySelector<SVGElement>('rect')?.setAttribute('fill', isActive ? condition.color : '#fff');
                button.querySelector<SVGElement>('text')?.setAttribute('fill', isActive ? '#fff' : '#000');
            });
        svg.querySelectorAll<SVGElement>(`.unitConditionBanner[condition="${attributeValue(condition.key)}"]`)
            .forEach(banner => {
                banner.classList.toggle('visible', isActive);
                banner.setAttribute('display', isActive ? '' : 'none');
                banner.setAttribute('opacity', isActive ? '1' : '0');
                const rect = banner.querySelector<SVGElement>('.unitConditionBannerRect');
                const text = banner.querySelector<SVGElement>('.unitConditionBannerText');
                rect?.setAttribute('fill', condition.color);
                if (text) text.textContent = condition.bannerLabel ?? condition.label;
                if (isActive) {
                    banner.setAttribute('transform', `translate(0 ${offset})`);
                    offset += Number(rect?.getAttribute('height') ?? 15);
                }
            });
    }
    svg.querySelectorAll<SVGElement>('.unitConditionButton[condition="menu"]')
        .forEach(button => { button.style.display = ''; });
}

/** Vacancy hides the authored station contents without destroying controls or print geometry. */
export function renderRecordSheetCrewVacancies(
    svg: SVGSVGElement,
    crew: readonly { readonly occurrence: number; readonly effectiveState?: string }[],
): void {
    const vacant = new Set(crew.filter(position => position.effectiveState === 'vacant').map(position => String(position.occurrence)));
    svg.querySelectorAll<SVGElement>('[data-mekbay-crew-stations]').forEach(frame => {
        const stations = frame.dataset['mekbayCrewStations']!.split(' ');
        frame.classList.toggle('crew-frame-vacant', stations.every(occurrence => vacant.has(occurrence)));
    });
    svg.querySelectorAll<SVGElement>('[data-mekbay-crew-position]').forEach(position => {
        position.classList.toggle('crew-position-vacant', vacant.has(position.dataset['mekbayCrewPosition']!));
    });
}

/** A crew name replaces its writing line whenever a value is present. */
export function renderRecordSheetCrewName(svg: SVGSVGElement, occurrence: number, name: string): boolean {
    let rendered = false;
    const hasName = name.trim().length > 0;
    svg.querySelectorAll<SVGElement>(`.crewNameButton[crewId="${occurrence}"]`).forEach(button => {
        const textId = button.getAttribute('textElement');
        const blankId = button.getAttribute('blankElement');
        const text = textId ? svg.getElementById(textId) : null;
        const blank = blankId ? svg.getElementById(blankId) : null;
        if (text) {
            text.textContent = name;
            (text as SVGElement).style.visibility = hasName ? 'visible' : 'hidden';
            rendered = true;
        }
        if (blank) (blank as SVGElement).style.visibility = hasName ? 'hidden' : 'visible';
    });
    return rendered;
}

/** Shared crew-state button/banner presentation for every Entity family. */
export function renderRecordSheetCrewState(
    svg: SVGSVGElement,
    occurrence: number,
    state: CrewStateDefinition | null,
): void {
    const color = state?.color ?? '#666';
    svg.querySelectorAll<SVGElement>(`.crewStateButton[crewId="${occurrence}"]`).forEach(button => {
        button.style.display = '';
        button.classList.toggle('active', state !== null);
        button.setAttribute('active-color', color);
        button.style.setProperty('--unit-condition-active-color', color);
        button.querySelector<SVGElement>('rect')?.setAttribute('fill', state ? color : '#fff');
        button.querySelector<SVGElement>('text')?.setAttribute('fill', state ? '#fff' : '#000');
    });
    svg.querySelectorAll<SVGElement>(`.crewStateBanner[crewId="${occurrence}"]`).forEach(banner => {
        const rect = banner.querySelector<SVGElement>('.unitConditionBannerRect');
        const text = banner.querySelector<SVGElement>('.unitConditionBannerText');
        banner.classList.toggle('visible', state !== null);
        banner.setAttribute('opacity', state ? '1' : '0');
        if (state) {
            banner.removeAttribute('display');
            rect?.setAttribute('fill', state.color);
            if (text) text.textContent = state.bannerLabel;
        } else {
            banner.setAttribute('display', 'none');
            if (text) text.textContent = '';
        }
        if (rect) {
            rect.style.transformBox = 'fill-box';
            rect.style.transformOrigin = 'right center';
            rect.style.transform = state ? 'scaleX(1)' : 'scaleX(0)';
        }
        if (text) text.style.opacity = state ? '1' : '0';
    });
}

/** Escapes a value for a CSS attribute selector. */
export function attributeValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
