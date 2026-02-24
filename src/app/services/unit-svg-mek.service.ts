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

import { uidTranslations } from "../models/common.model";
import { CriticalSlot, MountedEquipment } from "../models/force-serialization";
import { UnitSvgService } from "./unit-svg.service";
import { AmmoEquipment } from "../models/equipment.model";
import { MekRules } from "../models/rules/mek-rules";
import { resolveHitModifier } from "../models/rules/hit-modifier.util";

/*
 * Author: Drake
 */
export class UnitSvgMekService extends UnitSvgService {
    // Mek-specific SVG handling logic goes here
    private get mekRules(): MekRules { return this.unit.rules as MekRules; }

    protected override updateAllDisplays() {
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
        this.updateHeatDisplay(heat);
        this.updateCritSlotDisplay(critSlots);
        this.updateHeatSinkPips();
        this.updateInventory();
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
                    if (criticalSlot.eq && criticalSlot.eq instanceof AmmoEquipment) {
                        let shortName = criticalSlot.eq.shortName;
                        if (shortName.endsWith(' Ammo')) {
                            shortName = shortName.slice(0, -5);
                        }
                        text = `Ammo (${shortName})`;
                        isCustomAmmoLoadout = !!criticalSlot.originalName && (criticalSlot.originalName !== criticalSlot.name);
                        el.classList.toggle('customAmmoLoadout', isCustomAmmoLoadout);
                    } else {
                        text = (textNode.textContent || '').replace(/\s\d+$/, '');
                    }
                    textNode.textContent = `${isCustomAmmoLoadout ? '*' : ''}${text} ${remainingAmmo}`;

                    // Adjust text length if too wide
                    const maxWidth = 86;
                    const svgText = textNode as SVGTextContentElement;
                    // First we remove any existing constraints to get the natural length...
                    svgText.removeAttribute('textLength');
                    svgText.removeAttribute('lengthAdjust');
                    const currentLength = svgText.getComputedTextLength();
                    if (currentLength > maxWidth) {
                        // ...and we add it back if is too long
                        svgText.setAttribute('textLength', maxWidth.toString());
                        svgText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
                    }

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

    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        const movement = this.mekRules.movementState();
        const physical = this.mekRules.physicalCombat();
        if (!movement || !physical) return;

        // Partial wing heat bonus display
        if (movement.partialWingHeatBonus !== null) {
            const el = svg.getElementById('partialWingBonus');
            if (el) el.textContent = `(Partial Wing +${movement.partialWingHeatBonus})`;
        }

        // Movement point display
        const mpWalkEl = svg.querySelector('#mpWalk');
        if (mpWalkEl) {
            const mpRunEl = svg.querySelector('#mpRun');
            const mpJumpEl = svg.querySelector('#mpJump');
            const mpAltMode = svg.querySelector('#mp_2');
            mpWalkEl.classList.toggle('damaged', movement.moveImpaired);
            mpWalkEl.textContent = (movement.walk !== movement.maxWalk)
                ? `${movement.walk} [${movement.maxWalk}]` : movement.walk.toString();
            if (mpRunEl) {
                mpRunEl.textContent = (movement.run !== movement.maxRun)
                    ? `${movement.run} [${movement.maxRun}]` : movement.run.toString();
                mpRunEl.classList.toggle('damaged', movement.moveImpaired);
            }
            const elForAltMode = mpJumpEl || mpAltMode;
            if (elForAltMode) {
                elForAltMode.textContent = (movement.UMU > 0) ? movement.UMU.toString() : movement.jump.toString();
                elForAltMode.classList.toggle('damaged', movement.jumpImpaired || movement.UMUImpaired);
            }
        }

        // Inventory entries — state from rules, rendering here
        const entryStates = this.mekRules.computeAllEntryStates();
        this.unit.getInventory().forEach(entry => {
            if (!entry.el || !entry.locations) return;

            const state = entryStates.get(entry);
            if (!state) return;

            // Physical / melee damage display (reads base values from DOM, computes via rules)
            if (entry.physical) {
                switch (entry.name) {
                    case 'charge':
                        this.renderChargeSpikeBonus(entry, physical.spikeBonus);
                        break;
                    case 'punch':
                        this.renderMeleeDamage(entry, 'punch', Array.from(entry.locations)[0]);
                        break;
                    case 'club':
                        this.renderMeleeDamage(entry, 'club');
                        break;
                    case 'kick [talons]':
                    case 'kick':
                        this.renderMeleeDamage(entry, 'kick');
                        break;
                }
            } else if (entry.equipment?.flags.has('F_CLUB') || entry.equipment?.flags.has('F_HAND_WEAPON')) {
                this.renderMeleeDamage(entry, 'physWeapon', undefined, !!entry.equipment?.flags.has('S_FLAIL'));
            }

            entry.el.classList.toggle('disabledInventory', state.isDisabled);
            entry.el.classList.toggle('damagedInventory', state.isDamaged);
            if (state.isDamaged || state.isDisabled) entry.el.classList.remove('selected');

            // Hit modifier badge
            this.renderHitModEntry(entry, resolveHitModifier(entry, state.hitMod || 0));
        });
    }

    /** Render melee damage text: read base from DOM, compute via rules, write back. */
    private renderMeleeDamage(entry: MountedEquipment, attackType: 'punch' | 'kick' | 'club' | 'physWeapon', loc?: string, ignoreMyomer?: boolean) {
        const damageEl = entry.el!.querySelector(`:scope > .damage > text`);
        if (!damageEl) return;
        let originalText = damageEl.getAttribute('originalText');
        if (originalText === undefined || originalText === null) {
            originalText = damageEl.textContent || '';
            damageEl.setAttribute('originalText', originalText);
        }
        if (!originalText) return;
        const baseDamage = parseInt(originalText);
        const { damage, maxDamage } = this.mekRules.computeMeleeDamage(baseDamage, attackType, loc, ignoreMyomer);
        damageEl.textContent = (damage !== maxDamage) ? `${damage} [${maxDamage}]` : `${damage}`;
        damageEl.classList.toggle('damaged', damage < baseDamage);
    }

    /** Render spike bonus on charge damage text. */
    private renderChargeSpikeBonus(entry: MountedEquipment, spikeBonus: { total: number; working: number } | null) {
        if (!spikeBonus) return;
        const damageEl = entry.el!.querySelector(`:scope > .damage > text`);
        if (!damageEl) return;
        let originalText = damageEl.textContent || '';
        originalText = originalText.replace(/\+\d+$/, ''); // Remove any previous spike bonus
        if (!originalText) return;
        damageEl.textContent = `${originalText}+${spikeBonus.working * 2}`;
        damageEl.classList.toggle('damaged', spikeBonus.total > spikeBonus.working);
    }

    protected override updateHeatSinkPips() {
        const svg = this.unit.svg();
        if (!svg) return;

        const dissipation = this.mekRules.heatDissipation();
        if (!dissipation) return;

        // Update hsPips (visual damaged/fresh/disabled)
        const hsPipsContainer = svg.querySelector('.hsPips');
        if (hsPipsContainer) {
            const allHsPips = Array.from(hsPipsContainer.querySelectorAll('.pip')) as SVGElement[];
            const damagedPips = dissipation.damagedCount + dissipation.destroyedSuperCooledMyomer;
            let idx = 0;
            allHsPips.forEach(pip => {
                if (idx < damagedPips) {
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
                if (idx < dissipation.heatsinksOff) {
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

        // Update heatsink count display
        const hsCountElement = svg.querySelector('#hsCount');
        if (hsCountElement) {
            if (dissipation.healthyPips !== dissipation.totalDissipation || dissipation.heatsinksOff > 0) {
                hsCountElement.textContent = `${dissipation.healthyPips} (${dissipation.totalDissipation})`;
            } else {
                hsCountElement.textContent = dissipation.totalDissipation.toString();
            }
        }

        // Update heat profile display
        const heatProfileElement = svg.querySelector('#heatProfile');
        if (heatProfileElement) {
            const existingText = heatProfileElement.textContent || '';
            const match = existingText.match(/:\s*(\d+)/);
            const heatProfileValue = match ? match[1] : '0';
            heatProfileElement.textContent = `Total Heat (Dissipation): ${heatProfileValue} (${dissipation.totalDissipationWithWings})`;
        }
    }

    protected override updateArmorDisplay(initial: boolean = false) {
        const svg = this.unit.svg();
        if (!svg) return;

        // Shields
        const shieldPips = svg.querySelectorAll('.shield.pip');
        if (shieldPips.length > 0) {
            const locations = this.unit.getLocations();
            const shieldInfo: Record<string, { committed: number; total: number; idx: number }> = {};
            shieldPips.forEach(pip => {
                const linkedLoc = pip.getAttribute('loc');
                const loc = pip.parentElement?.getAttribute('loc');
                if (!loc || !linkedLoc) return;
                if (!shieldInfo[loc]) {
                    const d = locations[loc];
                    shieldInfo[loc] = { committed: d?.armor ?? 0, total: (d?.armor ?? 0) + (d?.pendingArmor ?? 0), idx: 0 };
                }
                const s = shieldInfo[loc];
                this.updatePip(pip, ++s.idx, s.committed, s.total, initial);
            });


            this.unit.locations?.armor.forEach(entry => {
                const el = svg.querySelector(`.shield:not(.pip)[loc="${entry.loc}"]`);
                if (!el) return;
                const shieldExhausted = this.unit.isArmorLocDestroyed('DC' + entry.loc) || this.unit.isArmorLocDestroyed('DA' + entry.loc);
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
            const ctData = locations['CT'];
            const siCommitted = ctData?.internal ?? 0;
            const siTotal = siCommitted + (ctData?.pendingInternal ?? 0);
            let siIdx = 0;
            lamStructuralIntegrityPips.forEach(pip => {
                this.updatePip(pip, ++siIdx, siCommitted, siTotal, initial);
            });
        }



    }
}