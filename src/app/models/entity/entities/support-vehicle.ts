import { signal, type WritableSignal } from '@angular/core';
import { type MotiveType, type WeightClass, resolveSupportVehicleWeightClass } from '../types';

export class SupportVehicleData {
  readonly barRating: WritableSignal<number>;
  readonly structuralTechRating = signal<number>(0);
  readonly engineTechRating = signal<number>(0);

  constructor(defaultBarRating: number) {
    this.barRating = signal(defaultBarRating);
  }

  resolveWeightClass(tonnage: number, motiveType: MotiveType): WeightClass {
    return resolveSupportVehicleWeightClass(tonnage, motiveType);
  }
}

export interface SupportVehicle {
  readonly supportVehicle: SupportVehicleData;
  readonly barRating: WritableSignal<number>;
  readonly structuralTechRating: WritableSignal<number>;
  readonly engineTechRating: WritableSignal<number>;
  readonly fuel: WritableSignal<number>;
  isSupportVehicle(): this is this & SupportVehicle;
}