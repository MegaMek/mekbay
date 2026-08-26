// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import { isQuartersBay } from '../../bays/bay-definitions';
import {
  AeroDesignType,
  EntityTransportBay,
  EntityType,
  INFANTRY_TRANSPORT_WEIGHTS,
  InfantryTransportType,
  SMALL_CRAFT_ARMOR_LOCATIONS,
  SMALL_CRAFT_EQUIP_LOCATIONS,
  SmallCraftCrew,
  StandardTransportBayType,
  WeightClass,
} from '../../types';
import { smallCraftArmorPointsPerTon } from '../../utils/large-craft-armor';
import { LargeAeroEntity } from './large-aero-entity';
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import { getSmallCraftConstructionTech } from '../../components';
import type { Equipment } from '../../../equipment.model';
import { isEcmEquipment } from '../../../ecm-mode.model';
import { isDroneOperatingSystemEquipment } from '../../../drone-operating-system.model';
import { supportEquipmentCrewContribution } from '../../../support-equipment.model';
import { sensorEquipmentCrewContribution } from '../../../sensor-equipment.model';
import { aerospaceSupportCrewContribution } from '../../../aerospace-support-equipment.model';

const MINIMUM_CREW_AND_QUARTERS_THRESHOLD_TONS = 25;
const INFANTRY_PERSONNEL: Readonly<Record<InfantryTransportType, { IS: number; Clan: number }>> = {
  Foot: { IS: 28, Clan: 25 },
  Jump: { IS: 21, Clan: 20 },
  Motorized: { IS: 28, Clan: 25 },
  Mechanized: { IS: 7, Clan: 5 },
};
const BAY_PERSONNEL_PER_CAPACITY: Partial<Record<StandardTransportBayType, number>> = {
  mek: 2, protomek: 6, 'light-vehicle': 5, 'heavy-vehicle': 8, 'super-heavy-vehicle': 15,
};

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

    this.gunners.set(Math.max(this.gunners(), this.calculateRequiredGunners()));
    const bayPersonnel = this.calculateBayPersonnel();
    const minimumCrew = this.gunners() + bayPersonnel + 3 + this.calculateEquipmentCrew();
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

  private calculateRequiredGunners(): number {
    if (this.equipment().some(mount => isDroneOperatingSystemEquipment(mount.equipment))) return 0;

    let capitalWeapons = 0;
    let standardWeapons = 0;
    for (const mount of this.equipment()) {
      const equipment = mount.equipment;
      if (!(equipment instanceof WeaponEquipment)) continue;
      if (equipment.ranges[2] <= 1 && equipment.ammoType !== 'MML') continue;
      if (equipment.capital) capitalWeapons++;
      else standardWeapons++;
    }
    return capitalWeapons + Math.ceil(standardWeapons / 6);
  }

  private calculateBayPersonnel(): number {
    return this.transporters().reduce((total, transporter) => {
      if (transporter.kind !== 'bay') return total;
      const configuration = transporter.configuration;
      switch (configuration.type) {
        case 'fighter': return total + (configuration.arts ? 0 : Math.trunc(transporter.capacity) * 2);
        case 'small-craft': return total + (configuration.arts ? 0 : Math.trunc(transporter.capacity) * 5);
        case 'battle-armor': return total + Math.trunc(transporter.capacity) * 6;
        case 'infantry': {
          const cubicles = Math.trunc(transporter.capacity / INFANTRY_TRANSPORT_WEIGHTS[configuration.infantryType]);
          return total + cubicles * INFANTRY_PERSONNEL[configuration.infantryType][this.techBase()];
        }
        case 'protomek': return total + Math.ceil(transporter.capacity) * BAY_PERSONNEL_PER_CAPACITY.protomek!;
        default: return total + Math.trunc(transporter.capacity)
          * (BAY_PERSONNEL_PER_CAPACITY[configuration.type as StandardTransportBayType] ?? 0);
      }
    }, 0);
  }

  private calculateEquipmentCrew(): number {
    return this.equipment().reduce((total, mount) => {
      const equipment = mount.equipment;
      if (!(equipment instanceof MiscEquipment)) return total;
      return total
        + supportEquipmentCrewContribution(this, mount)
        + aerospaceSupportCrewContribution(equipment)
        + sensorEquipmentCrewContribution(equipment);
    }, 0);
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
