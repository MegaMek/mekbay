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

import { untracked, Injectable, Injector, effect, EffectRef, OnDestroy, inject } from '@angular/core';
import { ForceUnit, CrewMember, SkillType, CriticalSlot, MountedEquipment } from '../models/force-unit.model';
import { DataService } from './data.service';
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { heatLevels, linkedLocs, uidTranslations } from '../components/svg-viewer/common';
import { LoggerService } from './logger.service';

/*
 * Author: Drake
 *
 * This service manages the lifecycle of a single ForceUnit's SVG element.
 * It loads, initializes, and keeps the SVG updated based on the unit's state.
 * An instance of this service should be created for each ForceUnit.
 */
@Injectable()
export class UnitSvgService implements OnDestroy {
    protected logger: LoggerService;

    private dataEffectRef: EffectRef | null = null;
    private armorEffectRef: EffectRef | null = null;
    private destroyEffectRef: EffectRef | null = null;
    private svgDimensions = { width: 0, height: 0 };

    constructor(
        protected unit: ForceUnit,
        protected dataService: DataService,
        protected unitInitializer: UnitInitializerService,
        protected injector: Injector
    ) {
        this.logger = this.injector.get(LoggerService);
    }

    public async loadAndInitialize(): Promise<void> {
        if (this.unit.svg()) {
            // Already loaded
            return;
        }

        try {
            const svg = await this.dataService.getSheet(this.unit.getUnit().sheets[0]);

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

                RsPolyfillUtil.addMissingClasses(this.unit.getUnit(), svg);
                this.unitInitializer.initializeUnitIfNeeded(this.unit, svg);

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

            // Set up the effect to keep the SVG updated
            this.setupDataEffect();
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

        // Update all displays
        this.updateBVDisplay();
        this.updateCrewDisplay(crew);
        this.updateCritLocDisplay(critSlots);
        this.updateHeatDisplay(heat);
        this.updateHeatSinkPips();
        this.updateInventory();
        this.updateHitMod();
        this.updateTurnState();
    }

    private setupDataEffect(): void {
        // Armor effect
        this.armorEffectRef = effect(() => {
            this.updateArmorDisplay(false);
            untracked(() => {
                this.evaluateDestroyed();
            });
        }, { injector: this.injector });
        // Data effect
        this.dataEffectRef = effect(() => {
            this.updateAllDisplays();
            untracked(() => {
                this.evaluateDestroyed();
            });
        }, { injector: this.injector });
        // Destroy effect
        this.destroyEffectRef = effect(() => {
            const destroyed = this.unit.destroyed;
            this.updateDestroyedOverlayDisplay(destroyed);
        }, { injector: this.injector });
    }

    ngOnDestroy(): void {
        if (this.armorEffectRef) {
            this.armorEffectRef.destroy();
            this.armorEffectRef = null;
        }
        if (this.dataEffectRef) {
            this.dataEffectRef.destroy();
            this.dataEffectRef = null;
        }
        if (this.destroyEffectRef) {
            this.destroyEffectRef.destroy();
            this.destroyEffectRef = null;
        }
        this.unit.svg.set(null); // Clear SVG on destruction
    }

    protected evaluateDestroyed() {
        const svg = this.unit.svg();
        if (!svg) return;
        let destroyed = false;
        if (svg.querySelector('.critLoc')) {
            this.unit.getCritSlots().forEach(critLoc => {
                if (!critLoc.el) return;
                if (critLoc.destroyed) {
                    if (critLoc.el.getAttribute('destroy')) {
                        destroyed = true;
                    }
                }
            });
        }
        if (this.unit.locations?.internal.has('SI')) {
            if (this.unit.isInternalLocDestroyed('SI')) {
                destroyed = true;
            }
        }
        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    protected updateDestroyedOverlayDisplay(destroyed?: boolean) {
        const svg = this.unit.svg();
        if (!svg) return;

        let destroyedOverlay = svg.querySelector('#destroyed-overlay') as SVGElement | null;

        if (destroyed) {
            if (!destroyedOverlay) {
                destroyedOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                destroyedOverlay.setAttribute('id', 'destroyed-overlay');
                destroyedOverlay.classList.add('no-invert', 'noprint');
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
                    svgElement.textContent = member.getSkill(skill.name, skill.asf).toString();
                }
            });

            const crewHitElements = svg.querySelectorAll(`.crewHit[crewId='${crewId}']`);
            const hits = member.getHits();
            crewHitElements.forEach(el => {
                const hitValue = parseInt(el.getAttribute('hit') || '0');
                el.classList.toggle('damaged', hits >= hitValue);
            });
        });
    }

    protected updateCritLocDisplay(critLocs: CriticalSlot[]) {
        const svg = this.unit.svg();
        if (!svg) return;
        if (!svg.querySelector('.critLoc')) return;

        critLocs.forEach(critLoc => {
            if (!critLoc.el) return;
            if (critLoc.destroyed) {
                if (critLoc.el.classList.contains('damaged')) {
                    critLoc.el.classList.remove('fresh');
                } else {
                    critLoc.el.classList.add('fresh');
                }
                critLoc.el.classList.add('damaged');
            } else {
                if (critLoc.el.classList.contains('damaged')) {
                    critLoc.el.classList.add('fresh');
                } else {
                    critLoc.el.classList.remove('fresh');
                }
                critLoc.el.classList.remove('damaged');
            }
        });
    }

    protected updateHeatDisplay(heat: { current: number, previous: number }) {
        const svg = this.unit.svg();
        if (!svg) return;

        if (!svg.getElementById('heatScale')) return;

        let highestHeatVal = -Infinity;

        // Update heat scale rectangles
        svg.querySelectorAll('#heatScale .heat').forEach(heatRect => {
            const heatVal = Number((heatRect as SVGElement).getAttribute('heat'));

            if (heatVal <= heat.current) {
                heatRect.classList.add('hot');
                if (heatVal > highestHeatVal) {
                    highestHeatVal = heatVal;
                }
            } else {
                heatRect.classList.remove('hot');
            }
        });

        // Update heat effects highlight
        svg.querySelectorAll('.heatEffect').forEach(effectEl => {
            const effectVal = Number((effectEl as SVGElement).getAttribute('heat'));
            effectEl.classList.remove('surpassed');

            if (effectVal <= heat.current) {
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
        if (highestHeatVal < heat.current) {
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
                overflowText.textContent = `${heat.current}`;
            }
        } else {
            svg.querySelector('#heatScale .overflowFrame')?.classList.remove('hot');
            const overflowText = svg.querySelector('#heatScale .overflowText') as SVGElement | null;
            if (overflowText) {
                overflowText.textContent = '';
            }
        }

        const updateArrow = (id: string, value: number, isCurrent: boolean) => {
            let arrow = svg.querySelector(`#${id}`) as SVGPolygonElement | null;
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
                    arrow.classList.add('noprint');
                    heatEl.parentElement?.appendChild(arrow);
                }
                arrow.setAttribute('points', `${x + 8},${y - 5} ${x},${y} ${x + 8},${y + 5}`);
                if (isCurrent) {
                    arrow.setAttribute('fill', '#666');
                    arrow.setAttribute('stroke', '#000');
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

        updateArrow('now-arrow', heat.current, true);

        if (heat.previous !== heat.current) {
            updateArrow('faded-arrow', heat.previous, false);
        } else {
            svg.querySelector('#faded-arrow')?.remove();
        }
    }

    private getHeatElementFromValue(value: number): SVGElement | null {
        const svg = this.unit.svg();
        if (!svg) return null;
        if (value > 30) {
            return svg.querySelector('#heatScale .overflowButton') as SVGElement | null;
        }
        return svg.querySelector(`#heatScale .heat[heat="${value}"]`) as SVGElement | null;
    }


    protected updateArmorDisplay(initial: boolean = false) {
        const svg = this.unit.svg();
        if (!svg) return;

        const armorPips = svg.querySelectorAll(`.armor.pip`);
        const locations = this.unit.getLocations();

        // Create copies of armor and internal values to track remaining pips
        const armorRemaining: Record<string, number> = {};
        const internalRemaining: Record<string, number> = {};

        // Armor pips
        armorPips.forEach(pip => {
            const loc = pip.getAttribute('loc');
            if (!loc) return;
            const rear = !!pip.getAttribute('rear');
            const locKey = rear ? `${loc}-rear` : loc;
            if (armorRemaining[locKey] === undefined) {
                armorRemaining[locKey] = locations[locKey]?.armor || 0;
            }
            if (armorRemaining[locKey] > 0) {
                if (!pip.classList.contains('damaged')) {
                    pip.classList.add('damaged');
                    if (!initial) {
                        pip.classList.add('fresh');
                    }
                } else if (pip.classList.contains('fresh')) {
                    pip.classList.remove('fresh');
                }
                armorRemaining[locKey]--;
            } else {
                if (pip.classList.contains('damaged')) {
                    pip.classList.remove('damaged');
                    if (!initial) {
                        pip.classList.add('fresh');
                    }
                } else if (pip.classList.contains('fresh')) {
                    pip.classList.remove('fresh');
                }
            }
        });

        // Structure (internal) pips
        const hasCTPips = !!svg.querySelector(`.structure.pip[loc="CT"]`);
        const structurePips = svg.querySelectorAll(`.structure.pip`);
        structurePips.forEach(pip => {
            const loc = pip.getAttribute('loc');
            if (!loc) return;
            if (loc == 'SI' && hasCTPips) return; // Skip structural integrity, they are represented by CT damage
            if (internalRemaining[loc] === undefined) {
                internalRemaining[loc] = locations[loc]?.internal || 0;
            }
            if (internalRemaining[loc] > 0) {
                if (!pip.classList.contains('damaged')) {
                    pip.classList.add('damaged');
                    if (!initial) {
                        pip.classList.add('fresh');
                    }
                } else if (pip.classList.contains('fresh')) {
                    pip.classList.remove('fresh');
                }
                internalRemaining[loc]--;
            } else {
                if (pip.classList.contains('damaged')) {
                    pip.classList.remove('damaged');
                    if (!initial) {
                        pip.classList.add('fresh');
                    }
                } else
                    if (pip.classList.contains('fresh')) {
                        pip.classList.remove('fresh');
                    }
            }
        });

        this.unit.locations?.armor.forEach(entry => {
            let el: Element | null = null;
            if (entry.rear) {
                el = svg.querySelector(`.unitLocation.armor[rear="1"][loc="${entry.loc}"]`);
            } else {
                el = svg.querySelector(`.unitLocation.armor:not([rear])[loc="${entry.loc}"]`);
            }
            if (!el) return;
            if (this.unit.isArmorLocDestroyed(entry.loc, entry.rear)) {
                el.classList.add('damaged');
            } else {
                el.classList.remove('damaged');
            }
        });

        this.unit.locations?.internal.forEach(entry => {
            const el = svg.querySelector(`.unitLocation.structure[loc="${entry.loc}"]`);
            if (!el) return;
            const armorEls = svg.querySelectorAll(`.unitLocation.armor[loc="${entry.loc}"]`);
            const destroyed = this.unit.isInternalLocDestroyed(entry.loc);
            const critGroup = svg.querySelector(`.critGroup[loc="${entry.loc}"]`);
            if (destroyed) {
                el.classList.add('damaged');
                critGroup?.classList.add('locationDestroyed');
                armorEls.forEach(armorEl => {
                    armorEl.classList.add('damaged');
                });
            } else {
                el.classList.remove('damaged');
                critGroup?.classList.remove('locationDestroyed');
                // Not needed to remove from armor, as it's handled before during the armor loop
            }
            if (linkedLocs[entry.loc]) {
                linkedLocs[entry.loc].forEach(linkedLoc => {
                    const linkedEls = svg.querySelectorAll(`[loc="${linkedLoc}"]`);
                    if (linkedEls) {
                        linkedEls.forEach(linkedEl => {
                            if (destroyed) {
                                linkedEl.classList.add('detached');
                            } else {
                                linkedEl.classList.remove('detached');
                            }
                        });
                    }
                });
            }
        });
    }

    protected updateHeatSinkPips() {
        const svg = this.unit.svg();
        if (!svg) return;

        let hasDoubleHeatsinks = false;
        const hsTypeElement = svg.getElementById('hsType');
        if (hsTypeElement) {
            const hsTypeText = hsTypeElement.textContent?.toLowerCase() ?? '';
            hasDoubleHeatsinks = hsTypeText.includes('double') || hsTypeText.includes('laser');
        }

        const heatSinkSlots = this.unit.getCritSlots().filter(slot =>
            (slot.el && slot.el.hasAttribute('hs') && Number(slot.el.getAttribute('hs')) > 0)
        );

        const heatsinkGroups = new Map<string, { dissipation: number, slots: CriticalSlot[] }>();
        heatSinkSlots.forEach(slot => {
            if (!slot.uid) return;
            if (!heatsinkGroups.has(slot.uid)) {
                const dissipation = Number(slot.el?.getAttribute('hs') ?? 1);
                heatsinkGroups.set(slot.uid, { dissipation, slots: [] });
            }
            heatsinkGroups.get(slot.uid)!.slots.push(slot);
        });

        const destroyedSuperCooledMyomer = this.unit.getCritSlots().filter(slot => slot.name && slot.name.includes('SuperCooledMyomer') && slot.destroyed).length;

        let damagedHeatSinkCount = 0;
        let turnedOffHeatSinkCount = this.unit.getHeat().heatsinksOff || 0;
        let dissipationFromHittableHeatsinks = 0;
        let dissipationLostFromDestroyedHittableHeatsinks = 0;
        heatsinkGroups.forEach(group => {
            dissipationFromHittableHeatsinks += group.dissipation;
            if (group.slots.some(slot => slot.destroyed)) {
                damagedHeatSinkCount++;
                dissipationLostFromDestroyedHittableHeatsinks += group.dissipation;
            }
        });

        // Update hsPips
        const hsPipsContainer = svg.querySelector('.hsPips');
        let totalHeatsinkPips = 0;

        if (hsPipsContainer) {
            const allHsPips = Array.from(hsPipsContainer.querySelectorAll('.pip')) as SVGElement[];
            totalHeatsinkPips = allHsPips.length;
            let idx = 0;
            allHsPips.forEach(pip => {
                if (idx < (damagedHeatSinkCount + destroyedSuperCooledMyomer)) {
                    if (!pip.classList.contains('damaged')) {
                        pip.classList.add('fresh');
                        pip.classList.add('damaged');
                    } else {
                        pip.classList.remove('fresh');
                    }
                } else {
                    if (pip.classList.contains('damaged')) {
                        pip.classList.add('fresh');
                        pip.classList.remove('damaged');
                    } else {
                        pip.classList.remove('fresh');
                    }
                }
                idx++;
            });

            idx = 0;
            allHsPips.reverse().forEach(pip => {
                if (idx < turnedOffHeatSinkCount) {
                    if (!pip.classList.contains('disabled')) {
                        pip.classList.add('disabled');
                    }
                } else {
                    if (pip.classList.contains('disabled')) {
                        pip.classList.remove('disabled');
                    }
                }
                idx++;
            });

        }
        let engineHeatsinksCount = totalHeatsinkPips - heatsinkGroups.size;
        let healthyHeatsinkPips = totalHeatsinkPips - damagedHeatSinkCount;
        let totalDissipation = (engineHeatsinksCount * (hasDoubleHeatsinks ? 2 : 1)) + (dissipationFromHittableHeatsinks - dissipationLostFromDestroyedHittableHeatsinks);
        totalDissipation = Math.max(0, totalDissipation - (turnedOffHeatSinkCount * (hasDoubleHeatsinks ? 2 : 1)));

        if (destroyedSuperCooledMyomer > 0) {
            totalDissipation -= destroyedSuperCooledMyomer * (hasDoubleHeatsinks ? 2 : 1);
            totalDissipation = Math.max(0, totalDissipation);
        }

        const hsCountElement = svg.querySelector('#hsCount');
        if (hsCountElement) {
            if (healthyHeatsinkPips !== totalDissipation || (turnedOffHeatSinkCount > 0)) {
                hsCountElement.textContent = `${healthyHeatsinkPips.toString()} (${totalDissipation.toString()})`;
            } else {
                hsCountElement.textContent = totalDissipation.toString();
            }
        }

        const critSlots = this.unit.getCritSlots();
        if (critSlots.length > 0) {
            const hasPartialWings = critSlots.some(slot => slot.name && slot.name.includes('PartialWing'));
            if (hasPartialWings) {
                const destroyedPartialWings = critSlots.filter(slot => slot.name && slot.name.includes('PartialWing') && slot.destroyed).length;
                const partialWingHeatBonus = Math.max(0, 3 - destroyedPartialWings);
                totalDissipation += partialWingHeatBonus;
            }
        }

        const heatProfileElement = svg.querySelector('#heatProfile');
        if (heatProfileElement) {
            const existingText = heatProfileElement.textContent || '';
            const match = existingText.match(/:\s*(\d+)/);
            const heatProfileValue = match ? match[1] : '0';
            heatProfileElement.textContent = `Total Heat (Dissipation): ${heatProfileValue} (${totalDissipation.toString()})`;
        }
    }

    protected updateHitMod() {
        const svg = this.unit.svg();
        if (!svg) return;

        let heatFireModifier = 0;
        svg.querySelectorAll('.heatEffect.hot:not(.surpassed)').forEach(effectEl => {
            const fire = parseInt(effectEl.getAttribute('h-fire') as string);
            if (fire && fire > heatFireModifier) {
                heatFireModifier = fire;
            }
        });
        this.unit.getInventory().forEach(entry => {
            let additionalModifiers = 0;
            if (entry.destroyed && entry.el) {
                const hitModRect = entry.el.querySelector(`:scope > .hitMod-rect`);
                const hitModText = entry.el.querySelector(`:scope > .hitMod-text`);
                if (hitModRect && hitModText) {
                    hitModRect.setAttribute('display', 'none');
                    hitModText.setAttribute('display', 'none');
                }
                return;
            };
            additionalModifiers += heatFireModifier;
            if (entry.linkedWith) {
                entry.linkedWith.forEach(linkedEntry => {
                    if (linkedEntry.equipment) {
                        if (linkedEntry.equipment.flags.has('F_ARTEMIS_V')) {
                            // If is destroyed, we increase hitmod by +1
                            if (linkedEntry.destroyed) {
                                additionalModifiers += 1;
                            }
                        }
                    }
                });
            }
            if (entry.baseHitMod !== 'Vs') {
                const hitModifier = this.calculateHitModifiers(this.unit, entry, additionalModifiers);
                if (hitModifier !== null) {
                    const hitModRect = entry.el.querySelector(`:scope > .hitMod-rect`);
                    const hitModText = entry.el.querySelector(`:scope > .hitMod-text`);
                    if (hitModRect && hitModText) {
                        const weakenedHitMod = (hitModifier > parseInt(entry.baseHitMod || '0'));
                        if (hitModifier !== 0 || entry.baseHitMod === '+0' || weakenedHitMod) {
                            hitModRect.setAttribute('display', 'block');
                            hitModText.setAttribute('display', 'block');
                            const hitModTextValue = (hitModifier >= 0 ? '+' : '') + hitModifier.toString();
                            hitModText.textContent = hitModTextValue;
                        } else {
                            hitModRect.setAttribute('display', 'none');
                            hitModText.setAttribute('display', 'none');
                        }
                        if (weakenedHitMod) {
                            entry.el.classList.add('weakenedHitMod');
                        } else {
                            entry.el.classList.remove('weakenedHitMod');
                        }
                    }
                }
            }
        });
    }

    protected calculateHitModifiers(unit: ForceUnit, entry: MountedEquipment, additionalModifiers: number): number | null {
        if (entry.equipment) {
            if (entry.equipment.flags.has('F_WEAPON_ENHANCEMENT')) {
                if (!entry.equipment.flags.has('F_RISC_LASER_PULSE_MODULE')) {
                    return null; // Skip calculation for weapon enhancements (except RISC Module)
                }
            }
            if ((!entry.equipment.range || entry.equipment.range == '-') && !entry.equipment.flags.has('F_CLUB')) {
                if (!entry.parent || !entry.parent.equipment || !entry.parent.equipment.range || entry.parent.equipment.range == '-') {
                    return null; // No range defined not by itself, not by parent, skip calculate hit modifier
                }
            }
        }
        let baseHitModValue = parseInt(entry.baseHitMod || '0');
        if (isNaN(baseHitModValue)) {
            return null; // Invalid hit modifier
        }
        let hitModValue = baseHitModValue;
        hitModValue += additionalModifiers;
        return hitModValue;
    }

    protected updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        this.unit.getInventory().forEach(entry => {
            if (entry.destroyed) {
                entry.el.classList.add('damagedInventory');
                entry.el.classList.remove('selected');
            } else {
                entry.el.classList.remove('damagedInventory');
            }
        });
    }

    protected updateTurnState() {
        const svg = this.unit.svg();
        if (!svg) return;
        const unit = this.unit;
        const turnState = unit.turnState();
        // Update move mode display
        const moveMode = turnState.moveMode();
        let el: SVGElement | null = null;
        const mpWalkEl = svg.getElementById('mpWalk') as SVGElement | null;
        const mpRunEl = svg.getElementById('mpRun') as SVGElement | null;
        const mpJumpEl = svg.getElementById('mpJump') as SVGElement | null;

        if (moveMode === 'walk') {
            el = mpWalkEl;
        } else if (moveMode === 'run') {
            el = mpRunEl;
        } else if (moveMode === 'jump') {
            el = mpJumpEl;
        }
        // cleanup
        for (const otherEl of [mpWalkEl, mpRunEl, mpJumpEl]) {
            if (!otherEl) continue;
            if (otherEl !== el) {
                otherEl?.classList.add('unusedMoveMode');
                const sibling = otherEl.previousElementSibling as SVGElement | null;
                sibling?.classList.add('unusedMoveMode');
                // Use an ID selector and the generic overload so TypeScript treats results as SVGElement
                svg.querySelectorAll<SVGElement>(`.${CSS.escape(otherEl.id)}-rect`).forEach((rectEl: SVGElement) => {
                    rectEl.style.display = 'none';
                });
            }
        }
        svg.querySelectorAll('.movementType').forEach(modeEl => {
            modeEl.classList.remove('currentMoveMode');
            modeEl.classList.remove('unusedMoveMode');
        });
        if (el) {
            el.classList.add('currentMoveMode');
            const sibling = el.previousElementSibling as SVGElement | null;
            sibling?.classList.add('currentMoveMode');
            svg.querySelectorAll<SVGElement>(`.${CSS.escape(el.id)}-rect`).forEach((rectEl: SVGElement) => {
                rectEl.style.display = 'block';
            });
            if (el === mpWalkEl) {
               const textEl = svg.querySelector<SVGElement>(`text.${CSS.escape(el.id)}-rect`);
                if (textEl) {
                    const distance = turnState?.moveDistance() || 0;
                    if (distance > 0) {
                        textEl.textContent = '+1';
                    } else {
                        textEl.textContent = '+0';
                    }
                }
            }
        }
    }
}