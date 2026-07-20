import { signal } from '@angular/core';
import { EntityType, WeightClass } from '../../types';
import { SupportVehicleData, type SupportVehicle } from '../support-vehicle';
import { NavalEntity } from './naval-entity';
import type { TechRatingSource } from '../../types';
import { getSupportTankConstructionTech } from '../../components';

/** Support vehicle using Naval, Submarine, or Hydrofoil movement. */
export class SupportNavalEntity extends NavalEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'SupportNaval';
  readonly supportVehicle = new SupportVehicleData(-1);
  readonly barRating = this.supportVehicle.barRating;
  readonly structuralTechRating = this.supportVehicle.structuralTechRating;
  readonly engineTechRating = this.supportVehicle.engineTechRating;
  readonly fuel = signal<number>(0);

  override isSupportVehicle(): this is this & SupportVehicle {
    return true;
  }

  protected override vehicleConstructionTechAdvancement(): TechRatingSource {
    return getSupportTankConstructionTech(this.motiveType(), this.weightClass());
  }

  protected override computeWeightClass(): WeightClass {
    return this.supportVehicle.resolveWeightClass(this.tonnage(), this.motiveType());
  }
}
