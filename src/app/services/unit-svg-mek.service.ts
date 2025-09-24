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

import { linkedLocs, uidTranslations } from "../components/svg-viewer/common";
import { CriticalSlot, ForceUnit, MountedEquipment } from "../models/force-unit.model";
import { UnitSvgService } from "./unit-svg.service";

/*
 * Author: Drake
 */
export class UnitSvgMekService extends UnitSvgService {
    // Mek-specific SVG handling logic goes here

    protected override updateAllDisplays() {
        if (!this.unit.svg()) return;
        // Read all reactive state properties to ensure they are tracked by the effect.
        const bv = this.unit.getBv();
        const crew = this.unit.getCrewMembers();
        const heat = this.unit.getHeat();
        const critSlots = this.unit.getCritSlots();
        const locations = this.unit.getLocations();
        const inventory = this.unit.getInventory();
        // Update all displays
        this.updateBVDisplay(bv);
        this.updateCrewDisplay(crew);
        this.updateHeatDisplay(heat);
        this.updateCritSlotDisplay(critSlots);
        this.updateHeatSinkPips();
        this.updateInventory();
        this.updateHitMod();
    }

    private updateCritSlotDisplay(criticalSlots: CriticalSlot[]) {
        const svg = this.unit.svg();
        if (!svg) return;
        const ammoProfile = new Map<string, number>();
        criticalSlots.forEach(criticalSlot => {
            const el = svg.querySelector(`.critSlot[loc="${criticalSlot.loc}"][slot="${criticalSlot.slot}"]`);
            if (!el) return;

            const uid = el.getAttribute('uid');
            const systemSlot = el.getAttribute('type') === 'sys';
            const armored = el.getAttribute('armored') === '1';
            const modularArmor = el.getAttribute('modularArmor') === '1';
            const isAmmo = el.classList.contains('ammoSlot');

            if (isAmmo) {
                const totalAmmo = parseInt(el.getAttribute('totalAmmo') || '0');
                const textNode = el.querySelector('text');
                if (textNode) {
                    let isCustomAmmoLoadout = false;
                    const remainingAmmo = totalAmmo - (criticalSlot.consumed ?? 0);
                    let text;
                    if (criticalSlot.eq) {
                        text = `Ammo (${criticalSlot.eq.shortName})`;
                        isCustomAmmoLoadout = !!criticalSlot.originalName && (criticalSlot.originalName !== criticalSlot.name);
                        el.classList.toggle('customAmmoLoadout', isCustomAmmoLoadout);
                    } else {
                        text = (textNode.textContent || '').replace(/\s\d+$/, '');
                    }
                    textNode.textContent = `${isCustomAmmoLoadout ? '*' : ''}${text} ${remainingAmmo}`;
                    const key = text.startsWith("Ammo ") ? text.substring(5) : text;
                    ammoProfile.set(
                        key,
                        !criticalSlot.destroyed ? (ammoProfile.get(key) ?? 0) + remainingAmmo : 0
                    );
                }
            }

            el.classList.toggle('damaged', !!criticalSlot.destroyed);

            if (armored && !criticalSlot.destroyed) {
                const armorPip = el.querySelector('.armoredLocPip');
                if (armorPip) {
                    const isHit = (criticalSlot.hits ?? 0) > 0;
                    if (armorPip.classList.contains('damaged') !== isHit) {
                        armorPip.classList.add('fresh');
                    } else if (armorPip.classList.contains('fresh')) {
                        armorPip.classList.remove('fresh');
                    }
                    armorPip.classList.toggle('damaged', isHit);
                }
            }

            if (modularArmor) {
                el.querySelectorAll('.modularArmorPip').forEach((pipEl, index) => {
                    const isHit = (criticalSlot.consumed ?? 0) > index;
                    if (pipEl.classList.contains('damaged') !== isHit) {
                        pipEl.classList.add('fresh');
                    } else if (pipEl.classList.contains('fresh')) {
                        pipEl.classList.remove('fresh');
                    }
                    pipEl.classList.toggle('damaged', isHit);
                });
            }

            if (systemSlot && uid && uidTranslations[uid]) {
                const allCritSlots = Array.from(svg.querySelectorAll(`.critSlot[uid="${uid}"]`));
                const damagedCount = allCritSlots.filter(e => e.classList.contains('damaged')).length;
                const translatedBase = uidTranslations[uid];

                if (translatedBase.endsWith('_')) {
                    for (let i = 1; i <= 5; i++) {
                        svg.querySelector(`#${CSS.escape(translatedBase + i)}`)?.classList.toggle('damaged', i <= damagedCount);
                    }
                } else {
                    svg.querySelector(`#${CSS.escape(translatedBase)}`)?.classList.toggle('damaged', damagedCount > 0);
                }
            }
        });
        // Update ammo profile
        const ammoProfileEl = svg.querySelector('#ammoProfile > text');
        if (ammoProfileEl) {
            const ammoList = Array.from(ammoProfile.entries())
                .map(([key, value]) => `${key} ${value}`)
                .join(', ');
            ammoProfileEl.textContent = ammoList ? `Ammo: ${ammoList}` : 'Ammo:';
        }
    }
    
    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;

        let heatMoveModifier = 0;
        let destroyedLegsCount = 0;
        let destroyedHipsCount = 0;
        let destroyedLegActuatorsCount = 0;
        svg.querySelectorAll('.heatEffect.hot:not(.surpassed)').forEach(effectEl => {
            const move = parseInt(effectEl.getAttribute('h-move') as string);
            if (move && move < heatMoveModifier) {
                heatMoveModifier = move;
            }
        });
        const mpWalkEl = svg.querySelector('#mpWalk');
        const critSlots = this.unit.getCritSlots();
        if (mpWalkEl) {
            const hasMASC = critSlots.some(slot => slot.name && slot.name.includes('MASC'));
            const destroyedMASC = critSlots.some(slot => slot.name && slot.name.includes('MASC') && slot.destroyed);
            const hasSupercharger = critSlots.some(slot => slot.name && slot.name.includes('Supercharger'));
            const destroyedSupercharger = critSlots.some(slot => slot.name && slot.name.includes('Supercharger') && slot.destroyed);
            const jumpJetsCount = critSlots.filter(slot => slot.name && (slot.name.includes('Jump Jet') || slot.name.includes('JumpJet'))).length;
            const destroyedJumpJetsCount = critSlots.filter(slot => slot.name && (slot.name.includes('Jump Jet') || slot.name.includes('JumpJet')) && slot.destroyed).length;
            const hasPartialWings = critSlots.some(slot => slot.name && slot.name.includes('PartialWing'));
            const internalLocations = new Set<string>(this.unit.locations?.internal.keys() || []);
            const hasTripleStrengthMyomer = critSlots.some(slot => slot.name && slot.name.includes('Triple Strength Myomer'));
            const mpRunEl = svg.querySelector('#mpRun');
            const mpJumpEl = svg.querySelector('#mpJump');
            let originalWalkValue = this.unit.getUnit().walk;
            let originalRunValue = this.unit.getUnit().run;
            let originalJumpValue = this.unit.getUnit().jump;
            let walkValue = originalWalkValue;
            let jumpValue = originalJumpValue;
            
            const checkLeg = (loc: string) => {
                if (this.unit.isInternalLocDestroyed(loc)) {
                    destroyedLegsCount++;
                } else {
                    destroyedHipsCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name === 'Hip' && slot.destroyed).length;
                    destroyedLegActuatorsCount += critSlots.filter(slot => slot.loc === loc && slot.name && (slot.name === 'Upper Leg' || slot.name === 'Lower Leg' || slot.name === 'Foot') && slot.destroyed).length;
                }
            };

            if (internalLocations.has('LL') && internalLocations.has('RL')) {
                // Biped and Tripods
                checkLeg('LL');
                checkLeg('RL');
                for (let i = 0; i < destroyedHipsCount; i++) {
                    // Apply hip damage effects
                    walkValue = Math.ceil(walkValue * 0.5);
                }
                walkValue -= destroyedLegActuatorsCount;
                if (destroyedLegsCount == 1) {
                    walkValue = 1;
                    jumpValue = 0;
                } else
                    if (destroyedLegsCount >= 2) {
                        walkValue = 0;
                        jumpValue = 0;
                    }
            } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
                // Quadrupeds
                checkLeg('RLL');
                checkLeg('FLL');
                checkLeg('RRL');
                checkLeg('FRL');
                walkValue -= destroyedHipsCount;
                walkValue -= destroyedLegActuatorsCount;
                if (destroyedLegsCount == 1) {
                    walkValue = walkValue - 1;
                    jumpValue = 0;
                } else
                    if (destroyedLegsCount >= 2) {
                        walkValue = 0;
                        jumpValue = 0;
                    }
            } else {
                //TODO: handle other cases (Tanks and stuffs)
                return;
            }
            walkValue = Math.max(0, walkValue + heatMoveModifier);
            let maxWalkValue = walkValue;
            if (walkValue < originalWalkValue) {
                mpWalkEl.classList.add('damaged');
            } else {
                mpWalkEl.classList.remove('damaged');
            }
            const tripleStrengthMyomerMoveBonusActive = (this.unit.getHeat().current >= 9 && hasTripleStrengthMyomer);
            if (tripleStrengthMyomerMoveBonusActive) {
                // we add it after apply damaged/undamaged
                walkValue += 2;
                maxWalkValue += 2;
            } else if (hasTripleStrengthMyomer) {
                maxWalkValue += 1 - heatMoveModifier; // We add back the heatMoveModifier this way we simulate heat at 9+
            }
            if (walkValue != maxWalkValue) {
                mpWalkEl.textContent = `${walkValue.toString()} [${maxWalkValue.toString()}]`;
            } else {
                mpWalkEl.textContent = walkValue.toString();
            }
            if (mpRunEl) {
                const baseRunValue = Math.round(walkValue * 1.5);
                let runValueCoeff = 1.5;
                if (hasMASC && !destroyedMASC && hasSupercharger && !destroyedSupercharger) {
                    runValueCoeff = 2.5;
                } else if ((hasMASC && !destroyedMASC) || (hasSupercharger && !destroyedSupercharger)) {
                    runValueCoeff = 2;
                }                
                let maxRunValue = Math.round(walkValue * runValueCoeff);
                if (hasTripleStrengthMyomer && !tripleStrengthMyomerMoveBonusActive) {
                    // we recalculate it after apply damaged/undamaged
                    maxRunValue = Math.round((walkValue + (1 - heatMoveModifier)) * runValueCoeff);
                }
                if (baseRunValue != maxRunValue) {
                    mpRunEl.textContent = `${baseRunValue.toString()} [${maxRunValue.toString()}]`;
                } else {
                    mpRunEl.textContent = baseRunValue.toString();
                }
                mpRunEl.classList.toggle('damaged', mpWalkEl.classList.contains('damaged'));
            }
            if (mpJumpEl) {
                if (destroyedJumpJetsCount === jumpJetsCount) {
                    jumpValue = 0;
                } else {
                    jumpValue = Math.max(0, jumpValue - destroyedJumpJetsCount);
                    if (hasPartialWings) {
                        const destroyedPartialWings = critSlots.filter(slot => slot.name && slot.name.includes('PartialWing') && slot.destroyed).length;
                        // I calculate how much JJ bonus I get from the partial wing in Standard conditions
                        const maxWingBonus = this.unit.getUnit().tons <= 55 ? 2 : 1;
                        // I remove 1 JumpMP for each partial wing crit hit up to the maximum bonus given by the wings
                        jumpValue -= Math.min(destroyedPartialWings, maxWingBonus);
                        const partialWingHeatBonus = Math.max(0, 3 - destroyedPartialWings);
                        const partialWingsHeatBonusEl = svg.getElementById('partialWingBonus');
                        if (partialWingsHeatBonusEl) {
                            partialWingsHeatBonusEl.textContent = `(Partial Wing +${partialWingHeatBonus})`;
                        }
                    }
                }
                mpJumpEl.textContent = jumpValue.toString();
                if (jumpValue < originalJumpValue) {
                    mpJumpEl.classList.add('damaged');
                } else {
                    mpJumpEl.classList.remove('damaged');
                }
            }
        }
        const getArmsModifiers = (loc: string) => {
            if (!this.unit.locations?.armor.has(loc)) {
                return null;
            }
            const destroyedHand = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Hand') && slot.destroyed);    
            const destroyedShoulder = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Shoulder') && slot.destroyed);
            return {
                canPunch: !destroyedShoulder,
                canClub: !destroyedShoulder && !destroyedHand,
            };
        };
        const locationsHitModifiers: { [key: string]: { canPunch: boolean; canClub: boolean } | null } = {
            'LA': getArmsModifiers('LA'),
            'RA': getArmsModifiers('RA'),
        };
        const cockpitLoc = critSlots.find(slot => slot.name === "Cockpit")?.loc ?? 'HD';
        const destroyedSensorsCount = critSlots.filter(slot => slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        this.unit.getInventory().forEach(entry => {
            let isDamaged = false;
            if (entry.critSlots.filter(slot => slot.destroyed).length > 0) {
                isDamaged = true;
            }
            if (entry.physical) {
                if (entry.name == 'kick' && (destroyedLegsCount > 0 || destroyedHipsCount > 0)) {
                    isDamaged = true;
                } else if (entry.name == 'punch') {
                    entry.locations.forEach(loc => {
                        if (this.unit.isInternalLocDestroyed(loc)) {
                            isDamaged = true;
                        } else
                            if (locationsHitModifiers[loc]) {
                                if (!locationsHitModifiers[loc].canPunch) {
                                    isDamaged = true;
                                }
                            }
                    });
                } else if (entry.name == 'push') {
                    entry.locations.forEach(loc => {
                        if (this.unit.isInternalLocDestroyed(loc)) {
                            isDamaged = true;
                        }
                    });
                }
            } else {
                if (entry.equipment?.flags.has('F_CLUB')) {
                    entry.locations.forEach(loc => {
                        if (locationsHitModifiers[loc]) {
                            if (!locationsHitModifiers[loc].canClub) {
                                isDamaged = true;
                            }
                        }
                    });
                } else {
                    if (cockpitLoc === 'HD' && destroyedSensorsCount >= 2) {
                        isDamaged = true;
                    } else if (destroyedSensorsCount >= 3) {
                        isDamaged = true;
                    }
                }
            }
            entry.destroyed = isDamaged;
            if (entry.el) {
                if (isDamaged) {
                    entry.el.classList.add('damagedInventory');
                    entry.el.classList.remove('interactive');
                    entry.el.classList.remove('selected');
                } else {
                    entry.el.classList.remove('damagedInventory');
                    entry.el.classList.add('interactive');
                }
            }
        });
    }

    protected override updateHitMod() {
        const svg = this.unit.svg();
        if (!svg) return;

        let heatFireModifier = 0;
        svg.querySelectorAll('.heatEffect.hot:not(.surpassed)').forEach(effectEl => {
            const fire = parseInt(effectEl.getAttribute('h-fire') as string);
            if (fire && fire > heatFireModifier) {
                heatFireModifier = fire;
            }
        });
        const critSlots = this.unit.getCritSlots();
        // Determine which equipment is unusable and hit modifiers
        const cockpitLoc = critSlots.find(slot => slot.name === "Cockpit")?.loc ?? 'HD';
        const destroyedSensorsCountInHD = critSlots.filter(slot => slot.loc === 'HD' && slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        const destroyedSensorsCount = critSlots.filter(slot => slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        const destroyedTargetingComputers = critSlots.filter(slot => slot.name && slot.name.includes('Targeting Computer') && slot.destroyed).length;


        const internalLocations = new Set<string>(this.unit.locations?.internal.keys() || []);
            
        let destroyedLegsCount = 0;
        let destroyedHipsCount = 0;
        let destroyedLegActuatorsCount = 0;
        let destroyedFootsCount = 0;
        
        const checkLeg = (loc: string) => {
            if (this.unit.isInternalLocDestroyed(loc)) {
                destroyedLegsCount++;
            } else {
                destroyedHipsCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name === 'Hip' && slot.destroyed).length;
                destroyedLegActuatorsCount += critSlots.filter(slot => slot.loc === loc && slot.name && (slot.name === 'Upper Leg' || slot.name === 'Lower Leg' || slot.name === 'Foot') && slot.destroyed).length;
                destroyedFootsCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name === 'Foot' && slot.destroyed).length;
            }
        };
        if (internalLocations.has('LL') && internalLocations.has('RL')) {
            // Biped and Tripods
            checkLeg('LL');
            checkLeg('RL');
        } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
            // Quadrupeds
            checkLeg('RLL');
            checkLeg('FLL');
            checkLeg('RRL');
            checkLeg('FRL');
        } else {
            //TODO: handle other cases (Tanks and stuffs)
            return;
        }

        const getArmsModifiers = (loc: string) => {
            if (!this.unit.locations?.armor.has(loc)) {
                return null;
            }
            const destroyedShoulder = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Shoulder') && slot.destroyed);
            const destroyedHand = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Hand') && slot.destroyed);    
            const destroyedUpperArms = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Upper Arm') && slot.destroyed);
            const destroyedLowerArms = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Lower Arm') && slot.destroyed);
            
            return {
                pushMod: destroyedShoulder ? 2 : 0,
                punchMod: (destroyedHand ? 1 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0),
                fireMod: destroyedShoulder ? 4 : (destroyedUpperArms ? 1 : 0) + (destroyedLowerArms ? 1 : 0),
                clubMod: (destroyedHand ? 2 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0),
            };
        };
        const locationsHitModifiers: { [key: string]: { punchMod: number; fireMod: number; pushMod: number; clubMod: number; } | null } = {
            'LA': getArmsModifiers('LA'),
            'RA': getArmsModifiers('RA'),
        };
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
            if (cockpitLoc !== 'HD' && destroyedSensorsCountInHD >= 2) {
                additionalModifiers += 4;
            }
            if (entry.physical) {
                if (entry.name == 'charge') {
                    const hasSpikes = critSlots.some(slot => slot.name && slot.name.includes('Spikes'));
                    if (hasSpikes) {
                        const workingSpikes = critSlots.filter(slot => slot.name && slot.name.includes('Spikes') && !slot.destroyed).length;
                        const damageText = entry.el.querySelector(`:scope > .damage > text`);
                        if (damageText) {
                            let originalText = damageText.textContent || '';
                            originalText = originalText.replace(/\+\d+$/, '');
                            damageText.textContent = ``;
                            damageText.textContent = `${originalText}+${workingSpikes * 2}`;
                        }
                    }
                } else if (entry.name == 'punch') {
                    entry.locations.forEach(loc => {
                        if (locationsHitModifiers[loc]) {
                            additionalModifiers += locationsHitModifiers[loc].punchMod;
                        }
                    });
                } else if (entry.name == 'push') {
                    if (locationsHitModifiers['LA']) {
                        additionalModifiers += locationsHitModifiers['LA'].pushMod;
                    }
                    if (locationsHitModifiers['RA']) {
                        additionalModifiers += locationsHitModifiers['RA'].pushMod;
                    }
                } else if (entry.name == 'kick') {
                    additionalModifiers += destroyedFootsCount + (destroyedLegActuatorsCount * 2);
                }
            } else {
                if (entry.equipment?.flags.has('F_CLUB')) {
                    entry.locations.forEach(loc => {
                        if (locationsHitModifiers[loc]) {
                            additionalModifiers += locationsHitModifiers[loc].clubMod;
                        }
                    });
                } else {
                    additionalModifiers += heatFireModifier;
                    if (cockpitLoc === 'HD' && destroyedSensorsCount > 0) {
                        additionalModifiers += (destroyedSensorsCount * 2);
                    } else 
                    if (cockpitLoc !== 'HD' && destroyedSensorsCountInHD < 2 && destroyedSensorsCount >= 1) {
                        additionalModifiers += destroyedSensorsCount * 2;
                    }
                    entry.locations.forEach(loc => {
                        if (locationsHitModifiers[loc]) {
                            additionalModifiers += locationsHitModifiers[loc].fireMod;
                        }
                    });
                }
                if (destroyedTargetingComputers > 0) {
                    if (entry.equipment) {
                        const equipment = (entry.parent && entry.parent.equipment) ? entry.parent.equipment : entry.equipment;
                        if ((equipment.flags.has('F_ENERGY') || equipment.flags.has('F_BALLISTIC'))
                            && equipment.flags.has('F_DIRECT_FIRE')) {
                            additionalModifiers += 1;
                        }
                    }
                }
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
            }
            if (entry.hitMod !== 'Vs') {
                const hitModifier = this.calculateHitModifiers(this.unit, entry, additionalModifiers);
                if (hitModifier !== null) {
                    const hitModRect = entry.el.querySelector(`:scope > .hitMod-rect`);
                    const hitModText = entry.el.querySelector(`:scope > .hitMod-text`);
                    if (hitModRect && hitModText) {
                        const weakenedHitMod = (hitModifier > parseInt(entry.hitMod || '0'));
                        if (hitModifier !== 0 || entry.hitMod === '+0' || weakenedHitMod) {
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

    protected override evaluateDestroyed(): void {
        const svg = this.unit.svg();
        if (!svg) return;

        const internalLocs = new Set<string>(this.unit.locations?.internal.keys() || []);
        const locationsToDestroy = new Set<String>();
        for (const loc of internalLocs) {
            if (this.unit.isInternalLocDestroyed(loc)) {
                locationsToDestroy.add(loc);
                if (linkedLocs[loc]) {
                    linkedLocs[loc].forEach(linkedLoc => {
                        if (internalLocs.has(linkedLoc)) {
                            locationsToDestroy.add(linkedLoc);
                        }
                    });
                }
            }
        }
        const critSlots = this.unit.getCritSlotsAsMatrix();
        for (const loc of internalLocs) {
            const locDestroyed = locationsToDestroy.has(loc);
            const critSlotsInLoc = critSlots[loc] || [];
            if (critSlotsInLoc.length === 0) continue;
            for (const critSlot of critSlotsInLoc) {
                if (!critSlot) continue;
                let armored = false;
                if (critSlot.el) {
                    armored = critSlot.el.getAttribute('armored') == '1';
                }
                const maxHits = armored ? 2 : 1;
                const destroyed = (locDestroyed || (critSlot.hits ?? 0) >= maxHits);
                if (!destroyed != !critSlot.destroyed) {
                    critSlot.destroyed = destroyed;
                    this.unit.setCritSlot(critSlot);
                }
            }
        }

        // Check if the unit is destroyed based on its critical slots
        // Check critSlots with uid="Engine" are damaged
        const engineHitElems = Array.from(svg.querySelectorAll('[id^="engine_hit_"]'));
        const engineSlotsRequired = engineHitElems.length;
        const allEngineSlots = this.unit.getCritSlots().filter(slot => slot.name === "Engine" && slot.destroyed);
        const engineBlowed = allEngineSlots.length >= engineSlotsRequired;

        // Check critSlots with uid="Cockpit" are damaged
        const cockpitDestroyed = this.unit.getCritSlots().some(slot => slot.name === "Cockpit" && slot.destroyed);

        const destroyed = engineBlowed || cockpitDestroyed;
        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    protected override updateArmorDisplay(initial: boolean = false) {
        const svg = this.unit.svg();
        if (!svg) return;

        // Shields
        const shieldPips = svg.querySelectorAll(`.shield.pip`);
        if (shieldPips.length > 0) {
            const locations = this.unit.getLocations();
            const shieldRemaining: Record<string, number> = {};
            shieldPips.forEach(pip => {
                const linkedLoc = pip.getAttribute('loc');
                const loc = pip.parentElement?.getAttribute('loc');
                if (!loc || !linkedLoc) return;
                if (shieldRemaining[loc] === undefined) {
                    shieldRemaining[loc] = locations[loc]?.armor || 0;
                }
                if (shieldRemaining[loc] > 0) {
                    if (!pip.classList.contains('damaged')) {
                        pip.classList.add('damaged');
                        if (!initial) {
                            pip.classList.add('fresh');
                        }
                    } else if (pip.classList.contains('fresh')) {
                        pip.classList.remove('fresh');
                    }
                    shieldRemaining[loc]--;
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

            
            this.unit.locations?.armor.forEach(entry => {
                const el = svg.querySelector(`.shield:not(.pip)[loc="${entry.loc}"]`);
                if (!el) return;
                const shieldExhausted = this.unit.isArmorLocDestroyed('DC'+entry.loc) || this.unit.isArmorLocDestroyed('DA'+entry.loc);
                if (shieldExhausted || this.unit.isInternalLocDestroyed(entry.loc)) {
                    el.classList.add('damaged');
                } else {
                    el.classList.remove('damaged');
                }
            });
        }

        // Normal armor and structure handling
        super.updateArmorDisplay(initial);

    }
}