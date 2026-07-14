import { signal } from '@angular/core';
import { EntityType, WeightClass } from '../../types';
import { SupportVehicleData, type SupportVehicle } from '../support-vehicle';
import { NavalEntity } from './naval-entity';

/** Support vehicle using Naval, Submarine, or Hydrofoil movement. */
export class SupportNavalEntity extends NavalEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'SupportNaval';
  readonly supportVehicle = new SupportVehicleData(-1);
  readonly barRating = this.supportVehicle.barRating;
  readonly structuralTechRating = this.supportVehicle.structuralTechRating;
  readonly engineTechRating = this.supportVehicle.engineTechRating;
  readonly fuel = signal<number>(0);

  protected override computeWeightClass(): WeightClass {
    return this.supportVehicle.resolveWeightClass(this.tonnage(), this.motiveType());
  }
}