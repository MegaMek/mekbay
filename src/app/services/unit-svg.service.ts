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

import { Injectable, effect, signal, inject, DestroyRef } from '@angular/core';
import { type CrewMember, type CrewMemberState, DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL, type SkillType } from '../models/crew-member.model';
import type { CriticalSlot, HeatProfile, MountedEquipment } from '../models/force-serialization';
import { SheetService } from './sheet.service';
import { UnitInitializerService } from './unit-initializer.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { LINKED_LOCATIONS } from "../models/rules/mek-rules";
import { LoggerService } from './logger.service';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { resolveHitModifier } from '../models/rules/hit-modifier.util';
import { formatGunneryDisplay, formatPilotingDisplay, UNIT_CONDITION_DEFINITIONS, unitConditionSortIndex, type UnitHeatSource } from '../models/rules/unit-type-rules';
import type { HeatDissipationState } from '../models/rules/heat-management';
import { AmmoEquipment } from '../models/equipment.model';
import { formatAmmoName } from '../utils/ammo-interaction.util';
import { inventoryTargetCategory, inventoryTargetNumberText, inventoryTargetRangeSelection, readInventoryTargetDisplay } from '../utils/inventory-target-number.util';
import { getInventoryControlModeAmmoSummary, INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE, INVENTORY_CONTROL_ORIGINAL_HEAT_TEXT_ATTRIBUTE, resolveInventoryControlRangeDamageText, resolveInventoryControlSelectedAmmoOption, type InventoryControlAmmoOption } from '../utils/inventory-control.util';
import type { InventoryControlRuntimeEntryState, InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget } from '../models/inventory-control-runtime-state.model';
import { isRiscLaserPulseModule, RISC_LASER_PULSE_MODE, selectedRiscLaserMode } from '../equipment-handlers/risc-laser-pulse-module.handler';

const INVENTORY_CONTROL_SELECTION_COLOR_PROPERTY = '--inventory-control-selection-color';
const HEAT_PROJECTION_ORIGINAL_OVERFLOW_STROKE = 'data-heat-projection-original-stroke';

const INVENTORY_CONTROL_RANGE_CLASS_NAMES: Record<InventoryControlRuntimeRangeKey, string> = {
    short: 'selected-range-short',
    medium: 'selected-range-medium',
    long: 'selected-range-long',
    extreme: 'selected-range-extreme'
};

type HeatDissipationWithWings = HeatDissipationState & { totalDissipationWithWings?: number };

/*
 * Author: Drake
 *
 * This service manages the lifecycle of a single ForceUnit's SVG element.
 * It loads, initializes, and keeps the SVG updated based on the unit's state.
 * An instance of this service should be created for each ForceUnit.
 */
@Injectable()
export class UnitSvgService {
    protected logger = inject(LoggerService);
    private sheetService = inject(SheetService);
    private svgDimensions = { width: 0, height: 0 };
    public version = signal(0);

    constructor(
        protected unit: CBTForceUnit,
        protected unitInitializer: UnitInitializerService
    ) {
        // Armor effect
        effect(() => {
            this.updateArmorDisplay(false);
            this.version(); // Track version to force a repaint
        });
        // Data effect
        effect(() => {
            this.updateAllDisplays();
            this.version(); // Track version to force a repaint
        });
        // Unit state effect
        effect(() => {
            const svg = this.unit.svg();
            if (!svg) return;
            this.updateConditionsDisplay();
            this.version(); // Track version to force a repaint
        });
        // Destroy effect
        effect(() => {
            const destroyed = this.unit.destroyed;
            this.updateDestroyedOverlayDisplay(destroyed);
            this.version(); // Track version to force a repaint
        });
        inject(DestroyRef).onDestroy(() => {        
            this.unit.svg.set(null); // Clear SVG on destruction
        });
    }


    public forceRepaint() {
        this.version.update(v => v + 1); // Increment version to trigger repaint
    }

    public async loadAndInitialize(): Promise<void> {
        if (this.unit.svg()) {
            // Already loaded
            return;
        }

        try {
            const svg = await this.sheetService.getSheet(this.unit.getUnit().sheets[0], this.unit.getUnit().serverHost);

            // Do basic setup that doesn't require the DOM
            this.initializeSvg(svg);

            // Create a hidden container to temporarily render the SVG for calculations
            const hiddenContainer = document.createElement('div');
            hiddenContainer.style.position = 'absolute';
            hiddenContainer.style.left = '-9999px';
            hiddenContainer.style.top = '-9999px';
            hiddenContainer.style.visibility = 'hidden';
            document.body.appendChild(hiddenContainer);

            try {
                // Append SVG to the hidden container to allow DOM calculations
                hiddenContainer.appendChild(svg);
                await this._waitForSvgLayout(svg);

                RsPolyfillUtil.addMissingClasses(this.unit, svg);
                this.unitInitializer.initializeUnitIfNeeded(this.unit, svg);
                RsPolyfillUtil.syncConditionButtons(this.unit, svg);

                this.unit.svg.set(svg);
                this.updateArmorDisplay(true);
                this.updateAllDisplays();
                this.updateDestroyedOverlayDisplay(this.unit.destroyed);

            } finally {
                // Clean up: remove the SVG from the hidden container and the container itself
                if (hiddenContainer.contains(svg)) {
                    hiddenContainer.removeChild(svg);
                }
                document.body.removeChild(hiddenContainer);
            }
        } catch (error) {
            this.logger.error(`Failed to load or initialize SVG for ${this.unit.getUnit().name}: ${error}`);
            this.unit.svg.set(null);
        }
    }

    private _waitForSvgLayout(svg: SVGSVGElement): Promise<void> {
        return new Promise((resolve, reject) => {
            // Use #btLogoColor as a representative element to check for layout readiness.
            const testElement = svg.querySelector('#btLogoColor');
            if (!testElement) {
                // If the element doesn't exist (e.g., on vehicles), resolve immediately.
                resolve();
                return;
            }

            let retries = 0;
            const maxRetries = 30; // ~500ms timeout to prevent infinite loops.

            const check = () => {
                try {
                    const bbox = (testElement as SVGGraphicsElement).getBBox();
                    if (bbox && bbox.width > 0) {
                        // Success: Layout is ready.
                        resolve();
                    } else if (retries < maxRetries) {
                        // Not ready yet, try again on the next frame.
                        retries++;
                        requestAnimationFrame(check);
                    } else {
                        // Timed out. Log a warning but don't block the app.
                        this.logger.warn('SVG layout check timed out. Proceeding anyway.');
                        resolve();
                    }
                } catch (e) {
                    // An error can occur if the element is not yet in the render tree.
                    if (retries < maxRetries) {
                        retries++;
                        requestAnimationFrame(check);
                    } else {
                        this.logger.error('Failed to get SVG BBox after multiple retries: ' + e);
                        reject(new Error('SVG layout failed to initialize.'));
                    }
                }
            };

            requestAnimationFrame(check);
        });
    }


    private initializeSvg(svg: SVGSVGElement): void {
        svg.classList.add('mekbay-sheet');
        const styleId = 'mekbay-svg-style';
        if (!svg.querySelector(`#${styleId}`)) {
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.setAttribute('id', styleId);
            style.textContent = `svg:not(:root) { overflow: visible; }`;
            svg.insertBefore(style, svg.firstChild);
        }

        if (svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
            this.svgDimensions = { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height };
        } else {
            this.svgDimensions = { width: svg.width.baseVal.value, height: svg.height.baseVal.value };
        }
    }

    protected updateAllDisplays() {
        if (!this.unit.svg()) return;
        // Read all reactive state properties to ensure they are tracked by the effect.
        const crew = this.unit.getCrewMembers();
        const heat = this.unit.getHeat();
        const critSlots = this.unit.getCritSlots();
        const locations = this.unit.getLocations();
        const inventory = this.unit.getInventory();
        this.unit.phaseTrigger(); // Ensure phase changes trigger update

        // Update all displays
        this.updateBVDisplay();
        this.updateCrewDisplay(crew);
        this.updateCritLocDisplay(critSlots);
        this.updateHeatDisplay(heat);
        this.updateHeatSinkPips();
        this.updateAmmoProfile();
        this.updateInventory();
        this.updateTurnState();
        this.updateConditionsDisplay();
    }

    protected updateConditionsDisplay() {
        const svg = this.unit.svg();
        if (!svg) return;

        const conditionControls = this.unit.rules.conditionControls;
        const conditions = this.unit.getConditions();
        const activeConditions = UNIT_CONDITION_DEFINITIONS
            .map(condition => ({ key: condition.key, active: conditions.has(condition.key) }))
            .sort((left, right) => unitConditionSortIndex(left.key) - unitConditionSortIndex(right.key));
        this.updateUnitConditionControlVisibility(svg, conditionControls);
        const activeMenuConditions = conditionControls.filter(condition => condition.placement === 'menu' && conditions.has(condition.key));
        const menuActive = activeMenuConditions.length > 0;
        const menuButton = svg.querySelector<SVGElement>('.unitConditionButton[condition="menu"]');
        const menuButtonColor = activeMenuConditions.length === 1 ? activeMenuConditions[0].color : '#666';
        menuButton?.setAttribute('active-color', menuButtonColor);
        menuButton?.style.setProperty('--unit-condition-active-color', menuButtonColor);
        menuButton?.classList.toggle('active', menuActive);
        menuButton?.querySelector<SVGElement>('rect')?.setAttribute('fill', menuActive ? menuButtonColor : '#fff');
        menuButton?.querySelector<SVGElement>('text')?.setAttribute('fill', menuActive ? '#fff' : '#000');

        let bannerOffset = 0;
        for (const condition of activeConditions) {
            const button = svg.querySelector<SVGElement>(`.unitConditionButton[condition="${condition.key}"]`);
            button?.classList.toggle('active', condition.active);
            const buttonColor = button?.getAttribute('active-color') ?? '#666';
            button?.querySelector<SVGElement>('rect')?.setAttribute('fill', condition.active ? buttonColor : '#fff');
            button?.querySelector<SVGElement>('text')?.setAttribute('fill', condition.active ? '#fff' : '#000');

            const banner = svg.querySelector<SVGElement>(`.unitConditionBanner[condition="${condition.key}"]`);
            if (!banner) continue;
            const bannerRect = banner.querySelector<SVGElement>('.unitConditionBannerRect');
            const bannerText = banner.querySelector<SVGElement>('.unitConditionBannerText');
            banner.classList.toggle('visible', condition.active);
            if (condition.active) {
                banner.removeAttribute('display');
            } else {
                banner.setAttribute('display', 'none');
            }
            banner.setAttribute('opacity', condition.active ? '1' : '0');
            bannerRect?.setAttribute('fill', banner.getAttribute('condition-color') ?? '#666');
            if (bannerRect) {
                bannerRect.style.transformBox = 'fill-box';
                bannerRect.style.transformOrigin = 'left center';
                bannerRect.style.transform = condition.active ? 'scaleX(1)' : 'scaleX(0)';
            }
            if (bannerText) {
                bannerText.style.opacity = condition.active ? '1' : '0';
            }
            if (condition.active) {
                const bannerHeight = Number(bannerRect?.getAttribute('height') ?? 15);
                banner.setAttribute('transform', `translate(0 ${bannerOffset})`);
                bannerOffset += bannerHeight;
            }
        }
    }

    private updateUnitConditionControlVisibility(svg: SVGSVGElement, conditionControls: readonly { key: string; placement?: string }[]): void {
        const buttonConditions = new Set(conditionControls
            .filter(condition => condition.placement === 'button')
            .map(condition => condition.key));
        const hasMenuConditions = conditionControls.some(condition => condition.placement === 'menu');

        svg.querySelectorAll<SVGElement>('.unitConditionButton[condition]').forEach(button => {
            const condition = button.getAttribute('condition');
            const visible = condition === 'menu'
                ? hasMenuConditions
                : !!condition && buttonConditions.has(condition);
            button.style.display = visible ? '' : 'none';
        });

        svg.querySelectorAll<SVGElement>('#unit_condition_wrapper, .unitConditionWrapper').forEach(wrapper => {
            const buttons = Array.from(wrapper.querySelectorAll<SVGElement>('.unitConditionButton[condition]'));
            wrapper.style.display = buttons.length > 0 && buttons.every(button => button.style.display === 'none') ? 'none' : '';
        });
    }

    protected updateDestroyedOverlayDisplay(destroyed?: boolean) {
        const svg = this.unit.svg();
        if (!svg) return;

        let destroyedOverlay = svg.querySelector('#destroyed-overlay') as SVGElement | null;

        if (destroyed) {
            if (!destroyedOverlay) {
                destroyedOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                destroyedOverlay.setAttribute('id', 'destroyed-overlay');
                destroyedOverlay.classList.add('no-invert', 'screen-only');
                destroyedOverlay.setAttribute('x', (this.svgDimensions.width / 2).toString());
                destroyedOverlay.setAttribute('y', (this.svgDimensions.height / 2.5).toString());
                destroyedOverlay.setAttribute('text-anchor', 'middle');
                destroyedOverlay.setAttribute('dominant-baseline', 'middle');
                destroyedOverlay.setAttribute('font-size', Math.max(64, this.svgDimensions.width / 6).toString());
                destroyedOverlay.setAttribute('fill', 'red');
                destroyedOverlay.setAttribute('stroke', 'black');
                destroyedOverlay.setAttribute('stroke-width', '5');
                destroyedOverlay.setAttribute('style', "paint-order: stroke fill; stroke-linejoin: round; pointer-events: none; user-select: none; font-weight: bold; font-family:Roboto;");
                destroyedOverlay.setAttribute('transform', `rotate(20,${this.svgDimensions.width / 2},${this.svgDimensions.height / 2.5})`);
                destroyedOverlay.textContent = 'DESTROYED';
                svg.appendChild(destroyedOverlay);
            }
        } else {
            destroyedOverlay?.remove();
        }
    }

    protected updateBVDisplay() {
        const svg = this.unit.svg();
        if (!svg) return;
        const bvElement = svg.querySelector('#bv');
        if (bvElement) {
            const bv = this.unit.getBv();
            // Here is ok to use .bv, we want custom ammo to show up in the variation too 
            const originalBv = this.unit.getUnit().bv || 0;
            if (bv !== originalBv) {
                bvElement.textContent = `${bv} (${originalBv})`;
            } else {
                bvElement.textContent = bv.toString();
            }
        }
    }

    protected updateCrewDisplay(crew: CrewMember[]) {
        const svg = this.unit.svg();
        if (!svg) return;
        const PSRMod = this.unit.PSRModifiers();
        const pilotingDisplayModifier = PSRMod?.modifier || this.unit.pilotingModifier();
        const attackerModifier = this.unit.turnState().getTotalTargetModifierAsAttacker();

        // Check if all crew members have default values (no name and default skills)
        const allCrewDefault = crew.every(member => 
            !member.getName() && // No name set
            member.getSkill('gunnery') === DEFAULT_GUNNERY_SKILL && // Default gunnery skill
            member.getSkill('piloting') === DEFAULT_PILOTING_SKILL // Default piloting skill
        );

        this.updateCrewDamageDisplay(svg, crew);

        // Apply or remove screen-only class on skillValue elements
        svg.querySelectorAll('.skillValue').forEach(el => {
            el.classList.toggle('screen-only', allCrewDefault);
        });
        const blanks = ['blankPilotingSkill0', 
            'blankGunnerySkill0', 
            'blankAsfGunnerySkill0', 
            'blankAsfPilotingSkill0',
            'blankPilotingSkill1',
            'blankGunnerySkill1',
            'blankPilotingSkill2',
            'blankGunnerySkill2',
            'blankPilotingSkill3',
            'blankGunnerySkill3'];
        blanks.forEach(selector => {
            const el = svg.getElementById(selector);
            if (el) {
                el.classList.toggle('print-show', allCrewDefault);
            }
        });

        crew.forEach(member => {
            const crewId = member.getId();
            const crewName = member.getName();
            const crewNameButton = svg.querySelector(`#crewNameButton${crewId}`) as SVGElement | null;
            const textElementName = crewNameButton?.getAttribute('textElement');
            const blankElementName = crewNameButton?.getAttribute('blankElement');
            const nameElement = textElementName ? svg.querySelector(`#${textElementName}`) as SVGElement | null : null;
            const blankElement = blankElementName ? svg.querySelector(`#${blankElementName}`) as SVGElement | null : null;
            if (nameElement && blankElement) {
                nameElement.textContent = crewName || '';
                nameElement.style.visibility = crewName ? 'visible' : 'hidden';
                blankElement.style.visibility = crewName ? 'hidden' : 'visible';
            }

            const skills: { name: SkillType; elementName: string; asf: boolean }[] = [
                { name: 'gunnery', elementName: 'gunnerySkill', asf: false },
                { name: 'piloting', elementName: 'pilotingSkill', asf: false },
                { name: 'gunnery', elementName: 'asfGunnerySkill', asf: true },
                { name: 'piloting', elementName: 'asfPilotingSkill', asf: true }
            ];
            skills.forEach(skill => {
                if (skill.asf && crewId > 0) return;
                const selector = skill.asf ? `#${skill.elementName}` : `#${skill.elementName}${crewId}`;
                const svgElement = svg.querySelector(selector) as SVGElement | null;
                if (svgElement) {
                    const skillValue = member.getSkill(skill.name, skill.asf);
                    if (skill.name === 'piloting') {
                        svgElement.textContent = formatPilotingDisplay(skillValue, pilotingDisplayModifier);
                    } else {
                        svgElement.textContent = formatGunneryDisplay(skillValue, attackerModifier);
                    }
                }
            });

            const crewHitElements = svg.querySelectorAll(`.crewHit[crewId='${crewId}']`);
            const hits = member.getHits();
            crewHitElements.forEach(el => {
                const hitValue = parseInt(el.getAttribute('hit') || '0');
                el.classList.toggle('damaged', hits >= hitValue);
            });

            const state = member.getState();
            const unconsciousGroup = svg.querySelector(`g#crew_status_checkbox_${crewId}[state=unconscious]`) as SVGGElement | null;
            const deadGroup = svg.querySelector(`g#crew_status_checkbox_${crewId}[state=dead]`) as SVGGElement | null;
            if (unconsciousGroup) {
                unconsciousGroup.classList.toggle('wounded', state === 'unconscious');
            }
            if (deadGroup) {
                deadGroup.classList.toggle('wounded', state === 'dead');
            }
            this.updateCrewStateControls(svg, crewId, state);

        });
    }

    private updateCrewDamageDisplay(svg: SVGSVGElement, crew: CrewMember[]): void {
        const hasCrew = this.unit.rules.hasCrew();
        const remoteDrone = this.unit.rules.isRemoteDrone();
        const visibleCrewIds = new Set(hasCrew ? crew.map(member => member.getId()) : []);
        let showRemoteDroneLabel = false;
        let hasCrewDamage0 = false;
        let labelContainer: Element | null = svg;
        let labelX = '70';
        let labelY = this.unit.getUnit().type === 'Aero' ? '60' : '40';
        svg.querySelectorAll<SVGElement>('g[id^="crewDamage"]').forEach(group => {
            const crewId = Number(group.id.replace('crewDamage', ''));
            const visible = visibleCrewIds.has(crewId);
            if (crewId === 0) {
                hasCrewDamage0 = true;
                labelContainer = group.parentNode instanceof Element ? group.parentNode : svg;
            }
            showRemoteDroneLabel ||= remoteDrone && crewId === 0 && !visible;
            group.style.display = visible ? '' : 'none';
            if (visible) {
                group.removeAttribute('display');
            } else {
                group.setAttribute('display', 'none');
            }
        });
        if (remoteDrone && !hasCrewDamage0) {
            const blankCrewName = svg.getElementById('blankCrewName0');
            labelContainer = blankCrewName?.parentNode instanceof Element ? blankCrewName.parentNode : null;
            showRemoteDroneLabel = labelContainer !== null;
            labelX = '72';
            labelY = '51';
        }
        this.updateRemoteDroneCrewDamageLabel(svg, labelContainer, showRemoteDroneLabel, labelX, labelY);
    }

    private updateRemoteDroneCrewDamageLabel(svg: SVGSVGElement, container: Element | null, visible: boolean, x: string, y: string): void {
        let label = svg.getElementById('remoteDroneCrewDamage0Label') as SVGTextElement | null;
        if (!visible || !container) {
            label?.remove();
            return;
        }
        if (!label) {
            label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        }
        container.appendChild(label);
        label.setAttribute('id', 'remoteDroneCrewDamage0Label');
        label.setAttribute('class', 'remoteDroneCrewDamageLabel screen-only');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-family', 'Roboto, sans-serif');
        label.setAttribute('font-size', '9');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('fill', '#000');
        label.setAttribute('x', x);
        label.setAttribute('y', y);
        label.textContent = 'REMOTE DRONE';
        label.style.display = '';
        label.removeAttribute('display');
    }

    private updateCrewStateControls(svg: SVGSVGElement, crewId: number, state: CrewMemberState): void {
        const stateDisplay = this.crewStateDisplay(state);
        const active = stateDisplay !== null;
        const color = stateDisplay?.color ?? '#666';
        const visible = this.unit.rules.crewStateControls.length > 0;

        svg.querySelectorAll<SVGElement>(`.crewStateButton[crewId="${crewId}"]`).forEach(button => {
            button.style.display = visible ? '' : 'none';
            button.classList.toggle('active', active);
            button.setAttribute('active-color', color);
            button.style.setProperty('--unit-condition-active-color', color);
            button.querySelector<SVGElement>('rect')?.setAttribute('fill', active ? color : '#fff');
            button.querySelector<SVGElement>('text')?.setAttribute('fill', active ? '#fff' : '#000');
        });

        svg.querySelectorAll<SVGElement>(`.crewStateBanner[crewId="${crewId}"]`).forEach(banner => {
            const bannerRect = banner.querySelector<SVGElement>('.unitConditionBannerRect');
            const bannerText = banner.querySelector<SVGElement>('.unitConditionBannerText');
            banner.classList.toggle('visible', active);
            banner.setAttribute('opacity', active ? '1' : '0');
            if (active && stateDisplay) {
                banner.removeAttribute('display');
                bannerRect?.setAttribute('fill', stateDisplay.color);
                if (bannerText) bannerText.textContent = stateDisplay.label;
            } else {
                banner.setAttribute('display', 'none');
                if (bannerText) bannerText.textContent = '';
            }
            if (bannerRect) {
                bannerRect.style.transformBox = 'fill-box';
                bannerRect.style.transformOrigin = 'right center';
                bannerRect.style.transform = active ? 'scaleX(1)' : 'scaleX(0)';
            }
            if (bannerText) {
                bannerText.style.opacity = active ? '1' : '0';
            }
        });
    }

    private crewStateDisplay(state: CrewMemberState): { label: string; color: string } | null {
        const definition = this.unit.rules.crewStateDefinition(state);
        return definition ? { label: definition.bannerLabel, color: definition.color } : null;
    }

    protected updateCritLocDisplay(critLocs: CriticalSlot[]) {
        const svg = this.unit.svg();
        if (!svg) return;
        if (!svg.querySelector('.critLoc')) return;

        critLocs.forEach(critLoc => {
            if (!critLoc.el) return;
                critLoc.el.classList.toggle('damaged', !!critLoc.destroyed);
                critLoc.el.classList.toggle('willChange', !!critLoc.destroying != !!critLoc.destroyed);
        });
    }

    protected updateHeatDisplay(heat: HeatProfile) {
        const svg = this.unit.svg();
        if (!svg) return;

        if (!svg.getElementById('heatScale')) return;

        const heatDataPanel = svg.querySelector('#heatDataPanel');
        if (heatDataPanel && !this.unit.readOnly()) {
            heatDataPanel.classList.toggle('dirtyHeat', heat.next !== undefined);
            heatDataPanel.classList.toggle('hot', heat.next !== undefined && heat.current <= heat.next);
            heatDataPanel.classList.toggle('cold', heat.next !== undefined && heat.current > heat.next);
        }

        const heatValue = heat.next ?? heat.current;

        let highestHeatVal = -Infinity;

        // Update heat scale rectangles
        svg.querySelectorAll('#heatScale rect.heat').forEach(heatRect => {
            const heatVal = Number((heatRect as SVGElement).getAttribute('heat'));
            if (heatVal > highestHeatVal) {
                highestHeatVal = heatVal;
            }
            if (heatVal <= heatValue) {
                heatRect.classList.add('hot');
            } else {
                heatRect.classList.remove('hot');
            }
        });

        // Update heat effects highlight
        svg.querySelectorAll('.heatEffect').forEach(effectEl => {
            const effectVal = Number((effectEl as SVGElement).getAttribute('heat'));
            effectEl.classList.remove('surpassed');

            if (effectVal <= heatValue) {
                effectEl.classList.add('hot');
            } else {
                effectEl.classList.remove('hot');
            }
        });
        svg.querySelectorAll('.heatEffect.hot').forEach(effectEl => {
            const attrs = [
                { name: 'h-shut', value: effectEl.getAttribute('h-shut') },
                { name: 'h-random', value: effectEl.getAttribute('h-random') },
                { name: 'h-ammo', value: effectEl.getAttribute('h-ammo') },
                { name: 'h-fire', value: effectEl.getAttribute('h-fire') },
                { name: 'h-move', value: effectEl.getAttribute('h-move'), inverse: true },
            ];
            let surpassed = false;
            for (const attr of attrs) {
                if (surpassed) break; // If already surpassed, no need to check further
                if (attr.value === null) continue;
                const currentVal = Number(attr.value);
                // Search for another .heatEffect.hot element with same attribute, not null, and lower value
                svg.querySelectorAll('.heatEffect.hot:not(.surpassed)').forEach(otherEl => {
                    if (otherEl === effectEl) return; // same element, skip
                    const otherVal = otherEl.getAttribute(attr.name);
                    if (otherVal === null) return; // skip if no value
                    if (attr.inverse) {
                        if (Number(otherVal) < currentVal) {
                            effectEl.classList.add('surpassed');
                            surpassed = true;
                        }
                    } else
                        if (Number(otherVal) > currentVal) {
                            effectEl.classList.add('surpassed');
                            surpassed = true;
                        }
                });
            }
        });

        // Handle overflow frame
        if (highestHeatVal < heatValue) {
            svg.querySelector('#heatScale .overflowFrame')?.classList.add('hot');

            const overflowFrameEl = svg.querySelector('#heatScale .overflowFrame') as SVGGraphicsElement | null;
            const overflowButtonEl = svg.querySelector('#heatScale .overflowButton') as SVGGraphicsElement | null;
            if (overflowFrameEl && overflowButtonEl) {
                overflowFrameEl.classList.add('hot');

                let overflowText = svg.querySelector('#heatScale .overflowText') as SVGElement | null;
                if (!overflowText) {
                    overflowText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    overflowText.setAttribute('id', 'overflowText');
                    overflowText.classList.add('overflowText');
                    overflowText.setAttribute('style', 'pointer-events: none; font-weight: bold; text-anchor: middle; dominant-baseline: middle; font-size: 10px;');

                    const x = overflowButtonEl.getAttribute('x');
                    const y = overflowButtonEl.getAttribute('y');
                    const height = overflowButtonEl.getAttribute('height');
                    const width = overflowButtonEl.getAttribute('width');
                    const centerX = Number(x) + Number(width) / 2;
                    const centerY = Number(y) + Number(height) / 2 + 4;
                    overflowText.setAttribute('x', centerX.toString());
                    overflowText.setAttribute('y', centerY.toString());
                    svg.getElementById('heatScale')!.appendChild(overflowText);
                }
                overflowText.textContent = `${heatValue}`;
            }
        } else {
            svg.querySelector('#heatScale .overflowFrame')?.classList.remove('hot');
            const overflowText = svg.querySelector('#heatScale .overflowText') as SVGElement | null;
            if (overflowText) {
                overflowText.textContent = '';
            }
        }

        const updateArrow = (id: string, value: undefined | number, state: 'current' | 'nextHot' | 'nextCold' | 'previous') => {
            let arrow = svg.querySelector(`#${id}`) as SVGPolygonElement | null;

            if (value === undefined) {
                arrow?.remove();
                return;
            }
            const heatEl = this.getHeatElementFromValue(value);

            if (heatEl) {
                const elX = heatEl.getAttribute('x');
                const elY = heatEl.getAttribute('y');
                const elHeight = heatEl.getAttribute('height');
                const elWidth = heatEl.getAttribute('width');
                const x = Number(elX) + Number(elWidth) + 2;
                const y = Number(elY) + Number(elHeight) / 2;

                if (!arrow) {
                    arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    arrow.setAttribute('id', id);
                    arrow.classList.add('screen-only');
                    heatEl.parentElement?.appendChild(arrow);
                }
                arrow.setAttribute('points', `${x + 8},${y - 5} ${x},${y} ${x + 8},${y + 5}`);
                if (state === 'current') {
                    arrow.setAttribute('fill', '#666');
                    arrow.setAttribute('stroke', '#000');
                    arrow.setAttribute('stroke-width', '1');
                } else if (state === 'nextHot') {
                    arrow.setAttribute('fill', 'var(--hot-color)');
                    arrow.setAttribute('stroke', 'var(--hot-color)');
                    arrow.setAttribute('stroke-width', '1');
                } else if (state === 'nextCold') {
                    arrow.setAttribute('fill', 'var(--cold-color)');
                    arrow.setAttribute('stroke', 'var(--cold-color)');
                    arrow.setAttribute('stroke-width', '1');
                } else {
                    arrow.setAttribute('fill', 'none');
                    arrow.setAttribute('stroke', '#aaa');
                    arrow.setAttribute('stroke-width', '1');
                }
                arrow.style.display = 'block';
            } else if (arrow) {
                arrow.style.display = 'none';
            }
        };

        if (heat.next === heat.current) {
            updateArrow('now-arrow', heat.current, 'current');
            svg.querySelector('#next-arrow')?.remove();
        } else {
            if (heat.next !== undefined) {
                updateArrow('next-arrow', heat.next, heat.next > heat.current ? 'nextHot' : 'nextCold');
            } else {
                svg.querySelector('#next-arrow')?.remove();
            }
            updateArrow('now-arrow', heat.current, 'current');
        }

        if (heat.previous !== heat.current && heat.previous !== heat.next) {
            updateArrow('faded-arrow', heat.previous, 'previous');
        } else {
            svg.querySelector('#faded-arrow')?.remove();
        }
        if (!this.unit.readOnly()) {
            this.updateHeatProjectionPreview(heat);
        }
    }

    protected getHeatElementFromValue(value: number): SVGElement | null {
        const svg = this.unit.svg();
        if (!svg) return null;
        if (value > 30) {
            return svg.querySelector('#heatScale .overflowButton') as SVGElement | null;
        }
        return svg.querySelector(`#heatScale .heat[heat="${value}"]`) as SVGElement | null;
    }


    /**
     * Updates a single pip's damaged/pending/fresh classes.
     *
     * For a location with `committed` damage and signed `pending` delta:
     *  - Pips 1..total (committed+pending): `damaged` (committed portion) or `damaged+pending` (new pending damage)
     *  - Pips (total+1)..committed: `pending` only (committed damage pending removal)
     *  - Beyond both: clean
     */
    protected updatePip(pip: Element, idx: number, committed: number, total: number, initial: boolean) {
        const shouldDamage = idx <= total;
        const shouldPending = (idx > committed && idx <= total) || (idx > total && idx <= committed);
        const wasDamaged = pip.classList.contains('damaged');

        if (wasDamaged !== shouldDamage) {
            pip.classList.toggle('damaged', shouldDamage);
            if (!initial) pip.classList.add('fresh');
        } else {
            pip.classList.remove('fresh');
        }
        pip.classList.toggle('pending', shouldPending);
    }

    protected updateArmorDisplay(initial: boolean = false) {
        const svg = this.unit.svg();
        if (!svg) return;
        this.unit.phaseTrigger(); // Ensure phase changes trigger update

        const locations = this.unit.getLocations();
        const locInfo: Record<string, { committed: number; total: number; idx: number }> = {};

        // Armor pips
        svg.querySelectorAll('.armor.pip').forEach(pip => {
            const loc = pip.getAttribute('loc');
            if (!loc) return;
            const locKey = pip.getAttribute('rear') ? `${loc}-rear` : loc;
            if (!locInfo[locKey]) {
                const d = locations[locKey];
                locInfo[locKey] = { committed: d?.armor ?? 0, total: (d?.armor ?? 0) + (d?.pendingArmor ?? 0), idx: 0 };
            }
            const s = locInfo[locKey];
            this.updatePip(pip, ++s.idx, s.committed, s.total, initial);
            pip.classList.toggle('flooded', this.unit.getLocationCondition(loc, 'flooded'));
            pip.classList.toggle('detached', this.unit.getLocationCondition(loc, 'blown-off'));
        });

        // Structure (internal) pips
        const hasCTPips = !!svg.querySelector('.structure.pip[loc="CT"]');
        const intInfo: Record<string, { committed: number; total: number; idx: number }> = {};
        svg.querySelectorAll('.structure.pip').forEach(pip => {
            const loc = pip.getAttribute('loc');
            if (!loc) return;
            if (loc === 'SI' && hasCTPips) return;
            if (!intInfo[loc]) {
                const d = locations[loc];
                intInfo[loc] = { committed: d?.internal ?? 0, total: (d?.internal ?? 0) + (d?.pendingInternal ?? 0), idx: 0 };
            }
            const s = intInfo[loc];
            this.updatePip(pip, ++s.idx, s.committed, s.total, initial);
            pip.classList.toggle('flooded', this.unit.getLocationCondition(loc, 'flooded'));
            pip.classList.toggle('detached', this.unit.getLocationCondition(loc, 'blown-off'));
        });

        this.unit.locations?.armor.forEach(entry => {
            let el: Element | null = null;
            if (entry.rear) {
                el = svg.querySelector(`.unitLocation.armor[rear="1"][loc="${entry.loc}"]`);
            } else {
                el = svg.querySelector(`.unitLocation.armor:not([rear])[loc="${entry.loc}"]`);
            }
            if (!el) return;
            if (this.unit.getArmorHits(entry.loc, entry.rear) >= this.unit.getArmorPoints(entry.loc, entry.rear)) {
                el.classList.add('damaged');
            } else {
                el.classList.remove('damaged');
            }
        });

        const topology = getTopologyFor(this.unit.locations?.internal?.keys() ?? []);

        this.unit.locations?.internal.forEach(entry => {
            const el = svg.querySelector(`.unitLocation.structure[loc="${entry.loc}"]`);
            if (!el) return;
            const armorEls = svg.querySelectorAll(`.unitLocation.armor[loc="${entry.loc}"]`);
            const flooded = this.unit.getLocationCondition(entry.loc, 'flooded');
            const blownOff = this.unit.getLocationCondition(entry.loc, 'blown-off');
            const physicallyDetached = blownOff || this.isLinkedLocationCommittedPhysicallyDetached(entry.loc);
            const functionallyDetached = physicallyDetached || this.isLinkedLocationCommittedFunctionallyDetached(entry.loc);
            const disabledLocation = !physicallyDetached && functionallyDetached;
            const narcCount = this.unit.getLocationConditionValue(entry.loc, 'narc') ?? 0;
            const structurallyDestroyed = this.unit.isInternalLocStructurallyDestroyed(entry.loc);
            const inheritedDisabledLocation = disabledLocation && !flooded && !structurallyDestroyed;
            const critGroup = svg.querySelector(`.critGroup[loc="${entry.loc}"]`);
            const locEls = svg.querySelectorAll(`.unitLocation[loc="${entry.loc}"], .pip[loc="${entry.loc}"], .critSlot[loc="${entry.loc}"]`);
            locEls.forEach(locEl => {
                locEl.classList.toggle('flooded', flooded);
                locEl.classList.toggle('detached', physicallyDetached);
                locEl.classList.toggle('disabledLocation', inheritedDisabledLocation);
            });
            critGroup?.classList.toggle('flooded', flooded);
            critGroup?.classList.toggle('detached', physicallyDetached);
            critGroup?.classList.toggle('disabledLocation', inheritedDisabledLocation);
            critGroup?.classList.toggle('locationDestroyed', structurallyDestroyed);
            this.updateLocationConditionButton(svg, entry.loc, narcCount);
            if (structurallyDestroyed) {
                el.classList.add('damaged');
                armorEls.forEach(armorEl => {
                    armorEl.classList.add('damaged');
                });
            } else {
                el.classList.remove('damaged');
                // Not needed to remove from armor, as it's handled before during the armor loop
            }
        });
    }

    private isLinkedLocationCommittedPhysicallyDetached(loc: string): boolean {
        return this.isLinkedLocationCommittedDestroyed(loc, sourceLoc => this.unit.isInternalLocCommittedPhysicallyDestroyed(sourceLoc));
    }

    private isLinkedLocationCommittedFunctionallyDetached(loc: string): boolean {
        return this.isLinkedLocationCommittedDestroyed(loc, sourceLoc => this.unit.isInternalLocCommittedDestroyed(sourceLoc));
    }

    private isLinkedLocationCommittedDestroyed(loc: string, destroyed: (sourceLoc: string) => boolean): boolean {
        return Object.entries(LINKED_LOCATIONS).some(([sourceLoc, linkedLocations]) => {
            if (!linkedLocations.includes(loc)) return false;
            return destroyed(sourceLoc);
        });
    }

    private updateLocationConditionButton(svg: SVGSVGElement, loc: string, narcCount: number): void {

        const narcBanner = svg.querySelector<SVGElement>(`.locationNarcBanner[loc="${loc}"]`);
        if (!narcBanner) return;
        const narcText = narcBanner.querySelector('text');
        if (narcText) narcText.textContent = `NARC: ${narcCount}`;
        if (narcCount > 0) {
            narcBanner.removeAttribute('display');
        } else {
            narcBanner.setAttribute('display', 'none');
        }
    }

    protected updateHeatSinkPips() {
        // No-op for non-heat units (vehicles, etc.)
    }

    private getInventoryOriginalTotalAmmo(entry: MountedEquipment): number {
        const componentIndexText = entry.id.split('#').pop();
        const [componentIndexRaw, binIndexRaw] = (componentIndexText ?? '').split('.');
        const componentIndex = Number(componentIndexRaw);
        const binIndex = Number(binIndexRaw ?? 0);
        const component = Number.isInteger(componentIndex) ? this.unit.getUnit().comp[componentIndex] : undefined;
        const ammo = entry.equipment instanceof AmmoEquipment ? entry.equipment : undefined;
        const binCount = Math.max(1, component?.q ?? 1);
        const originalTotalAmmo = component?.q2 || (ammo ? ammo.shots * binCount : 0) || entry.totalAmmo || 0;
        const baseBinAmmo = Math.floor(originalTotalAmmo / binCount);
        const extraBinAmmo = originalTotalAmmo % binCount;
        return baseBinAmmo + (binIndex < extraBinAmmo ? 1 : 0);
    }

    protected updateAmmoProfile() {
        const svg = this.unit.svg();
        if (!svg) return;

        const ammoProfileEl = svg.querySelector('#ammoProfile > text');
        if (!ammoProfileEl) return;

        const equipmentList = this.unit.getAvailableEquipment();
        const ammoProfile = new Map<string, number>();
        this.unit.getInventory().forEach(entry => {
            if (!(entry.equipment instanceof AmmoEquipment)) return;
            const currentAmmo = entry.ammo && equipmentList[entry.ammo] instanceof AmmoEquipment
                ? equipmentList[entry.ammo] as AmmoEquipment
                : entry.equipment;
            const totalAmmo = entry.totalAmmo ?? this.getInventoryOriginalTotalAmmo(entry);
            const remainingAmmo = totalAmmo - (entry.consumed ?? 0);
            const key = `(${formatAmmoName(currentAmmo)})`;
            ammoProfile.set(key, (ammoProfile.get(key) ?? 0) + (this.unit.isEquipmentUnavailable(entry) ? 0 : remainingAmmo));
        });

        const ammoList = Array.from(ammoProfile.entries())
            .map(([key, value]) => `${key} ${value}`)
            .join(', ');
        ammoProfileEl.textContent = ammoList ? `Ammo: ${ammoList}` : 'Ammo:';
    }

    protected resolveInventoryControlHitModifier(entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null): number | 'Vs' | '*' | null {
        return resolveHitModifier(
            entry,
            0,
            range,
            this.inventoryTargetSelectedAmmo(entry),
            (candidate, selectedAmmo) => this.unit.getLinkedEquipmentHitModifier(candidate, selectedAmmo),
            (candidate, candidateRange?: InventoryControlRuntimeRangeKey | null) => this.unit.getInventoryControlBaseHitModifier(candidate, candidateRange)
        );
    }

    /** Override to inject entry-specific effective hit modifiers. */
    protected getInventoryTargetHitModifier(entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null): number {
        const hitModifier = this.resolveInventoryControlHitModifier(entry, range);
        return typeof hitModifier === 'number' ? hitModifier - this.inventoryTargetHeatFireModifier(entry) : 0;
    }

    inventoryTargetHeatFireModifier(entry: MountedEquipment): number {
        return 0;
    }

    inventoryTargetNumberText(entry: MountedEquipment, target: InventoryControlRuntimeTarget): string | null {
        const missingMovementModifier = this.unit.turnState().missingAttackMovementModifier();
        const display = readInventoryTargetDisplay(entry);
        const hitModifierRange = this.inventoryControlRangeForTarget(entry, target, false);
        const text = inventoryTargetNumberText({
            entry,
            category: inventoryTargetCategory(entry),
            display,
            selectedAmmo: this.inventoryTargetSelectedAmmo(entry),
            target: this.inventoryControlTargetForRangeSelection(target, true),
            gunnerySkill: this.unit.rules.getTargetNumberGunnerySkill(),
            pilotingSkill: this.unit.rules.getTargetNumberPilotingSkill(),
            gunneryModifierBreakdown: this.unit.rules.getTargetNumberGunneryModifierBreakdown(),
            pilotingModifierBreakdown: this.unit.rules.getTargetNumberPilotingModifierBreakdown(),
            missingMovementModifier,
            attackModifierBreakdown: this.unit.turnState().getAttackModifierBreakdown(),
            hitModifier: this.getInventoryTargetHitModifier(entry, hitModifierRange),
            heatFireModifier: this.inventoryTargetHeatFireModifier(entry)
        });
        return text || null;
    }

    protected inventoryTargetSelectedAmmo(entry: MountedEquipment): AmmoEquipment | null {
        const summary = getInventoryControlModeAmmoSummary(entry, this.unit.getAvailableEquipment(), this.unit.getInventoryControlRules());
        const resolvedOption = resolveInventoryControlSelectedAmmoOption(summary.options, this.unit.getInventoryControlEntryAmmoOption(entry.id));
        return resolvedOption?.ammo ?? null;
    }

    protected renderInventoryControlSelection(): void {
        this.unit.inventoryControl.inventoryViewVersion();
        const entryStates = this.unit.inventoryControl.entryStates();
        const targets = this.unit.inventoryControl.targetsMap();
        const highlightedLinkedElements = new Set<SVGElement>();
        for (const entry of this.unit.getInventory()) {
            if (!entry.el) continue;
            const entryState = entryStates.get(entry.id);
            const selected = entryState?.selected ?? false;
            const targetId = entryState?.targetId;
            const target = targetId ? targets.get(targetId) : undefined;
            const targetNumberText = selected && target ? this.inventoryTargetNumberText(entry, target) : null;
            const selectedRange = selected ? this.inventoryControlSelectedRange(entry, entryState, target) : null;
            const weaponRuleRange = selected ? this.inventoryControlWeaponRuleRange(entry, entryState, target) : null;
            const hasSelectedMode = !!entry.el.querySelector(':scope > .alternativeMode.selected');

            this.renderInventoryControlSelectionColor(entry, target);
            this.renderInventoryControlHeatEntry(entry, weaponRuleRange);
            this.renderInventoryControlRangeDamageEntry(entry, weaponRuleRange);
            if (!entry.isDestroyed()) {
                this.renderHitModEntry(entry, this.resolveInventoryControlHitModifier(entry, weaponRuleRange));
            }
            entry.el.classList.toggle('selected', selected);
            entry.el.classList.toggle('selected-alternative-mode', selected && hasSelectedMode);
            this.renderInventoryControlTargetNumberEntry(entry, targetNumberText);
            for (const [range, className] of Object.entries(INVENTORY_CONTROL_RANGE_CLASS_NAMES) as [InventoryControlRuntimeRangeKey, string][]) {
                entry.el.classList.toggle(className, selectedRange === range);
            }
            this.collectLinkedInventoryControlSelection(entry, selected, highlightedLinkedElements);
        }
        for (const entry of this.unit.getInventory()) {
            if (entry.el && entry.parent) {
                entry.el.classList.toggle('selected', highlightedLinkedElements.has(entry.el));
            }
        }
        for (const el of highlightedLinkedElements) {
            el.classList.add('selected');
        }
    }

    private collectLinkedInventoryControlSelection(entry: MountedEquipment, selected: boolean, highlightedLinkedElements: Set<SVGElement>): void {
        if (!selected || selectedRiscLaserMode(entry) !== RISC_LASER_PULSE_MODE) return;
        const linkedWith = entry.linkedWith ?? [];
        for (const linked of linkedWith) {
            if (linked.el && isRiscLaserPulseModule(linked)) {
                highlightedLinkedElements.add(linked.el);
            }
        }
    }

    private renderInventoryControlSelectionColor(entry: MountedEquipment, target: InventoryControlRuntimeTarget | undefined): void {
        const el = entry.el;
        if (!el) return;
        if (target?.color) {
            el.style.setProperty(INVENTORY_CONTROL_SELECTION_COLOR_PROPERTY, target.color);
        } else {
            el.style.removeProperty(INVENTORY_CONTROL_SELECTION_COLOR_PROPERTY);
        }
    }

    private renderInventoryControlTargetNumberEntry(entry: MountedEquipment, targetNumberText: string | null): void {
        const el = entry.el;
        if (!el) return;
        const rect = el.querySelector<SVGElement>(':scope > .targetTn-rect');
        const text = el.querySelector<SVGElement>(':scope > .targetTn-text');
        if (!rect || !text) return;

        const visible = !!targetNumberText;
        rect.setAttribute('display', visible ? 'block' : 'none');
        text.setAttribute('display', visible ? 'block' : 'none');
        text.textContent = targetNumberText ?? '';
        el.classList.toggle('selected-target-out-of-range', targetNumberText === 'X');
    }

    private renderInventoryControlHeatEntry(entry: MountedEquipment, selectedRange: InventoryControlRuntimeRangeKey | null): void {
        const text = inventoryControlDirectText(entry.el, '.heat');
        if (!text) return;

        const originalHeat = text.getAttribute(INVENTORY_CONTROL_ORIGINAL_HEAT_TEXT_ATTRIBUTE) ?? text.textContent ?? '';
        const display = this.unit.applyInventoryControlDisplayEffects(entry, {
            name: '',
            location: '',
            heat: originalHeat,
            damage: '',
            hit: '',
            min: '',
            short: '',
            medium: '',
            long: ''
        }, {
            selectedRange,
            additionalHitModifier: 0,
            selectedAmmo: this.inventoryTargetSelectedAmmo(entry)
        });

        if (display.heat === originalHeat) {
            text.textContent = originalHeat;
            text.removeAttribute(INVENTORY_CONTROL_ORIGINAL_HEAT_TEXT_ATTRIBUTE);
            text.classList.remove('damaged');
            return;
        }

        if (!text.hasAttribute(INVENTORY_CONTROL_ORIGINAL_HEAT_TEXT_ATTRIBUTE)) {
            text.setAttribute(INVENTORY_CONTROL_ORIGINAL_HEAT_TEXT_ATTRIBUTE, originalHeat);
        }
        text.textContent = display.heat;
        text.classList.add('damaged');
    }

    // TODO: need to implement the aimed shot
    private renderInventoryControlAimedShotWarning(entry: MountedEquipment, warningText: string | null): void {
        const el = entry.el;
        if (!el) return;
        const warning = el.querySelector<SVGElement>(':scope > .targetAimedShotWarning-text');
        if (!warning) return;

        const visible = !!warningText;
        const warningRect = el.querySelector<SVGElement>(':scope > .targetAimedShotWarning-rect');
        if (warningRect) {
            warningRect.setAttribute('display', visible ? 'block' : 'none');
        }
        warning.setAttribute('display', visible ? 'block' : 'none');
        warning.textContent = visible ? 'NO AIM' : '';
        el.classList.toggle('selected-target-aimed-shot-denied', visible);
        if (visible && warningText) {
            warning.setAttribute('aria-label', warningText);
        } else {
            warning.removeAttribute('aria-label');
        }
    }

    private renderInventoryControlRangeDamageEntry(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        const text = entry.el?.querySelector<SVGElement>(':scope > .damage > text');
        if (!text) return;

        const originalDamage = text.getAttribute(INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE);
        const damage = resolveInventoryControlRangeDamageText(entry, range, originalDamage ?? text.textContent);
        if (damage === null) {
            if (originalDamage !== null) {
                text.textContent = originalDamage;
                text.removeAttribute(INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE);
            }
            return;
        }

        if (originalDamage === null) {
            text.setAttribute(INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE, text.textContent ?? '');
        }
        text.textContent = damage;
    }

    private inventoryControlSelectedRange(
        entry: MountedEquipment,
        entryState: InventoryControlRuntimeEntryState | undefined,
        target: InventoryControlRuntimeTarget | undefined
    ): InventoryControlRuntimeRangeKey | null {
        if (target) return this.inventoryControlRangeForTarget(entry, target, true);
        return entryState?.range ?? null;
    }

    private inventoryControlWeaponRuleRange(
        entry: MountedEquipment,
        entryState: InventoryControlRuntimeEntryState | undefined,
        target: InventoryControlRuntimeTarget | undefined
    ): InventoryControlRuntimeRangeKey | null {
        if (target) return this.inventoryControlRangeForTarget(entry, target, false);
        return entryState?.range ?? null;
    }

    private inventoryControlRangeForTarget(entry: MountedEquipment, target: InventoryControlRuntimeTarget, useC3Distance: boolean): InventoryControlRuntimeRangeKey | null {
        return inventoryTargetRangeSelection({
            entry,
            category: inventoryTargetCategory(entry),
            display: readInventoryTargetDisplay(entry),
            target: this.inventoryControlTargetForRangeSelection(target, useC3Distance)
        })?.range ?? null;
    }

    private inventoryControlTargetForRangeSelection(target: InventoryControlRuntimeTarget, useC3Distance: boolean): InventoryControlRuntimeTarget {
        if (useC3Distance && this.unit.hasLinkedC3Network?.() === true) return target;
        if (target.c3Distance === undefined) return target;
        return { ...target, c3Distance: undefined };
    }

    /** Render hit modifier badge for a single inventory entry. Pure presentation. */
    protected renderHitModEntry(entry: MountedEquipment, hitModifier: number | 'Vs' | '*' | null) {
        if (!entry.el) return;
        const hitModRect = entry.el.querySelector(`:scope > .hitMod-rect`);
        const hitModText = entry.el.querySelector(`:scope > .hitMod-text`);
        if (!hitModRect || !hitModText) return;

        if (hitModifier === null || entry.isDestroyed()) {
            hitModRect.setAttribute('display', 'none');
            hitModText.setAttribute('display', 'none');
            entry.el.classList.remove('weakenedHitMod');
            return;
        }
        if (hitModifier === 'Vs' || hitModifier === '*') {
            hitModRect.setAttribute('display', 'block');
            hitModText.setAttribute('display', 'block');
            hitModText.textContent = hitModifier;
            entry.el.classList.remove('weakenedHitMod');
            return;
        }

        const weakenedHitMod = hitModifier > parseInt(entry.baseHitMod || '0');
        if (hitModifier !== 0 || entry.baseHitMod === '+0' || weakenedHitMod) {
            hitModRect.setAttribute('display', 'block');
            hitModText.setAttribute('display', 'block');
            hitModText.textContent = (hitModifier >= 0 ? '+' : '') + hitModifier.toString();
        } else {
            hitModRect.setAttribute('display', 'none');
            hitModText.setAttribute('display', 'none');
        }
        entry.el.classList.toggle('weakenedHitMod', weakenedHitMod);
    }

    protected updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        this.unit.getInventory().forEach(entry => {
            if (!entry.el) return;
            // Inventory state
            if (entry.isDestroyed()) {
                entry.el.classList.add('damagedInventory');
                entry.el.classList.remove('selected');
            } else {
                entry.el.classList.remove('damagedInventory');
            }
            // Hit modifier badge
            if (entry.isDestroyed()) {
                this.renderHitModEntry(entry, null);
            } else {
                this.renderHitModEntry(entry, this.resolveInventoryControlHitModifier(entry));
            }
            this.renderInventoryControlHeatEntry(entry, null);
        });
        this.renderInventoryControlSelection();
    }

    protected updateTurnState() {
        const svg = this.unit.svg();
        if (!svg) return;
        const unit = this.unit;
        const turnState = unit.turnState();
        this.renderHeatSourcesSummary(svg, turnState.heatSources());
        // Update move mode display
        const moveMode = turnState.moveMode();
        const moveModifier = turnState.getAttackMovementModifier();
        let el: SVGElement | null = null;
        const mpWalkEl = svg.getElementById('mpWalk') as SVGElement | null;
        const mpRunEl = svg.getElementById('mpRun') as SVGElement | null;
        const mpJumpEl = svg.getElementById('mpJump') as SVGElement | null;
        const mpAltMode = svg.querySelector('#mp_2') as SVGElement | null;

        if (moveMode === 'walk' || moveMode === 'stationary') {
            el = mpWalkEl;
        } else if (moveMode === 'run') {
            el = mpRunEl;
        } else if (moveMode === 'jump' || moveMode === 'UMU') {
            el = mpJumpEl ?? mpAltMode;
        }
        const movementEls = [mpWalkEl, mpRunEl, mpJumpEl, mpAltMode].filter((candidate): candidate is SVGElement => candidate !== null);
        for (const otherEl of movementEls) {
            otherEl.classList.remove('unusedMoveMode', 'currentMoveMode');
            const sibling = otherEl.previousElementSibling as SVGElement | null;
            sibling?.classList.remove('unusedMoveMode', 'currentMoveMode');
            svg.querySelectorAll<SVGElement>(`.${CSS.escape(otherEl.id)}-rect`).forEach((rectEl: SVGElement) => {
                rectEl.style.display = 'none';
            });
        }

        if (!el || moveMode === null) return;

        const hasAttackMovementModifier = movementEls.some(moveEl => {
            const candidateMode = moveEl === mpWalkEl ? 'walk'
                : moveEl === mpRunEl ? 'run'
                    : moveEl === mpJumpEl || moveEl === mpAltMode ? 'jump'
                        : null;
            return candidateMode !== null && unit.rules.getAttackMovementModifier(candidateMode, unit.turnState().airborne() ?? false) !== 0;
        });

        if (moveMode !== 'stationary') {
            for (const otherEl of movementEls) {
                const isCurrent = otherEl === el;
                otherEl.classList.toggle('currentMoveMode', isCurrent);
                otherEl.classList.toggle('unusedMoveMode', !isCurrent);
                const sibling = otherEl.previousElementSibling as SVGElement | null;
                sibling?.classList.toggle('currentMoveMode', isCurrent);
                sibling?.classList.toggle('unusedMoveMode', !isCurrent);
            }
        } else {
            for (const otherEl of movementEls) {
                otherEl.classList.add('unusedMoveMode');
                const sibling = otherEl.previousElementSibling as SVGElement | null;
                sibling?.classList.add('unusedMoveMode');
            }
        }

        if (!hasAttackMovementModifier) return;

        svg.querySelectorAll<SVGElement>(`.${CSS.escape(el.id)}-rect`).forEach((rectEl: SVGElement) => {
            rectEl.style.display = 'block';
        });
        const textEl = svg.querySelector<SVGElement>(`text.${CSS.escape(el.id)}-rect`);
        if (textEl) {
            textEl.textContent = this.formatSignedModifier(moveModifier);
        }
    }

    private formatSignedModifier(modifier: number): string {
        return modifier >= 0 ? `+${modifier}` : modifier.toString();
    }

    private renderHeatSourcesSummary(svg: SVGSVGElement, sources: UnitHeatSource[]): void {
        const heatSourcesText = svg.getElementById('damagedEngineHeatText') as SVGTextElement | null;
        if (!heatSourcesText) return;

        const positiveSources = sources.filter(source => source.value > 0);
        if (positiveSources.length === 0) {
            heatSourcesText.textContent = '';
            heatSourcesText.setAttribute('display', 'none');
            heatSourcesText.style.display = 'none';
            return;
        }

        const x = heatSourcesText.getAttribute('x') ?? '0';
        const y = Number(heatSourcesText.getAttribute('y') ?? '0');
        const lineHeight = 9;
        heatSourcesText.textContent = '';
        heatSourcesText.removeAttribute('display');
        heatSourcesText.style.display = 'block';

        positiveSources.forEach((source, index) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            line.setAttribute('x', x);
            line.setAttribute('y', (y - ((positiveSources.length - 1 - index) * lineHeight)).toString());
            line.textContent = `${this.heatSourceSummaryLabel(source)}: ${this.formatSignedModifier(source.value)}`;
            heatSourcesText.appendChild(line);
        });
    }

    private heatSourceSummaryLabel(source: UnitHeatSource): string {
        if (source.id === 'damaged-engine') return 'Engine';
        return source.label;
    }

    private updateHeatProjectionPreview(heat: HeatProfile): void {
        const svg = this.unit.svg();
        const heatScale = svg?.getElementById('heatScale') as SVGGElement | null;
        if (!svg || !heatScale) return;

        const dissipation = this.heatDissipationState();
        if (!dissipation) {
            this.clearHeatProjectionPreview(heatScale);
            return;
        }

        const heatGain = this.unit.turnState().heatSources()
            .reduce((total, source) => total + Math.max(0, source.value), 0);
        const heatDissipation = Math.max(0, dissipation.totalDissipationWithWings ?? dissipation.totalDissipation);
        const netHeat = heatGain - heatDissipation;
        const projectedHeat = Math.max(0, heat.current + netHeat);

        this.updateHeatProjectionOverflow(heatScale, projectedHeat, heat.current);

        const startValue = Math.max(0, heat.current);
        const targetValue = Math.max(0, Math.min(30, projectedHeat));
        if (netHeat === 0 || (startValue > 30 && projectedHeat > 30)) {
            this.clearHeatProjectionBar(heatScale);
            return;
        }

        const startEl = this.getHeatElementFromValue(startValue);
        const targetEl = this.getHeatElementFromValue(targetValue);
        const startCenter = startEl ? this.heatMarkerCenter(startEl) : null;
        const targetCenter = targetEl
            ? projectedHeat > 30 ? this.heatMarkerTopCenter(targetEl) : this.heatMarkerCenter(targetEl)
            : null;
        const heatZeroEl = svg.querySelector('#heatScale .heat[heat="0"]') as SVGElement | null;
        if (!startCenter || !targetCenter || !heatZeroEl) {
            this.clearHeatProjectionBar(heatScale);
            return;
        }

        const height = Math.abs(targetCenter.y - startCenter.y);
        if (height <= 0.1) {
            this.clearHeatProjectionBar(heatScale);
            return;
        }

        let bar = heatScale.querySelector('#heat-projection-bar') as SVGRectElement | null;
        if (!bar) {
            bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bar.setAttribute('id', 'heat-projection-bar');
            bar.setAttribute('class', 'screen-only heatProjectionBar');
            bar.setAttribute('pointer-events', 'none');
            heatScale.appendChild(bar);
        }
        const x = Number(heatZeroEl.getAttribute('x') ?? 0) - 3.8;
        const projectionColor = netHeat > 0 ? '#d12020' : '#2070d1';
        const barTop = Math.min(startCenter.y, targetCenter.y) - 2;
        bar.setAttribute('x', x.toString());
        bar.setAttribute('y', barTop.toString());
        bar.setAttribute('width', '3');
        bar.setAttribute('height', (height + 4).toString());
        bar.setAttribute('fill', projectionColor);
        const arrowTipX = Number(heatZeroEl.getAttribute('x') ?? 0) + 4;
        const arrowBaseX = arrowTipX - 5;

        let originArrow = heatScale.querySelector('#heat-projection-origin-arrow') as SVGRectElement | null;
        if (!originArrow) {
            originArrow = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            originArrow.setAttribute('id', 'heat-projection-origin-arrow');
            originArrow.setAttribute('class', 'screen-only heatProjectionOriginArrow');
            originArrow.setAttribute('pointer-events', 'none');
            heatScale.appendChild(originArrow);
        }
        originArrow.setAttribute('x', (arrowBaseX - 1.5).toString());
        originArrow.setAttribute('y', (startCenter.y - 2).toString());
        originArrow.setAttribute('width', '4');
        originArrow.setAttribute('height', '4');
        originArrow.setAttribute('fill', projectionColor);

        let targetArrow = heatScale.querySelector('#heat-projection-target-arrow') as SVGPolygonElement | null;
        if (!targetArrow) {
            targetArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            targetArrow.setAttribute('id', 'heat-projection-target-arrow');
            targetArrow.setAttribute('class', 'screen-only heatProjectionTargetArrow');
            targetArrow.setAttribute('pointer-events', 'none');
            heatScale.appendChild(targetArrow);
        }
        targetArrow.setAttribute('fill', projectionColor);
        if (projectedHeat <= 30) {
            targetArrow.setAttribute('points', `${arrowTipX},${targetCenter.y} ${arrowBaseX},${targetCenter.y - 2} ${arrowBaseX},${targetCenter.y + 2}`);
        } else {
            targetArrow.setAttribute('points', `${arrowTipX},${barTop} ${arrowTipX - 2},${barTop + 5} ${arrowTipX + 2},${barTop + 5}`);
        }
    }

    private heatDissipationState(): HeatDissipationWithWings | null {
        return this.unit.rules.heatDissipation() as HeatDissipationWithWings | null;
    }

    private updateHeatProjectionOverflow(heatScale: SVGGElement, projectedHeat: number, currentHeat: number): void {
        const overflowFrame = heatScale.querySelector('.overflowFrame') as SVGElement | null;
        const overflowButton = heatScale.querySelector('.overflowButton') as SVGElement | null;
        if (!overflowFrame || !overflowButton) return;

        let overflowText = heatScale.querySelector('#heat-projection-overflow-text') as SVGTextElement | null;
        if (projectedHeat <= 30) {
            this.restoreHeatProjectionOverflowStroke(overflowFrame);
            overflowText?.remove();
            return;
        }

        if (!overflowFrame.hasAttribute(HEAT_PROJECTION_ORIGINAL_OVERFLOW_STROKE)) {
            overflowFrame.setAttribute(HEAT_PROJECTION_ORIGINAL_OVERFLOW_STROKE, overflowFrame.getAttribute('stroke') ?? '');
        }
        const overflowColor = projectedHeat < currentHeat ? '#2070d1' : '#d12020';
        overflowFrame.setAttribute('stroke', overflowColor);
        const center = this.heatMarkerCenter(overflowButton);
        if (!center) return;

        if (!overflowText) {
            overflowText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            overflowText.setAttribute('id', 'heat-projection-overflow-text');
            overflowText.setAttribute('class', 'screen-only heatProjectionOverflowText');
            overflowText.setAttribute('text-anchor', 'end');
            overflowText.setAttribute('dominant-baseline', 'middle');
            overflowText.setAttribute('font-size', '8');
            overflowText.setAttribute('font-weight', 'bold');
            overflowText.setAttribute('fill', overflowColor);
            overflowText.setAttribute('pointer-events', 'none');
            heatScale.appendChild(overflowText);
        }
        overflowText.setAttribute('fill', overflowColor);
        overflowText.setAttribute('x', (center.x - 12).toString());
        overflowText.setAttribute('y', (center.y + 4.5).toString());
        overflowText.textContent = Math.round(projectedHeat).toString();
    }

    private clearHeatProjectionPreview(heatScale: SVGGElement): void {
        this.clearHeatProjectionBar(heatScale);
        heatScale.querySelector('#heat-projection-overflow-text')?.remove();
        const overflowFrame = heatScale.querySelector('.overflowFrame') as SVGElement | null;
        if (overflowFrame) this.restoreHeatProjectionOverflowStroke(overflowFrame);
    }

    private clearHeatProjectionBar(heatScale: SVGGElement): void {
        heatScale.querySelector('#heat-projection-bar')?.remove();
        heatScale.querySelector('#heat-projection-origin-arrow')?.remove();
        heatScale.querySelector('#heat-projection-target-arrow')?.remove();
    }

    private restoreHeatProjectionOverflowStroke(overflowFrame: SVGElement): void {
        if (!overflowFrame.hasAttribute(HEAT_PROJECTION_ORIGINAL_OVERFLOW_STROKE)) return;
        const originalStroke = overflowFrame.getAttribute(HEAT_PROJECTION_ORIGINAL_OVERFLOW_STROKE);
        if (originalStroke) {
            overflowFrame.setAttribute('stroke', originalStroke);
        } else {
            overflowFrame.removeAttribute('stroke');
        }
        overflowFrame.removeAttribute(HEAT_PROJECTION_ORIGINAL_OVERFLOW_STROKE);
    }

    private heatMarkerCenter(el: SVGElement): { x: number; y: number } | null {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));
        const width = Number(el.getAttribute('width'));
        const height = Number(el.getAttribute('height'));
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
            return { x: x + width / 2, y: y + height / 2 };
        }
        try {
            const bbox = (el as SVGGraphicsElement).getBBox();
            return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
        } catch {
            return null;
        }
    }

    private heatMarkerTopCenter(el: SVGElement): { x: number; y: number } | null {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));
        const width = Number(el.getAttribute('width'));
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width)) {
            return { x: x + width / 2, y: y - 1 };
        }
        try {
            const bbox = (el as SVGGraphicsElement).getBBox();
            return { x: bbox.x + bbox.width / 2, y: bbox.y - 1 };
        } catch {
            return null;
        }
    }
}

function inventoryControlDirectText(el: SVGElement | undefined, selector: string): SVGElement | null {
    const direct = el?.querySelector<SVGElement>(`:scope > ${selector}`) ?? null;
    if (!direct) return null;
    return direct.tagName.toLocaleLowerCase() === 'text'
        ? direct
        : direct.querySelector<SVGElement>(':scope > text');
}