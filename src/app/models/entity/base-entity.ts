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
import { ArmorEquipment } from '../equipment.model';
import {
  createEngine,
  createMountedEngine,
  MountedEngine,
} from './components';
import {
  ArmorFace,
  ArmorType,
  ARMOR_TYPE_TO_CODE,
  EngineFlag,
  EngineType,
  MotiveType,
  StructureType,
  EntityFluff,
  EntityMountedEquipment,
  EntityQuirk,
  EntityTechBase,
  EntityTransporter,
  EntityType,
  EntityValidationMessage,
  EntityValidationResult,
  EntityWeaponQuirk,
  LocationArmor,
  locationArmor,
  MountPlacement,
} from './types';
import { generateMountId, removeMountById, updateMap } from './utils/signal-helpers';

/**
 * Abstract base class for all entity types.
 *
 * Properties are categorised as:
 * - **signal** — user-editable inputs (designer's choices or parser values)
 * - **computed** — derived automatically from signals; reactive and read-only
 *
 * === Architectural invariants ===
 *
 * 1. **Single canonical model**: The `equipment` signal is the sole source
 *    of truth for installed gear.  Mek crit grids and location inventories
 *    are DERIVED views.
 *
 * 2. **Immutable snapshots**: Every signal write creates a fresh Array or Map.
 *    Helpers in `signal-helpers.ts` enforce this; in-place mutation is never
 *    performed on signal payloads.
 *
 * 3. **Tiered validation**: Validation is split into independent computed
 *    slices (`engineValidation`, `armorValidation`, `equipmentValidation`,
 *    `typeSpecificValidation`) so changing armor doesn't re-run the engine
 *    check, etc.  A single `validationResult` aggregate collects them.
 *
 * 4. **Typed locations**: Location IDs use canonical literal unions
 *    (`MekLocation`, `TankLocation`, …).  Parsers normalise raw strings at
 *    ingress; all other code uses canonical IDs only.
 */
export abstract class BaseEntity {
  // ── Identity (immutable after construction) ─────────────────────────────
  abstract readonly entityType: EntityType;

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Identity ──
  chassis = signal<string>('');
  model = signal<string>('');
  clanName = signal<string>('');
  mulId = signal<number>(-1);

  // ── Tech ──
  year = signal<number>(3025);
  originalBuildYear = signal<number>(-1);
  techBase = signal<EntityTechBase>('Inner Sphere');
  techLevel = signal<string>('');
  rulesLevel = signal<number>(2);
  mixedTech = signal<boolean>(false);

  // ── Meta ──
  role = signal<string>('');
  source = signal<string>('');
  omni = signal<boolean>(false);

  // ── Movement ──
  motiveType = signal<MotiveType>('None');
  walkMP = signal<number>(0);

  /**
   * The motive type as a BLK-compatible string, or `null` if the
   * entity should not write a `motion_type` block at all.
   * Base implementation returns the canonical MotiveType value
   * (or `null` when `'None'`).
   * Subclasses (e.g. InfantryEntity) override to produce compound
   * strings like `"Beast:Tariq"` or `"Motorized SCUBA"`.
   */
  getMotiveTypeAsString(): string | null {
    const m = this.motiveType();
    return m === 'None' ? null : m;
  }
  /** Raw jump MP from the source file (for round-trip fidelity). -1 means not set. */
  declaredJumpMP = signal<number>(-1);

  // ── Engine (via MountedEngine) ──
  /**
   * The mounted engine — single source of truth for engine type, rating,
   * tech base, and engine-integrated heat sinks.
   */
  mountedEngine = signal<MountedEngine>(
    createMountedEngine(createEngine('Fusion', 0, false)),
  );

  /** Convenience: engine type (delegates to mountedEngine) */
  engineType = computed<EngineType>(() => this.mountedEngine().engine.type);
  /** Convenience: engine rating (delegates to mountedEngine) */
  engineRating = computed<number>(() => this.mountedEngine().engine.rating);
  /** True when the engine uses Clan tech (mixed-tech relevant) */
  clanEngine = computed<boolean>(() => this.mountedEngine().engine.isClan);

  // ── Weight ──
  tonnage = signal<number>(0);

  // ── Armor (structured: each location stores { front, rear }) ──
  armorType = signal<ArmorType>('STANDARD');
  armorTechBase = signal<EntityTechBase>('Inner Sphere');
  /** Resolved ArmorEquipment from the equipment DB (set by parser). */
  armorEquipment = signal<ArmorEquipment | null>(null);
  /** BLK armor type code, derived from `armorType`. */
  armorTypeCode = computed(() => ARMOR_TYPE_TO_CODE[this.armorType()] ?? 0);
  /**
   * Tech-rating index (A=0 … F=5).  Parsers set this directly from the BLK
   * `armor_tech_rating` block for round-trip fidelity.  When not explicitly
   * set (-1), the writer can derive it from ArmorEquipment.
   */
  armorTechRating = signal<number>(-1);
  /**
   * Compound tech level for BLK output.  Parsers set this directly from the
   * BLK `armor_tech_level` block for round-trip fidelity.
   */
  armorTechLevel = signal<number>(-1);
  /**
   * Armor per location.  Keys are canonical location IDs ("CT", "LT", etc.).
   * Each value is `{ front, rear }`.  For locations without rear armour the
   * `rear` field is 0.
   */
  armorValues = signal<Map<string, LocationArmor>>(new Map());
  /** Patchwork only: per-location armor type overrides */
  armorTypes = signal<Map<string, string>>(new Map());
  /** Patchwork BLK only: per-location armor type code (key=locationName, value=int code) */
  patchworkArmorCodes = signal<Map<string, number>>(new Map());
  /** Patchwork BLK only: per-location armor tech string (e.g. "Inner Sphere", "Clan") */
  patchworkArmorTech = signal<Map<string, string>>(new Map());
  /** Patchwork BLK only: per-location armor tech rating (A=0…F=5) */
  patchworkArmorTechRating = signal<Map<string, number>>(new Map());

  // ── Internal Structure ──
  structureType = signal<StructureType>('Standard');
  /** Raw MTF structure string for round-trip (e.g. "IS Standard", "Clan Endo Steel") */
  rawStructure = signal<string>('');
  /** Raw BLK internal_type code for round-trip fidelity (-1 = Unknown, 0 = Standard, etc.) */
  rawInternalTypeCode = signal<number>(0);

  // ── Equipment — SINGLE SOURCE OF TRUTH ──
  equipment = signal<EntityMountedEquipment[]>([]);

  // ── Transporters / Bays ──
  transporters = signal<EntityTransporter[]>([]);

  // ── Quirks ──
  quirks = signal<EntityQuirk[]>([]);
  weaponQuirks = signal<EntityWeaponQuirk[]>([]);

  // ── Fluff ──
  fluff = signal<EntityFluff>({});

  // ── Generator (MTF metadata — tool that created the file) ──
  generator = signal<string>('');

  // ── BV Override ──
  manualBV = signal<number>(0);

  // ── Icon / Fluff image ──
  iconEncoded = signal<string>('');
  fluffImageEncoded = signal<string>('');

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPUTED
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full chassis name including the clan alternate name if present.
   * E.g. "Black Hawk (Nova)"
   */
  fullChassis = computed(() => {
    const clan = this.clanName();
    return clan ? `${this.chassis()} (${clan})` : this.chassis();
  });

  displayName = computed(() => {
    const c = this.fullChassis();
    const m = this.model();
    return m ? `${c} ${m}`.trim() : c;
  });

  engineFlags = computed<Set<EngineFlag>>(() => {
    const flags = new Set<EngineFlag>();
    if (this.techBase() === 'Clan' && !this.mixedTech()) flags.add('clan');
    if (this.engineRating() > 400) flags.add('large');
    return flags;
  });

  runMP = computed(() => Math.ceil(this.walkMP() * 1.5));

  jumpMP = computed(() =>
    this.equipment().filter(e => e.equipment?.hasFlag?.('F_JUMP_JET')).length
  );

  structureValues = computed<Map<string, number>>(() =>
    this.computeStructureValues(this.tonnage(), this.structureType())
  );

  maxArmorValues = computed<Map<string, number>>(() =>
    this.computeMaxArmor(this.structureValues())
  );

  totalArmor = computed(() => {
    let sum = 0;
    for (const la of this.armorValues().values()) {
      sum += la.front + la.rear;
    }
    return sum;
  });

  totalMaxArmor = computed(() => {
    let sum = 0;
    for (const v of this.maxArmorValues().values()) sum += v;
    return sum;
  });

  // ── Derived indexes (reused across validators) ─────────────────────────

  /** Equipment grouped by location — rebuilt only when equipment changes */
  protected mountsByLocation = computed(() => {
    const idx = new Map<string, EntityMountedEquipment[]>();
    for (const m of this.equipment()) {
      let arr = idx.get(m.location);
      if (!arr) { arr = []; idx.set(m.location, arr); }
      arr.push(m);
    }
    return idx;
  });

  /** Set of unresolved mount IDs — rebuilt only when equipment changes */
  protected unresolvedMounts = computed(() =>
    this.equipment().filter(m => !m.equipment)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  TIERED VALIDATION — independent computed slices
  // ═══════════════════════════════════════════════════════════════════════════

  /** Engine rating cross-check */
  protected engineValidation = computed<EntityValidationMessage[]>(() => {
    const msgs: EntityValidationMessage[] = [];
    const expected = this.computeExpectedEngineRating();
    if (expected !== null && this.engineRating() !== expected) {
      msgs.push({
        severity: 'warning', category: 'engine', code: 'ENGINE_RATING_MISMATCH',
        message: `Engine rating ${this.engineRating()} ≠ expected ${expected} `
          + `(walkMP=${this.walkMP()} × tonnage=${this.tonnage()})`,
      });
    }
    return msgs;
  });

  /** Per-location armor bounds */
  protected armorValidation = computed<EntityValidationMessage[]>(() => {
    const msgs: EntityValidationMessage[] = [];
    for (const [loc, la] of this.armorValues()) {
      const maxTotal = this.maxArmorValues().get(loc) ?? 0;
      const total = la.front + la.rear;
      if (total > maxTotal) {
        msgs.push({
          severity: 'error', category: 'armor', code: 'ARMOR_EXCEEDS_MAX',
          message: `${loc} armor ${total} exceeds maximum ${maxTotal}`, location: loc,
        });
      }
      if (la.rear > 0 && !this.hasRearArmor(loc)) {
        msgs.push({
          severity: 'error', category: 'armor', code: 'ARMOR_REAR_INVALID',
          message: `${loc} does not support rear armor`, location: loc,
        });
      }
    }
    return msgs;
  });

  /** Unresolved equipment names */
  protected equipmentValidation = computed<EntityValidationMessage[]>(() =>
    this.unresolvedMounts().map(m => ({
      severity: 'error' as const, category: 'equipment' as const,
      code: 'EQUIPMENT_UNRESOLVED',
      message: `Equipment "${m.equipmentId}" could not be resolved`,
    }))
  );

  /** Override in subclasses for type-specific rules */
  protected abstract typeSpecificValidation: Signal<EntityValidationMessage[]>;

  /** Aggregated validation result */
  readonly validationResult: Signal<EntityValidationResult> = computed(() => {
    const messages = [
      ...this.engineValidation(),
      ...this.armorValidation(),
      ...this.equipmentValidation(),
      ...this.typeSpecificValidation(),
    ];
    return { valid: messages.every(m => m.severity !== 'error'), messages };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT — implemented by each entity type
  // ═══════════════════════════════════════════════════════════════════════════

  abstract get locationOrder(): readonly string[];
  abstract get validLocations(): ReadonlySet<string>;

  /** Whether a given location supports rear armor */
  abstract hasRearArmor(loc: string): boolean;

  protected abstract computeStructureValues(tonnage: number, structureType: StructureType): Map<string, number>;
  protected abstract computeMaxArmor(structureValues: Map<string, number>): Map<string, number>;
  protected abstract computeExpectedEngineRating(): number | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //  METHODS — immutable equipment management
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get all equipment at a specific location */
  getEquipmentAtLocation(loc: string): EntityMountedEquipment[] {
    return this.mountsByLocation().get(loc) ?? [];
  }

  /** Find a mount by its stable ID */
  getMountById(mountId: string): EntityMountedEquipment | undefined {
    return this.equipment().find(m => m.mountId === mountId);
  }

  /** Append a new equipment mount (auto-generates mountId if missing) */
  addEquipment(equip: EntityMountedEquipment): void {
    const mount: EntityMountedEquipment = equip.mountId
      ? equip
      : { ...equip, mountId: generateMountId() };
    this.equipment.update(list => [...list, mount]);
  }

  /** Remove equipment by mountId */
  removeEquipment(mountId: string): void {
    removeMountById(this.equipment, mountId);
  }

  /** Move equipment to a new location, optionally with new placements */
  moveEquipment(mountId: string, newLocation: string, newPlacements?: readonly MountPlacement[]): void {
    this.equipment.update(list => list.map(m => {
      if (m.mountId !== mountId) return m;
      return { ...m, location: newLocation, placements: newPlacements ?? m.placements };
    }));
  }

  /** Set armor for a specific location and face, always creating new Map */
  setArmorValue(loc: string, face: ArmorFace, value: number): void {
    updateMap(this.armorValues, draft => {
      const prev = draft.get(loc) ?? locationArmor(0);
      draft.set(loc, { ...prev, [face]: value });
    });
  }

  /** Get armor for a specific location and face */
  getArmorValue(loc: string, face: ArmorFace = 'front'): number {
    const la = this.armorValues().get(loc);
    return la ? la[face] : 0;
  }
}
