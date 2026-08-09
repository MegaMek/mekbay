// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MountedEquipment } from "../models/mounted-equipment.model";
import type { CriticalSlot } from "../models/force-serialization";
import { VehicleRules } from "../models/rules/vehicle-rules";
import type { InventoryControlRuntimeRangeKey } from "../models/inventory-control-runtime-state.model";
import { committedCriticalHitCount, isRepeatableMotiveHitId, MOTIVE_HIT_PIP_COUNT } from "../models/rules/vehicle-motive-hit.util";
import { UnitSvgService } from "./unit-svg.service";

const VTOL_ROTOR_CRIT_ID = 'rotor';


export class UnitSvgVehicleService extends UnitSvgService {
    private get vehicleRules(): VehicleRules { return this.unit.rules as VehicleRules; }

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

        this.unit.getInventory().forEach(entry => {
                if (!entry.el) return;
                if (entry.isIntrinsicPhysicalAttack()) {
                    if (entry.name === 'charge') {
                        this.renderChargeDamage(entry, this.vehicleRules.chargeDamage());
                    }
                }
                const actionUnavailable = !entry.owner.canPerformEquipmentAction(entry, entry.isPhysicalWeapon() ? 'physical-attack' : 'fire');
                entry.el.classList.toggle('disabledInventory', actionUnavailable);
                const destroyed = this.unit.getEquipmentStatus(entry) === 'destroyed';
                entry.el.classList.toggle('damagedInventory', destroyed);
                if (destroyed || actionUnavailable) entry.el.classList.remove('selected');

                this.renderHitModEntry(entry, this.resolveInventoryControlToHit(entry));
        });
        this.renderInventoryControlSelection();
    }

    protected override resolveInventoryControlToHit(entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null) {
        const stateModifiers = this.vehicleRules.getEquipmentToHitModifiers(entry);
        const selectedAmmo = this.inventoryTargetSelectedAmmo(entry);
        return this.unit.gameRules.resolveToHit({
            subject: entry,
            stateModifiers,
            range,
            adjustments: this.unit.getInventoryControlRules().resolveToHitAdjustments?.(entry, selectedAmmo)
        });
    }

}
