/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { getUnitServerHost, heatLevels } from "../models/common.model";
import type { CBTForceUnit } from "../models/cbt-force-unit.model";
import { getUnitConditionDefinition, UNIT_CONDITION_DEFINITIONS } from "../models/rules/unit-type-rules";
import type { Unit, UnitType } from "../models/units.model";

interface InventoryRangeButtonColumn {
    className: string;
    x: number;
    width: number;
    field: string;
}

interface InventoryRangeButtonSpec {
    className: string;
    labels: string[];
    field: string;
}

/*
 * Author: Drake
 */
export class RsPolyfillUtil {

    private static readonly UNIT_CONDITION_BANNER_WIDTH = 200;
    private static readonly UNIT_CONDITION_BANNER_HEIGHT = 24;
    private static readonly UNIT_CONDITION_BANNER_FONT_SIZE = 24;
    private static readonly IMPORTANT_UNIT_CONDITION_BANNER_WIDTH = 270;
    private static readonly IMPORTANT_UNIT_CONDITION_BANNER_HEIGHT = 32;
    private static readonly IMPORTANT_UNIT_CONDITION_BANNER_FONT_SIZE = 32;
    private static readonly UNIT_CONDITION_BANNER_FADE_WIDTH = 48;
    private static readonly UNIT_CONDITION_BANNER_FADE_STRIPE_GAP = 6;
    private static unitConditionBannerFadeMaskSequence = 0;
    private static readonly CREW_STATE_BUTTON_WIDTH = 10;
    private static readonly CREW_STATE_BUTTON_HEIGHT = 10;
    private static readonly CREW_STATE_BUTTON_GAP = 2;
    private static readonly CREW_STATE_BANNER_WIDTH = 64;
    private static readonly CREW_STATE_BANNER_HEIGHT = 10;
    private static readonly CREW_STATE_BANNER_FONT_SIZE = 8;
    private static readonly LOC_CONDITION_BUTTON_WIDTH = 8;
    private static readonly LOC_CONDITION_BUTTON_HEIGHT = 8;
    private static readonly LOC_CONDITION_BUTTON_GAP = 2;
    
    
    private static readonly CRITICAL_LOCATION_IDS = [
        "commander_hit",
        "driver_hit",
        "pilot_hit",
        "copilot_hit",
        "avionics_hit_",
        "fcs_hit_",
        "cic_hit_",
        "fuel_tank_hit_",
        "docking_collar_hit_",
        "kf_boom_hit_",
        "thruster_left_hit_",
        "thruster_right_hit_",
        "engine_hit_",
        "gyro_hit_",
        "sensor_hit_",
        "landing_gear_hit_",
        "life_support_hit_",
        "life_support_hit",
        "motive_system_hit_",
        "turret_locked",
        "turret_locked_f",
        "turret_locked_r",
        "stabilizer_hit_front",
        "stabilizer_hit_left",
        "stabilizer_hit_right",
        "stabilizer_hit_rear",
        "stabilizer_hit_turret",
        "stabilizer_hit_turret_f",
        "stabilizer_hit_turret_r",
        "flight_stabilizer_hit",
        // Protomek
        "gun_hit_",
        "ra_hit_",
        "legs_hit_",
        "torso_hit_",
        "la_hit_",
        "head_hit_",
    ];

    /**
     * Polyfill to add missing classes to record sheets SVGs.
     * TODO: Remove this when the record sheet SVGs are updated to include these classes.
     * @param callback The function to call when the browser is idle.
     */
    public static addMissingClasses(forceUnit: CBTForceUnit, svg: SVGSVGElement): void {
        const unit = forceUnit.getUnit();
        if (unit.type !== 'Mek') {
            this.addCriticalLocs(svg);
        }
        this.addConditionsButtons(forceUnit, svg);
        this.addMotiveHitPips(svg);
        this.addVtolRotorHitsCounter(unit, svg);
        this.addHeatLevels(svg);
        this.addApplyHeatButton(svg);
        this.addCrewSkillsButtons(svg, unit.type);
        this.addCrewDamageClasses(unit, svg);
        this.addCrewNamesButtons(svg, forceUnit);
        this.addInventoryLines(svg);
        this.adjustArmorPips(unit, svg);
        this.addPipHitAreas(svg);
        this.addHitMod(svg);
        this.injectFluffImage(unit, svg);
        this.addTurnStateClasses(unit, svg);
        this.addCritSlotClasses(svg);
        this.addCriticalSectionsButtons(unit, svg)
    }

    public static fixSvg(svg: SVGSVGElement): void {
        this.addViewBox(svg);
        this.fixFontSize(svg);
    }

    private static addViewBox(svg: SVGSVGElement): void {
        // Ensure the SVG has a viewBox attribute
        if (!svg.hasAttribute('viewBox')) {
            const width = svg.getAttribute('width') || '612';
            const height = svg.getAttribute('height') || '792';
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }
        // Remove width and height attributes to prevent scaling issues
        // svg.removeAttribute('width');
        // svg.removeAttribute('height');
    }

    /**
     * Fix font size for text elements in the SVG
     * TODO: fix this in the SVGs themselves.
     */
    private static fixFontSize(svg: SVGSVGElement): void {
        svg.querySelectorAll('[style]').forEach(el => {
            const style = el.getAttribute('style');
            if (style && /font-size\s*:\s*\d+(\.\d+)?(\s*;|;|$)/i.test(style)) {
                // Only add px if there is no unit after the number
                const fixed = style.replace(
                    /font-size\s*:\s*(\d+(\.\d+)?)(?!\s*[a-zA-Z%])(\s*;?)/gi,
                    (match, num, _, tail) => `font-size: ${num}px${tail || ''}`
                );
                if (fixed !== style) {
                    el.setAttribute('style', fixed);
                }
            }
        });
    }

    /**
     * Adds critical location classes to the svg.
     * This is a polyfill for older record sheets that do not have these classes.
     * TODO: fix this in the SVGs themselves.
     */
    private static addCriticalLocs(svg: SVGSVGElement): void {
        this.CRITICAL_LOCATION_IDS.forEach(baseId => {
            if (baseId.endsWith('_')) {
                for (let i = 1; i <= 8; i++) {
                    const fullId = `${baseId}${i}`;
                    this.addCritLocClassToElement(svg, fullId, baseId.substring(0, fullId.length - 1), i);
                }
            } else {
                this.addCritLocClassToElement(svg, baseId, baseId, 1);
            }
        });
    }

    private static addConditionsButtons(unit: CBTForceUnit, svg: SVGSVGElement): void {
        const hasButtonWrapper = !!svg.getElementById('unit_condition_wrapper');
        const hasBannerWrapper = !!svg.getElementById('condition_banner_wrapper');
        if (hasButtonWrapper && hasBannerWrapper) return;
        const conditionControls = unit.rules.conditionControls;
        if (conditionControls.length === 0) return;
        const immobileCondition = getUnitConditionDefinition('immobile') ?? { key: 'immobile', label: 'IMMOBILE', color: '#444' };
        const abandonedCondition = getUnitConditionDefinition('abandoned') ?? { key: 'abandoned', label: 'ABANDONED', color: '#7a1f1f' };
        const crippledCondition = getUnitConditionDefinition('crippled') ?? { key: 'crippled', label: 'CRIPPLED', color: '#b70000' };
        const conditions = [
            ...conditionControls,
            abandonedCondition,
            immobileCondition,
            crippledCondition,
        ];

        if (!hasButtonWrapper) {
            const unitDataPanelEl = svg.getElementById('unitDataPanel') as SVGGraphicsElement | null;
            if (unitDataPanelEl) {
                const frameEl = (unitDataPanelEl.querySelector('.frame')
                    ?? unitDataPanelEl.querySelectorAll('path')[1]
                    ?? unitDataPanelEl) as SVGGraphicsElement;
                const coords = frameEl.getBBox();
                const buttons = [
                    ...conditionControls
                        .filter(condition => condition.placement === 'button')
                        .map(condition => ({ ...condition, width: this.conditionButtonWidth(condition.label) })),
                    ...(conditionControls.some(condition => condition.placement === 'menu') ? [{ key: 'menu', label: '...', color: '#666', width: 14 }] : []),
                ];
                const buttonHeight = 12;
                const buttonGap = 2;
                const totalButtonWidth = buttons.reduce((total, button) => total + button.width, 0) + buttonGap * (buttons.length - 1);
                // This is needed to fix the misaligned buttons on Vehicles
                const buttonY = coords.y - (unit.getUnit().type === 'Mek' ? 0.5 : -2);
                let buttonX = coords.x + coords.width - totalButtonWidth - 16;
                const buttonWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                buttonWrapper.setAttribute('id', `unit_condition_wrapper`);
                buttonWrapper.setAttribute('class', 'screen-only unitConditionWrapper');

                buttons.forEach((condition) => {
                    const width = condition.width;
                    const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    buttonGroup.setAttribute('id', `unit_condition_button_${condition.key}`);
                    buttonGroup.setAttribute('class', 'unitConditionButton');
                    buttonGroup.setAttribute('condition', condition.key);
                    buttonGroup.setAttribute('active-color', condition.color);
                    buttonGroup.style.setProperty('--unit-condition-active-color', condition.color);

                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', buttonX.toString());
                    rect.setAttribute('y', buttonY.toString());
                    rect.setAttribute('width', width.toString());
                    rect.setAttribute('height', buttonHeight.toString());
                    rect.setAttribute('fill', '#fff');
                    rect.setAttribute('stroke', '#000');
                    rect.setAttribute('stroke-width', '1.2');

                    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    text.setAttribute('x', (buttonX + width / 2).toString());
                    text.setAttribute('y', (buttonY + buttonHeight / 2 + 0.5).toString());
                    text.setAttribute('class', 'conditionText no-autocolor');
                    text.setAttribute('text-anchor', 'middle');
                    text.setAttribute('dominant-baseline', 'middle');
                    text.setAttribute('font-family', 'Roboto, sans-serif');
                    text.setAttribute('font-size', '6.5');
                    text.setAttribute('font-weight', 'bold');
                    text.setAttribute('fill', '#000');
                    text.textContent = condition.label;

                    buttonGroup.appendChild(rect);
                    buttonGroup.appendChild(text);
                    buttonWrapper.appendChild(buttonGroup);
                    buttonX += width + buttonGap;
                });

                unitDataPanelEl.appendChild(buttonWrapper);
            }
        }

        if (hasBannerWrapper) return;

        const bannerWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        bannerWrapper.setAttribute('id', `condition_banner_wrapper`);
        bannerWrapper.setAttribute('class', 'screen-only unitConditionBannerWrapper');

        const svgBox = svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0
            ? svg.viewBox.baseVal
            : { x: 0, y: 0, width: svg.width.baseVal.value, height: svg.height.baseVal.value };
        const bannerX = svgBox.x;
        const bannerY = svgBox.y + 7;
        const defs = this.svgDefs(svg);
        const fadeMaskSequence = ++this.unitConditionBannerFadeMaskSequence;
        conditions.forEach(condition => {
            const definition = UNIT_CONDITION_DEFINITIONS.find(def => def.key === condition.key);
            const bannerWidth = definition?.important
                ? this.IMPORTANT_UNIT_CONDITION_BANNER_WIDTH
                : this.UNIT_CONDITION_BANNER_WIDTH;
            const bannerHeight = definition?.important
                ? this.IMPORTANT_UNIT_CONDITION_BANNER_HEIGHT
                : this.UNIT_CONDITION_BANNER_HEIGHT;
            const bannerFontSize = definition?.important
                ? this.IMPORTANT_UNIT_CONDITION_BANNER_FONT_SIZE
                : this.UNIT_CONDITION_BANNER_FONT_SIZE;
            const maskId = `unit_condition_banner_fade_${fadeMaskSequence}_${condition.key}`;
            this.addUnitConditionBannerFadeMask(defs, maskId, bannerX, bannerY, bannerWidth, bannerHeight);
            const bannerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bannerGroup.setAttribute('id', `unit_condition_banner_${condition.key}`);
            bannerGroup.setAttribute('class', 'unitConditionBanner no-autocolor');
            bannerGroup.setAttribute('condition', condition.key);
            bannerGroup.setAttribute('condition-color', condition.color);
            bannerGroup.setAttribute('transform', 'translate(0 0)');

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('class', 'unitConditionBannerRect');
            rect.setAttribute('x', bannerX.toString());
            rect.setAttribute('y', bannerY.toString());
            rect.setAttribute('width', bannerWidth.toString());
            rect.setAttribute('height', bannerHeight.toString());
            rect.setAttribute('fill', condition.color);
            rect.setAttribute('mask', `url(#${maskId})`);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('class', 'unitConditionBannerText');
            text.setAttribute('x', (bannerX + 6).toString());
            text.setAttribute('y', (bannerY + bannerHeight / 2 + 2).toString());
            text.setAttribute('text-anchor', 'start');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-family', 'Roboto, sans-serif');
            text.setAttribute('font-size', bannerFontSize.toString());
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#fff');
            text.textContent = condition.label;

            bannerGroup.appendChild(rect);
            bannerGroup.appendChild(text);
            bannerWrapper.appendChild(bannerGroup);
        });

        svg.appendChild(bannerWrapper);
    }

    private static svgDefs(svg: SVGSVGElement): SVGDefsElement {
        const existingDefs = Array.from(svg.children).find(child => child.tagName.toLowerCase() === 'defs') as SVGDefsElement | undefined;
        if (existingDefs) return existingDefs;

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs') as SVGDefsElement;
        svg.insertBefore(defs, svg.firstChild);
        return defs;
    }

    private static addUnitConditionBannerFadeMask(defs: SVGDefsElement, maskId: string, x: number, y: number, width: number, height: number): void {
        defs.querySelector(`[id="${maskId}"]`)?.remove();

        const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
        mask.setAttribute('id', maskId);
        mask.setAttribute('maskUnits', 'userSpaceOnUse');
        mask.setAttribute('x', x.toString());
        mask.setAttribute('y', y.toString());
        mask.setAttribute('width', width.toString());
        mask.setAttribute('height', height.toString());

        const solidArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        solidArea.setAttribute('x', x.toString());
        solidArea.setAttribute('y', y.toString());
        solidArea.setAttribute('width', width.toString());
        solidArea.setAttribute('height', height.toString());
        solidArea.setAttribute('fill', '#fff');
        mask.appendChild(solidArea);

        const fadeWidth = Math.min(this.UNIT_CONDITION_BANNER_FADE_WIDTH, width);
        const fadeStart = x + width - fadeWidth;
        const stripeExtension = fadeWidth;
        const firstStripeX = fadeStart - height - this.UNIT_CONDITION_BANNER_FADE_STRIPE_GAP;
        const lastStripeX = x + width + height + this.UNIT_CONDITION_BANNER_FADE_STRIPE_GAP;
        for (let stripeX = firstStripeX; stripeX <= lastStripeX; stripeX += this.UNIT_CONDITION_BANNER_FADE_STRIPE_GAP) {
            const progress = Math.max(0, Math.min(1, (stripeX + height - fadeStart) / fadeWidth));
            if (progress <= 0) continue;

            const stripe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            stripe.setAttribute('d', `M ${stripeX - stripeExtension} ${y + height + stripeExtension} L ${stripeX + height + stripeExtension} ${y - stripeExtension}`);
            stripe.setAttribute('stroke', '#000');
            stripe.setAttribute('stroke-width', (0.4 + progress * 4.8).toFixed(2));
            stripe.setAttribute('stroke-linecap', 'butt');
            mask.appendChild(stripe);
        }

        defs.appendChild(mask);
    }

    private static conditionButtonWidth(label: string): number {
        return Math.max(30, label.length * 5.5);
    }

    private static addCritLocClassToElement(svg: SVGSVGElement, elementId: string, type: string, hit: number): void {
        const element = svg.getElementById(elementId);
        if (element && !element.classList.contains('critLoc')) {
            element.classList.add('critLoc');
            element.setAttribute('fill', '#fff');
            element.setAttribute('type', type);
            element.setAttribute('hit', hit.toString());
            if (element.tagName.toLowerCase() === 'path' && element.nextElementSibling) {
                const nextSibling = element.nextElementSibling;
                if (nextSibling.tagName.toLowerCase() === 'text') {
                    nextSibling.classList.add('clickPassthrough');
                }
            }
        }
    }

    private static addMotiveHitPips(svg: SVGSVGElement): void {
        ['motive_system_hit_2', 'motive_system_hit_3'].forEach(id => {
            const motiveEl = svg.getElementById(id) as SVGGraphicsElement | null;
            if (!motiveEl || svg.getElementById(`${id}_pips`)) return;

            let bbox: DOMRect;
            try {
                bbox = motiveEl.getBBox();
            } catch {
                return;
            }

            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('id', `${id}_pips`);
            group.setAttribute('class', 'motiveHitPips screen-only');
            group.setAttribute('critId', id);

            const cellWidth = bbox.width / 3;
            const cellHeight = bbox.height / 3;
            const radius = Math.min(cellWidth, cellHeight) * 0.4;
            const yOffset = bbox.height + 1;
            for (let index = 0; index < 9; index++) {
                const column = index % 3;
                const row = Math.floor(index / 3);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('class', 'motiveHitPip hidden');
                circle.setAttribute('cx', (bbox.x + cellWidth * (column + 0.5)).toString());
                circle.setAttribute('cy', (bbox.y + yOffset + cellHeight * (row + 0.5)).toString());
                circle.setAttribute('r', radius.toString());
                group.appendChild(circle);
            }

            motiveEl.parentElement?.appendChild(group);
        });
    }

    private static addVtolRotorHitsCounter(unit: Unit, svg: SVGSVGElement): void {
        if (unit.type !== 'VTOL' || svg.getElementById('rotor_hits_group')) return;

        const rotorArmorText = svg.getElementById('textArmor_RO') as SVGTextElement | null;
        if (!rotorArmorText) return;

        const xAttr = rotorArmorText.getAttribute('x');
        const yAttr = rotorArmorText.getAttribute('y');
        if (!xAttr || !yAttr) return;

        const centerX = parseFloat(xAttr);
        const labelY = parseFloat(yAttr) - 10;
        if (!Number.isFinite(centerX) || !Number.isFinite(labelY)) return;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', 'rotor_hits_group');
        group.setAttribute('class', 'screen-only critLoc counterGroup rotorHitsControl');
        group.setAttribute('critId', 'rotor');
        group.setAttribute('type', 'rotor');
        group.setAttribute('transform', `translate(0 -40)`);

        const rectWidth = 36;
        const rectHeight = 24;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', (centerX - rectWidth / 2).toString());
        rect.setAttribute('y', (labelY - 8).toString());
        rect.setAttribute('width', rectWidth.toString());
        rect.setAttribute('height', rectHeight.toString());
        rect.setAttribute('fill', '#fff');
        rect.setAttribute('stroke', '#000');
        rect.setAttribute('stroke-width', '0.8');

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', centerX.toString());
        label.setAttribute('y', labelY.toString());
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-family', 'Roboto, sans-serif');
        label.setAttribute('font-size', '7');
        label.setAttribute('font-weight', 'bold');
        label.textContent = 'Rotor Hits';

        const counter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        counter.setAttribute('id', 'rotor_hits_counter');
        counter.setAttribute('x', centerX.toString());
        counter.setAttribute('y', (labelY + 9).toString());
        counter.setAttribute('text-anchor', 'middle');
        counter.setAttribute('dominant-baseline', 'middle');
        counter.setAttribute('font-family', 'Roboto, sans-serif');
        counter.setAttribute('font-size', '10');
        counter.setAttribute('font-weight', 'bold');
        counter.textContent = '0';

        group.appendChild(rect);
        group.appendChild(label);
        group.appendChild(counter);
        rotorArmorText.parentElement?.parentElement?.appendChild(group);
    }

    private static addCrewSkillsButtons(svg: SVGSVGElement, unitType: UnitType): void {
        if (svg.querySelector('.crewSkillButton')) return; // Avoid duplicates
        const skillTargets = [
            { textElement: 'gunnerySkill0', crewId: 0, skill: 'gunnery' },
            { textElement: 'pilotingSkill0', crewId: 0, skill: 'piloting' },
            { textElement: 'asfGunnerySkill', crewId: 0, skill: 'gunnery', asf: true },
            { textElement: 'asfPilotingSkill', crewId: 0, skill: 'piloting', asf: true },
            { textElement: 'gunnerySkill1', crewId: 1, skill: 'gunnery' },
            { textElement: 'pilotingSkill1', crewId: 1, skill: 'piloting' },
            { textElement: 'gunnerySkill2', crewId: 2, skill: 'gunnery' },
            { textElement: 'pilotingSkill2', crewId: 2, skill: 'piloting' },
            { textElement: 'gunnerySkill3', crewId: 3, skill: 'gunnery' },
            { textElement: 'pilotingSkill3', crewId: 3, skill: 'piloting' },
        ];
        skillTargets.forEach((skillTarget) => {
            const textElement = svg.getElementById(skillTarget.textElement);
            if (!textElement) return;
            const textElementVisibility = (textElement as SVGElement).getAttribute('visibility');
            if (textElementVisibility === 'hidden') return;
            const yAttr = (textElement as SVGTextElement).getAttribute('y');
            const xAttr = (textElement as SVGTextElement).getAttribute('x');
            if (!yAttr || !xAttr) return;
            let textY = parseFloat(yAttr) - 2;
            let textX = parseFloat(xAttr);
            textElement.setAttribute('text-anchor', 'left');
            textElement.setAttribute('dominant-baseline', 'middle');
            const prevStyle = textElement.getAttribute('style') || '';
            textElement.classList.add('skillValue');
            textElement.setAttribute('style', prevStyle.replace(/font-size\s*:\s*[^;]+;?/g, 'font-size:12px;font-weight:bold;'));
            if (unitType === 'Mek' || unitType === 'Tank' || unitType === 'VTOL' || unitType === 'Naval') {
                if (skillTarget.skill === 'piloting') {
                    textElement.setAttribute('x', (textX - 6).toString());
                } else {
                    textElement.setAttribute('x', (textX - 3).toString());
                }
            } else if (unitType === 'Aero') {
                if (skillTarget.skill === 'piloting') {
                    textElement.setAttribute('x', (textX - 2).toString());
                }
            }
            textElement.setAttribute('y', textY.toString());

            const rectWidth = 30;
            const rectHeight = 12;

            const rectX = (textX - rectWidth / 2) + 5;
            const rectY = (textY - rectHeight / 2) - 0.7;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            let asfSuffix = '';
            if (skillTarget.asf) {
                asfSuffix = '_asf';
                rect.setAttribute('asf', 'true');
            }
            rect.setAttribute('id', `crewSkillButton_${skillTarget.crewId}_${skillTarget.skill}${asfSuffix}`);
            rect.classList.add('crewSkillButton');
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', rectY.toString());
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('crewId', skillTarget.crewId.toString());
            rect.setAttribute('skill', skillTarget.skill);
            rect.setAttribute('textElement', skillTarget.textElement);
            textElement.parentNode?.appendChild(rect);
        });
    }

    private static addCrewNamesButtons(svg: SVGSVGElement, forceUnit: CBTForceUnit): void {
        if (svg.querySelector('.crewNameButton')) return; // Avoid duplicates
        const unitType = forceUnit.getUnit().type;
        const crewSize = forceUnit.getUnit().crewSize;
        // Ugly offset due to the sheets SVG messed up
        let offsetX = 0;
        if (unitType === 'Mek' && crewSize > 1) {
            offsetX = 5;
        } else if (unitType === 'Mek') {
            offsetX = 0;
        } else {
            offsetX = 2;
        }
        const addStateControls = forceUnit.rules.crewStateControls.length > 0;
        const nameTargets = [
            { blankPath: 'blankCrewName0', textElement: 'pilotName0', crewId: 0 },
            { blankPath: 'blankCrewName1', textElement: 'pilotName1', crewId: 1 },
            { blankPath: 'blankCrewName2', textElement: 'pilotName2', crewId: 2 },
            { blankPath: 'blankCrewName3', textElement: 'pilotName3', crewId: 3 },
            { blankPath: 'blankFluffName', textElement: 'fluffName', crewId: 0 }
        ];
        let firstNameX = 0;
        nameTargets.forEach((target, index) => {
            const blankNamePath = svg.querySelector(`#${target.blankPath}`);
            const nameText = svg.querySelector(`#${target.textElement}`);
            if (!blankNamePath || !nameText) return;
            const blankPathVisibility = (blankNamePath as SVGElement).getAttribute('visibility');
            const pilotTextVisibility = (nameText as SVGElement).getAttribute('visibility');
            if (blankPathVisibility === 'hidden' && pilotTextVisibility === 'hidden') return;
            const height = 12;
            if (firstNameX === 0) {
                firstNameX = parseFloat((nameText as SVGTextElement).getAttribute('x') || '0');
            }
            const nameX = firstNameX - 22;
            const nameY: number = parseFloat((nameText as SVGTextElement).getAttribute('y') || '0') + 1;
            const pathBBox = (blankNamePath as SVGPathElement).getBBox();
            let width = pathBBox.width;
            if (width <= 0) {
                width = 122; // Fallback
            } else {
                width += 22; // Add padding
            }
            const stateButtonWidth = addStateControls ? this.CREW_STATE_BUTTON_WIDTH : 0;
            const stateButtonGap = addStateControls ? this.CREW_STATE_BUTTON_GAP : 0;
            const nameButtonWidth = addStateControls ? Math.max(30, width - stateButtonWidth - stateButtonGap) : width;
            const clickArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            clickArea.classList.add('crewNameButton');
            clickArea.setAttribute('id', `crewNameButton${target.crewId}`);
            clickArea.setAttribute('x', nameX.toString());
            clickArea.setAttribute('y', (nameY - height).toString());
            clickArea.setAttribute('width', nameButtonWidth.toString());
            clickArea.setAttribute('height', height.toString());
            clickArea.setAttribute('fill', 'transparent');
            clickArea.setAttribute('crewId', target.crewId.toString());
            clickArea.setAttribute('textElement', target.textElement);
            clickArea.setAttribute('blankElement', target.blankPath);
            blankNamePath.parentNode?.insertBefore(clickArea, blankNamePath.nextSibling);
            if (addStateControls) {
                const buttonX = nameX + nameButtonWidth + stateButtonGap + offsetX;
                const buttonY = nameY + 2 - height + (height - this.CREW_STATE_BUTTON_HEIGHT) / 2;
                this.addCrewStateMenuButton(blankNamePath.parentNode, target.crewId, target.textElement, buttonX, buttonY);
            }
        });
    }

    private static addCrewStateMenuButton(parent: ParentNode | null, crewId: number, controlId: string, buttonX: number, buttonY: number): void {
        if (!parent) return;

        const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        buttonGroup.setAttribute('id', `crew_state_button_${crewId}_${controlId}`);
        buttonGroup.setAttribute('class', 'crewStateButton unitConditionButton screen-only');
        buttonGroup.setAttribute('crewId', crewId.toString());
        buttonGroup.setAttribute('active-color', '#666');
        buttonGroup.style.setProperty('--unit-condition-active-color', '#666');

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', buttonX.toString());
        rect.setAttribute('y', buttonY.toString());
        rect.setAttribute('width', this.CREW_STATE_BUTTON_WIDTH.toString());
        rect.setAttribute('height', this.CREW_STATE_BUTTON_HEIGHT.toString());
        rect.setAttribute('fill', '#fff');
        rect.setAttribute('stroke', '#000');
        rect.setAttribute('stroke-width', '0.72');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', (buttonX + this.CREW_STATE_BUTTON_WIDTH / 2).toString());
        text.setAttribute('y', (buttonY + this.CREW_STATE_BUTTON_HEIGHT / 2 + 0.5).toString());
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-family', 'Roboto, sans-serif');
        text.setAttribute('font-size', '6.5');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('fill', '#000');
        text.textContent = '...';

        const bannerX = buttonX - this.CREW_STATE_BANNER_WIDTH;
        const bannerY = buttonY;
        const bannerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        bannerGroup.setAttribute('id', `crew_state_banner_${crewId}_${controlId}`);
        bannerGroup.setAttribute('class', 'crewStateBanner unitConditionBanner screen-only no-autocolor');
        bannerGroup.setAttribute('crewId', crewId.toString());
        bannerGroup.setAttribute('display', 'none');

        const bannerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bannerRect.setAttribute('class', 'unitConditionBannerRect');
        bannerRect.setAttribute('x', bannerX.toString());
        bannerRect.setAttribute('y', bannerY.toString());
        bannerRect.setAttribute('width', this.CREW_STATE_BANNER_WIDTH.toString());
        bannerRect.setAttribute('height', this.CREW_STATE_BANNER_HEIGHT.toString());
        bannerRect.setAttribute('fill', '#666');

        const bannerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        bannerText.setAttribute('class', 'unitConditionBannerText');
        bannerText.setAttribute('x', (bannerX + this.CREW_STATE_BANNER_WIDTH - 3).toString());
        bannerText.setAttribute('y', (bannerY + this.CREW_STATE_BANNER_HEIGHT / 2 + 1).toString());
        bannerText.setAttribute('text-anchor', 'end');
        bannerText.setAttribute('dominant-baseline', 'middle');
        bannerText.setAttribute('font-family', 'Roboto, sans-serif');
        bannerText.setAttribute('font-size', this.CREW_STATE_BANNER_FONT_SIZE.toString());
        bannerText.setAttribute('font-weight', 'bold');
        bannerText.setAttribute('fill', '#fff');

        buttonGroup.appendChild(rect);
        buttonGroup.appendChild(text);
        bannerGroup.appendChild(bannerRect);
        bannerGroup.appendChild(bannerText);
        parent.appendChild(bannerGroup);
        parent.appendChild(buttonGroup);
    }

    /**
     * Adds crew damage hit boxes to the svg.
     * Creates transparent rectangles above crew damage text elements.
     */
    private static addCrewDamageClasses(unit: Unit, svg: SVGSVGElement): boolean {
        // First number: crew index (0-4)
        for (let crewId = 0; crewId <= 4; crewId++) {
            // Second number: hit index (1-10)
            let tracksDamage = false;
            for (let hit = 1; hit <= 10; hit++) {
                const elementId = `crew_damage_${crewId}_${hit}`;
                const textElement = svg.getElementById(elementId);
                if (textElement) {
                    this.addCrewHitRect(svg, textElement, crewId, hit);
                    tracksDamage = true;
                }
            }
        }
        return true;
    }

    private static addCrewHitRect(svg: SVGSVGElement, textElement: Element, crewId: number, hit: number): void {
        // Get text element position and dimension
        const yAttr = (textElement as SVGTextElement).getAttribute('y');
        const xAttr = (textElement as SVGTextElement).getAttribute('x');
        if (!yAttr || !xAttr) return;
        let textY = parseFloat(yAttr) - 1.3;
        let textX = parseFloat(xAttr);
        // Set dominant-baseline for consistent vertical alignment, let's also increase the font size
        textElement.setAttribute('dominant-baseline', 'middle');
        const prevStyle = textElement.getAttribute('style') || '';
        textElement.setAttribute('style', prevStyle.replace(/font-size\s*:\s*[^;]+;?/g, 'font-size:8px;font-weight:bold;'));
        textElement.setAttribute('y', textY.toString());

        // Calculate rectangle position (centered above the text element)
        const rectWidth = 14;
        const rectHeight = 10;
        const rectX = (textX - rectWidth / 2);
        const rectY = (textY - rectHeight / 2) - 0.5;
        const rectWidth2 = 10;
        const rectHeight2 = 8;
        const rectX2 = (textX - rectWidth2 / 2);
        const rectY2 = (textY - rectHeight2 / 2) - 0.5;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'crewHit');
        group.setAttribute('crewId', crewId.toString());
        group.setAttribute('hit', hit.toString());

        // Create the X (two lines forming a cross)
        const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line1.setAttribute('x1', rectX2.toString());
        line1.setAttribute('y1', rectY2.toString());
        line1.setAttribute('x2', (rectX2 + rectWidth2).toString());
        line1.setAttribute('y2', (rectY2 + rectHeight2).toString());
        line1.setAttribute('stroke', 'red');
        line1.setAttribute('stroke-width', '1.5');
        line1.setAttribute('class', 'crew-x');
        line1.setAttribute('opacity', '0');

        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', (rectX2 + rectWidth2).toString());
        line2.setAttribute('y1', rectY2.toString());
        line2.setAttribute('x2', rectX2.toString());
        line2.setAttribute('y2', (rectY2 + rectHeight2).toString());
        line2.setAttribute('stroke', 'red');
        line2.setAttribute('stroke-width', '1.5');
        line2.setAttribute('class', 'crew-x');
        line2.setAttribute('opacity', '0');

        // Create transparent rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', rectX.toString());
        rect.setAttribute('y', rectY.toString());
        rect.setAttribute('width', rectWidth.toString());
        rect.setAttribute('height', rectHeight.toString());
        rect.setAttribute('fill', 'transparent');

        group.appendChild(line1);
        group.appendChild(line2);
        group.appendChild(rect);

        if (textElement.nextSibling) {
            textElement.parentNode?.insertBefore(group, textElement.nextSibling);
        } else {
            textElement.parentNode?.appendChild(group);
        }
    }

    public static addHitMod(svg: SVGSVGElement): void {
        const inventoryEntries = svg.querySelectorAll('.inventoryEntry');

        inventoryEntries.forEach(group => {
            const id = group.getAttribute('id')?.replaceAll(' ', '_');
            group.classList.add(`eq-${id}`);

            // Avoid duplicate insertion
            const existingHitModRect = group.querySelector<SVGElement>(':scope > .hitMod-rect');
            const existingHitModText = group.querySelector<SVGElement>(':scope > .hitMod-text');
            if (existingHitModRect && existingHitModText) {
                this.addTargetTnOverlay(group, existingHitModRect, existingHitModText);
                return;
            }

            // Gather hitMod attributes
            let hitMod: string | null = '';
            if (group.hasAttribute('hitMod')) {
                hitMod = group.getAttribute('hitMod');
            } else {
                const parent = group.closest('.inventoryEntry');
                if (parent && parent.hasAttribute('hitMod2')) {
                    hitMod = parent.getAttribute('hitMod2');
                }
            }

            // Find .name elements for alignment
            let nameEl = group.querySelector('.name');
            if (!nameEl) return;

            // Get bounding box from .name element
            let bbox: DOMRect | null = null;
            try {
                bbox = (nameEl as SVGGraphicsElement).getBBox();
            } catch {
                bbox = null;
            }
            if (!bbox) return;

            // Try to get the font size from the .name element
            let fontSize = 9; // default
            const fs = nameEl.querySelector('text')?.getAttribute('font-size');
            if (fs) {
                const parsed = parseFloat(fs);
                if (!isNaN(parsed)) fontSize = parsed * 1.1;
            }

            if (nameEl?.querySelector('text')) {
                const subTextEl = nameEl.querySelector('text') as SVGGraphicsElement;
                const subTextBBox = subTextEl.getBBox();
                bbox.height = subTextBBox.height;
            }

            const rectWidth = 10;
            let rectHeight = bbox.height;
            let rectX = 0 - (rectWidth / 2);
            let rectY = bbox.y;

            if (fontSize > 6) {
                rectHeight += 1;
                rectY -= 0.5;
            }

            // Create rect
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', rectY.toString());
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('fill', '#000');
            rect.setAttribute('class', 'hitMod-rect');
            if (hitMod === '') {
                rect.setAttribute('display', 'none');
            }

            // // Create text
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (rectX + rectWidth / 2).toString());
            text.setAttribute('y', (rectY + rectHeight / 2 + fontSize / 3).toString());
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-family', 'monospace');
            text.setAttribute('font-size', fontSize.toString());
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#fff');
            text.setAttribute('class', 'hitMod-text');
            text.textContent = hitMod == '*' ? 'vs' : hitMod;
            if (hitMod === '') {
                text.setAttribute('display', 'none');
            }

            nameEl.parentElement?.appendChild(rect);
            nameEl.parentElement?.appendChild(text);
            this.addTargetTnOverlay(nameEl.parentElement ?? group, rect, text);
        });
    }

    private static addTargetTnOverlay(parent: Element, hitModRect: SVGElement, hitModText: SVGElement): void {
        if (parent.querySelector(':scope > .targetTn-rect') || parent.querySelector(':scope > .targetTn-text')) return;

        const targetTnRect = hitModRect.cloneNode(false) as SVGRectElement;
        targetTnRect.setAttribute('class', 'targetTn-rect');
        targetTnRect.setAttribute('fill', '#fff');
        targetTnRect.setAttribute('stroke', '#000');
        targetTnRect.setAttribute('stroke-width', '0.8');
        targetTnRect.setAttribute('display', 'none');

        const targetTnText = hitModText.cloneNode(false) as SVGTextElement;
        targetTnText.setAttribute('class', 'targetTn-text');
        targetTnText.setAttribute('fill', '#000');
        targetTnText.setAttribute('display', 'none');
        targetTnText.textContent = '';

        parent.appendChild(targetTnRect);
        parent.appendChild(targetTnText);
    }


    public static addInventoryLines(svg: SVGSVGElement): void {

        const inventoryEntries = svg.querySelectorAll('.inventoryEntry');
        if (!inventoryEntries.length) return;

        let rectX = 2;
        let rectWidth = 0;
        const rangeButtonColumns = this.findInventoryRangeButtonColumns(svg);
        const entryButtonLimitX = this.findInventoryEntryButtonLimitX(svg, rangeButtonColumns);
        const unitDataPanel = svg.querySelector('#unitDataPanel') as SVGSVGElement;
        if (unitDataPanel) {
            unitDataPanel.parentElement?.appendChild(unitDataPanel);
            let frame = unitDataPanel.querySelector('.frame') as SVGGraphicsElement;
            if (!frame) {
                const paths = unitDataPanel.querySelectorAll('path');
                if (paths.length > 1) {
                    frame = paths[1];
                }
            }
            const bboxPanel = frame.getBBox();
            rectWidth = bboxPanel.width - 4;
        }

        let ammoProfileButtonAdded = false;
        const addAmmoProfileButton = () => {
            const ammoProfile = svg.querySelector('#ammoProfile') as SVGGElement | null;
            if (ammoProfileButtonAdded || !ammoProfile || ammoProfile.querySelector('.ammoProfileButton')) return;
            let bbox: DOMRect | null = null;
            try {
                bbox = ammoProfile.getBBox();
            } catch {
                const ammoProfileText = ammoProfile.querySelector('text') as SVGGraphicsElement | null;
                bbox = ammoProfileText?.getBBox() ?? null;
            }
            if (!bbox) return;
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', bbox.y.toString());
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', bbox.height.toString());
            rect.setAttribute('class', 'inventoryEntryButton ammoProfileButton interactive screen-only');
            ammoProfile.insertBefore(rect, ammoProfile.firstChild);
            ammoProfileButtonAdded = true;
        };

        inventoryEntries.forEach(group => {
            const id = group.getAttribute('id');
            if (!id) return;
            const groupBBox = (group as SVGGElement).getBBox();
            // Find .name elements for alignment
            let nameEl = group.querySelector('.name') as SVGGraphicsElement;
            if (!nameEl) return;
            // Get bounding box from .name element
            let bbox = nameEl.getBBox();

            if (rectWidth === 0) {
                // We didn't get the rectWidth from the .frame, so we guess it using the first entry
                rectWidth = groupBBox.width + 4;
                rectX = groupBBox.x - 1;
            }
            addAmmoProfileButton();
            let rectHeight = bbox.height;
            let rectY = bbox.y;
            const rowRectWidth = this.inventoryEntryButtonWidth(rectX, rectWidth, entryButtonLimitX);

            // check for sub-text for the line alignment
            if (nameEl.querySelector('text')) {
                bbox = (nameEl.querySelector(':scope > text') as SVGGraphicsElement).getBBox();
            }

            const strike = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            strike.classList.add('damaged-strike');
            let yPosition = bbox.y + bbox.height / 2;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', bbox.x.toString());
            line.setAttribute('y1', yPosition.toString());
            line.setAttribute('x2', (groupBBox.x + groupBBox.width).toString());
            line.setAttribute('y2', yPosition.toString());
            line.setAttribute('stroke', 'var(--damage-color)');
            line.setAttribute('stroke-width', '1');
            line.setAttribute('class', 'damaged-strike');
            nameEl.parentElement?.insertBefore(line, nameEl.parentElement.firstChild);

            // Create rect
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', rectY.toString());
            rect.setAttribute('width', rowRectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('inventory-id', id);
            rect.setAttribute('class', 'inventoryEntryButton mainButton interactive screen-only');
            nameEl.parentElement?.insertBefore(rect, nameEl.parentElement.firstChild);
            this.addAimedShotWarningText(nameEl.parentElement, rectX + rectWidth, rectY, rectHeight);
            this.addRangeButtons(nameEl.parentElement, rangeButtonColumns, id, null, rectY, rectHeight);

            const alternativeModes = group.querySelectorAll('.alternativeMode');
            alternativeModes.forEach(mode => {
                const modeName = mode.getAttribute('mode');
                if (!modeName) return;
                const modeBBox = (mode as SVGGraphicsElement).getBBox();
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', rectX.toString());
                rect.setAttribute('y', modeBBox.y.toString());
                rect.setAttribute('width', rowRectWidth.toString());
                rect.setAttribute('height', rectHeight.toString());
                rect.setAttribute('inventory-id', id);
                rect.setAttribute('mode', modeName);
                rect.setAttribute('class', 'inventoryEntryButton alternativeModeButton interactive screen-only');
                mode.insertBefore(rect, mode.firstElementChild);
                this.addRangeButtons(mode, rangeButtonColumns, id, modeName, modeBBox.y, rectHeight);
            });
        });
    }

    private static addAimedShotWarningText(parent: Element | null | undefined, x: number, y: number, height: number): void {
        if (!parent || parent.querySelector(':scope > .targetAimedShotWarning-text')) return;

        const warningRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        warningRect.setAttribute('class', 'targetAimedShotWarning-rect screen-only');
        warningRect.setAttribute('x', x.toString());
        warningRect.setAttribute('y', y.toString());
        warningRect.setAttribute('width', '29');
        warningRect.setAttribute('height', height.toString());
        warningRect.setAttribute('fill', '#d12020');
        warningRect.setAttribute('display', 'none');
        parent.appendChild(warningRect);

        const warningText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        warningText.setAttribute('class', 'targetAimedShotWarning-text screen-only');
        warningText.setAttribute('x', (x + 2).toString());
        warningText.setAttribute('y', (y + height / 2).toString());
        warningText.setAttribute('dominant-baseline', 'central');
        warningText.setAttribute('fill', '#fefefe');
        warningText.setAttribute('font-size', '7');
        warningText.setAttribute('font-weight', '500');
        warningText.setAttribute('display', 'none');
        warningText.textContent = '';
        parent.appendChild(warningText);
    }

    private static findInventoryRangeButtonColumns(svg: SVGSVGElement): InventoryRangeButtonColumn[] {
        return this.findRangeButtonColumns(svg, [
            { className: 'shrButton', labels: ['Shr', 'Sht'], field: 'range_short' },
            { className: 'medButton', labels: ['Med'], field: 'range_medium' },
            { className: 'lngButton', labels: ['Lng'], field: 'range_long' },
        ]) || this.findRangeButtonColumns(svg, [
            { className: 'shrButton', labels: ['SRV'], field: 'range_short' },
            { className: 'medButton', labels: ['MRV'], field: 'range_medium' },
            { className: 'lngButton', labels: ['LRV'], field: 'range_long' },
            { className: 'extButton', labels: ['ERV'], field: 'range_extreme' },
        ]) || [];
    }

    private static findRangeButtonColumns(svg: SVGSVGElement, specs: InventoryRangeButtonSpec[]): InventoryRangeButtonColumn[] | null {
        const columns = specs.map(spec => {
            const header = this.findInventoryHeaderText(svg, spec.labels);
            return header ? { ...header, className: spec.className, field: spec.field } : null;
        });
        return columns.every((column): column is InventoryRangeButtonColumn => column !== null) ? columns : null;
    }

    private static findInventoryEntryButtonLimitX(svg: SVGSVGElement, rangeButtonColumns: InventoryRangeButtonColumn[]): number | null {
        const inventoryBox = svg.querySelector('#gInventoryBox');
        return rangeButtonColumns[0]?.x ?? null;
    }

    private static findInventoryHeaderText(svg: SVGSVGElement, labels: string[]): { x: number; width: number } | null {
        const inventoryBox = svg.querySelector('#gInventoryBox') ?? svg.querySelector('#unitDataPanel');
        if (!inventoryBox) return null;

        return this.findInventoryHeaderTextIn(inventoryBox, labels);
    }

    private static findInventoryHeaderTextIn(inventoryBox: Element, labels: string[]): { x: number; width: number } | null {
        const labelSet = new Set(labels);
        const header = Array.from(inventoryBox.querySelectorAll<SVGTextElement>('text'))
            .find(text => labelSet.has(text.textContent?.trim() ?? ''));
        if (!header) return null;

        try {
            const bbox = header.getBBox();
            if (Number.isFinite(bbox.x) && Number.isFinite(bbox.width) && bbox.width > 0) {
                return { x: bbox.x, width: bbox.width };
            }
        } catch {
            // Fall back to attributes below.
        }

        const x = Number.parseFloat(header.getAttribute('x') ?? '');
        const width = Number.parseFloat(header.getAttribute('textLength') ?? '');
        if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return null;
        const textAnchor = header.getAttribute('text-anchor');
        return { x: textAnchor === 'middle' ? x - width / 2 : x, width };
    }

    private static inventoryEntryButtonWidth(rectX: number, rectWidth: number, limitX: number | null): number {
        if (limitX === null) return rectWidth;
        return Math.max(0, limitX - rectX - 1.2);
    }

    private static addRangeButtons(
        parent: Element | null | undefined,
        rangeButtonColumns: InventoryRangeButtonColumn[],
        inventoryId: string,
        modeName: string | null,
        y: number,
        height: number
    ): void {
        if (!parent || rangeButtonColumns.length === 0) return;
        for (const column of rangeButtonColumns) {
            // we need this so that physical weapons have range clickable areas
            // if (!this.hasRangeButtonValue(parent, column.field)) continue;
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', column.x.toString());
            rect.setAttribute('y', y.toString());
            rect.setAttribute('width', column.width.toString());
            rect.setAttribute('height', height.toString());
            rect.setAttribute('inventory-id', inventoryId);
            if (modeName) rect.setAttribute('mode', modeName);
            rect.setAttribute('class', `inventoryEntryButton ${column.className} interactive screen-only`);
            parent.insertBefore(rect, parent.firstElementChild);
        }
    }

    private static hasRangeButtonValue(parent: Element, field: string): boolean {
        const value = parent.querySelector(`:scope > .${field}`)?.textContent?.trim() ?? '';
        return value.length > 0 && value !== '—';
    }

    private static adjustArmorPips(unit: Unit, svg: SVGSVGElement): void {
        if (unit.armorType === 'Hardened') {
            const armorPips = svg.querySelectorAll<SVGElement>('.pip.armor');
            armorPips.forEach(pip => {
                pip.classList.add('hardened');
                const clone = pip.cloneNode(true) as SVGElement;
                clone.classList.add('half');
                if (pip.parentNode && pip.nextSibling) {
                    pip.parentNode.insertBefore(clone, pip.nextSibling);
                } else if (pip.parentNode) {
                    pip.parentNode.appendChild(clone);
                }
            });
        }
        const structureType = svg.getElementById('structureType')?.textContent || '';
        if (structureType.includes('Reinforced')) {
            const structurePips = svg.querySelectorAll<SVGElement>('.pip.structure');
            structurePips.forEach(pip => {
                pip.classList.add('hardened');
                const clone = pip.cloneNode(true) as SVGElement;
                clone.classList.add('half');
                if (pip.parentNode && pip.nextSibling) {
                    pip.parentNode.insertBefore(clone, pip.nextSibling);
                } else if (pip.parentNode) {
                    pip.parentNode.appendChild(clone);
                }
            });
        }
    };

    /**
     * Adds larger transparent hit areas to armor and structure pips.
     * This is needed when .unitLocation zones are not available and we fall back to individual pips,
     * which are too small to reliably tap on touch devices.
     */
    private static addPipHitAreas(svg: SVGSVGElement): void {
        // Only add hit areas if there are no .unitLocation zones
        // (if .unitLocation exists, those are used instead for interaction)
        if (svg.querySelector('.unitLocation')) return;

        const pips = svg.querySelectorAll<SVGElement>('.pip.armor, .pip.structure');
        if (pips.length === 0) return;

        const hitAreaSize = 15; // Size of the transparent hit area rectangle

        pips.forEach(pip => {
            // Skip if hit area already added
            if (pip.querySelector('.pip-hit-area')) return;

            const bbox = (pip as SVGGraphicsElement).getBBox();
            const centerX = bbox.x + bbox.width / 2;
            const centerY = bbox.y + bbox.height / 2;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            rect.setAttribute('cx', centerX.toString());
            rect.setAttribute('cy', centerY.toString());
            rect.setAttribute('r', (hitAreaSize / 2).toString());
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('class', 'pip-hit-area screen-only');

            // Copy relevant attributes from pip to hit area
            const loc = pip.getAttribute('loc');
            if (loc) rect.setAttribute('loc', loc);
            const rear = pip.getAttribute('rear');
            if (rear) rect.setAttribute('rear', rear);
            const id = pip.getAttribute('id');
            if (id) rect.setAttribute('pip-id', id);

            // Copy relevant classes for interaction service to identify pip type
            if (pip.classList.contains('armor')) rect.classList.add('armor');
            if (pip.classList.contains('structure')) rect.classList.add('structure');
            if (pip.classList.contains('shield')) rect.classList.add('shield');

            pip.after(rect);
        });
    }

    private static addHeatLevels(svg: SVGSVGElement): void {
        const heatScale = svg.querySelector('#heatScale');
        if (!heatScale) return;

        heatScale.querySelectorAll<SVGElement>('.heat').forEach(heatRect => {
            const heatVal = Number(heatRect.getAttribute('heat'));
            const heatLevel = heatLevels.find(cfg => heatVal >= cfg.min && heatVal <= cfg.max);
            if (heatLevel) {
                heatRect.classList.add(heatLevel.class);
                heatRect.classList.add('no-autocolor');
            }
        });

        const overflowFrameEl = heatScale.querySelector('.overflowFrame') as SVGGraphicsElement | null;
        if (overflowFrameEl) {
            overflowFrameEl.style.pointerEvents = 'none';
            const bbox = overflowFrameEl.getBBox();
            // we create a transparent rectangle over it
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', bbox.x.toString());
            rect.setAttribute('y', bbox.y.toString());
            rect.setAttribute('width', bbox.width.toString());
            rect.setAttribute('height', bbox.height.toString());
            rect.setAttribute('class', 'overflowButton screen-only no-autocolor');
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('pointer-events', 'all');
            overflowFrameEl.parentElement?.insertBefore(rect, overflowFrameEl);
        }
    }

    private static addApplyHeatButton(svg: SVGSVGElement): void {
        const heatDataPanel = svg.querySelector('#heatDataPanel');
        if (!heatDataPanel) return;
        // We search the first <g>, we clone the content and create a button
        const firstGroup = heatDataPanel.querySelector('g');
        if (!firstGroup) return;
        const buttonGroup = firstGroup.cloneNode(true) as SVGGElement;
        buttonGroup.setAttribute('id', 'applyHeatButton');
        buttonGroup.setAttribute('class', 'screen-only no-autocolor');
        const textEl = buttonGroup.querySelector('text');
        if (textEl) {
            textEl.textContent = 'APPLY HEAT';
        }
        heatDataPanel.appendChild(buttonGroup);
        // We find the 2nd path and we add a class to it so we can style the border of the frame
        const paths = heatDataPanel.querySelectorAll('path');
        if (paths.length >= 2) {
            paths[1].classList.add('applyHeatButtonFrame');
            const frameBBox = (paths[1] as SVGGraphicsElement).getBBox();
            const damagedEngineHeatText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            damagedEngineHeatText.setAttribute('id', 'damagedEngineHeatText');
            damagedEngineHeatText.setAttribute('x', (frameBBox.x + frameBBox.width - 6).toString());
            damagedEngineHeatText.setAttribute('y', (frameBBox.y + frameBBox.height - 4).toString());
            damagedEngineHeatText.setAttribute('text-anchor', 'end');
            damagedEngineHeatText.setAttribute('dominant-baseline', 'text-after-edge');
            damagedEngineHeatText.setAttribute('font-family', 'Arial, sans-serif');
            damagedEngineHeatText.setAttribute('font-size', '8');
            damagedEngineHeatText.setAttribute('font-weight', 'bold');
            damagedEngineHeatText.setAttribute('letter-spacing', '-0.05em');
            damagedEngineHeatText.setAttribute('fill', 'red');
            damagedEngineHeatText.setAttribute('class', 'damagedEngineHeatText');
            damagedEngineHeatText.setAttribute('display', 'none');
            paths[1].parentElement?.appendChild(damagedEngineHeatText);
        }

        const pipsGroup = heatDataPanel.querySelector('g.hsPips');
        // We create a background rectangle to act as button hit area
        if (pipsGroup) {
            const bbox = (pipsGroup as SVGGraphicsElement).getBBox();
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            const x = bbox.x - 6;
            const y = bbox.y - 6;
            const width = bbox.width + 12;
            const height = bbox.height + 12;
            rect.setAttribute('x', x.toString());
            rect.setAttribute('y', y.toString());
            rect.setAttribute('width', width.toString());
            rect.setAttribute('height', height.toString());
            rect.setAttribute('class', 'changeActiveHeatsinksCountButton screen-only');
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('pointer-events', 'all');
            pipsGroup.insertBefore(rect, pipsGroup.firstChild);
        }
    }

    private static injectFluffImage(unit: Unit, svg: SVGSVGElement) {
        const fluffImage = unit?.fluff?.img;
        if (!fluffImage) return; // no fluff image to inject
        if (fluffImage.endsWith('hud.png')) return; // default fluff image, we skip
        const fluffImageUrl = `${getUnitServerHost(unit)}/images/fluff/${fluffImage}`;
        const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
        if (referenceTables.length === 0) return; // We don't have a place where to put the fluff image
        // We calculate the width/height using all the reference tables and also the top/left most position
        const pt = svg.createSVGPoint();
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let topLeftElement: SVGGraphicsElement = referenceTables[0]; // We guess the first one is the top left most
        referenceTables.forEach((rt: SVGGraphicsElement) => {
            const bbox = rt.getBBox();
            const ctm = rt.getCTM() ?? svg.getCTM() ?? new DOMMatrix();
            const corners = [
                { x: bbox.x, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y },
                { x: bbox.x, y: bbox.y + bbox.height },
                { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
            ];
            let rtMinX = Number.POSITIVE_INFINITY;
            let rtMinY = Number.POSITIVE_INFINITY;
            let rtMaxX = Number.NEGATIVE_INFINITY;
            let rtMaxY = Number.NEGATIVE_INFINITY;
            for (const c of corners) {
                pt.x = c.x; pt.y = c.y;
                const p = pt.matrixTransform(ctm);
                rtMinX = Math.min(rtMinX, p.x);
                rtMinY = Math.min(rtMinY, p.y);
                rtMaxX = Math.max(rtMaxX, p.x);
                rtMaxY = Math.max(rtMaxY, p.y);
            }

            minX = Math.min(minX, rtMinX);
            minY = Math.min(minY, rtMinY);
            maxX = Math.max(maxX, rtMaxX);
            maxY = Math.max(maxY, rtMaxY);
            // Check if this rt is more top-left than the current topLeftElement
            if (rtMinY < minY || (rtMinY === minY && rtMinX < minX)) {
                topLeftElement = rt;
            }
        });
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;
        // Determine parent to inject into (parent of top/left most referenceTable if available)
        let injectParent: ParentNode = svg;
        if (topLeftElement?.parentElement) {
            injectParent = topLeftElement.parentElement;
        }
        const parentCTM = (injectParent as any).getCTM ? (injectParent as SVGGraphicsElement).getCTM() : null;
        const invParent = parentCTM ? parentCTM.inverse() : new DOMMatrix();
        pt.x = minX; pt.y = minY;
        const localTL = pt.matrixTransform(invParent);
        pt.x = maxX; pt.y = maxY;
        const localBR = pt.matrixTransform(invParent);

        const localWidth = localBR.x - localTL.x;
        const localHeight = localBR.y - localTL.y;
        const rootW = Math.max(0, localWidth);
        const rootH = Math.max(0, localHeight);

        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('id', 'fluff-image-fo');
        fo.setAttribute('x', localTL.x.toString());
        fo.setAttribute('y', localTL.y.toString());
        fo.setAttribute('width', rootW.toString());
        fo.setAttribute('height', rootH.toString());
        fo.setAttribute('style', 'display: none;');

        const htmlImg = document.createElementNS('http://www.w3.org/1999/xhtml', 'img');
        htmlImg.setAttribute('id', 'fluff-image-injected');
        htmlImg.setAttribute('src', fluffImageUrl);
        htmlImg.setAttribute('alt', '');
        htmlImg.style.width = '100%';
        htmlImg.style.height = '100%';
        htmlImg.style.objectFit = 'contain';

        fo.appendChild(htmlImg);
        topLeftElement.after(fo);
    }

    private static addTurnStateClasses(unit: Unit, svg: SVGSVGElement): void {
        const mpWalkEl = svg.getElementById('mpWalk') as SVGElement | null;
        const mpRunEl = svg.getElementById('mpRun') as SVGElement | null;
        const mpJumpEl = svg.getElementById('mpJump') as SVGElement | null;
        for (const moveEl of [mpWalkEl, mpRunEl, mpJumpEl]) {
            if (!moveEl) continue;
            moveEl.classList.add('movementType');
            const labelEl = moveEl.previousElementSibling as SVGElement | null;
            if (labelEl) {
                labelEl.classList.add('movementType');
            }

            // Add a black rectangle aligned using the same X alignment used in addHitMod
            const rectId = `${moveEl.id}-turnState-move-rect`;
            if (svg.getElementById(rectId)) continue; // avoid duplicates

            const bbox = this.getElementBBoxInParentCoordinates(svg, moveEl);
            if (!bbox) continue;

            const rectWidth = 10;
            let rectHeight = bbox.height;
            // Same X alignment as addHitMod: centered at x = 0
            const rectX = 0 - (rectWidth / 2);
            let rectY = bbox.y;

            // Try to infer font size to adjust height (similar to addHitMod)
            let fontSize = 7.5;
            rectHeight += 1;
            rectY -= 0.5;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('id', rectId);
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', rectY.toString());
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('fill', '#000');
            rect.setAttribute('class', moveEl.id + '-rect screen-only');
            rect.setAttribute('display', 'none');



            // // Create text
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (rectX + rectWidth / 2).toString());
            text.setAttribute('y', (rectY + rectHeight / 2 + fontSize / 3).toString());
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-family', 'monospace');
            text.setAttribute('font-size', fontSize.toString());
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#fff');
            text.setAttribute('class', moveEl.id + '-rect screen-only');
            rect.setAttribute('display', 'none');
            if (moveEl == mpWalkEl) text.textContent = '+1';
            else if (moveEl == mpRunEl) text.textContent = '+2';
            else if (moveEl == mpJumpEl) text.textContent = '+3';

            moveEl.parentElement?.appendChild(rect);
            moveEl.parentElement?.appendChild(text);
        }

        this.addMovementPsrWarningText(unit, svg, mpRunEl);
        this.addMovementPsrWarningText(unit, svg, mpJumpEl ?? (svg.querySelector('#mp_2') as SVGElement | null));
    }

    private static addMovementPsrWarningText(unit: Unit, svg: SVGSVGElement, moveEl: SVGElement | null): void {
        if (!moveEl) return;

        const warningId = `${moveEl.id}-psr-warning`;
        if (svg.getElementById(warningId)) return;

        const xAttr = moveEl.getAttribute('x');
        const yAttr = moveEl.getAttribute('y');
        if (!xAttr || !yAttr) return;

        const tightSpaceForText = unit.subtype === 'Land-Air BattleMek';
        const warningPosition = this.transformElementPointToParentCoordinates(
            svg,
            moveEl,
            parseFloat(xAttr) + (tightSpaceForText ? 4 : 8),
            parseFloat(yAttr)
        );
        if (!warningPosition) return;

        const warningText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        warningText.setAttribute('id', warningId);
        warningText.setAttribute('x', warningPosition.x.toString());
        warningText.setAttribute('y', warningPosition.y.toString());
        warningText.setAttribute('text-anchor', 'start');
        warningText.setAttribute('class', 'movePsrWarning movementType screen-only');
        warningText.setAttribute('display', 'none');
        warningText.textContent = tightSpaceForText ? '!!!' : 'PSR!';

        moveEl.parentElement?.appendChild(warningText);
    }

    private static getElementBBoxInParentCoordinates(svg: SVGSVGElement, el: SVGElement): DOMRect | null {
        let bbox: DOMRect;
        try {
            bbox = (el as SVGGraphicsElement).getBBox();
        } catch {
            return null;
        }

        const parent = el.parentElement as SVGGraphicsElement | null;
        const elementCTM = (el as SVGGraphicsElement).getCTM?.() ?? null;
        const parentCTM = parent?.getCTM?.() ?? svg.getCTM() ?? null;
        if (!elementCTM || !parentCTM) return bbox;

        const pt = svg.createSVGPoint();
        const invParent = parentCTM.inverse();
        const corners = [
            { x: bbox.x, y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y },
            { x: bbox.x, y: bbox.y + bbox.height },
            { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
        ];
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const corner of corners) {
            pt.x = corner.x;
            pt.y = corner.y;
            const transformed = pt.matrixTransform(elementCTM).matrixTransform(invParent);
            minX = Math.min(minX, transformed.x);
            minY = Math.min(minY, transformed.y);
            maxX = Math.max(maxX, transformed.x);
            maxY = Math.max(maxY, transformed.y);
        }

        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
        return new DOMRect(minX, minY, maxX - minX, maxY - minY);
    }

    private static transformElementPointToParentCoordinates(svg: SVGSVGElement, el: SVGElement, x: number, y: number): DOMPoint | null {
        const parent = el.parentElement as SVGGraphicsElement | null;
        const elementCTM = (el as SVGGraphicsElement).getCTM?.() ?? null;
        const parentCTM = parent?.getCTM?.() ?? svg.getCTM() ?? null;
        if (!elementCTM || !parentCTM) return new DOMPoint(x, y);

        const pt = svg.createSVGPoint();
        pt.x = x;
        pt.y = y;
        return pt.matrixTransform(elementCTM).matrixTransform(parentCTM.inverse());
    }

    private static addCritSlotClasses(svg: SVGSVGElement): void {
        const critSlots = svg.querySelectorAll<SVGSVGElement>('.critSlot');
        const columns = new Map<ParentNode, DOMRect>();
        critSlots.forEach((critSlot: SVGSVGElement) => {
            // Avoid duplicate insertion
            if (critSlot.querySelector('.critSlot-bg-rect')) return;
            if (critSlot.getAttribute('hittable') != '1') return;

            // Find the text element inside the critSlot
            const textElement = critSlot.querySelector('text');
            if (!textElement) return;

            // Get text bounding box for positioning
            let bbox: DOMRect | null = null;
            let parentBBox: DOMRect | null = null;
            try {
                bbox = critSlot.getBBox();
                // having the parentBBox saved avoids the drifting of the X position after we add elements with X-1
                if (columns.has(critSlot.parentNode as ParentNode)) {
                    parentBBox = columns.get(critSlot.parentNode as ParentNode) || null;
                } else {
                    parentBBox = (critSlot.parentNode as SVGGraphicsElement).getBBox();
                    columns.set(critSlot.parentNode as ParentNode, parentBBox);
                }
            } catch {
                bbox = null;
                parentBBox = null;
            }

            if (!bbox || !parentBBox) return;

            // Create background rect
            const rectWidth = 95; //Math.max(90, bbox.width)+5;
            const rectHeight = bbox.height;
            const rectX = parentBBox.x - 1; // Slight left padding
            const rectY = bbox.y;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', rectY.toString());
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('fill', 'transparent'); // Transparent background
            rect.setAttribute('class', 'critSlot-bg-rect');

            // Insert rect before the text element
            critSlot.insertBefore(rect, textElement);
        });
        columns.clear();
    }

    
    private static addCriticalSectionsButtons(unit: Unit, svg: SVGSVGElement): void {
        if (unit.type !== 'Mek') return;

        svg.querySelectorAll<SVGElement>('.critGroup').forEach(critGroup => {
            const loc = critGroup.getAttribute('loc');
            if (!loc) return;
            if (critGroup.querySelector('.locationConditionButton')) return;
            const textEl = Array.from(critGroup.children).find(child => child.tagName.toLowerCase() === 'text') as SVGGraphicsElement | undefined;
            if (!textEl) return;
            textEl.classList.add('locationConditionText');
            textEl.setAttribute('loc', loc);
            textEl.style.pointerEvents = 'all';
            const textCoords = textEl.getBBox();
            const buttonX = textCoords.x - this.LOC_CONDITION_BUTTON_WIDTH - 1.5;
            const buttonY = textCoords.y + 1.5;
            const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            buttonGroup.setAttribute('id', `location_condition_${loc}`);
            buttonGroup.setAttribute('class', 'locationConditionButton locConditionButton screen-only');
            buttonGroup.setAttribute('loc', loc);

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', buttonX.toString());
            rect.setAttribute('y', buttonY.toString());
            rect.setAttribute('width', this.LOC_CONDITION_BUTTON_WIDTH.toString());
            rect.setAttribute('height', this.LOC_CONDITION_BUTTON_HEIGHT.toString());
            rect.setAttribute('fill', '#fff');
            rect.setAttribute('stroke', '#000');
            rect.setAttribute('stroke-width', '0.72');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (buttonX + this.LOC_CONDITION_BUTTON_WIDTH / 2).toString());
            text.setAttribute('y', (buttonY + this.LOC_CONDITION_BUTTON_HEIGHT / 2 + 0.5).toString());
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-family', 'Roboto, sans-serif');
            text.setAttribute('font-size', '6.5');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#000');
            text.textContent = '...';

            buttonGroup.appendChild(rect);
            buttonGroup.appendChild(text);
            critGroup.insertBefore(buttonGroup, textEl);

            const narcBanner = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            narcBanner.setAttribute('class', 'locationNarcBanner screen-only');
            narcBanner.setAttribute('loc', loc);
            narcBanner.setAttribute('display', 'none');
            const critGroupTransform = critGroup.getAttribute('transform');
            if (critGroupTransform) narcBanner.setAttribute('transform', critGroupTransform);

            const narcRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            narcRect.setAttribute('x', textCoords.x.toString());
            narcRect.setAttribute('y', (textCoords.y - 8).toString());
            narcRect.setAttribute('width', '40');
            narcRect.setAttribute('height', '8');
            narcRect.setAttribute('fill', '#fff');
            narcRect.setAttribute('stroke', '#f00');
            narcRect.setAttribute('stroke-width', '0.9');
            narcRect.setAttribute('class', 'no-autocolor');

            const narcText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            narcText.setAttribute('x', (textCoords.x + 21).toString());
            narcText.setAttribute('y', (textCoords.y - 2).toString());
            narcText.setAttribute('text-anchor', 'middle');
            narcText.setAttribute('font-family', 'Roboto, sans-serif');
            narcText.setAttribute('font-size', '6.5');
            narcText.setAttribute('font-weight', 'bold');
            narcText.setAttribute('fill', '#f00');
            narcText.setAttribute('class', 'no-autocolor');
            narcText.textContent = 'NARC: 0';

            narcBanner.appendChild(narcRect);
            narcBanner.appendChild(narcText);
            if (critGroup.parentNode) {
                critGroup.parentNode.insertBefore(narcBanner, critGroup.nextSibling);
            } else {
                critGroup.insertBefore(narcBanner, textEl);
            }
        });

    }
}
