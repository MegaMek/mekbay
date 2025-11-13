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

import { computed } from "@angular/core";
import { linkedLocs, uidTranslations } from "../components/svg-viewer/common";
import { ForceUnit } from "../models/force-unit.model";
import { CriticalSlot, MountedEquipment } from "../models/force-serialization";
import { UnitSvgService } from "./unit-svg.service";

/*
 * Author: Drake
 */
type ArmLocation = "LA" | "RA";

export class UnitSvgMekService extends UnitSvgService {
    // Mek-specific SVG handling logic goes here

    protected override updateAllDisplays() {
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
        this.updateHeatDisplay(heat);
        this.updateCritSlotDisplay(critSlots);
        this.updateHeatSinkPips();
        this.updateInventory();
        this.updateHitMod();
        this.updateTurnState();
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
            const modularArmor = el.getAttribute('modularArmor') === '1';
            const isAmmo = el.classList.contains('ammoSlot');

            if (isAmmo) {
                const totalAmmo = criticalSlot?.totalAmmo || parseInt(el.getAttribute('totalAmmo') || '0');
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
                        (ammoProfile.get(key) ?? 0) + (criticalSlot.destroyed ? 0 : remainingAmmo)
                    );
                }
            }

            if (!!criticalSlot.destroyed) {
                el.classList.add('damaged');
                el.classList.remove('willDamage');
            } else {
                el.classList.remove('damaged');
                el.classList.toggle('willDamage', !!criticalSlot.destroying);
            }

            if (criticalSlot.armored && !criticalSlot.destroyed) {
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

    systemsStatus = computed(() => {
        const critSlots = this.unit.getCritSlots();        
        const hasMASC = critSlots.some(slot => slot.name && slot.name.includes('MASC'));
        const destroyedMASC = critSlots.some(slot => slot.name && slot.name.includes('MASC') && slot.destroyed);
        const hasSupercharger = critSlots.some(slot => slot.name && slot.name.includes('Supercharger'));
        const destroyedSupercharger = critSlots.some(slot => slot.name && slot.name.includes('Supercharger') && slot.destroyed);
        const jumpJetsCount = critSlots.filter(slot => slot.name && (slot.name.includes('Jump Jet') || slot.name.includes('JumpJet'))).length;
        const destroyedJumpJetsCount = critSlots.filter(slot => slot.name && (slot.name.includes('Jump Jet') || slot.name.includes('JumpJet')) && slot.destroyed).length;
        const UMUCount = critSlots.filter(slot => slot.name && (slot.name.includes('UMU'))).length;
        const destroyedUMUCount = critSlots.filter(slot => slot.name && (slot.name.includes('UMU')) && slot.destroyed).length;
        const hasPartialWings = critSlots.some(slot => slot.name && slot.name.includes('PartialWing'));
        const destroyedPartialWings = hasPartialWings ? critSlots.filter(slot => slot.name && slot.name.includes('PartialWing') && slot.destroyed).length : 0;
        const hasTripleStrengthMyomer = critSlots.some(slot => slot.name && slot.name.includes('Triple Strength Myomer'));
        const cockpitLoc = critSlots.find(slot => slot.name === "Cockpit")?.loc ?? 'HD';
        const destroyedSensorsCountInHD = critSlots.filter(slot => slot.loc === 'HD' && slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        const destroyedSensorsCount = critSlots.filter(slot => slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        const destroyedTargetingComputers = critSlots.filter(slot => slot.name && slot.name.includes('Targeting Computer') && slot.destroyed).length;

        const internalLocations = new Set<string>(this.unit.locations?.internal.keys() || []);
        
        let destroyedLegsCount = 0;
        let destroyedHipsCount = 0;
        let destroyedLegActuatorsCount = 0;
        let destroyedFeetCount = 0;
        let destroyedLegAES = false;

        const checkLeg = (loc: string) => {
            if (!destroyedLegAES) {
                destroyedLegAES = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('AES') && slot.destroyed);
            }
            if (this.unit.isInternalLocDestroyed(loc)) {
                destroyedLegsCount++;
            } else {
                destroyedHipsCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name === 'Hip' && slot.destroyed).length;
                destroyedLegActuatorsCount += critSlots.filter(slot => slot.loc === loc && slot.name && (slot.name === 'Upper Leg' || slot.name === 'Lower Leg') && slot.destroyed).length;
                destroyedFeetCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name === 'Foot' && slot.destroyed).length;
            }
        };

        if (internalLocations.has('LL') && internalLocations.has('RL')) {
            // Biped and Tripods
            checkLeg('LL');
            checkLeg('RL');
            if (internalLocations.has('CL')) { // Tripods
                checkLeg('CL');
            }
        } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
            // Quadrupeds
            checkLeg('RLL');
            checkLeg('FLL');
            checkLeg('RRL');
            checkLeg('FRL');
        }
      
        let destroyedArmActuatorsCount = { 'LA': 0, 'RA': 0 };

        // Capabilities
        const getArmsModifiers = (loc: string) => {
            const destroyedAES = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('AES') && slot.destroyed);
            if (!this.unit.locations?.armor.has(loc)) {
                return null;
            }

            const destroyedShoulder = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Shoulder') && slot.destroyed);
            const destroyedHand = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Hand') && slot.destroyed);    
            const destroyedUpperArmsCount = critSlots.filter(slot => slot.loc == loc && slot.name && slot.name.includes('Upper Arm') && slot.destroyed).length;
            const destroyedLowerArmsCount = critSlots.filter(slot => slot.loc == loc && slot.name && slot.name.includes('Lower Arm') && slot.destroyed).length;
            const destroyedUpperArms = destroyedUpperArmsCount > 0;
            const destroyedLowerArms = destroyedLowerArmsCount > 0;
            destroyedArmActuatorsCount[loc as ArmLocation] += destroyedUpperArmsCount + destroyedLowerArmsCount;

            return {
                canPunch: !destroyedShoulder,
                canPhysWeapon: !destroyedShoulder && !destroyedHand,
                pushMod: destroyedShoulder ? 2 : 0,
                punchMod: (destroyedHand ? 1 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0),
                fireMod: destroyedShoulder ? 4 : (destroyedUpperArms ? 1 : 0) + (destroyedLowerArms ? 1 : 0),
                physWeaponMod: (destroyedHand ? 2 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0),
                singleArmMod: destroyedAES ? 1 : 0,
            };
        };
        const locationModifiers: { [key: string]: { canPunch: boolean; canPhysWeapon: boolean; pushMod: number; punchMod: number; fireMod: number; physWeaponMod: number; singleArmMod: number; } | null } = {
            'LA': getArmsModifiers('LA'),
            'RA': getArmsModifiers('RA'),
        };

        return {
            hasMASC,
            destroyedMASC,
            hasSupercharger,
            destroyedSupercharger,
            jumpJetsCount,
            destroyedJumpJetsCount,
            UMUCount,
            destroyedUMUCount,
            hasPartialWings,
            destroyedPartialWings,
            internalLocations,
            hasTripleStrengthMyomer,
            tripleStrengthMyomerMoveBonusActive: (this.unit.getHeat().current >= 9 && hasTripleStrengthMyomer),
            cockpitLoc,
            destroyedSensorsCountInHD,
            destroyedSensorsCount,
            destroyedTargetingComputers,
            destroyedLegAES,
            destroyedLegsCount,
            destroyedHipsCount,
            destroyedLegActuatorsCount,
            destroyedFeetCount,
            destroyedArmActuatorsCount,
            locationModifiers: locationModifiers,
        };
    });

    unitState = computed(() => {
        const svg = this.unit.svg();
        if (!svg) return;
        const unit = this.unit.getUnit();
        if (!unit) return;
        let walkValue = unit.walk;
        let jumpValue = unit.jump;
        let UMUValue = unit.umu;
        let heatMoveModifier = 0;
        let heatFireModifier = 0;
        let moveImpaired = false;
        
        const systemsStatus = this.systemsStatus();
        const internalLocations = new Set<string>(this.unit.locations?.internal.keys() || []);
        
        // Walk MP and crits computation
        if (internalLocations.has('LL') && internalLocations.has('RL')) {
            for (let i = 0; i < systemsStatus.destroyedHipsCount; i++) {
                // Apply hip damage effects
                walkValue = Math.ceil(walkValue * 0.5);
                moveImpaired = true;
            }
            if (systemsStatus.destroyedLegsCount == 1) {
                walkValue = 1;
                moveImpaired = true;
            }
        } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
            // Quadrupeds
            if (systemsStatus.destroyedHipsCount != 0) {
                moveImpaired = true;
                walkValue -= systemsStatus.destroyedHipsCount;
            }
            if (systemsStatus.destroyedLegsCount == 1) {
                walkValue = walkValue - 1;
                moveImpaired = true;
            }
        }
        if (systemsStatus.destroyedLegsCount >= 2) {
            walkValue = 0;
            moveImpaired = true;
        }
        walkValue -= systemsStatus.destroyedLegActuatorsCount;
        walkValue -= systemsStatus.destroyedFeetCount;
        if (systemsStatus.destroyedLegActuatorsCount != 0 || systemsStatus.destroyedFeetCount != 0) {
            moveImpaired = true;
        }
        
        svg.querySelectorAll('.heatEffect.hot:not(.surpassed)').forEach(effectEl => {
            const move = parseInt(effectEl.getAttribute('h-move') as string);
            if (move && move < heatMoveModifier) {
                heatMoveModifier = move;
                moveImpaired = true;
            }
            const fire = parseInt(effectEl.getAttribute('h-fire') as string);
            if (fire && fire > heatFireModifier) {
                heatFireModifier = fire;
            }
        });

        walkValue += heatMoveModifier;
        if (heatMoveModifier != 0) {
            moveImpaired = true;
        }
        walkValue = Math.max(0, walkValue);
        let maxWalkValue = walkValue;
        if (systemsStatus.tripleStrengthMyomerMoveBonusActive) {
            // we add it after apply damaged/undamaged
            walkValue += 2;
            maxWalkValue += 2;
        } else if (systemsStatus.hasTripleStrengthMyomer) {
            maxWalkValue += 1 - heatMoveModifier; // We add back the heatMoveModifier this way we simulate heat at 9+
        }
        walkValue = Math.max(0, walkValue);

        // Run MP
        const hasWorkingMASC = systemsStatus.hasMASC && !systemsStatus.destroyedMASC;
        const hasWorkingSupercharger = systemsStatus.hasSupercharger && !systemsStatus.destroyedSupercharger;
        const armorModifierOnRun = (this.unit.getUnit().armorType === 'Hardened') ? -1 : 0;
        let runValue;
        let maxRunValue;
        if (walkValue === 0) {
            runValue = 0;
            maxRunValue = 0;
        } else {
            runValue = Math.round(walkValue * 1.5) + armorModifierOnRun;
            let runValueCoeff = 1.5;
            if (hasWorkingMASC && hasWorkingSupercharger) {
                runValueCoeff = 2.5;
            } else if ((hasWorkingMASC) || (hasWorkingSupercharger)) {
                runValueCoeff = 2;
            }
            maxRunValue = Math.round(walkValue * runValueCoeff) + armorModifierOnRun;
            if (systemsStatus.hasTripleStrengthMyomer && !systemsStatus.tripleStrengthMyomerMoveBonusActive) {
                // we recalculate it after apply damaged/undamaged
                maxRunValue = Math.round((walkValue + (1 - heatMoveModifier)) * runValueCoeff) + armorModifierOnRun;
            }
        }

        // Jump MP
        if (systemsStatus.destroyedJumpJetsCount === systemsStatus.jumpJetsCount) {
            jumpValue = 0;
        } else {
            jumpValue = Math.max(0, jumpValue - systemsStatus.destroyedJumpJetsCount);
            if (systemsStatus.hasPartialWings) {
                // I calculate how much JJ bonus I get from the partial wing in Standard conditions
                const maxWingBonus = this.unit.getUnit().tons <= 55 ? 2 : 1;
                // I remove 1 JumpMP for each partial wing crit hit up to the maximum bonus given by the wings
                jumpValue -= Math.min(systemsStatus.destroyedPartialWings, maxWingBonus);
                const partialWingHeatBonus = Math.max(0, 3 - systemsStatus.destroyedPartialWings);
                const partialWingsHeatBonusEl = svg.getElementById('partialWingBonus');
                if (partialWingsHeatBonusEl) {
                    partialWingsHeatBonusEl.textContent = `(Partial Wing +${partialWingHeatBonus})`;
                }
            }
        }

        if (systemsStatus.destroyedUMUCount === systemsStatus.UMUCount) {
            UMUValue = 0;
        } else {
            UMUValue = Math.max(0, UMUValue - systemsStatus.destroyedUMUCount);
        }

        const destroyedLA = this.unit.isInternalLocDestroyed('LA');
        const destroyedRA = this.unit.isInternalLocDestroyed('RA');

        let canFire = true;
        if (systemsStatus.cockpitLoc === 'HD' && systemsStatus.destroyedSensorsCount >= 2) {
            canFire = false;
        } else if (systemsStatus.destroyedSensorsCount >= 3) {
            canFire = false;
        }
        let globalFireMod = heatFireModifier;
        if (systemsStatus.cockpitLoc === 'HD' && systemsStatus.destroyedSensorsCount > 0) {
            globalFireMod += (systemsStatus.destroyedSensorsCount * 2);
        } else
        if (systemsStatus.cockpitLoc !== 'HD' && systemsStatus.destroyedSensorsCountInHD < 2 && systemsStatus.destroyedSensorsCount >= 1) {
            globalFireMod += systemsStatus.destroyedSensorsCount * 2;
        }

        let globalMod = 0;
        if (systemsStatus.cockpitLoc !== 'HD' && systemsStatus.destroyedSensorsCountInHD >= 2) {
            globalMod += 4;
        }
        const locationModifiers = systemsStatus.locationModifiers;
        return {
            moveImpaired: moveImpaired,
            walk: walkValue,
            maxWalk: maxWalkValue,
            run: runValue,
            maxRun: maxRunValue,
            jumpImpaired: (jumpValue < unit.jump),
            jump: jumpValue,
            UMUImpaired: (UMUValue < unit.umu),
            UMU: UMUValue,
            canKick: systemsStatus.destroyedLegsCount === 0 && systemsStatus.destroyedHipsCount === 0,
            kickMod: (systemsStatus.destroyedLegActuatorsCount * 2) + (systemsStatus.destroyedFeetCount) + (systemsStatus.destroyedLegAES ? 1 : 0),
            canPunch: {
                'LA': (locationModifiers['LA']?.canPunch && !destroyedLA) || false,
                'RA': (locationModifiers['RA']?.canPunch && !destroyedRA) || false,
            },
            punchMod: {
                'LA': locationModifiers['LA']?.punchMod || 0,
                'RA': locationModifiers['RA']?.punchMod || 0,
            },
            canPhysWeapon: {
                'LA': (locationModifiers['LA']?.canPhysWeapon && !destroyedLA) || false,
                'RA': (locationModifiers['RA']?.canPhysWeapon && !destroyedRA) || false,
            },
            physWeaponMod: {
                'LA': locationModifiers['LA']?.physWeaponMod || 0,
                'RA': locationModifiers['RA']?.physWeaponMod || 0,
            },
            canPush: !destroyedLA && !destroyedRA,
            canClub: (locationModifiers['LA']?.canPhysWeapon && !destroyedLA) && (locationModifiers['RA']?.canPhysWeapon && !destroyedRA),
            clubMod: (locationModifiers['LA']?.physWeaponMod || 0) + (locationModifiers['RA']?.physWeaponMod || 0),
            canFire: canFire,
            globalFireMod: globalFireMod,
            fireMod: {
                'LA': locationModifiers['LA']?.fireMod || 0,
                'RA': locationModifiers['RA']?.fireMod || 0,
            },
            pushMod: (locationModifiers['LA']?.pushMod || 0) + (locationModifiers['RA']?.pushMod || 0),
            globalMod: globalMod,
            singleArmMod: {
                'LA': locationModifiers['LA']?.singleArmMod || 0,
                'RA': locationModifiers['RA']?.singleArmMod || 0,
            }
        };
    });
    
    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        const systemStatus = this.systemsStatus();
        const unitState = this.unitState();
        if (!unitState) return;
        const mpWalkEl = svg.querySelector('#mpWalk');
        if (mpWalkEl) {
            const mpRunEl = svg.querySelector('#mpRun');
            const mpJumpEl = svg.querySelector('#mpJump');
            const mpAltMode = svg.querySelector('#mp_2');
            mpWalkEl.classList.toggle('damaged', unitState.moveImpaired);
            if (unitState.walk != unitState.maxWalk) {
                mpWalkEl.textContent = `${unitState.walk.toString()} [${unitState.maxWalk.toString()}]`;
            } else {
                mpWalkEl.textContent = unitState.walk.toString();
            }
            if (mpRunEl) {
                if (unitState.run != unitState.maxRun) {
                    mpRunEl.textContent = `${unitState.run.toString()} [${unitState.maxRun.toString()}]`;
                } else {
                    mpRunEl.textContent = unitState.run.toString();
                }
                mpRunEl.classList.toggle('damaged', unitState.moveImpaired);
            }
            const elForAltMode = mpJumpEl || mpAltMode;
            if (elForAltMode) {
                if (unitState.UMU > 0) {
                    elForAltMode.textContent = unitState.UMU.toString();
                } else {
                    elForAltMode.textContent = unitState.jump.toString();
                }
                elForAltMode.classList.toggle('damaged', unitState.jumpImpaired || unitState.UMUImpaired);
            }
        }
        this.unit.getInventory().forEach(entry => {
            if (!entry.el) return;
            if (!entry.locations) return;
            let isDamaged = false;
            let isDisabled = false;
            let hitMod = 0;
            if (unitState.globalMod != 0) {
                hitMod += unitState.globalMod;
            }
            if (entry.locations.size === 1) {
                const singleLoc = Array.from(entry.locations)[0];
                if (singleLoc in unitState.singleArmMod) {
                    hitMod += unitState.singleArmMod[singleLoc as ArmLocation];
                }
            }
            if (entry.critSlots && entry.critSlots.filter(slot => slot.destroyed).length > 0) {
                isDamaged = true;
            }
            if (entry.physical) {
                switch (entry.name) {
                    case 'charge':
                        const critSlots = this.unit.getCritSlots();
                        const hasSpikes = critSlots.some(slot => slot.name && slot.name.includes('Spikes'));
                        if (hasSpikes) {
                            const spikesCount = critSlots.filter(slot => slot.name && slot.name.includes('Spikes')).length;
                            const workingSpikesCount = critSlots.filter(slot => slot.name && slot.name.includes('Spikes') && !slot.destroyed).length;
                            const chargeDamageEl = entry.el.querySelector(`:scope > .damage > text`);
                            if (chargeDamageEl) {
                                let originalText = chargeDamageEl.textContent || '';
                                originalText = originalText.replace(/\+\d+$/, ''); // Remove any previous spike bonus, format is 10/hex+12
                                if (originalText) {
                                    let spikesBonusDamage = workingSpikesCount * 2;
                                    chargeDamageEl.textContent = `${originalText}+${spikesBonusDamage}`;
                                    chargeDamageEl.classList.toggle('damaged', spikesCount > workingSpikesCount);
                                }
                            }
                        }
                        break;
                    case 'punch':
                        const loc = Array.from(entry.locations)[0]?.toString() as ArmLocation; // We assume punch is only one location
                        if (loc in unitState.canPunch && !unitState.canPunch[loc]) {
                            isDisabled = true;
                        }
                        if (loc in unitState.punchMod) {
                            hitMod += unitState.punchMod[loc];
                        }
                        const punchDamageEl = entry.el.querySelector(`:scope > .damage > text`);
                        if (punchDamageEl) {
                            let originalText = punchDamageEl.getAttribute('originalText');
                            if (originalText === undefined || originalText === null) {
                                originalText = punchDamageEl.textContent || '';
                                punchDamageEl.setAttribute('originalText', originalText);
                            }
                            if (originalText) {
                                let baseDamage = parseInt(originalText);
                                let damage = baseDamage;
                                for (let i = 0; i < systemStatus.destroyedArmActuatorsCount[loc]; i++) {
                                    damage = Math.floor(damage * 0.5);
                                    if (damage < 1) damage = 1;
                                }
                                if (systemStatus.tripleStrengthMyomerMoveBonusActive) {
                                    damage *= 2;
                                }
                                punchDamageEl.textContent = `${damage}`;
                                punchDamageEl.classList.toggle('damaged', damage < baseDamage);
                            }

                        }
                        break;
                    case 'club':
                        if (!unitState.canClub) {
                            isDisabled = true;
                        }
                        hitMod += unitState.clubMod;
                        const clubDamageEl = entry.el.querySelector(`:scope > .damage > text`);
                        if (clubDamageEl) {
                            let originalText = clubDamageEl.getAttribute('originalText');
                            if (originalText === undefined || originalText === null) {
                                originalText = clubDamageEl.textContent || '';
                                clubDamageEl.setAttribute('originalText', originalText);
                            }
                            if (originalText) {
                                let baseDamage = parseInt(originalText);
                                let damage = baseDamage;
                                if (systemStatus.tripleStrengthMyomerMoveBonusActive) {
                                    damage *= 2;
                                }
                                clubDamageEl.textContent = `${damage}`;
                                clubDamageEl.classList.toggle('damaged', damage < baseDamage);
                            }
                        }
                        break;
                    case 'push':
                        if (!unitState.canPush) {
                            isDisabled = true;
                        }
                        hitMod += unitState.pushMod || 0;
                        break;
                    case 'kick':
                        if (!unitState.canKick) {
                            isDisabled = true;
                        }
                        hitMod += unitState.kickMod;
                        const kickDamageEl = entry.el.querySelector(`:scope > .damage > text`);
                        if (kickDamageEl) {
                            let originalText = kickDamageEl.getAttribute('originalText');
                            if (originalText === undefined || originalText === null) {
                                originalText = kickDamageEl.textContent || '';
                                kickDamageEl.setAttribute('originalText', originalText);
                            }
                            if (originalText) {
                                let baseDamage = parseInt(originalText);
                                let damage = baseDamage;
                                for (let i = 0; i < systemStatus.destroyedLegActuatorsCount; i++) {
                                    damage = Math.floor(damage * 0.5);
                                    if (damage < 1) damage = 1;
                                }
                                if (systemStatus.tripleStrengthMyomerMoveBonusActive) {
                                    damage *= 2;
                                }
                                kickDamageEl.textContent = `${damage}`;
                                kickDamageEl.classList.toggle('damaged', damage < baseDamage);
                            }
                        }
                        break;
                }
            } else {
                // Physical weapons are marked as F_CLUB and they have physical=false. 
                // TODO: make them physical=true
                if (entry.equipment?.flags.has('F_CLUB')) {
                    entry.locations.forEach(loc => {
                        if ((loc in unitState.canPhysWeapon) && !unitState.canPhysWeapon[loc as "LA" | "RA"]) {
                            isDisabled = true;
                        }
                        if ((loc in unitState.physWeaponMod)) {
                            hitMod += unitState.physWeaponMod[loc as "LA" | "RA"];
                        }
                    });
                } else {
                    if (!unitState.canFire) {
                        isDisabled = true;
                    }
                    if (unitState.globalFireMod) {
                        hitMod += unitState.globalFireMod;
                    }
                    entry.locations.forEach(loc => {
                        if (loc in unitState.fireMod) {
                            hitMod += unitState.fireMod[loc as "LA" | "RA"];
                        }
                    });
                    if (systemStatus.destroyedTargetingComputers > 0) {
                        if (entry.equipment) {
                            const equipment = (entry.parent && entry.parent.equipment) ? entry.parent.equipment : entry.equipment;
                            if ((equipment.flags.has('F_ENERGY') || equipment.flags.has('F_BALLISTIC'))
                                && equipment.flags.has('F_DIRECT_FIRE')) {
                                hitMod += 1;
                            }
                        }
                    }
                    if (entry.linkedWith) {
                        entry.linkedWith.forEach(linkedEntry => {
                            if (linkedEntry.equipment) {
                                if (linkedEntry.equipment.flags.has('F_ARTEMIS_V')) {
                                    // If is destroyed, we increase hitmod by +1
                                    if (linkedEntry.destroyed) {
                                        hitMod += 1;
                                    }
                                }
                            }
                        });
                    }
                }
            }
            entry.hitModVariation = hitMod;
            entry.destroyed = isDamaged;
            if (entry.el) {
                entry.el.classList.toggle('disabledInventory', isDisabled);
                entry.el.classList.toggle('damagedInventory', isDamaged);
            }
        });
    }

    protected override updateHitMod() {
        const svg = this.unit.svg();
        if (!svg) return;
        this.unit.getInventory().forEach(entry => {
            if (!entry.el) return;
            const hitModifier = this.calculateHitModifiers(this.unit, entry, entry.hitModVariation || 0);
            if (entry.baseHitMod !== 'Vs' && hitModifier !== null) {
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
                const maxHits = critSlot.armored ? 2 : 1;
                const destroyed = (locDestroyed || (critSlot.hits ?? 0) >= maxHits);
                if (!!destroyed !== !!critSlot.destroying) {
                    critSlot.destroying = destroyed ? Date.now() : undefined;
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

        // if we have SI pips, this is a LAM, we fill them with the CT
        const lamStructuralIntegrityPips = svg.querySelectorAll(`.structure.pip[loc="SI"]`);
        if (lamStructuralIntegrityPips.length > 0) {
            const locations = this.unit.getLocations();
            let structuralIntegrityDamageRemaining = locations['CT']?.internal || 0;
            lamStructuralIntegrityPips.forEach(pip => {
                if (structuralIntegrityDamageRemaining > 0) {
                    if (!pip.classList.contains('damaged')) {
                        pip.classList.add('damaged');
                        if (!initial) {
                            pip.classList.add('fresh');
                        }
                    } else if (pip.classList.contains('fresh')) {
                        pip.classList.remove('fresh');
                    }
                    structuralIntegrityDamageRemaining--;
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
        }



    }
}