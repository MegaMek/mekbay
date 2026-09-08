// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { MiscEquipment } from '../../../equipment.model';
import { isQuartersBay } from '../../bays/bay-definitions';
import {
  AeroDesignType,
  EntityTransportBay,
  EntityType,
  SMALL_CRAFT_ARMOR_LOCATIONS,
  SMALL_CRAFT_EQUIP_LOCATIONS,
  SmallCraftCrew,
  WeightClass,
} from '../../types';
import { smallCraftArmorPointsPerTon } from '../../utils/large-craft-armor';
import { LargeAeroEntity } from './large-aero-entity';
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import { getSmallCraftConstructionTech } from '../../components';
import type { Equipment } from '../../../equipment.model';
import { isEcmEquipment } from '../../../ecm-mode.model';
import { calculateSpacecraftRequiredGunners, calculateTransportBayPersonnel, calculateSpacecraftEquipmentCrew } from '../../utils/crew-requirements';

const MINIMUM_CREW_AND_QUARTERS_THRESHOLD_TONS = 25;

interface CrewConfiguration {
  readonly crew: number;
  readonly officers: number;
  readonly gunners: number;
}

/**
 * SmallCraft entity (100-200 tons).
 *
 * Uses different location names than fighters: Left Side / Right Side / Hull
 * instead of Left Wing / Right Wing / Fuselage.
 */
export class SmallCraftEntity extends LargeAeroEntity {
  override componentLocationOrder(): readonly string[] {
    return ['Nose', 'Left Side', 'Right Side', 'Aft', 'Hull'];
  }

  override componentLocationLabel(location: string): string {
    return ({ 'Left Side': 'LS', 'Right Side': 'RS', Hull: 'HULL' })[location]
      ?? super.componentLocationLabel(location);
  }
  override readonly entityType: EntityType = 'SmallCraft';

  protected unitSubtypeKind(): 'Small Craft' | 'DropShip' {
    return 'Small Craft';
  }

  override unitSubtype(): UnitSubtype {
    const civilian = this.isMilitary() ? '' : 'Civilian ';
    const form = this.motiveType() === 'Spheroid' ? 'Spheroid' : 'Aerodyne';
    return this.withOmniSubtype(`${civilian}${form} ${this.unitSubtypeKind()}`);
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getSmallCraftConstructionTech(this.uniformArmor()?.type === 'PRIMITIVE_AERO')];
  }

  protected override computeImplicitSystemEquipment(): readonly Equipment[] {
    const implicit = [...super.computeImplicitSystemEquipment()];
    if (this.entityType !== 'SmallCraft'
      || !this.isMilitary()
      || this.equipment().some(mount => isEcmEquipment(mount.equipment))) {
      return implicit;
    }

    const ecmId = this.techBase() === 'Clan' ? 'CLSingle-Hex ECM' : 'ISSingle-Hex ECM';
    const automaticEcm = this.equipmentRegistry.findForTechBase(ecmId, this.techBase());
    if (automaticEcm) implicit.push(automaticEcm);
    return implicit;
  }

  // ── SmallCraft-specific signals ──

  designType = signal<AeroDesignType>('Civilian');

  /** Crew configuration */
  crew = signal<number>(0);
  officers = signal<number>(0);
  gunners = signal<number>(0);
  passengers = signal<number>(0);
  marines = signal<number>(0);
  battleArmor = signal<number>(0);
  otherPassenger = signal<number>(0);
  lifeboats = signal<number>(0);
  escapePods = signal<number>(0);

  /** Structured crew data (alternative to individual signals) */
  crewConfig = signal<SmallCraftCrew>({});

  private autoFilledCrew?: CrewConfiguration;

  /**
   * Reconciles the personnel and accommodation required by the current chassis tonnage.
   * Call after bulk updates that set crew, transporters, or equipment without changing tonnage.
   */
  reconcileCrewAndQuarters(): void {
    if (this.tonnage() <= MINIMUM_CREW_AND_QUARTERS_THRESHOLD_TONS) {
      this.restoreDeclaredCrew();
      this.transporters.update(transporters => transporters.filter(transporter =>
        transporter.kind !== 'bay' || !isQuartersBay(transporter)));
      return;
    }

    this.autoFilledCrew ??= {
      crew: this.crew(), officers: this.officers(), gunners: this.gunners(),
    };

    this.gunners.set(Math.max(this.gunners(), calculateSpacecraftRequiredGunners(this)));
    const bayPersonnel = calculateTransportBayPersonnel(this);
    const minimumCrew = this.gunners() + bayPersonnel + 3 + calculateSpacecraftEquipmentCrew(this);
    this.crew.set(Math.max(this.crew(), minimumCrew));
    if (this.officers() === 0) this.officers.set(Math.ceil((this.crew() - bayPersonnel) / 5));

    if (this.transporters().some(transporter => transporter.kind === 'bay' && isQuartersBay(transporter))) return;

    const standardQuarters = this.crew() - bayPersonnel - this.officers()
      + this.marines() + this.battleArmor();
    this.transporters.update(transporters => [
      ...transporters,
      this.createQuarters('first-class-quarters', this.officers(), 10, 0),
      this.createQuarters('second-class-quarters', this.passengers(), 7, 1),
      ...(standardQuarters > 0 ? [this.createQuarters('crew-quarters', standardQuarters, 7, 2)] : []),
    ]);
  }

  protected override onTonnageChanged(tonnage: number): void {
    super.onTonnageChanged(tonnage);
    this.reconcileCrewAndQuarters();
  }

  private restoreDeclaredCrew(): void {
    if (!this.autoFilledCrew) return;
    this.crew.set(this.autoFilledCrew.crew);
    this.officers.set(this.autoFilledCrew.officers);
    this.gunners.set(this.autoFilledCrew.gunners);
    this.autoFilledCrew = undefined;
  }

  private createQuarters(
    type: 'first-class-quarters' | 'second-class-quarters' | 'crew-quarters',
    capacity: number, tonsPerPerson: number, offset: number,
  ): EntityTransportBay {
    return {
      id: `transporter-${this.transporters().length + offset + 1}`,
      kind: 'bay', configuration: { type }, capacity, constructionWeight: capacity * tonsPerPerson,
      doors: 0, bayNumber: 0, omni: false,
    };
  }

  protected override computeMaximumArmorPoints(): number {
    const mountedArmor = this.uniformArmor();
    const isSpheroid = this.motiveType() === 'Spheroid';
    const pointsPerTon = mountedArmor
      ? smallCraftArmorPointsPerTon(this.tonnage(), isSpheroid, mountedArmor.armor)
      : 16;
    const armorWeightFactor = isSpheroid ? 3.6 : 4.5;
    const maximumArmorWeight = Math.floor(this.structuralIntegrity() * armorWeightFactor * 2) / 2;
    const siBonus = 4 * this.structuralIntegrity();
    const baseArmor = Math.floor(pointsPerTon * maximumArmorWeight + siBonus);
    return mountedArmor?.type === 'PRIMITIVE_AERO'
      ? Math.floor(baseArmor * 0.66)
      : baseArmor;
  }

  /** Small Craft has a single weight class. */
  protected override computeWeightClass(): WeightClass {
    return 'Small Craft';
  }

  // ── Location overrides ──

  get locationOrder(): readonly string[] {
    return SMALL_CRAFT_ARMOR_LOCATIONS;
  }

  get equipLocations(): readonly string[] {
    return [...SMALL_CRAFT_EQUIP_LOCATIONS];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...SMALL_CRAFT_EQUIP_LOCATIONS]);
  }
}
