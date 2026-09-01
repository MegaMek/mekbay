// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import type { EntityType } from '../../models/entity/types';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { FluffImageAssetRef } from '../../models/presentation-catalog.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import {
  MM_DATA_UNIT_PROVIDER_ID,
  type DesignIdentity,
} from '../unit-catalog/unit-catalog.types';
import {
  parseFluffImageCatalog,
  type FluffImageFacts,
  type FluffImagePath,
} from '../../utils/fluff-image-resolver';
import { FluffImageCatalogService } from './fluff-image-catalog.service';

type PresentationUnit = Pick<
  UnitSummary,
  'uuid' | 'chassis' | 'model' | 'type' | 'subtype' | 'weightClass'
> & Partial<Pick<UnitSummary, 'provider' | 'entityType' | 'baseChassis' | 'clanName'>>;

/**
 * The only production bridge from a unit to fluff art.
 * mm-data units resolve through images.json; the persisted summary never owns an image path.
 */
@Injectable({ providedIn: 'root' })
export class UnitFluffImageService {
  private readonly catalog = inject(FluffImageCatalogService);

  resolveUrl(unit: PresentationUnit | null | undefined): string | null {
    if (!unit) return null;

    return this.resolveCatalogUrl(unit);
  }

  resolveEntityUrl(entity: BaseEntity, design?: DesignIdentity): string | null {
    const identity: DesignIdentity = design ?? {
      provider: MM_DATA_UNIT_PROVIDER_ID,
      uuid: entity.uuid(),
    };
    const resolution = this.catalog.resolveUnitImage(identity, {
      entityType: entity.entityType,
      baseChassis: entity.chassis(),
      model: entity.model(),
      ...(entity.clanName() ? { clanName: entity.clanName() } : {}),
    });
    return resolution.status === 'matched' ? fluffImageAssetUrl(resolution.asset) : null;
  }

  private resolveCatalogUrl(unit: PresentationUnit): string | null {
    const design: DesignIdentity = {
      provider: unit.provider ?? MM_DATA_UNIT_PROVIDER_ID,
      uuid: unit.uuid,
    };

    const entityType = unit.entityType ?? legacyEntityType(unit);
    if (!entityType) return null;
    const facts: FluffImageFacts = {
      entityType,
      baseChassis: unit.baseChassis ?? unit.chassis,
      model: unit.model,
      ...(unit.clanName !== undefined && { clanName: unit.clanName }),
    };
    const resolution = this.catalog.resolveUnitImage(design, facts);
    return resolution.status === 'matched' ? fluffImageAssetUrl(resolution.asset) : null;
  }
}

/** URL construction is centralized so validated catalog paths cannot become arbitrary URLs. */
export function fluffImageAssetUrl(asset: FluffImageAssetRef): string {
  return joinFluffImageUrl(asset.baseUrl, asset.path);
}

function joinFluffImageUrl(baseUrl: string, path: FluffImagePath): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/images/fluff/${encodedPath}`;
}

function legacyEntityType(unit: PresentationUnit): EntityType | undefined {
  switch (unit.subtype) {
    case 'Battle Armor': return 'BattleArmor';
    case 'Conventional Infantry':
    case 'Mechanized Conventional Infantry':
    case 'Motorized Conventional Infantry': return 'Infantry';
    case 'Conventional Fighter': return 'ConvFighter';
    case 'Fixed Wing Support Vehicle':
    case 'Fixed Wing Support Vehicle Omni': return 'FixedWingSupport';
    case 'Aerospace Fighter':
    case 'Aerospace Fighter Omni': return 'Aero';
    case 'Aerodyne Small Craft':
    case 'Civilian Aerodyne Small Craft':
    case 'Spheroid Small Craft': return 'SmallCraft';
    case 'Aerodyne DropShip':
    case 'Civilian Aerodyne DropShip':
    case 'Civilian Spheroid DropShip':
    case 'Spheroid DropShip': return 'DropShip';
    case 'JumpShip': return 'JumpShip';
    case 'WarShip': return 'WarShip';
    case 'Civilian Space Station':
    case 'Military Space Station': return 'SpaceStation';
    case 'ProtoMek':
    case 'Quad ProtoMek': return 'ProtoMek';
    case 'Handheld Weapon': return 'HandheldWeapon';
    case 'Gun Emplacement': return 'GunEmplacement';
    case 'Building': return 'BuildingEntity';
    default: break;
  }

  if (unit.type === 'Mek') return 'Mek';
  if (unit.type === 'Infantry') return 'Infantry';
  if (unit.type === 'ProtoMek') return 'ProtoMek';
  if (unit.type === 'Aero') return 'Aero';
  if (unit.type === 'Naval') {
    return unit.subtype === 'Support Vehicle' || unit.subtype === 'Support Vehicle Omni'
      ? 'SupportNaval'
      : 'Naval';
  }
  if (unit.type === 'VTOL') {
    return unit.subtype === 'Support Vehicle' || unit.subtype === 'Support Vehicle Omni'
      ? 'SupportVTOL'
      : 'VTOL';
  }
  if (unit.type === 'Tank') {
    if (unit.subtype === 'Support Vehicle' || unit.subtype === 'Support Vehicle Omni') {
      return unit.weightClass === 'Large Support Vehicle' ? 'LargeSupportTank' : 'SupportTank';
    }
    return 'Tank';
  }
  return undefined;
}
