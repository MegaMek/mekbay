import { signal, type WritableSignal } from '@angular/core';
import type { BaseEntity } from '../base-entity';
import { SUPPORT_VEHICLE_WEIGHT_LIMITS, type MotiveType, type WeightClass, resolveWeightClass } from '../types';

export class SupportVehicleData {
  readonly isSupportVehicle = true as const;
  readonly barRating: WritableSignal<number>;
  readonly structuralTechRating = signal<number>(0);
  readonly engineTechRating = signal<number>(0);

  constructor(defaultBarRating: number) {
    this.barRating = signal(defaultBarRating);
  }

  resolveWeightClass(tonnage: number, motiveType: MotiveType): WeightClass {
    const limits = SUPPORT_VEHICLE_WEIGHT_LIMITS[motiveType] ?? SUPPORT_VEHICLE_WEIGHT_LIMITS['Tracked'];
    return resolveWeightClass(tonnage, limits);
  }
}

export interface SupportVehicle {
  readonly supportVehicle: SupportVehicleData;
  readonly barRating: WritableSignal<number>;
  readonly structuralTechRating: WritableSignal<number>;
  readonly engineTechRating: WritableSignal<number>;
  readonly fuel: WritableSignal<number>;
}

export function isSupportVehicle(entity: BaseEntity): entity is BaseEntity & SupportVehicle {
  return 'supportVehicle' in entity
    && (entity as BaseEntity & Partial<SupportVehicle>).supportVehicle?.isSupportVehicle === true;
}