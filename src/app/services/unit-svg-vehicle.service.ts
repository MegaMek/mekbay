/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import type { CriticalSlot, MountedEquipment } from "../models/force-serialization";
import { VehicleRules } from "../models/rules/vehicle-rules";
import { resolveHitModifier } from "../models/rules/hit-modifier.util";
import type { InventoryControlRuntimeRangeKey } from "../models/inventory-control-runtime-state.model";
import { committedCriticalHitCount, isRepeatableMotiveHitId, MOTIVE_HIT_PIP_COUNT } from "../models/rules/vehicle-motive-hit.util";
import { UnitSvgService } from "./unit-svg.service";

type VehicleEntryState = { isDamaged: boolean; isDisabled: boolean; hitMod: number };
const VTOL_ROTOR_CRIT_ID = 'rotor';

/*
 * Author: Drake
 */
export class UnitSvgVehicleService extends UnitSvgService {
    private get vehicleRules(): VehicleRules { return this.unit.rules as VehicleRules; }
    private currentEntryStates: Map<MountedEquipment, VehicleEntryState> | null = null;

    protected override updateAllDisplays() {
        if (!this.unit.svg()) return;
        const crew = this.unit.getCrewMembers();
        const heat = this.unit.getHeat();
        const critSlots = this.unit.getCritSlots();
        const locations = this.unit.getLocations();
        const inventory = this.unit.getInventory();
        this.unit.phaseTrigger();

        this.updateBVDisplay();
        this.updateCrewDisplay(crew);
        this.updateCritLocDisplay(critSlots);
        this.updateHeatDisplay(heat);
        this.updateHeatSinkPips();
        this.updateAmmoProfile();
        this.updateInventory();
        this.updateTurnState();
    }

    protected override updateCritLocDisplay(critLocs: CriticalSlot[]) {
        const svg = this.unit.svg();
        if (!svg) return;
        if (!svg.querySelector('.critLoc')) return;

        critLocs.forEach(critLoc => {
            if (!critLoc.el) return;
            if (isRepeatableMotiveHitId(critLoc.id || critLoc.name || '')) {
                this.updateMotiveHitPips(critLoc);
                const committedHits = committedCriticalHitCount(critLoc);
                const currentHits = Math.max(0, committedHits + (critLoc.pendingHits ?? 0));
                critLoc.el.classList.toggle('damaged', committedHits > 0);
                critLoc.el.classList.toggle('willChange', (committedHits > 0) !== (currentHits > 0));
                return;
            }
            if (critLoc.id === VTOL_ROTOR_CRIT_ID || critLoc.name === VTOL_ROTOR_CRIT_ID) {
                const committedHits = Math.max(0, critLoc.hits ?? 0);
                const pendingHits = critLoc.pendingHits ?? 0;
                const counter = svg.querySelector('#rotor_hits_counter');
                if (counter) {
                    this.renderRotorHitsCounter(counter, committedHits, pendingHits);
                }
                critLoc.el.classList.toggle('rotorHitsDamaged', committedHits > 0);
                critLoc.el.classList.toggle('rotorHitsPendingPositive', pendingHits > 0);
                critLoc.el.classList.toggle('rotorHitsPendingNegative', pendingHits < 0);
                return;
            }
            critLoc.el.classList.toggle('damaged', !!critLoc.destroyed);
            critLoc.el.classList.toggle('willChange', !!critLoc.destroying != !!critLoc.destroyed);
        });
    }

    private updateMotiveHitPips(critLoc: CriticalSlot): void {
        const committedHits = committedCriticalHitCount(critLoc);
        const pendingHits = critLoc.pendingHits ?? 0;
        const pendingPositiveHits = Math.max(0, pendingHits);
        const pendingNegativeHits = Math.max(0, -pendingHits);
        const group = critLoc.el?.parentElement?.querySelector<SVGGElement>(`#${critLoc.id}_pips`);
        if (!group) return;

        const pips = Array.from(group.querySelectorAll<SVGCircleElement>('.motiveHitPip'));
        pips.forEach((pip, index) => {
            const committedIndex = index < committedHits;
            const pendingAddIndex = index >= committedHits && index < committedHits + pendingPositiveHits;
            const pendingRemoveIndex = index >= Math.max(0, committedHits - pendingNegativeHits) && index < committedHits;

            pip.classList.toggle('damaged', committedIndex);
            pip.classList.toggle('willChange', pendingAddIndex || pendingRemoveIndex);
            pip.classList.toggle('pendingRemoval', pendingRemoveIndex);
            pip.classList.toggle('hidden', !committedIndex && !pendingAddIndex);
        });

        group.classList.toggle('hasVisiblePips', pips.some(pip => !pip.classList.contains('hidden')));
    }

    private renderRotorHitsCounter(counter: Element, committedHits: number, pendingHits: number): void {
        counter.textContent = '';

        const committed = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        committed.setAttribute('class', 'rotorHitsCommitted');
        committed.textContent = committedHits.toString();
        counter.appendChild(committed);

        if (pendingHits === 0) return;

        const pending = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        pending.setAttribute('class', pendingHits > 0 ? 'rotorHitsPending positive' : 'rotorHitsPending negative');
        pending.textContent = pendingHits > 0 ? `+${pendingHits}` : pendingHits.toString();
        counter.appendChild(pending);
    }

    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;

        const movement = this.vehicleRules.movementState();
        const mpWalkEl = svg.querySelector('#mpWalk');
        if (mpWalkEl) {
            const mpRunEl = svg.querySelector('#mpRun');
            mpWalkEl.classList.toggle('damaged', movement.moveImpaired);
            mpWalkEl.textContent = movement.walk !== movement.maxWalk
                ? `${movement.walk} [${movement.maxWalk}]`
                : movement.walk.toString();
            if (mpRunEl) {
                mpRunEl.classList.toggle('damaged', movement.moveImpaired);
                mpRunEl.textContent = movement.run !== movement.maxRun
                    ? `${movement.run} [${movement.maxRun}]`
                    : movement.run.toString();
            }
        }

        const entryStates = this.vehicleRules.computeAllEntryStates();
        this.currentEntryStates = entryStates;
        try {
            this.unit.getInventory().forEach(entry => {
                if (!entry.el) return;

                const state = entryStates.get(entry);
                if (!state) return;

                entry.el.classList.toggle('disabledInventory', state.isDisabled);
                entry.el.classList.toggle('damagedInventory', state.isDamaged);
                if (state.isDamaged || state.isDisabled) entry.el.classList.remove('selected');

                this.renderHitModEntry(entry, this.resolveInventoryControlHitModifier(entry));
            });
            this.renderInventoryControlSelection();
        } finally {
            this.currentEntryStates = null;
        }
    }

    protected override resolveInventoryControlHitModifier(entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null): number | 'Vs' | '*' | null {
        const state = this.currentEntryStates?.get(entry) ?? this.vehicleRules.computeEntryState(entry);
        if (this.unit.turnState().moveMode() === null && this.vehicleRules.hasDamagedStabilizerAffectingEntry(entry)) {
            return '*';
        }
        return resolveHitModifier(
            entry,
            state.hitMod,
            range,
            this.inventoryTargetSelectedAmmo(entry),
            (candidate, selectedAmmo) => this.unit.getLinkedEquipmentHitModifier(candidate, selectedAmmo),
            candidate => this.unit.getInventoryControlBaseHitModifier(candidate)
        );
    }

    protected override renderHitModEntry(entry: MountedEquipment, hitModifier: number | 'Vs' | '*' | null) {
        super.renderHitModEntry(entry, hitModifier);
        if (hitModifier === '*' && this.vehicleRules.hasDamagedStabilizerAffectingEntry(entry)) {
            entry.el?.classList.add('weakenedHitMod');
        }
    }
}
