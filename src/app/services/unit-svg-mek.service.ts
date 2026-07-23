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
import { MountedEquipment  } from '../models/mounted-equipment.model';
import type { CriticalSlot } from "../models/force-serialization";
import { UnitSvgService } from "./unit-svg.service";
import { AmmoEquipment } from "../models/equipment.model";
import { MekRules } from "../models/rules/mek-rules";
import type { InventoryControlRuntimeRangeKey } from "../models/inventory-control-runtime-state.model";
import { getCriticalSlotAmmoProfileKey } from "../utils/ammo-interaction.util";
import type { MountedEquipmentRuleState } from "../models/rules/unit-type-rules";
import { INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE, readInventoryControlDisplayData } from "../utils/inventory-control.util";

/*
 * Author: Drake
 */
export class UnitSvgMekService extends UnitSvgService {
    // Mek-specific SVG handling logic goes here
    private get mekRules(): MekRules { return this.unit.rules as MekRules; }
    private currentEntryStates: Map<MountedEquipment, MountedEquipmentRuleState> | null = null;

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

                    const key = getCriticalSlotAmmoProfileKey(criticalSlot) ?? (text.startsWith("Ammo ") ? text.substring(5) : text);
                    ammoProfile.set(key, (ammoProfile.get(key) ?? 0) + (this.unit.isEquipmentUnavailable(criticalSlot) ? 0 : remainingAmmo));
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
        this.renderAmmoProfile(ammoProfile);
    }

    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        const movement = this.mekRules.movementState();
        const physical = this.mekRules.physicalCombat();
        const systemsStatus = this.mekRules.systemsStatus();
        if (!movement || !physical) return;

        // Partial wing heat bonus display
        if (systemsStatus.hasPartialWings) {
            const el = svg.getElementById('partialWingBonus');
            if (el) {
                el.textContent = `(Partial Wing +${systemsStatus.partialWingsHeatBonus})`;
                if (systemsStatus.destroyedPartialWingsCount > 0) {
                    el.classList.add('damaged');
                }
            }
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
        this.currentEntryStates = entryStates;
        try {
            this.unit.getInventory().forEach(entry => {
                if (!entry.el || !entry.locations) return;

                const state = entryStates.get(entry);
                if (!state) return;

                // Physical / melee damage display (reads base values from DOM, computes via rules)
                if (entry.physical) {
                    switch (entry.name) {
                        case 'charge':
                            this.renderChargeDamage(entry, physical.chargeDamage);
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
                this.renderHitModEntry(entry, this.resolveInventoryControlToHit(entry));
            });
            this.renderInventoryControlSelection();
        } finally {
            this.currentEntryStates = null;
        }
    }

    protected override resolveInventoryControlToHit(entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null) {
        const state = this.currentEntryStates?.get(entry) ?? this.mekRules.computeEntryState(entry);
        const selectedAmmo = this.inventoryTargetSelectedAmmo(entry);
        return this.unit.gameRules.resolveToHit({
            subject: entry,
            stateModifier: state.hitMod,
            stateWeakened: state.weakenedHitMod,
            range,
            adjustments: this.unit.getInventoryControlRules().resolveToHitAdjustments?.(entry, selectedAmmo)
        });
    }

    protected override renderHitModEntry(
        entry: MountedEquipment,
        resolution: ReturnType<UnitSvgMekService['resolveInventoryControlToHit']>
    ) {
        const state = this.currentEntryStates?.get(entry) ?? this.mekRules.computeEntryState(entry);
        super.renderHitModEntry(entry, resolution, !!state.weakenedHitMod);
    }

    override inventoryTargetHeatFireModifier(entry: MountedEquipment): number {
        if (entry.physical || entry.equipment?.flags.has('F_CLUB') || entry.equipment?.flags.has('F_HAND_WEAPON')) return 0;
        return MekRules.getHeatEffects(this.unit.getHeat().current).fireModifier;
    }

    protected override updateTurnState() {
        super.updateTurnState();

        const svg = this.unit.svg();
        if (!svg) return;

        const movement = this.mekRules.movementState();
        if (!movement) return;

        const runWarning = movement.maxRun > 0 ? this.unit.rules.getCommittedDamageMovementModePSRCheck('run') : null;
        const jumpWarning = movement.jump > 0 ? this.unit.rules.getCommittedDamageMovementModePSRCheck('jump') : null;
        const jumpMoveElementId = svg.getElementById('mpJump') ? 'mpJump' : (svg.getElementById('mp_2') ? 'mp_2' : null);

        this.syncMovementModePsrWarning(svg, 'mpRun', runWarning?.reason ?? null);
        if (jumpMoveElementId) {
            this.syncMovementModePsrWarning(svg, jumpMoveElementId, jumpWarning?.reason ?? null);
        }
    }

    private syncMovementModePsrWarning(svg: SVGSVGElement, moveElementId: 'mpRun' | 'mpJump' | 'mp_2', reason: string | null) {
        const warningEl = svg.getElementById(`${moveElementId}-psr-warning`) as SVGTextElement | null;
        if (!warningEl) return;

        const currentMoveMode = this.unit.turnState().moveMode();
        let selectedMoveElementId: string | null = null;
        if (currentMoveMode === 'walk' || currentMoveMode === 'stationary') {
            selectedMoveElementId = 'mpWalk';
        } else if (currentMoveMode === 'run') {
            selectedMoveElementId = 'mpRun';
        } else if (currentMoveMode === 'jump' || currentMoveMode === 'UMU') {
            selectedMoveElementId = svg.getElementById('mpJump') ? 'mpJump' : 'mp_2';
        }

        if (!reason) {
            warningEl.setAttribute('display', 'none');
            warningEl.style.display = 'none';
            warningEl.classList.remove('currentMoveMode', 'unusedMoveMode', 'noPsrCheck');
            return;
        }

        warningEl.removeAttribute('display');
        warningEl.style.display = 'block';
        const warningMoveMode = moveElementId === 'mpRun' ? 'run' : 'jump';
        const isCurrentMoveMode = currentMoveMode === warningMoveMode;
        const moveDistance = this.unit.turnState().moveDistance();
        const triggersPsr = moveDistance !== null && (warningMoveMode === 'jump' || moveDistance > 0);
        warningEl.classList.toggle('noPsrCheck', !isCurrentMoveMode || !triggersPsr);

        if (!selectedMoveElementId) {
            warningEl.classList.remove('currentMoveMode', 'unusedMoveMode');
            return;
        }

        const isUnused = !isCurrentMoveMode;
        warningEl.classList.toggle('unusedMoveMode', isUnused);
        warningEl.classList.toggle('currentMoveMode', !isUnused);
    }

    /** Render melee damage text: read base from DOM, compute via rules, write back. */
    private renderMeleeDamage(entry: MountedEquipment, attackType: 'punch' | 'kick' | 'club' | 'physWeapon', loc?: string, ignoreMyomer?: boolean) {
        const damageEl = entry.el!.querySelector(`:scope > .damage > text`);
        if (!damageEl) return;
        let originalText = damageEl.getAttribute(INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE);
        if (originalText === undefined || originalText === null) {
            originalText = damageEl.textContent || '';
            damageEl.setAttribute(INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE, originalText);
        }
        if (!originalText) return;
        const baseDamage = parseInt(originalText);
        const { weakened } = this.mekRules.resolveMeleeDamageDisplay(entry, baseDamage, attackType, loc, ignoreMyomer);
        const display = this.unit.applyInventoryControlDisplayEffects(entry, readInventoryControlDisplayData(entry), {
            selectedRange: null,
            additionalHitModifier: 0,
            selectedAmmo: null,
        });
        damageEl.textContent = display.damage;
        damageEl.classList.toggle('damaged', weakened);
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