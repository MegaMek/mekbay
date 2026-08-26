// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    CrewStateDefinition,
    UnitConditionDefinition,
} from '../../models/unit-status-presentation';

export function renderRecordSheetPips(
    pips: readonly SVGElement[],
    maximum: number,
    committedRemaining: number,
    previewRemaining: number,
    markChanges = false,
): void {
    const committedDamage = maximum - committedRemaining;
    const previewDamage = maximum - previewRemaining;
    pips.forEach((pip, index) => {
        const ordinal = index + 1;
        pip.style.display = ordinal <= maximum ? '' : 'none';
        const damaged = ordinal <= previewDamage;
        if (pip.classList.contains('damaged') !== damaged) {
            pip.classList.toggle('damaged', damaged);
            pip.classList.toggle('fresh', markChanges);
        } else {
            pip.classList.remove('fresh');
        }
        pip.classList.toggle('pending',
            ordinal > Math.min(committedDamage, previewDamage)
            && ordinal <= Math.max(committedDamage, previewDamage));
    });
}

export function renderRecordSheetDestroyed(svg: SVGSVGElement, destroyed: boolean): void {
    let overlay = svg.querySelector<SVGTextElement>('#destroyed-overlay');
    if (!destroyed) {
        overlay?.remove();
        return;
    }
    if (!overlay) {
        overlay = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        overlay.setAttribute('id', 'destroyed-overlay');
        overlay.setAttribute('x', '50%');
        overlay.setAttribute('y', '40%');
        overlay.setAttribute('text-anchor', 'middle');
        overlay.setAttribute('font-size', '64');
        overlay.setAttribute('fill', 'red');
        overlay.setAttribute('stroke', 'black');
        overlay.setAttribute('paint-order', 'stroke fill');
        overlay.setAttribute('pointer-events', 'none');
        svg.appendChild(overlay);
    }
    overlay.textContent = 'DESTROYED';
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

function attributeValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
