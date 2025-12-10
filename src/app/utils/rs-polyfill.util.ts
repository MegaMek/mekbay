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

import { heatLevels, REMOTE_HOST } from "../models/common.model";
import { Unit } from "../models/units.model";

/*
 * Author: Drake
 */
export class RsPolyfillUtil {

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
    public static addMissingClasses(unit: Unit, svg: SVGSVGElement): void {
        if (unit.type !== 'Mek') {
            this.addCriticalLocs(svg);
        }
        this.addHeatLevels(svg);
        this.addApplyHeatButton(svg);
        this.addCrewSkillsButtons(svg);
        this.addCrewNamesButtons(svg);
        this.addCrewDamageClasses(unit, svg);
        this.addInventoryLines(svg);
        this.adjustArmorPips(unit, svg);
        this.addHitMod(svg);
        this.injectFluffImage(unit, svg);
        this.addTurnStateClasses(unit, svg);
        this.addCritSlotClasses(svg);
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

    private static addCrewSkillsButtons(svg: SVGSVGElement): void {
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
            textElement.setAttribute('text-anchor', 'middle');
            textElement.setAttribute('dominant-baseline', 'middle');
            const prevStyle = textElement.getAttribute('style') || '';
            textElement.classList.add('skillValue');
            textElement.setAttribute('style', prevStyle.replace(/font-size\s*:\s*[^;]+;?/g, 'font-size:8px;font-weight:bold;'));
            textElement.setAttribute('y', textY.toString());

            const rectWidth = 12;
            const rectHeight = 12;

            const rectX = (textX - rectWidth / 2);
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

    private static addCrewNamesButtons(svg: SVGSVGElement): void {
        if (svg.querySelector('.crewNameButton')) return; // Avoid duplicates
        const nameTargets = [
            { blankPath: 'blankCrewName0', textElement: 'pilotName0', crewId: 0 },
            { blankPath: 'blankCrewName1', textElement: 'pilotName1', crewId: 1 },
            { blankPath: 'blankCrewName2', textElement: 'pilotName2', crewId: 2 },
            { blankPath: 'blankCrewName3', textElement: 'pilotName3', crewId: 3 },
            { blankPath: 'blankFluffName', textElement: 'fluffName', crewId: 0 }
        ];
        nameTargets.forEach((target, index) => {
            const blankNamePath = svg.querySelector(`#${target.blankPath}`);
            const nameText = svg.querySelector(`#${target.textElement}`);
            if (!blankNamePath || !nameText) return;
            const blankPathVisibility = (blankNamePath as SVGElement).getAttribute('visibility');
            const pilotTextVisibility = (nameText as SVGElement).getAttribute('visibility');
            if (blankPathVisibility === 'hidden' && pilotTextVisibility === 'hidden') return;
            const height = 10;
            const nameX: number = parseFloat((nameText as SVGTextElement).getAttribute('x') || '0');
            const nameY: number = parseFloat((nameText as SVGTextElement).getAttribute('y') || '0') + 2;
            const pathBBox = (blankNamePath as SVGPathElement).getBBox();
            let width = pathBBox.width;
            if (width <= 0) {
                width = 100; // Fallback
            }
            const clickArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            clickArea.classList.add('crewNameButton');
            clickArea.setAttribute('id', `crewNameButton${target.crewId}`);
            clickArea.setAttribute('x', nameX.toString());
            clickArea.setAttribute('y', (nameY - height).toString());
            clickArea.setAttribute('width', width.toString());
            clickArea.setAttribute('height', height.toString());
            clickArea.setAttribute('fill', 'transparent');
            clickArea.setAttribute('crewId', target.crewId.toString());
            clickArea.setAttribute('textElement', target.textElement);
            clickArea.setAttribute('blankElement', target.blankPath);
            blankNamePath.parentNode?.insertBefore(clickArea, blankNamePath.nextSibling);
        });
    }

    /**
     * Adds crew damage hit boxes to the svg.
     * Creates transparent rectangles above crew damage text elements.
     */
    private static addCrewDamageClasses(unit: Unit, svg: SVGSVGElement): void {
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
            if (tracksDamage) {
                const crewDamageContainer = svg.getElementById(`crewDamage${crewId}`) as SVGGraphicsElement;
                if (crewDamageContainer) {
                    this.addUnconsciousCheckbox(svg, crewDamageContainer, crewId);
                    // const frameElement = crewDamageContainer.closest('.frame') as SVGGraphicsElement | null;
                    // if (frameElement) {
                    //     this.addUnconsciousIndicator(svg, frameElement, crewId);
                    // }
                }
            }
        }
    }

    private static addUnconsciousIndicator(svg: SVGSVGElement, frameElement: SVGGraphicsElement, crewId: number): void {
        // Check if indicator already exists to avoid duplicates
        const existingIndicator = svg.getElementById(`unconscious_indicator_${crewId}`);
        if (existingIndicator) return;

        // Get frame bounding box
        const bbox = frameElement.getBBox();

        // Position at top-right corner
        const rectHeight = 12;
        const rectWidth = bbox.width;
        const rectX = bbox.x + bbox.width - rectWidth;
        const rectY = - rectHeight;
        const fontSize = 12;

        // Create group for indicator
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `unconscious_indicator_${crewId}`);
        group.setAttribute('class', 'unconscious-indicator noprint');
        group.setAttribute('crewId', crewId.toString());
        // group.setAttribute('display', 'none'); // Hidden by default

        const clipPathId = `unconscious_clip_${crewId}`;
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', clipPathId);

        const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        clipRect.setAttribute('id', `unconscious_clip_rect_${crewId}`);
        clipRect.setAttribute('x', (rectX + rectWidth).toString());
        clipRect.setAttribute('x', (0).toString());
        clipRect.setAttribute('y', rectY.toString());
        clipRect.setAttribute('width', (rectX + rectWidth).toString());
        clipRect.setAttribute('height', rectHeight.toString());
        clipRect.style.transition = 'width 0.4s ease-out, x 0.4s ease-out';

        clipPath.appendChild(clipRect);
        let defs = svg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svg.insertBefore(defs, svg.firstChild);
        }
        defs.appendChild(clipPath);

        // Create rectangle background
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', rectX.toString());
        rect.setAttribute('y', rectY.toString());
        rect.setAttribute('width', rectWidth.toString());
        rect.setAttribute('height', rectHeight.toString());
        rect.setAttribute('fill', '#ff0000EE');
        rect.setAttribute('fill', '#ff7300ee');
        rect.setAttribute('clip-path', `url(#${clipPathId})`);

        // Create text
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', (rectX + rectWidth - 2).toString());
        text.setAttribute('y', (rectY + rectHeight / 2 + 1).toString());
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-family', 'Arial, sans-serif');
        text.setAttribute('font-size', fontSize.toString());
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('fill', '#fff');
        text.setAttribute('clip-path', `url(#${clipPathId})`);
        text.textContent = 'UNCONSCIOUS';

        // Assemble the group
        group.appendChild(rect);
        group.appendChild(text);

        frameElement.appendChild(group);
    }

    private static addUnconsciousCheckbox(svg: SVGSVGElement, container: SVGGraphicsElement, crewId: number): void {
        // Check if checkbox already exists to avoid duplicates
        const existingCheckbox = svg.getElementById(`crew_status_checkbox_${crewId}`);
        if (existingCheckbox) return;

        // Find the "Consciousness #" text element within the container
        const textElements = Array.from(container.querySelectorAll('text'));
        const consciousnessTextEl = textElements.find(el => el.textContent?.trim().startsWith('Consciousness #'));
        if (!consciousnessTextEl) return;

        consciousnessTextEl.classList.add('checkbox-label');

        // Get text element's bounding box for positioning
        const textBBox = (consciousnessTextEl as SVGGraphicsElement).getBBox();

        // Checkbox dimensions
        const checkboxSize = 5;
        const margin = 2; // Space between checkbox and text

        // Position checkbox to the left of the text
        const checkboxX = textBBox.x - checkboxSize - margin;
        const checkboxY = textBBox.y + (textBBox.height - checkboxSize) / 2; // Vertically center with text

        // Create group for checkbox and label
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `crew_status_checkbox_${crewId}`);
        group.setAttribute('class', 'crew-status-checkbox noprint');
        group.setAttribute('crewId', crewId.toString());
        group.setAttribute('state', 'unconscious');

        // Create checkbox rectangle (border)
        const checkboxRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        checkboxRect.setAttribute('x', checkboxX.toString());
        checkboxRect.setAttribute('y', checkboxY.toString());
        checkboxRect.setAttribute('width', checkboxSize.toString());
        checkboxRect.setAttribute('height', checkboxSize.toString());
        checkboxRect.setAttribute('fill', 'transparent');
        checkboxRect.setAttribute('stroke', '#000');
        checkboxRect.setAttribute('stroke-width', '1');
        checkboxRect.setAttribute('class', 'checkbox-rect');

        // Create clickable area covering both checkbox and text
        const clickAreaX = checkboxX;
        const clickAreaY = Math.min(checkboxY, textBBox.y);
        const clickAreaWidth = textBBox.x + textBBox.width - clickAreaX;
        const clickAreaHeight = Math.max(checkboxSize, textBBox.height);

        const clickArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        clickArea.setAttribute('x', clickAreaX.toString());
        clickArea.setAttribute('y', clickAreaY.toString());
        clickArea.setAttribute('width', clickAreaWidth.toString());
        clickArea.setAttribute('height', clickAreaHeight.toString());
        clickArea.setAttribute('fill', 'transparent');
        clickArea.setAttribute('crewId', crewId.toString());
        clickArea.setAttribute('class', 'crew-status-area');
        clickArea.setAttribute('cursor', 'pointer');

        // Assemble the group
        group.appendChild(checkboxRect);
        group.appendChild(clickArea);

        // Insert the group into the same parent as the text element
        consciousnessTextEl.parentNode?.appendChild(group);
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
            if (group.querySelector('.hitMod-rect')) return;

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
        });
    }


    public static addInventoryLines(svg: SVGSVGElement): void {

        const inventoryEntries = svg.querySelectorAll('.inventoryEntry');
        if (!inventoryEntries.length) return;

        let rectX = 2;
        let rectWidth = 0;
        const unitDataPanel = svg.querySelector('#unitDataPanel') as SVGSVGElement;
        if (unitDataPanel) {
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
            let rectHeight = bbox.height;
            let rectY = bbox.y;

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
            rect.setAttribute('width', rectWidth.toString());
            rect.setAttribute('height', rectHeight.toString());
            rect.setAttribute('inventory-id', id);
            rect.setAttribute('class', 'inventoryEntryButton interactive noprint');
            nameEl.parentElement?.insertBefore(rect, nameEl.parentElement.firstChild);

            const alternativeModes = group.querySelectorAll('.alternativeMode');
            alternativeModes.forEach(mode => {
                const modeName = mode.getAttribute('mode');
                if (!modeName) return;
                const modeBBox = (mode as SVGGraphicsElement).getBBox();
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', rectX.toString());
                rect.setAttribute('y', modeBBox.y.toString());
                rect.setAttribute('width', rectWidth.toString());
                rect.setAttribute('height', rectHeight.toString());
                rect.setAttribute('inventory-id', id);
                rect.setAttribute('mode', modeName);
                rect.setAttribute('class', 'inventoryEntryButton alternativeModeButton interactive noprint');
                mode.insertBefore(rect, mode.firstElementChild);
            });
        });
    }

    private static adjustArmorPips(unit: Unit, svg: SVGSVGElement): void {
        if (unit.armorType === 'Hardened') {
            const armorPips = svg.querySelectorAll('.pip.armor');
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
            const structurePips = svg.querySelectorAll('.pip.structure');
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

    private static addHeatLevels(svg: SVGSVGElement): void {
        const heatScale = svg.querySelector('#heatScale');
        if (!heatScale) return;

        heatScale.querySelectorAll('.heat').forEach(heatRect => {
            const heatVal = Number((heatRect as SVGElement).getAttribute('heat'));
            const heatLevel = heatLevels.find(cfg => heatVal >= cfg.min && heatVal <= cfg.max);
            if (heatLevel) heatRect.classList.add(heatLevel.class);
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
            rect.setAttribute('class', 'overflowButton noprint');
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
        buttonGroup.setAttribute('class', 'noprint');
        const textEl = buttonGroup.querySelector('text');
        if (textEl) {
            textEl.textContent = 'APPLY HEAT';
        }
        heatDataPanel.appendChild(buttonGroup);
        // We find the 2nd path and we add a class to it so we can style the border of the frame
        const paths = heatDataPanel.querySelectorAll('path');
        if (paths.length >= 2) {
            paths[1].classList.add('applyHeatButtonFrame');
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
            rect.setAttribute('class', 'changeActiveHeatsinksCountButton noprint');
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('pointer-events', 'all');
            pipsGroup.insertBefore(rect, pipsGroup.firstChild);
        }
    }

    private static injectFluffImage(unit: Unit, svg: SVGSVGElement) {
        const fluffImage = unit?.fluff?.img;
        if (!fluffImage) return; // no fluff image to inject
        if (fluffImage.endsWith('hud.png')) return; // default fluff image, we skip
        const fluffImageUrl = `${REMOTE_HOST}/images/fluff/${fluffImage}`;
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
        const rootX = minX;
        const rootY = minY;
        const rootW = Math.max(0, localWidth);
        const rootH = Math.max(0, localHeight);

        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('id', 'fluff-image-fo');
        fo.setAttribute('x', rootX.toString());
        fo.setAttribute('y', rootY.toString());
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
        svg.appendChild(fo); // we append directly to root svg to avoid coordinate issues
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

            // Try to get bounding box for vertical positioning/height
            let bbox: DOMRect | null = null;
            try {
                bbox = (moveEl as SVGGraphicsElement).getBBox();
            } catch {
                bbox = null;
            }
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
            rect.setAttribute('class', moveEl.id + '-rect noprint');
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
            text.setAttribute('class', moveEl.id + '-rect noprint');
            rect.setAttribute('display', 'none');
            if (moveEl == mpWalkEl) text.textContent = '+1';
            else if (moveEl == mpRunEl) text.textContent = '+2';
            else if (moveEl == mpJumpEl) text.textContent = '+3';

            moveEl.parentElement?.appendChild(rect);
            moveEl.parentElement?.appendChild(text);
        }
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
}