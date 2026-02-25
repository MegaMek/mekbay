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

import { Signal, computed, signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import {
  CriticalSlotView,
  EngineFlag,
  EntityType,
  EntityValidationMessage,
  HeatSinkType,
  MEK_INTERNAL_STRUCTURE,
  MEK_REAR_ARMOR_LOCATIONS,
  MekConfig,
  MekSystemType,
} from '../../types';

// ============================================================================
// MekEntity — abstract base for all Mek-type entities
// ============================================================================

export abstract class MekEntity extends BaseEntity {
  override readonly entityType: EntityType = 'Mek';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS — user / parser inputs
  // ═══════════════════════════════════════════════════════════════════════════

  gyroType = signal<string>('Standard');
  cockpitType = signal<string>('Standard');
  myomerType = signal<string>('Standard');
  ejectionType = signal<string>('');
  heatSinkKit = signal<string>('');

  heatSinkType = signal<HeatSinkType>('Single');
  baseChassisHeatSinks = signal<number>(-1);

  // NOTE: No `criticalSlots` signal!  The crit grid is DERIVED — see
  // `criticalSlotGrid` computed below.  Equipment `placements` on each
  // mount are the single source of truth for slot assignments.

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPUTED — derived from signals
  // ═══════════════════════════════════════════════════════════════════════════

  isSuperHeavy = computed(() => this.tonnage() > 100);
  slotsPerLocation = computed(() => (this.isSuperHeavy() ? 24 : 12));

  heatSinkCount = computed(() =>
    this.equipment().reduce((sum, e) => {
      if (!e.equipment) return sum;
      const isCompactDouble =
        e.equipment.hasFlag?.('F_COMPACT_HEAT_SINK') &&
        e.equipment.hasFlag?.('F_DOUBLE_HEAT_SINK');
      if (isCompactDouble) return sum + 2;
      if (e.equipment.hasFlag?.('F_HEAT_SINK') || e.equipment.hasFlag?.('F_DOUBLE_HEAT_SINK')) {
        return sum + 1;
      }
      return sum;
    }, 0)
  );

  integralHeatSinks = computed(() => {
    const rating = this.engineRating();
    return this.heatSinkType() === 'Compact'
      ? Math.floor(rating / 25) * 2
      : Math.floor(rating / 25);
  });

  override engineFlags = computed<Set<EngineFlag>>(() => {
    const flags = new Set<EngineFlag>();
    if (this.techBase() === 'Clan' && !this.mixedTech()) flags.add('clan');
    if (this.engineRating() > 400) flags.add('large');
    if (this.isSuperHeavy()) flags.add('superheavy');
    return flags;
  });

  // ── Derived crit-slot grid ────────────────────────────────────────────

  /**
   * Complete critical-slot grid for every location.
   *
   * Built by:
   * 1. Laying down the system template (engine, gyro, actuators, …)
   * 2. Overlaying equipment from mount `placements`
   *
   * This is a READ-ONLY view.  To change slot assignments, mutate the
   * `equipment` signal (update mount placements), and this recomputes.
   */
  criticalSlotGrid = computed<Map<string, CriticalSlotView[]>>(() => {
    const grid = new Map<string, CriticalSlotView[]>();
    const slotsPerLoc = this.slotsPerLocation();

    for (const loc of this.locationOrder) {
      // Start with system template + empty fill
      const systemSlots = this.getSystemSlotsForLocation(loc as string);
      const slots: CriticalSlotView[] = [];
      for (let i = 0; i < slotsPerLoc; i++) {
        slots.push(systemSlots[i] ?? EMPTY_SLOT);
      }

      grid.set(loc as string, slots);
    }

    // Overlay equipment placements
    for (const mount of this.equipment()) {
      if (!mount.placements) continue;
      for (const p of mount.placements) {
        const slots = grid.get(p.location);
        if (slots && p.slotIndex >= 0 && p.slotIndex < slotsPerLoc) {
          slots[p.slotIndex] = {
            type: 'equipment',
            mountId: mount.mountId,
            armored: mount.armored,
            omniPod: mount.omniPodMounted,
          };
        }
      }
    }

    return grid;
  });

  // ── Abstract ──────────────────────────────────────────────────────────

  abstract get chassisConfig(): MekConfig;

  // ═══════════════════════════════════════════════════════════════════════════
  //  Base abstract implementations
  // ═══════════════════════════════════════════════════════════════════════════

  override hasRearArmor(loc: string): boolean {
    return MEK_REAR_ARMOR_LOCATIONS.has(loc);
  }

  protected override computeExpectedEngineRating(): number | null {
    return this.walkMP() * this.tonnage();
  }

  protected override computeStructureValues(tonnage: number, _structureType: string): Map<string, number> {
    const values = new Map<string, number>();
    const entry = MEK_INTERNAL_STRUCTURE[tonnage];
    if (!entry) return values;
    const [head, ct, sideTorso, arm, leg] = entry;
    for (const loc of this.locationOrder) {
      switch (loc) {
        case 'HD':  values.set(loc, head); break;
        case 'CT':  values.set(loc, ct); break;
        case 'LT': case 'RT':  values.set(loc, sideTorso); break;
        case 'LA': case 'RA': case 'FLL': case 'FRL':  values.set(loc, arm); break;
        default:  values.set(loc, leg); break;   // LL, RL, RLL, RRL, CL
      }
    }
    return values;
  }

  protected override computeMaxArmor(structureValues: Map<string, number>): Map<string, number> {
    const maxArmor = new Map<string, number>();
    for (const [loc, isVal] of structureValues) {
      // Head: flat cap (9 normal, 12 superheavy). Torsos: 2×IS (combined front+rear).
      // Arms/legs: 2×IS (front only, no rear).
      maxArmor.set(loc, loc === 'HD' ? (this.isSuperHeavy() ? 12 : 9) : isVal * 2);
    }
    return maxArmor;
  }

  // ── Tiered validation slice ───────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    // Minimum 10 heat sinks
    if (this.heatSinkCount() < 10) {
      msgs.push({
        severity: 'error', category: 'heat', code: 'HEAT_SINKS_BELOW_MIN',
        message: `Mek needs at least 10 heat sinks (has ${this.heatSinkCount()})`,
      });
    }

    // Engine rating ≥ 10
    if (this.engineRating() > 0 && this.engineRating() < 10) {
      msgs.push({
        severity: 'error', category: 'engine', code: 'ENGINE_RATING_TOO_LOW',
        message: `Engine rating must be at least 10 (has ${this.engineRating()})`,
      });
    }

    // Crit slot overflow (derived grid vs slots-per-location)
    const slotsPerLoc = this.slotsPerLocation();
    for (const [loc, slots] of this.criticalSlotGrid()) {
      const usedSlots = slots.filter(s => s.type !== 'empty').length;
      if (usedSlots > slotsPerLoc) {
        msgs.push({
          severity: 'error', category: 'crit', code: 'CRIT_SLOTS_OVERFLOW',
          message: `${loc} has ${usedSlots} crit slots but max is ${slotsPerLoc}`,
          location: loc,
        });
      }
    }

    // Equipment placed on system slots (placement conflict)
    for (const mount of this.equipment()) {
      if (!mount.placements) continue;
      for (const p of mount.placements) {
        const systemSlots = this.getSystemSlotsForLocation(p.location);
        if (p.slotIndex < systemSlots.length && systemSlots[p.slotIndex].type === 'system') {
          msgs.push({
            severity: 'error', category: 'crit', code: 'CRIT_PLACEMENT_CONFLICT',
            message: `"${mount.equipmentId}" placed on system slot ${p.slotIndex} in ${p.location}`,
            location: p.location,
          });
        }
      }
    }

    return msgs;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SYSTEM TEMPLATE — generates fixed system slots per location
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns the system slots for a given location.
   * Entries at a given index mean "this slot is reserved for this system."
   * Remaining indices (up to slotsPerLocation) are empty.
   */
  private getSystemSlotsForLocation(loc: string): CriticalSlotView[] {
    const slots: CriticalSlotView[] = [];

    switch (loc) {
      case 'HD':
        this.applyHeadSystemSlots(slots);
        break;
      case 'CT':
        this.applyCenterTorsoSystemSlots(slots);
        break;
      case 'LT': case 'RT':
        this.applySideTorsoSystemSlots(slots);
        break;
      case 'LA': case 'RA':
        this.applyArmSystemSlots(slots, loc);
        break;
      case 'FLL': case 'FRL':
      case 'LL': case 'RL':
      case 'RLL': case 'RRL':
      case 'CL':
        this.applyLegSystemSlots(slots);
        break;
    }

    return slots;
  }

  private applyHeadSystemSlots(slots: CriticalSlotView[]): void {
    slots.push(
      sys('Life Support'),
      sys('Sensors'),
      sys('Cockpit'),
      EMPTY_SLOT,          // slot 3 — usually free (or 2nd cockpit for Dual)
      sys('Sensors'),
      sys('Life Support'),
    );
  }

  private applyCenterTorsoSystemSlots(slots: CriticalSlotView[]): void {
    const engineBefore = this.engineType() === 'Compact' ? 3 : 3;
    const gyroCrits = this.getGyroCritCount();
    const engineAfter = this.engineType() === 'Compact' ? 0 : 3;

    for (let i = 0; i < engineBefore; i++) slots.push(sys('Engine'));
    for (let i = 0; i < gyroCrits; i++)    slots.push(sys('Gyro'));
    for (let i = 0; i < engineAfter; i++)  slots.push(sys('Engine'));
  }

  private applySideTorsoSystemSlots(slots: CriticalSlotView[]): void {
    const count = this.getSideTorsoEngineCrits();
    for (let i = 0; i < count; i++) slots.push(sys('Engine'));
  }

  private applyArmSystemSlots(slots: CriticalSlotView[], loc: string): void {
    slots.push(sys('Shoulder'), sys('Upper Arm Actuator'));
    // MekWithArmsEntity overrides to add Lower Arm / Hand if present
    if (this instanceof MekWithArmsEntity) {
      const side = loc === 'LA' ? 'left' : 'right';
      if (this.hasLowerArmActuator()[side]) slots.push(sys('Lower Arm Actuator'));
      if (this.hasHandActuator()[side])     slots.push(sys('Hand Actuator'));
    }
  }

  private applyLegSystemSlots(slots: CriticalSlotView[]): void {
    slots.push(sys('Hip'), sys('Upper Leg Actuator'), sys('Lower Leg Actuator'), sys('Foot Actuator'));
  }

  private getGyroCritCount(): number {
    switch (this.gyroType()) {
      case 'XL':       return 6;
      case 'Compact':  return 2;
      case 'None':     return 0;
      default:         return 4;  // Standard, Heavy-Duty, Superheavy
    }
  }

  private getSideTorsoEngineCrits(): number {
    switch (this.engineType()) {
      case 'XL':    return 3;
      case 'XXL':   return 6;
      case 'Light': return 2;
      default:      return 0;
    }
  }
}

// ============================================================================
// MekWithArmsEntity — abstract, adds arm actuator management
// ============================================================================

export abstract class MekWithArmsEntity extends MekEntity {
  hasLowerArmActuator = signal<{ left: boolean; right: boolean }>({ left: true, right: true });
  hasHandActuator = signal<{ left: boolean; right: boolean }>({ left: true, right: true });
}

// ============================================================================
// Helpers
// ============================================================================

const EMPTY_SLOT: CriticalSlotView = Object.freeze({
  type: 'empty', armored: false, omniPod: false,
});

function sys(systemType: MekSystemType): CriticalSlotView {
  return { type: 'system', systemType, armored: false, omniPod: false };
}
