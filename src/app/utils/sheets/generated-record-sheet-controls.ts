// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
    isAeroEntity,
    isMekEntity,
    isProtoMekEntity,
    isVehicleEntity,
} from '../../models/entity/utils/entity-type-guards';
import { isDroneOperatingSystemEquipment } from '../../models/drone-operating-system.model';
import { MEK_UNIT_CONDITION_CONTROLS } from '../../models/mek-record-sheet-controls';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import { gameRulesFor } from '../../models/rules/game-rules';
import {
    NARC_CONDITION_COLOR,
    UNIT_CONDITION_DEFINITIONS,
    unitConditionControls,
    type UnitConditionControl,
} from '../../models/unit-status-presentation';
import {
    addText,
    readViewBox,
    setAttributes,
    svgElement,
    transparentRect,
} from './record-sheet-svg-rendering';

export interface GeneratedRecordSheetControlOptions {
    readonly ruleset?: CBTRuleset;
    readonly fluffImageUrl?: string | null;
}

const UNIT_CONDITION_BANNER_FADE_WIDTH = 48;
const UNIT_CONDITION_BANNER_FADE_STRIPE_GAP = 6;
let unitConditionBannerFadeMaskSequence = 0;

/**
 * Emits application interaction/presentation markup as part of SVG generation.
 * This is the sole record-sheet control contract; generated artwork owns it natively.
 */
export function renderGeneratedRecordSheetControls(
    svg: SVGSVGElement,
    entity: BaseEntity,
    options: GeneratedRecordSheetControlOptions = {},
): void {
    const ruleset = options.ruleset ?? 'total-warfare';
    appendUnitConditionPresentation(svg, generatedUnitConditionControls(entity, ruleset));
    appendMovementPresentation(svg, isMekEntity(entity) && entity.chassisConfig === 'LAM');
    appendCrewStateMenuIndicators(svg, entity);
    applyConstructionPipPresentation(svg, entity);
    appendPipHitAreas(svg);
    appendGeneratedFluffImage(svg, entity, options.fluffImageUrl);
}

export function generatedUnitConditionControls(
    entity: BaseEntity,
    ruleset: CBTRuleset = 'total-warfare',
): readonly UnitConditionControl[] {
    if (isMekEntity(entity)) return MEK_UNIT_CONDITION_CONTROLS;
    if (!isVehicleEntity(entity) && !isProtoMekEntity(entity) && !isAeroEntity(entity)) return [];

    const drone = entity.equipment().some(mount => isDroneOperatingSystemEquipment(mount.equipment));
    return unitConditionControls([
        'swarmed',
        'tagged',
        'ecm-shielded',
        ...(gameRulesFor(ruleset).supportsSkidding ? ['skidding'] : []),
        'jammed',
        ...(drone ? ['disconnected'] : []),
    ]);
}

function appendUnitConditionPresentation(
    svg: SVGSVGElement,
    controls: readonly UnitConditionControl[],
): void {
    appendConditionButtons(svg, controls);
    appendConditionBanners(svg);
}

function appendConditionButtons(
    svg: SVGSVGElement,
    controls: readonly UnitConditionControl[],
): void {
    const buttons = [
        ...controls
            .filter(control => control.placement === 'button')
            .map(control => ({
                key: control.key,
                label: control.label,
                color: control.color,
                width: Math.max(30, control.label.length * 5.5),
            })),
        ...(controls.some(control => control.placement === 'menu')
            ? [{ key: 'menu', label: '...', color: '#666', width: 14 }]
            : []),
    ];
    if (buttons.length === 0) return;

    const type = svg.getElementById('type');
    const panel = type?.closest<SVGGElement>('[data-mekbay-frame-width]') ?? null;
    const parent: SVGElement = panel ?? svg;
    const viewBox = readViewBox(svg);
    const panelWidth = Number(panel?.dataset['mekbayFrameWidth']) || viewBox.width;
    const gap = 2;
    const height = 12;
    const totalWidth = buttons.reduce((sum, button) => sum + button.width, 0)
        + gap * Math.max(0, buttons.length - 1);
    let x = panelWidth - totalWidth - 16;
    const y = panel ? (isGeneratedMek(svg) ? -0.5 : 2) : 54;

    const wrapper = svgElement('g');
    wrapper.id = 'unit_condition_wrapper';
    wrapper.setAttribute('class', 'screen-only unitConditionWrapper');
    for (const button of buttons) {
        const group = svgElement('g');
        group.id = `unit_condition_button_${button.key}`;
        group.setAttribute('class', 'unitConditionButton');
        group.setAttribute('condition', button.key);
        group.setAttribute('active-color', button.color);
        group.style.setProperty('--unit-condition-active-color', button.color);
        const rect = svgElement('rect');
        setAttributes(rect, {
            x,
            y,
            width: button.width,
            height,
            fill: '#fff',
            stroke: '#000',
            'stroke-width': 1.2,
        });
        const label = addText(group, button.label, x + button.width / 2, y + height / 2 + 0.5, {
            size: 6.5,
            weight: 700,
            anchor: 'middle',
            class: 'conditionText no-autocolor',
        });
        label.setAttribute('dominant-baseline', 'middle');
        group.insertBefore(rect, label);
        wrapper.appendChild(group);
        x += button.width + gap;
    }
    parent.appendChild(wrapper);
}

function appendConditionBanners(svg: SVGSVGElement): void {
    const viewBox = readViewBox(svg);
    const bannerX = viewBox.x;
    const bannerY = viewBox.y + 7;
    const defs = directDefs(svg);
    const fadeMaskSequence = ++unitConditionBannerFadeMaskSequence;
    const wrapper = svgElement('g');
    wrapper.id = 'condition_banner_wrapper';
    wrapper.setAttribute('class', 'screen-only unitConditionBannerWrapper');

    for (const condition of UNIT_CONDITION_DEFINITIONS) {
        const width = condition.important ? 270 : 200;
        const height = condition.important ? 32 : 24;
        const fontSize = (condition.important ? 32 : 24) * (condition.bannerFontScaling || 1);
        const maskId = `generated_condition_banner_fade_${fadeMaskSequence}_${condition.key}`;
        appendConditionFadeMask(defs, maskId, bannerX, bannerY, width, height);
        const banner = svgElement('g');
        banner.id = `unit_condition_banner_${condition.key}`;
        banner.setAttribute('class', 'unitConditionBanner no-autocolor');
        banner.setAttribute('condition', condition.key);
        banner.setAttribute('condition-color', condition.color);
        banner.setAttribute('transform', 'translate(0 0)');
        banner.setAttribute('display', 'none');

        const background = svgElement('rect');
        setAttributes(background, {
            x: bannerX,
            y: bannerY,
            width,
            height,
            fill: condition.color,
            mask: `url(#${maskId})`,
            class: 'unitConditionBannerRect',
        });
        const label = addText(
            banner,
            condition.bannerLabel ?? condition.label,
            bannerX + 6,
            bannerY + height / 2 + 2,
            {
                size: fontSize,
                weight: 700,
                fill: condition.bannerTextColor ?? '#fff',
                class: 'unitConditionBannerText',
            },
        );
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-family', 'Roboto, sans-serif');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('text-anchor', 'start');
        banner.insertBefore(background, label);
        wrapper.appendChild(banner);
    }
    svg.appendChild(wrapper);
}

function appendConditionFadeMask(
    defs: SVGDefsElement,
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const mask = svgElement('mask');
    mask.id = id;
    setAttributes(mask, { maskUnits: 'userSpaceOnUse', x, y, width, height });

    const solidArea = svgElement('rect');
    setAttributes(solidArea, { x, y, width, height, fill: '#fff' });
    mask.appendChild(solidArea);

    const fadeWidth = Math.min(UNIT_CONDITION_BANNER_FADE_WIDTH, width);
    const fadeStart = x + width - fadeWidth;
    const stripeExtension = fadeWidth;
    const firstStripeX = fadeStart - height - UNIT_CONDITION_BANNER_FADE_STRIPE_GAP;
    const lastStripeX = x + width + height + UNIT_CONDITION_BANNER_FADE_STRIPE_GAP;
    for (let stripeX = firstStripeX;
        stripeX <= lastStripeX;
        stripeX += UNIT_CONDITION_BANNER_FADE_STRIPE_GAP) {
        const progress = Math.max(0, Math.min(1, (stripeX + height - fadeStart) / fadeWidth));
        if (progress <= 0) continue;

        const stripe = svgElement('path');
        setAttributes(stripe, {
            d: `M ${stripeX - stripeExtension} ${y + height + stripeExtension} L ${stripeX + height + stripeExtension} ${y - stripeExtension}`,
            stroke: '#000',
            'stroke-width': (0.4 + progress * 4.8).toFixed(2),
            'stroke-linecap': 'butt',
        });
        mask.appendChild(stripe);
    }

    defs.appendChild(mask);
}

function directDefs(svg: SVGSVGElement): SVGDefsElement {
    const existing = Array.from(svg.children)
        .find(child => child.tagName.toLowerCase() === 'defs') as SVGDefsElement | undefined;
    if (existing) return existing;
    const defs = svgElement('defs');
    svg.insertBefore(defs, svg.firstChild);
    return defs;
}

function appendMovementPresentation(svg: SVGSVGElement, tightWarning: boolean): void {
    const movements = [
        { id: 'mpWalk', modifier: '+1', psr: false },
        { id: 'mpRun', modifier: '+2', psr: true },
        { id: svg.getElementById('mpJump') ? 'mpJump' : 'mp_2', modifier: '+3', psr: true },
    ] as const;
    for (const movement of movements) {
        const value = svg.getElementById(movement.id) as SVGTextElement | null;
        if (!value) continue;
        value.classList.add('movementType');
        (value.previousElementSibling as SVGElement | null)?.classList.add('movementType');
        const parent = value.parentElement as SVGElement | null;
        if (!parent) continue;
        const valueX = Number(value.getAttribute('x')) || 0;
        const valueY = Number(value.getAttribute('y')) || 0;
        const fontSize = Number(value.getAttribute('font-size')) || 7.5;
        const badgeClass = `${movement.id}-rect screen-only`;
        const badge = svgElement('rect');
        badge.id = `${movement.id}-turnState-move-rect`;
        setAttributes(badge, {
            x: valueX - 7,
            y: valueY - fontSize,
            width: 14,
            height: fontSize + 2,
            fill: '#000',
            class: badgeClass,
            display: 'none',
        });
        const badgeText = addText(parent, movement.modifier, valueX, valueY + 0.5, {
            size: fontSize,
            weight: 700,
            fill: '#fff',
            anchor: 'middle',
            class: badgeClass,
        });
        badgeText.setAttribute('display', 'none');
        parent.insertBefore(badge, badgeText);

        if (!movement.psr) continue;
        const warning = addText(
            parent,
            tightWarning ? '!!!' : 'PSR!',
            valueX + (tightWarning ? 4 : 14),
            valueY,
            { size: 7, weight: 700, class: 'movePsrWarning movementType screen-only' },
        );
        warning.id = `${movement.id}-psr-warning`;
        warning.setAttribute('display', 'none');
    }
}

function appendCrewStateMenuIndicators(svg: SVGSVGElement, entity: BaseEntity): void {
    const drone = entity.equipment().some(mount => isDroneOperatingSystemEquipment(mount.equipment));
    const hasCrewStateControls = isMekEntity(entity) || isProtoMekEntity(entity)
        || isVehicleEntity(entity) && !drone;
    if (!hasCrewStateControls) return;

    const occurrences = new Set(Array.from(svg.querySelectorAll<SVGElement>('.crewStateButton[crewId]'))
        .map(control => control.getAttribute('crewId'))
        .filter((value): value is string => value !== null));
    for (const occurrence of occurrences) {
        if (svg.getElementById(`generated_crew_state_menu_${occurrence}`)) continue;
        const name = svg.getElementById(`pilotName${occurrence}`)
            ?? svg.getElementById(`crewName${occurrence}`);
        if (!name) continue;
        const parent = name.parentElement as SVGElement | null;
        if (!parent) continue;
        const frame = name.closest<SVGGElement>('[data-mekbay-frame-width]');
        const width = Number(frame?.dataset['mekbayFrameWidth']) || 145.6;
        const nameY = Number(name.getAttribute('y')) || 12;
        const control = svgElement('g');
        control.id = `generated_crew_state_menu_${occurrence}`;
        control.setAttribute('class', 'crewStateButton unitConditionButton screen-only');
        control.setAttribute('crewId', occurrence);
        control.setAttribute('data-mekbay-control-id', 'menu');
        const x = Math.max(0, width - 14);
        const rect = transparentRect(x, nameY - 10, 11, 11, 'crew-state-menu-hit-area');
        rect.setAttribute('fill', '#fff');
        rect.setAttribute('stroke', '#000');
        rect.setAttribute('stroke-width', '0.9');
        const text = addText(control, '...', x + 5.5, nameY - 2.5, {
            size: 6.5,
            weight: 700,
            anchor: 'middle',
            class: 'conditionText no-autocolor',
        });
        control.insertBefore(rect, text);
        parent.appendChild(control);
        ensureGeneratedCrewStateBanners(svg, parent, occurrence, x - 64, nameY - 10);
    }
}

function ensureGeneratedCrewStateBanners(
    svg: SVGSVGElement,
    parent: SVGElement,
    occurrence: string,
    x: number,
    y: number,
): void {
    const existing = [...svg.querySelectorAll<SVGGElement>(`.crewStateBanner[crewId="${occurrence}"]`)];
    const banners = existing.length > 0 ? existing : [svgElement('g')];
    for (const banner of banners) {
        banner.setAttribute('crewId', occurrence);
        banner.classList.add('crewStateBanner', 'unitConditionBanner', 'screen-only', 'no-autocolor');
        banner.setAttribute('display', 'none');
        if (!banner.parentNode) parent.appendChild(banner);
        if (!banner.querySelector(':scope > .unitConditionBannerRect')) {
            const background = svgElement('rect');
            setAttributes(background, {
                x,
                y,
                width: 64,
                height: 10,
                fill: '#666',
                class: 'unitConditionBannerRect',
            });
            banner.appendChild(background);
        }
        if (!banner.querySelector(':scope > .unitConditionBannerText')) {
            const label = addText(banner, '', x + 61, y + 6, {
                size: 8,
                weight: 700,
                fill: '#fff',
                anchor: 'end',
                class: 'unitConditionBannerText',
            });
            label.setAttribute('dominant-baseline', 'middle');
        }
    }
}

function applyConstructionPipPresentation(svg: SVGSVGElement, entity: BaseEntity): void {
    const uniformArmorName = entity.uniformArmor()?.armor.name ?? '';
    const armorNames = new Map([...entity.armorByLocation()]
        .map(([location, armor]) => [location, armor.armor.name] as const));
    doubleConstructionPips(svg, '.pip.armor', location =>
        (armorNames.get(location) ?? uniformArmorName).toLowerCase().includes('hardened'));

    const uniformStructureName = entity.uniformStructure()?.structure.name ?? '';
    const structureNames = new Map([...entity.structureByLocation()]
        .map(([location, structure]) => [location, structure.structure.name] as const));
    doubleConstructionPips(svg, '.pip.structure', location =>
        (structureNames.get(location) ?? uniformStructureName).toLowerCase().includes('reinforced'));
}

function doubleConstructionPips(
    svg: SVGSVGElement,
    selector: string,
    appliesAt: (location: string) => boolean,
): void {
    svg.querySelectorAll<SVGElement>(`${selector}:not(.half)`).forEach(pip => {
        const location = pip.getAttribute('loc');
        if (!location || pip.classList.contains('hardened') || !appliesAt(location)) return;
        pip.classList.add('hardened');
        const half = pip.cloneNode(true) as SVGElement;
        half.removeAttribute('id');
        half.classList.add('half');
        pip.after(half);
    });
}

function appendPipHitAreas(svg: SVGSVGElement): void {
    if (svg.querySelector('.unitLocation.armor, .unitLocation.structure')) return;
    svg.querySelectorAll<SVGElement>('.pip.armor:not(.half), .pip.structure:not(.half)').forEach(pip => {
        const hitArea = pip.cloneNode(false) as SVGElement;
        hitArea.removeAttribute('id');
        hitArea.removeAttribute('style');
        hitArea.classList.remove('pip', 'damaged', 'pending', 'fresh', 'hidden', 'hardened');
        hitArea.classList.add('pip-hit-area', 'screen-only');
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '15');
        hitArea.setAttribute('pointer-events', 'all');
        pip.after(hitArea);
    });
}

function appendGeneratedFluffImage(
    svg: SVGSVGElement,
    entity: BaseEntity,
    resolvedUrl: string | null | undefined,
): void {
    if (svg.getElementById('fluff-image-injected')) return;
    const encoded = entity.fluffImageEncoded().trim();
    const source = resolvedUrl ?? (encoded
        ? encoded.startsWith('data:') ? encoded : `data:image/png;base64,${encoded}`
        : null);
    if (!source) return;

    const boxes = Array.from(svg.querySelectorAll<SVGGElement>('.referenceTable[data-mekbay-region="center-panel"]'))
        .map(frameBox)
        .filter((box): box is { x: number; y: number; width: number; height: number } => box !== null);
    if (boxes.length === 0) return;
    const left = Math.min(...boxes.map(box => box.x));
    const top = Math.min(...boxes.map(box => box.y));
    const right = Math.max(...boxes.map(box => box.x + box.width));
    const bottom = Math.max(...boxes.map(box => box.y + box.height));
    const image = svgElement('image');
    image.id = 'fluff-image-injected';
    setAttributes(image, {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        preserveAspectRatio: 'xMidYMid meet',
    });
    image.setAttribute('href', source);
    image.style.display = 'none';
    svg.appendChild(image);
}

function frameBox(frame: SVGGElement): { x: number; y: number; width: number; height: number } | null {
    const width = Number(frame.dataset['mekbayFrameWidth']);
    const height = Number(frame.dataset['mekbayFrameHeight']);
    const transform = frame.getAttribute('transform') ?? '';
    const translate = /translate\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)/u.exec(transform);
    if (!Number.isFinite(width) || !Number.isFinite(height) || !translate) return null;
    return {
        x: Number(translate[1]),
        y: Number(translate[2]),
        width,
        height,
    };
}

function isGeneratedMek(svg: SVGSVGElement): boolean {
    return svg.dataset['mekbaySheetKind'] === 'mek'
        || svg.dataset['mekbayLayout'] === 'mek';
}

/** Native Mek critical-heading controls are authored by the Mek layout itself. */
export function appendGeneratedMekCriticalHeadingControls(
    criticalGroup: SVGGElement,
    heading: SVGTextElement,
    location: string,
    box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): void {
    heading.classList.add('locationConditionText');
    heading.setAttribute('loc', location);
    const control = svgElement('g');
    control.setAttribute('class', 'locationConditionControl');
    control.setAttribute('loc', location);
    control.setAttribute('pointer-events', 'all');
    const hitArea = transparentRect(box.x, box.y, box.width, box.height, 'locationConditionHitArea');
    criticalGroup.insertBefore(control, heading);
    control.appendChild(hitArea);

    const narc = svgElement('g');
    narc.setAttribute('class', 'locationNarcBanner screen-only');
    narc.setAttribute('loc', location);
    narc.setAttribute('display', 'none');
    const background = svgElement('rect');
    setAttributes(background, {
        x: box.x + 2,
        y: box.y - 9,
        width: 40,
        height: 8,
        fill: '#fff',
        stroke: NARC_CONDITION_COLOR,
        'stroke-width': 0.9,
        class: 'no-autocolor',
    });
    const label = addText(narc, 'NARC: 0', box.x + 23, box.y - 3, {
        size: 6.5,
        weight: 700,
        fill: NARC_CONDITION_COLOR,
        anchor: 'middle',
        class: 'no-autocolor',
    });
    narc.insertBefore(background, label);
    control.appendChild(narc);
}
