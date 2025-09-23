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

import { heatLevels } from "../components/svg-viewer/common";
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
        "flight_stabilizer_hit"
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
        this.addCrewSkillsButtons(svg);
        this.addCrewNamesButtons(svg);
        this.addCrewDamageClasses(svg);
        this.addInventoryLines(svg);
        this.adjustArmorPips(unit, svg);
        this.addHitMod(svg);
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
            {textElement:'gunnerySkill0', crewId: 0, skill: 'gunnery'},
            {textElement:'pilotingSkill0', crewId: 0, skill: 'piloting'},
            {textElement:'asfGunnerySkill', crewId: 0, skill: 'gunnery', asf: true},
            {textElement:'asfPilotingSkill', crewId: 0, skill: 'piloting', asf: true},
            {textElement:'gunnerySkill1', crewId: 1, skill: 'gunnery'},
            {textElement:'pilotingSkill1', crewId: 1, skill: 'piloting'},
            {textElement:'gunnerySkill2', crewId: 2, skill: 'gunnery'},
            {textElement:'pilotingSkill2', crewId: 2, skill: 'piloting'},
            {textElement:'gunnerySkill3', crewId: 3, skill: 'gunnery'},
            {textElement:'pilotingSkill3', crewId: 3, skill: 'piloting'},
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
    private static addCrewDamageClasses(svg: SVGSVGElement): void {
        // First number: crew index (0-4)
        for (let crewId = 0; crewId <= 4; crewId++) {
            // Second number: hit index (1-10)
            for (let hit = 1; hit <= 10; hit++) {
                const elementId = `crew_damage_${crewId}_${hit}`;
                const textElement = svg.getElementById(elementId);
                if (textElement) {
                    this.addCrewHitRect(svg, textElement, crewId, hit);
                }
            }
        }
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
}