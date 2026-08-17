// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getUnitServerHost, heatLevels } from "../models/common.model";
import type { CBTForceUnit } from "../models/cbt-force-unit.model";
import { getUnitConditionDefinition, NARC_CONDITION_COLOR, UNIT_CONDITION_DEFINITIONS } from "../models/rules/unit-type-rules";
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
    private static readonly WARRIOR_DATA_SINGLE = 'warriorDataSingle';
    private static readonly WARRIOR_DATA_DUAL = 'warriorDataDual';
    private static readonly WARRIOR_DATA_TRIPLE = 'warriorDataTriple';
    
    
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
        this.addNightModeImageFilter(svg);
        if (unit.type !== 'Mek') {
            this.addCriticalLocs(svg);
        }
        this.addConditionsButtons(forceUnit, svg);
        this.addLifeSupportPilotDamageWarning(unit, svg);
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

    /** Adds a native SVG inversion filter for iOS WebKit, which ignores CSS invert() on SVG images. */
    private static addNightModeImageFilter(svg: SVGSVGElement): void {
        const filterId = 'mekbay-night-image-invert';
        if (svg.getElementById(filterId)) return;

        let defs = Array.from(svg.children)
            .find(element => element.localName === 'defs') as SVGDefsElement | undefined;
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svg.insertBefore(defs, svg.firstChild);
        }

        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', filterId);
        filter.setAttribute('color-interpolation-filters', 'sRGB');

        const componentTransfer = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
        for (const channel of ['R', 'G', 'B']) {
            const fn = document.createElementNS('http://www.w3.org/2000/svg', `feFunc${channel}`);
            fn.setAttribute('type', 'table');
            fn.setAttribute('tableValues', '1 0');
            componentTransfer.appendChild(fn);
        }
        filter.appendChild(componentTransfer);
        defs.appendChild(filter);
    }

    public static syncConditionButtons(forceUnit: CBTForceUnit, svg: SVGSVGElement): void {
        this.addConditionsButtons(forceUnit, svg);
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
        const buttonWrapper = svg.getElementById('unit_condition_wrapper') as SVGElement | null;
        const hasBannerWrapper = !!svg.getElementById('condition_banner_wrapper');
        const conditionControls = unit.rules.conditionControls;
        if (conditionControls.length === 0) return;

        const buttons = this.conditionButtons(conditionControls);
        if (buttonWrapper) {
            this.syncConditionButtonWrapper(buttonWrapper, buttons);
        } else {
            this.createConditionButtonWrapper(buttons, unit, svg);
        }

        if (hasBannerWrapper) return;

        const immobileCondition = getUnitConditionDefinition('immobile');
        const abandonedCondition = getUnitConditionDefinition('abandoned');
        const crippledCondition = getUnitConditionDefinition('crippled');
        const disconnectedCondition = getUnitConditionDefinition('disconnected');
        const spottingCondition = getUnitConditionDefinition('spotting');
        const conditions = Array.from(new Map([
            ...conditionControls,
            abandonedCondition,
            immobileCondition,
            crippledCondition,
            disconnectedCondition,
            spottingCondition,
        ].map(condition => [condition.key, condition])).values());

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
            const bannerFontSize = (definition?.important
                ? this.IMPORTANT_UNIT_CONDITION_BANNER_FONT_SIZE
                : this.UNIT_CONDITION_BANNER_FONT_SIZE) * (definition?.bannerFontScaling || 1);
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
            text.setAttribute('fill', definition?.bannerTextColor ?? '#fff');
            text.textContent = condition.bannerLabel ?? condition.label;

            bannerGroup.appendChild(rect);
            bannerGroup.appendChild(text);
            bannerWrapper.appendChild(bannerGroup);
        });

        svg.appendChild(bannerWrapper);
    }

    private static conditionButtons(conditionControls: readonly { key: string; label: string; color: string; placement?: string }[]): { key: string; label: string; color: string; width: number }[] {
        return [
            ...conditionControls
                .filter(condition => condition.placement === 'button')
                .map(condition => ({ ...condition, width: this.conditionButtonWidth(condition.label) })),
            ...(conditionControls.some(condition => condition.placement === 'menu') ? [{ key: 'menu', label: '...', color: '#666', width: 14 }] : []),
        ];
    }

    private static createConditionButtonWrapper(buttons: readonly { key: string; label: string; color: string; width: number }[], unit: CBTForceUnit, svg: SVGSVGElement): void {
        const unitDataPanelEl = svg.getElementById('unitDataPanel') as SVGGraphicsElement | null;
        if (!unitDataPanelEl) return;

        const frameEl = (unitDataPanelEl.querySelector('.frame')
            ?? unitDataPanelEl.querySelectorAll('path')[1]
            ?? unitDataPanelEl) as SVGGraphicsElement;
        const coords = frameEl.getBBox();
        const buttonHeight = 12;
        const buttonGap = 2;
        const totalButtonWidth = buttons.reduce((total, button) => total + button.width, 0) + buttonGap * (buttons.length - 1);
        // This is needed to fix the misaligned buttons on Vehicles
        const buttonY = coords.y - (unit.getUnit().type === 'Mek' ? 0.5 : -2);
        let buttonX = coords.x + coords.width - totalButtonWidth - 16;
        const buttonWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        buttonWrapper.setAttribute('id', `unit_condition_wrapper`);
        buttonWrapper.setAttribute('class', 'screen-only unitConditionWrapper');

        buttons.forEach(condition => {
            this.appendConditionButton(buttonWrapper, condition, buttonX, buttonY, buttonHeight);
            buttonX += condition.width + buttonGap;
        });

        unitDataPanelEl.appendChild(buttonWrapper);
    }

    private static addLifeSupportPilotDamageWarning(unit: Unit, svg: SVGSVGElement): void {
        if (unit.type !== 'Mek' || svg.getElementById('lifeSupportPilotDamageWarning')) return;

        const warriorData = [
            this.WARRIOR_DATA_SINGLE,
            this.WARRIOR_DATA_DUAL,
            this.WARRIOR_DATA_TRIPLE,
        ].map(id => svg.getElementById(id) as SVGGraphicsElement | null).find(element => !!element);
        if (!warriorData) return;

        const coords = warriorData.getBBox();
        const warningWidth = 42;
        const warningHeight = 15;
        const warningX = coords.x + coords.width - warningWidth - 6;
        const warningY = coords.y - 0.5;
        const warning = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        warning.setAttribute('id', 'lifeSupportPilotDamageWarning');
        warning.setAttribute('class', 'screen-only no-autocolor');
        warning.setAttribute('pointer-events', 'none');
        warning.setAttribute('display', 'none');
        warning.setAttribute('transform', `translate(${warningX} ${warningY})`);
        warning.setAttribute('data-width', warningWidth.toString());
        warning.setAttribute('data-height', warningHeight.toString());

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.append(
            this.createLifeSupportHeatDamageIcon(),
            this.createLifeSupportOxygenDamageIcon(),
        );
        warning.appendChild(defs);
        warriorData.appendChild(warning);
    }

    private static createLifeSupportHeatDamageIcon(): SVGSymbolElement {
        const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
        symbol.setAttribute('id', 'lifeSupportHeatDamageIcon');
        symbol.setAttribute('viewBox', '-48 -48 608 608');

        const flame = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        flame.setAttribute('class', 'lifeSupportHeatFlame');
        flame.setAttribute('d', 'M392.172,147.731c13.598,34.6-10.914,87.102-45.319,68.762c-25.344-13.528-18.732-38.095,0.456-72.5c27.26-48.843-20.194-82.996-20.194-82.996s-9.013,62.081-60.738,51.402C222.128,103.268,220.306,27.526,239.464,0c-69.092,8.212-79.267,107.563-46.951,144.15c38.864,43.999,31.594,102.649-18.451,100.592c-36.398-1.492-53.231-46.943-33.965-91.712c-65.763,27.213-92.19,109.904-87.338,161.722c3.282,34.805,10.411,76.778,39.633,112.682c51.71,72.099,146.821,104.148,234.237,72.208c84.402-30.84,135.859-111.889,133.065-197.044C459.254,264.197,450.617,186.932,392.172,147.731z');
        flame.setAttribute('fill', '#f4511e');
        flame.setAttribute('stroke', '#000');
        flame.setAttribute('stroke-width', '96');
        flame.setAttribute('stroke-linejoin', 'round');
        flame.setAttribute('paint-order', 'stroke fill');

        const letterPaths = [
            'M199.123,395.55c-0.141,0.895-0.722,1.554-1.602,1.672l-17.634,2.34c-0.88,0.11-1.461-0.392-1.319-1.288l6.862-39.53c0.142-0.598-0.157-0.856-0.738-0.778l-31.327,4.153c-0.58,0.078-0.879,0.408-1.02,1.013l-6.847,39.524c-0.157,0.903-0.596,1.539-1.46,1.656l-17.634,2.34c-0.88,0.118-1.46-0.392-1.319-1.287l17.053-98.448c0.142-0.888,0.738-1.555,1.602-1.672l17.634-2.34c0.88-0.117,1.32,0.416,1.178,1.303l-6.564,38.472c-0.142,0.613,0.141,0.864,0.722,0.786l31.185-4.138c0.597-0.079,0.88-0.408,1.021-1.013l6.705-38.487c0.157-0.895,0.738-1.562,1.601-1.672l17.634-2.34c0.879-0.118,1.46,0.392,1.319,1.288L199.123,395.55z',
            'M293.606,363.344c-7.883,16.936-20.854,25.501-38.487,27.841c-18.654,2.473-31.327-6.195-31.327-26.161c0-8.888,4.804-39.398,9.908-50.57c7.867-16.928,20.994-25.525,38.472-27.841c18.655-2.473,31.342,6.194,31.342,26.16C303.515,321.668,298.71,352.178,293.606,363.344z',
            'M389.236,289.455c-0.142,0.895-0.722,1.554-1.602,1.672l-24.339,3.227c-0.581,0.078-0.88,0.408-1.021,1.005l-13.85,80.39c-0.141,0.903-0.722,1.554-1.602,1.672l-17.634,2.339c-0.723,0.094-1.303-0.408-1.162-1.303l13.85-80.39c0.142-0.604-0.157-0.856-0.738-0.777l-24.182,3.211c-0.88,0.11-1.461-0.392-1.32-1.287l2.764-15.672c0.157-0.887,0.738-1.554,1.617-1.672l70.678-9.374c0.879-0.117,1.46,0.4,1.303,1.288L389.236,289.455z',
        ].map(data => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'lifeSupportHeatLetter');
            path.setAttribute('d', data);
            path.setAttribute('fill', '#fff');
            return path;
        });

        const counter = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        counter.setAttribute('class', 'lifeSupportHeatCounter');
        counter.setAttribute('d', 'M269.408,305.205c-8.008,1.06-13.692,6.328-17.053,13.92c-3.501,7.31-7.867,34.114-7.867,41.259c0,8.597,4.946,13.339,13.41,12.216c8.008-1.06,13.692-6.336,17.194-13.936c3.345-7.302,7.726-34.114,7.726-41.251C282.819,308.808,278.014,304.058,269.408,305.205z');
        counter.setAttribute('fill', '#f4511e');

        symbol.append(flame, ...letterPaths, counter);
        return symbol;
    }

    private static createLifeSupportOxygenDamageIcon(): SVGSymbolElement {
        const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
        symbol.setAttribute('id', 'lifeSupportOxygenDamageIcon');
        symbol.setAttribute('viewBox', '-48 -48 608 608');

        const shapes = [
            'M80 456V226c0-46 32-76 70-84v-28h30v28c38 8 70 38 70 84v230q0 18-18 18H98q-18 0-18-18z',
            'M140 142V82h-28V42h96v40h-28v23h88v40h-88v-3z',
            'M112 78a50 50 0 1 0 0 100a50 50 0 1 0 0-100zm0 34a16 16 0 1 1 0 32a16 16 0 1 1 0-32z',
            'M292 224q0-58 58-58h18q58 0 58 58v106q0 58-58 58h-18q-58 0-58-58zm50 2v102q0 16 16 16h2q16 0 16-16V226q0-16-16-16h-2q-16 0-16 16z',
            'M412 360q0-46 46-46h12q40 0 40 40q0 24-22 40l-37 27h59v47H404v-48l57-45q9-7 9-17q0-8-10-8h-8q-8 0-8 10z',
        ].map((data, index) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', index < 3 ? 'lifeSupportOxygenTank' : 'lifeSupportOxygenLabel');
            path.setAttribute('d', data);
            path.setAttribute('fill', index < 3 ? '#2196f3' : '#fff');
            path.setAttribute('stroke', '#000');
            path.setAttribute('stroke-width', '96');
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('paint-order', 'stroke fill');
            if (index === 2 || index === 3) path.setAttribute('fill-rule', 'evenodd');
            if (index === 3) path.setAttribute('transform', 'translate(-44 0)');
            return path;
        });

        symbol.append(...shapes);
        return symbol;
    }

    private static syncConditionButtonWrapper(buttonWrapper: SVGElement, buttons: readonly { key: string; label: string; color: string; width: number }[]): void {
        const existingButtons = Array.from(buttonWrapper.querySelectorAll<SVGElement>('.unitConditionButton[condition]'));
        const buttonByCondition = new Map(existingButtons
            .map(button => [button.getAttribute('condition'), button] as const)
            .filter((entry): entry is [string, SVGElement] => !!entry[0]));

        const buttonGap = 2;
        const fallbackHeight = 12;
        const rects = existingButtons
            .map(button => button.querySelector<SVGElement>('rect'))
            .filter(rect => !!rect);
        const anchorRect = buttonByCondition.get('menu')?.querySelector<SVGElement>('rect') ?? rects.reduce<SVGElement | null>((rightmost, rect) => {
            if (!rightmost) return rect;
            const rectRight = Number(rect.getAttribute('x') ?? 0) + Number(rect.getAttribute('width') ?? 0);
            const rightmostRight = Number(rightmost.getAttribute('x') ?? 0) + Number(rightmost.getAttribute('width') ?? 0);
            return rectRight > rightmostRight ? rect : rightmost;
        }, null);
        if (!anchorRect) return;

        const buttonY = Number(anchorRect.getAttribute('y') ?? 0);
        const buttonHeight = Number(anchorRect.getAttribute('height') ?? fallbackHeight);
        const layoutButtons = buttons.map(button => {
            const rect = buttonByCondition.get(button.key)?.querySelector<SVGElement>('rect');
            return {
                ...button,
                width: Number(rect?.getAttribute('width') ?? button.width),
            };
        });
        const rightEdge = Number(anchorRect.getAttribute('x') ?? 0) + Number(anchorRect.getAttribute('width') ?? 0);
        const totalButtonWidth = layoutButtons.reduce((total, button) => total + button.width, 0) + buttonGap * (layoutButtons.length - 1);
        let buttonX = rightEdge - totalButtonWidth;

        layoutButtons.forEach(condition => {
            const existingButton = buttonByCondition.get(condition.key);
            const button = existingButton ?? this.createConditionButton(condition);
            this.positionConditionButton(button, condition, buttonX, buttonY, buttonHeight);
            if (!existingButton) {
                buttonWrapper.appendChild(button);
            }
            buttonX += condition.width + buttonGap;
        });
    }

    private static createConditionButton(condition: { key: string; label: string; color: string; width: number }): SVGElement {
        const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        buttonGroup.setAttribute('id', `unit_condition_button_${condition.key}`);
        buttonGroup.setAttribute('class', 'unitConditionButton');
        buttonGroup.setAttribute('condition', condition.key);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('fill', '#fff');
        rect.setAttribute('stroke', '#000');
        rect.setAttribute('stroke-width', '1.2');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'conditionText no-autocolor');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-family', 'Roboto, sans-serif');
        text.setAttribute('font-size', '6.5');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('fill', '#000');

        buttonGroup.appendChild(rect);
        buttonGroup.appendChild(text);
        return buttonGroup;
    }

    private static positionConditionButton(buttonGroup: SVGElement, condition: { key: string; label: string; color: string; width: number }, buttonX: number, buttonY: number, buttonHeight: number): void {
        buttonGroup.setAttribute('active-color', condition.color);
        buttonGroup.style.setProperty('--unit-condition-active-color', condition.color);

        const rect = buttonGroup.querySelector<SVGElement>('rect') ?? document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        if (!rect.parentNode) buttonGroup.appendChild(rect);
        rect.setAttribute('x', buttonX.toString());
        rect.setAttribute('y', buttonY.toString());
        rect.setAttribute('width', condition.width.toString());
        rect.setAttribute('height', buttonHeight.toString());
        rect.setAttribute('fill', rect.getAttribute('fill') ?? '#fff');
        rect.setAttribute('stroke', rect.getAttribute('stroke') ?? '#000');
        rect.setAttribute('stroke-width', rect.getAttribute('stroke-width') ?? '1.2');

        const text = buttonGroup.querySelector<SVGElement>('text') ?? document.createElementNS('http://www.w3.org/2000/svg', 'text');
        if (!text.parentNode) buttonGroup.appendChild(text);
        text.setAttribute('x', (buttonX + condition.width / 2).toString());
        text.setAttribute('y', (buttonY + buttonHeight / 2 + 0.5).toString());
        text.setAttribute('class', text.getAttribute('class') ?? 'conditionText no-autocolor');
        text.setAttribute('text-anchor', text.getAttribute('text-anchor') ?? 'middle');
        text.setAttribute('dominant-baseline', text.getAttribute('dominant-baseline') ?? 'middle');
        text.setAttribute('font-family', text.getAttribute('font-family') ?? 'Roboto, sans-serif');
        text.setAttribute('font-size', text.getAttribute('font-size') ?? '6.5');
        text.setAttribute('font-weight', text.getAttribute('font-weight') ?? 'bold');
        text.setAttribute('fill', text.getAttribute('fill') ?? '#000');
        text.textContent = condition.label;
    }

    private static appendConditionButton(buttonWrapper: SVGElement, condition: { key: string; label: string; color: string; width: number }, buttonX: number, buttonY: number, buttonHeight: number): void {
        const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        buttonGroup.setAttribute('id', `unit_condition_button_${condition.key}`);
        buttonGroup.setAttribute('class', 'unitConditionButton');
        buttonGroup.setAttribute('condition', condition.key);
        buttonGroup.setAttribute('active-color', condition.color);
        buttonGroup.style.setProperty('--unit-condition-active-color', condition.color);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', buttonX.toString());
        rect.setAttribute('y', buttonY.toString());
        rect.setAttribute('width', condition.width.toString());
        rect.setAttribute('height', buttonHeight.toString());
        rect.setAttribute('fill', '#fff');
        rect.setAttribute('stroke', '#000');
        rect.setAttribute('stroke-width', '1.2');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', (buttonX + condition.width / 2).toString());
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
        counter.setAttribute('dy', '0.35em');
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
            if (id) group.classList.add(`eq-${id}`);

            // Avoid duplicate insertion
            const existingHitModRect = group.querySelector<SVGElement>(':scope > .hitMod-rect');
            const existingHitModText = group.querySelector<SVGElement>(':scope > .hitMod-text');
            if (existingHitModRect && existingHitModText) {
                existingHitModRect.setAttribute('display', 'none');
                existingHitModText.setAttribute('display', 'none');
                existingHitModText.textContent = '';
                this.addTargetTnOverlay(group, existingHitModRect, existingHitModText);
                return;
            }

            // Prefer the name wrapper for alignment. Some Aero sheets do not
            // provide one, so fall back to the inventory row itself.
            const nameEl = group.querySelector('.name');
            const alignmentEl = (nameEl ?? group) as SVGGraphicsElement;

            // Get the bounding box from the best available alignment element.
            let bbox: DOMRect | null = null;
            try {
                bbox = alignmentEl.getBBox();
            } catch {
                bbox = null;
            }
            if (!bbox) return;

            // Try to get the font size from the .name element
            let fontSize = 9; // default
            const labelText = nameEl?.querySelector('text') ?? group.querySelector('text');
            const fs = labelText?.getAttribute('font-size');
            if (fs) {
                const parsed = parseFloat(fs);
                if (!isNaN(parsed)) fontSize = parsed * 1.1;
            }

            if (labelText) {
                try {
                    const labelBBox = (labelText as SVGGraphicsElement).getBBox();
                    if (labelBBox.height > 0) bbox.height = labelBBox.height;
                } catch {
                    // Keep the row/name bounding box when text cannot be measured.
                }
            }

            const rectWidth = 10;
            let rectHeight = bbox.height || fontSize;
            const rectX = nameEl ? 0 - (rectWidth / 2) : bbox.x - rectWidth;
            let rectY = bbox.y;

            if (fontSize > 6) {
                rectHeight += 1;
                rectY -= 0.5;
            }

            const parent = nameEl?.parentElement ?? group;
            const rect = existingHitModRect
                ?? document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', rectX.toString());
            rect.setAttribute('y', rectY.toString());
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('fill', '#000');
            rect.setAttribute('class', 'hitMod-rect');
            rect.setAttribute('display', 'none');

            const text = existingHitModText
                ?? document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (rectX + rectWidth / 2).toString());
            text.setAttribute('y', (rectY + rectHeight / 2 + fontSize / 3).toString());
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-family', 'monospace');
            text.setAttribute('font-size', fontSize.toString());
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#fff');
            text.setAttribute('class', 'hitMod-text');
            text.setAttribute('display', 'none');

            text.textContent = '';
            if (!existingHitModRect) parent.appendChild(rect);
            if (!existingHitModText) parent.appendChild(text);
            this.addTargetTnOverlay(parent, rect, text);
        });
    }

    private static addTargetTnOverlay(parent: Element, hitModRect: SVGElement, hitModText: SVGElement): void {
        const existingRect = parent.querySelector<SVGRectElement>(':scope > .targetTn-rect');
        const existingText = parent.querySelector<SVGTextElement>(':scope > .targetTn-text');
        const targetTnRect = existingRect ?? hitModRect.cloneNode(false) as SVGRectElement;
        targetTnRect.setAttribute('class', 'targetTn-rect');
        targetTnRect.setAttribute('fill', '#fff');
        targetTnRect.setAttribute('stroke', '#000');
        targetTnRect.setAttribute('stroke-width', '0.8');
        targetTnRect.setAttribute('display', 'none');

        const targetTnText = existingText ?? hitModText.cloneNode(false) as SVGTextElement;
        targetTnText.setAttribute('class', 'targetTn-text');
        targetTnText.setAttribute('fill', '#000');
        targetTnText.setAttribute('display', 'none');
        targetTnText.textContent = '';

        if (!existingRect) parent.appendChild(targetTnRect);
        if (!existingText) parent.appendChild(targetTnText);
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

            let yPosition = bbox.y + bbox.height / 2;
            if (!nameEl.parentElement?.querySelector(':scope > .damaged-strike')) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', bbox.x.toString());
                line.setAttribute('y1', yPosition.toString());
                line.setAttribute('x2', (groupBBox.x + groupBBox.width).toString());
                line.setAttribute('y2', yPosition.toString());
                line.setAttribute('stroke', 'var(--damage-color)');
                line.setAttribute('stroke-width', '1');
                line.setAttribute('class', 'damaged-strike');
                nameEl.parentElement?.insertBefore(line, nameEl.parentElement.firstChild);
            }

            // Create rect
            if (!nameEl.parentElement?.querySelector(':scope > .inventoryEntryButton.mainButton')) {
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', rectX.toString());
                rect.setAttribute('y', rectY.toString());
                rect.setAttribute('width', rowRectWidth.toString());
                rect.setAttribute('height', rectHeight.toString());
                rect.setAttribute('inventory-id', id);
                rect.setAttribute('class', 'inventoryEntryButton mainButton interactive screen-only');
                nameEl.parentElement?.insertBefore(rect, nameEl.parentElement.firstChild);
            }
            this.addAimedShotWarningText(nameEl.parentElement, rectX + rectWidth, rectY, rectHeight);
            this.addRangeButtons(nameEl.parentElement, rangeButtonColumns, id, null, rectY, rectHeight);

            const alternativeModes = group.querySelectorAll('.alternativeMode');
            alternativeModes.forEach(mode => {
                const modeName = mode.getAttribute('mode');
                if (!modeName) return;
                const modeBBox = (mode as SVGGraphicsElement).getBBox();
                if (!mode.querySelector(':scope > .inventoryEntryButton.alternativeModeButton')) {
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', rectX.toString());
                    rect.setAttribute('y', modeBBox.y.toString());
                    rect.setAttribute('width', rowRectWidth.toString());
                    rect.setAttribute('height', rectHeight.toString());
                    rect.setAttribute('inventory-id', id);
                    rect.setAttribute('mode', modeName);
                    rect.setAttribute('class', 'inventoryEntryButton alternativeModeButton interactive screen-only');
                    mode.insertBefore(rect, mode.firstElementChild);
                }
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
        const groundRangeColumns: InventoryRangeButtonSpec[] = [
            { className: 'shrButton', labels: ['Shr', 'Sht'], field: 'range_short' },
            { className: 'medButton', labels: ['Med'], field: 'range_medium' },
            { className: 'lngButton', labels: ['Lng'], field: 'range_long' },
        ];
        return this.findRangeButtonColumns(svg, [
            ...groundRangeColumns,
            { className: 'extButton', labels: ['Ext', 'EXT'], field: 'range_extreme' },
        ]) || this.findRangeButtonColumns(svg, groundRangeColumns) || this.findRangeButtonColumns(svg, [
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
            if (parent.querySelector(`:scope > .inventoryEntryButton.${column.className}`)) continue;
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
        if (!heatDataPanel.querySelector('#applyHeatButton')) {
            const buttonGroup = firstGroup.cloneNode(true) as SVGGElement;
            buttonGroup.setAttribute('id', 'applyHeatButton');
            buttonGroup.setAttribute('class', 'screen-only no-autocolor');
            const textEl = buttonGroup.querySelector('text');
            if (textEl) {
                textEl.textContent = 'APPLY HEAT';
            }
            heatDataPanel.appendChild(buttonGroup);
        }
        // We find the 2nd path and we add a class to it so we can style the border of the frame
        const paths = heatDataPanel.querySelectorAll('path');
        if (paths.length >= 2) {
            paths[1].classList.add('applyHeatButtonFrame');
            const frameBBox = (paths[1] as SVGGraphicsElement).getBBox();
            if (!heatDataPanel.querySelector('#damagedEngineHeatText')) {
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
        }

        const pipsGroup = heatDataPanel.querySelector('g.hsPips');
        // We create a background rectangle to act as button hit area
        if (pipsGroup && !pipsGroup.querySelector(':scope > .changeActiveHeatsinksCountButton')) {
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
        const rootScreenCtm = svg.getScreenCTM();
        const screenToRoot = rootScreenCtm?.inverse() ?? null;
        referenceTables.forEach((rt: SVGGraphicsElement) => {
            const bbox = rt.getBBox();
            // getCTM() stops at the nearest SVG viewport. Record sheets can contain
            // nested SVGs (notably vehicle sheets), so convert through screen space
            // to preserve every ancestor transform before appending to the root SVG.
            const tableScreenCtm = rt.getScreenCTM();
            const ctm = rt.getCTM() ?? svg.getCTM();
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
                let p = pt;
                if (tableScreenCtm && screenToRoot) {
                    p = pt.matrixTransform(tableScreenCtm).matrixTransform(screenToRoot);
                } else if (ctm) {
                    p = pt.matrixTransform(ctm);
                }
                rtMinX = Math.min(rtMinX, p.x);
                rtMinY = Math.min(rtMinY, p.y);
                rtMaxX = Math.max(rtMaxX, p.x);
                rtMaxY = Math.max(rtMaxY, p.y);
            }

            minX = Math.min(minX, rtMinX);
            minY = Math.min(minY, rtMinY);
            maxX = Math.max(maxX, rtMaxX);
            maxY = Math.max(maxY, rtMaxY);
        });
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

        // Keep the foreignObject in root SVG coordinates. iOS WebKit can drop
        // transformed-ancestor positioning when foreignObject content uses the
        // filters and blend modes applied by night mode.
        const rootW = Math.max(0, maxX - minX);
        const rootH = Math.max(0, maxY - minY);

        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('id', 'fluff-image-fo');
        fo.setAttribute('x', minX.toString());
        fo.setAttribute('y', minY.toString());
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
        svg.appendChild(fo);
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
            parseFloat(xAttr) + (tightSpaceForText ? 4 : 14),
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
            if (critGroup.querySelector('.locationConditionControl')) return;
            const textEl = Array.from(critGroup.children).find(child => child.tagName.toLowerCase() === 'text') as SVGGraphicsElement | undefined;
            if (!textEl) return;
            textEl.classList.add('locationConditionText');
            textEl.setAttribute('loc', loc);
            const textCoords = textEl.getBBox();

            const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            control.setAttribute('class', 'locationConditionControl');
            control.setAttribute('loc', loc);
            control.setAttribute('pointer-events', 'all');

            const labelBaseline = Number.parseFloat(textEl.getAttribute('y') ?? '');
            const rectHeight = textCoords.height + 6;
            const rectBaseline = Number.isFinite(labelBaseline) ? labelBaseline : textCoords.y + textCoords.height;
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            hitArea.setAttribute('class', 'locationConditionHitArea');
            hitArea.setAttribute('x', (textCoords.x - 2).toString());
            hitArea.setAttribute('y', (rectBaseline - rectHeight).toString());
            hitArea.setAttribute('width', (Math.max(30, textCoords.width + 12)).toString());
            hitArea.setAttribute('height', rectHeight.toString());
            hitArea.setAttribute('fill', 'transparent');
            hitArea.setAttribute('pointer-events', 'all');

            critGroup.insertBefore(control, textEl);
            control.append(hitArea, textEl);

            const narcBanner = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            narcBanner.setAttribute('class', 'locationNarcBanner screen-only');
            narcBanner.setAttribute('loc', loc);
            narcBanner.setAttribute('display', 'none');

            const narcRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            narcRect.setAttribute('x', textCoords.x.toString());
            narcRect.setAttribute('y', (textCoords.y - 8).toString());
            narcRect.setAttribute('width', '40');
            narcRect.setAttribute('height', '8');
            narcRect.setAttribute('fill', '#fff');
            narcRect.setAttribute('stroke', NARC_CONDITION_COLOR);
            narcRect.setAttribute('stroke-width', '0.9');
            narcRect.setAttribute('class', 'no-autocolor');

            const narcText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            narcText.setAttribute('x', (textCoords.x + 21).toString());
            narcText.setAttribute('y', (textCoords.y - 2).toString());
            narcText.setAttribute('text-anchor', 'middle');
            narcText.setAttribute('font-family', 'Roboto, sans-serif');
            narcText.setAttribute('font-size', '6.5');
            narcText.setAttribute('font-weight', 'bold');
            narcText.setAttribute('fill', NARC_CONDITION_COLOR);
            narcText.setAttribute('class', 'no-autocolor');
            narcText.textContent = 'NARC: 0';

            narcBanner.appendChild(narcRect);
            narcBanner.appendChild(narcText);
            control.appendChild(narcBanner);
        });

    }
}
