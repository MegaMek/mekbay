// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { uidTranslations } from "../models/common.model";
import { MountedEquipment  } from '../models/mounted-equipment.model';
import type { CriticalSlot, HeatProfile } from "../models/force-serialization";
import { UnitSvgService } from "./unit-svg.service";
import { AmmoEquipment } from "../models/equipment.model";
import { MekRules } from "../models/rules/mek-rules";
import { getCriticalSlotAmmoProfileKey } from "../utils/ammo-interaction.util";
import { INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE, readInventoryControlDisplayData } from "../utils/inventory-control.util";


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
        this.unit.getConditions();
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

    protected override updateHeatDisplay(heat: HeatProfile): void {
        super.updateHeatDisplay(heat);
        this.updateLifeSupportPilotDamageWarning(heat);
    }

    private updateLifeSupportPilotDamageWarning(heat: HeatProfile): void {
        const svg = this.unit.svg();
        if (!svg) return;

        const heatHits = this.mekRules.heatLifeSupportPilotHits(heat.next ?? heat.current);
        const builtInWarning = svg.getElementById('heatLifeSupportWarning');
        if (builtInWarning) {
            if (heatHits === 0) {
                builtInWarning.setAttribute('display', 'none');
                builtInWarning.removeAttribute('aria-label');
                builtInWarning.removeAttribute('data-pilot-hits');
                return;
            }
            builtInWarning.setAttribute('aria-label', `${heatHits} Life Support heat pilot hit${heatHits === 1 ? '' : 's'}`);
            builtInWarning.setAttribute('data-pilot-hits', heatHits.toString());
            builtInWarning.removeAttribute('display');
            return;
        }

        const warning = svg.getElementById('lifeSupportPilotDamageWarning');
        if (!warning) return;

        const oxygenHits = this.mekRules.submergedLifeSupportPilotHits();
        const iconKinds: ('heat' | 'oxygen')[] = [];
        for (let i = 0; i < heatHits; i++) iconKinds.push('heat');
        for (let i = 0; i < oxygenHits; i++) iconKinds.push('oxygen');

        warning.querySelectorAll('.lifeSupportPilotDamageIcon').forEach(icon => icon.remove());
        if (iconKinds.length === 0) {
            warning.setAttribute('display', 'none');
            warning.removeAttribute('aria-label');
            return;
        }

        const warningWidth = Number(warning.getAttribute('data-width')) || 42;
        const iconSize = Number(warning.getAttribute('data-height')) || 15;
        const iconGap = -1.5;
        const iconsWidth = iconKinds.length * iconSize + (iconKinds.length - 1) * iconGap;
        const startX = warningWidth - iconsWidth;
        iconKinds.forEach((kind, index) => {
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            icon.setAttribute('class', `lifeSupportPilotDamageIcon ${kind}`);
            icon.setAttribute('href', kind === 'heat' ? '#lifeSupportHeatDamageIcon' : '#lifeSupportOxygenDamageIcon');
            icon.setAttribute('x', (startX + index * (iconSize + iconGap)).toString());
            icon.setAttribute('y', '0');
            icon.setAttribute('width', iconSize.toString());
            icon.setAttribute('height', iconSize.toString());
            warning.appendChild(icon);
        });

        warning.setAttribute('aria-label', `${heatHits} heat, ${oxygenHits} oxygen-deprivation pilot damage`);
        warning.removeAttribute('display');
    }

    protected updateCritSlotDisplay(criticalSlots: CriticalSlot[]) {
        const svg = this.unit.svg();
        if (!svg) return;
        const extraHitPipsEnabled = this.unit.gameRules.id !== 'tw';
        svg.querySelectorAll<SVGElement>('.extraHitPip').forEach(pip => {
            if (extraHitPipsEnabled) {
                pip.removeAttribute('display');
            } else {
                pip.setAttribute('display', 'none');
            }
        });
        const ammoProfile = new Map<string, number>();
        criticalSlots.forEach(criticalSlot => {
            const el = svg.querySelector(`.critSlot[loc="${criticalSlot.loc}"][slot="${criticalSlot.slot}"]`);
            if (!el) return;

            const uid = el.getAttribute('uid');
            const systemSlot = el.getAttribute('type') === 'sys';
            const modularArmor = el.getAttribute('modularArmor') === '1';
            const isAmmo = el.classList.contains('ammoSlot');
            const extraHit = extraHitPipsEnabled && el.getAttribute('extraHit') === '1';
            const hitCount = Math.max(0, criticalSlot.hits ?? 0);
            const pipHitCapacity = (criticalSlot.armored ? 1 : 0) + (extraHit ? 1 : 0);
            const showWholeSlotHit = hitCount === 0 || hitCount > pipHitCapacity;
            const wholeSlotDamaged = !!criticalSlot.destroyed && showWholeSlotHit;

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
                    ammoProfile.set(key, (ammoProfile.get(key) ?? 0) + (this.unit.isEquipmentOperational(criticalSlot) ? remainingAmmo : 0));
                }
            }

            if (wholeSlotDamaged) {
                el.classList.add('damaged');
                el.classList.remove('willDamage');
            } else {
                el.classList.remove('damaged');
                el.classList.toggle('willDamage', !!criticalSlot.destroying && showWholeSlotHit);
            }

            if (criticalSlot.armored) {
                const armoredPip = el.querySelector('.armoredLocPip');
                this.updateCriticalSlotPip(armoredPip, hitCount > 0);
                if (wholeSlotDamaged) armoredPip?.classList.remove('fresh');
            }

            if (extraHit) {
                const precedingArmoredHit = criticalSlot.armored ? 1 : 0;
                const extraHitPip = el.querySelector('.extraHitPip');
                this.updateCriticalSlotPip(extraHitPip, hitCount > precedingArmoredHit);
                if (wholeSlotDamaged) extraHitPip?.classList.remove('fresh');
            }

            if (modularArmor) {
                el.querySelectorAll('.modularArmorPip').forEach((pipEl, index) => {
                    this.updateCriticalSlotPip(pipEl, (criticalSlot.consumed ?? 0) > index);
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

    private updateCriticalSlotPip(pip: Element | null, isHit: boolean): void {
        if (!pip) return;
        if (pip.classList.contains('damaged') !== isHit) {
            pip.classList.add('fresh');
        } else {
            pip.classList.remove('fresh');
        }
        pip.classList.toggle('damaged', isHit);
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
                el.classList.toggle('damaged',  (systemsStatus.destroyedPartialWingsCount > 0));
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
        this.unit.getInventory().forEach(entry => {
                if (!entry.el || !entry.locations) return;

                // Physical / melee damage display (reads base values from DOM, computes via rules)
                if (entry.isIntrinsicPhysicalAttack()) {
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
                } else if (entry.equipment?.hasFlag('F_SHIELD')) {
                    this.renderShieldDamage(entry);
                } else if (entry.isPhysicalWeapon()) {
                    this.renderMeleeDamage(entry, 'physWeapon', undefined, !!entry.equipment?.flags.has('S_FLAIL'));
                }

                this.renderInventoryEntryState(entry);
        });
        this.renderInventoryControlSelection();
    }

    protected override updateTurnState() {
        super.updateTurnState();

        const svg = this.unit.svg();
        if (!svg) return;

        const movement = this.mekRules.movementState();
        if (!movement) return;

        const runWarning = this.unit.rules.isMotiveModeAvailable('run')
            ? this.unit.rules.getCommittedDamageMovementModePSRCheck('run')
            : null;
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

        const turnState = this.unit.turnState();
        const currentMoveMode = turnState.effectiveMoveMode();
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
        const triggersPsr = isCurrentMoveMode
            && this.unit.rules.getCommittedDamageMovementModePSRCheck(
                warningMoveMode,
                turnState.moveDistance(),
            ) !== null;
        warningEl.classList.toggle('noPsrCheck', !triggersPsr);

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
        const resolved = this.mekRules.resolveInventoryMeleeDamageDisplay(
            entry,
            originalText,
            attackType,
            loc,
            ignoreMyomer,
        );
        if (!resolved) return;
        this.renderRulesAdjustedDamage(entry, damageEl, resolved.weakened, originalText);
    }

    /** Render rules-specific shield damage without applying physical-weapon or TSM modifiers. */
    private renderShieldDamage(entry: MountedEquipment) {
        const damageEl = entry.el!.querySelector(`:scope > .damage > text`);
        if (!damageEl) return;
        const shieldDisplay = this.mekRules.resolveShieldDamageDisplay(entry);
        this.renderRulesAdjustedDamage(entry, damageEl, shieldDisplay.weakened);
    }

    private renderRulesAdjustedDamage(
        entry: MountedEquipment,
        damageEl: Element,
        weakened: boolean,
        baseDamage?: string,
    ): void {
        const sourceDisplay = readInventoryControlDisplayData(entry);
        const display = this.unit.applyInventoryControlDisplayEffects(
            entry,
            baseDamage === undefined ? sourceDisplay : { ...sourceDisplay, damage: baseDamage },
            {
                selectedRange: null,
                hitModifierBreakdown: this.mekRules.getEquipmentToHitModifiers(entry),
                selectedAmmo: null,
            },
        );
        this.renderInventoryDamageText(damageEl, display.damage);
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

        this.updateHeatProfileDisplay(dissipation.totalDissipationWithWings ?? dissipation.totalDissipation);
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
                    shieldInfo[loc] = {
                        committed: this.mekRules.getShieldTrackHits(loc) ?? d?.armor ?? 0,
                        total: this.mekRules.getShieldTrackHits(loc, true)
                            ?? (d?.armor ?? 0) + (d?.pendingArmor ?? 0),
                        idx: 0,
                    };
                }
                const s = shieldInfo[loc];
                this.updatePip(pip, ++s.idx, s.committed, s.total, initial);
            });


            this.unit.locations?.armor.forEach(entry => {
                const el = svg.querySelector(`.shield:not(.pip)[loc="${entry.loc}"]`);
                if (!el) return;
                const shieldExhausted = ['DA', 'DC'].some(prefix => {
                    const trackLoc = `${prefix}${entry.loc}`;
                    const points = this.unit.getArmorPoints(trackLoc);
                    const hits = this.mekRules.getShieldTrackHits(trackLoc, true)
                        ?? this.unit.getArmorHits(trackLoc);
                    return points > 0 && hits >= points;
                });
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
