// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BaseEntity } from '../models/entity/base-entity';
import { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import type { EntityType } from '../models/entity/types';
import { UNIT_SUMMARY_VERSION } from '../models/unit-summary.model';
import type {
  AlphaStrikeUnitStats,
  UnitSummary,
  UnitComponent,
  UnitSummaryComponent,
  WeightClass,
} from '../models/unit-summary.model';
import {
  asUnitUuid,
  type CatalogEntryKey,
  type NativeUnitFormat,
} from '../services/unit-catalog/unit-catalog.types';
import { buildUnitComponentMetadata } from './unit-component-metadata-builder';
import { UnitMetadataBuilder } from './unit-metadata-builder';
import type { UnitIconResolver } from './unit-sprite-resolver';
import { canonicalOptionalClanName } from './fluff-image-resolver';
import { calculateUnitSustainedDamage } from './unit-sustained-damage';
import { buildUnitRulesRefs } from './unit-rules-ref-builder';

export interface UnitSummaryBuildContext {
  readonly entryKey: CatalogEntryKey;
  readonly format?: NativeUnitFormat;
}

const REQUIRED_METADATA_FIELDS = [
  'name', 'id', 'chassis', 'model', 'year', 'weightClass', 'tons', 'loadoutTons',
  'offSpeedFactor', 'bv', 'cost', 'level', 'techBase', 'mixed', 'techRating',
  'type', 'subtype', 'omni', 'engine', 'engineRating', 'engineHS', 'engineHSType',
  'source', 'published', 'canon', 'canAntiMech', 'role', 'armorType',
  'rulesRefs',
  'structureType', 'armor', 'armorPer', 'internal', 'squads', 'squadSize', 'heat',
  'dissipation', 'moveType', 'walk', 'walk2', 'run', 'run2', 'jump', 'jump2',
  'umu', 'c3', 'comp', 'su', 'crewSize', 'quirks', 'features', 'icon', 'as',
] as const satisfies readonly (keyof UnitSummary)[];

type RequiredMetadataField = typeof REQUIRED_METADATA_FIELDS[number];
type CompleteMetadata = Partial<UnitSummary> & Required<Pick<UnitSummary, RequiredMetadataField>>;

/** Total, versioned-catalog-ready projection from one parsed entity. */
export class UnitSummaryBuilder {
  private readonly metadataBuilder: UnitMetadataBuilder;

  constructor(private readonly resolveIcon: UnitIconResolver = () => '') {
    this.metadataBuilder = new UnitMetadataBuilder(resolveIcon);
  }

  /** Build the entity-derived base. Sheets are composed separately without reparsing. */
  build(entity: BaseEntity, context: UnitSummaryBuildContext): UnitSummary {
    const loadIssues = entity.loadIssues().map(issue => ({ ...issue }));
    const uuid = validateIdentityAndSource(entity, context);
    if (entity instanceof StaticEmplacementEntity) {
      return this.buildStaticEmplacement(entity, context, uuid);
    }

    const metadata = this.metadataBuilder.build(entity);
    assertCompleteMetadata(metadata);
    const components = cloneComponents(metadata.comp);

    return {
      uuid,
      provider: context.entryKey.design.provider,
      origin: context.entryKey.origin,
      hash: context.entryKey.sourceRevision,
      summaryVersion: UNIT_SUMMARY_VERSION,
      loadIssues,
      name: metadata.name,
      id: metadata.id,
      chassis: entity.fullChassis(),
      baseChassis: entity.chassis(),
      ...optionalClanName(entity),
      model: metadata.model,
      year: metadata.year,
      weightClass: metadata.weightClass,
      tons: metadata.tons,
      loadoutTons: metadata.loadoutTons,
      offSpeedFactor: metadata.offSpeedFactor,
      bv: metadata.bv,
      pv: metadata.as.PV,
      cost: metadata.cost,
      level: metadata.level,
      techBase: metadata.techBase,
      mixed: metadata.mixed,
      techRating: metadata.techRating,
      type: metadata.type,
      subtype: metadata.subtype,
      entityType: entity.entityType,
      omni: metadata.omni,
      engine: metadata.engine || null,
      engineRating: metadata.engineRating,
      engineHS: metadata.engineHS,
      engineHSType: metadata.engineHSType,
      source: [...metadata.source],
      published: [...metadata.published],
      rulesRefs: metadata.rulesRefs.map(combination => [...combination]),
      canon: metadata.canon,
      canAntiMech: metadata.canAntiMech,
      role: metadata.role,
      armorType: metadata.armorType,
      structureType: metadata.structureType,
      armor: metadata.armor,
      armorPer: metadata.armorPer,
      internal: metadata.internal,
      squads: metadata.squads,
      squadSize: metadata.squadSize,
      heat: metadata.heat,
      dissipation: metadata.dissipation,
      ...(metadata.diss !== undefined && { diss: [...metadata.diss] }),
      moveType: metadata.moveType,
      walk: metadata.walk,
      walk2: metadata.walk2,
      run: metadata.run,
      run2: metadata.run2,
      jump: metadata.jump,
      jump2: metadata.jump2,
      umu: metadata.umu,
      c3: metadata.c3,
      dpt: calculateUnitSustainedDamage(entity, metadata.comp),
      comp: components,
      su: metadata.su,
      crewSize: metadata.crewSize,
      quirks: [...metadata.quirks],
      features: [...metadata.features],
      icon: metadata.icon,
      ...(metadata.cargo !== undefined && { cargo: metadata.cargo.map(item => ({ ...item })) }),
      ...(metadata.capital !== undefined && {
        capital: { ...metadata.capital, gravDecks: [...metadata.capital.gravDecks] },
      }),
      as: cloneAlphaStrike(metadata.as),
    };
  }

  private buildStaticEmplacement(
    entity: StaticEmplacementEntity,
    context: UnitSummaryBuildContext,
    uuid: ReturnType<typeof asUnitUuid>,
  ): UnitSummary {
    const loadIssues = entity.loadIssues().map(issue => ({ ...issue }));
    const components = cloneComponents(buildUnitComponentMetadata(entity) ?? []);
    const armor = entity.totalArmorPoints();
    const maximumArmor = entity.maximumArmorPoints();
    const alphaStrike = unavailableAlphaStrike();
    return {
      uuid,
      provider: context.entryKey.design.provider,
      origin: context.entryKey.origin,
      hash: context.entryKey.sourceRevision,
      summaryVersion: UNIT_SUMMARY_VERSION,
      loadIssues,
      name: buildStaticName(entity),
      id: entity.mulId(),
      chassis: entity.fullChassis(),
      baseChassis: entity.chassis(),
      ...optionalClanName(entity),
      model: entity.model(),
      year: entity.year(),
      weightClass: exportWeightClass(entity),
      tons: entity.tonnage(),
      loadoutTons: 0,
      offSpeedFactor: 0,
      bv: 0,
      pv: 0,
      cost: 0,
      level: entity.staticTechLevel(),
      techBase: entity.techBase() === 'IS' ? 'Inner Sphere' : 'Clan',
      mixed: entity.mixedTech(),
      techRating: entity.techRating(),
      type: entity.unitType(),
      subtype: entity.unitSubtype(),
      entityType: entity.entityType,
      omni: entity.omni() ? 1 : 0,
      engine: null,
      engineRating: 0,
      engineHS: 0,
      engineHSType: null,
      source: entity.source().map(source => source.abbrev),
      published: entity.published().map(source => source.abbrev),
      rulesRefs: buildUnitRulesRefs(entity),
      canon: entity.canon(),
      canAntiMech: false,
      role: entity.role() || 'None',
      armorType: entity.uniformArmor()?.armor.name ?? '',
      structureType: entity.uniformStructureMaterial()?.structure.name ?? null,
      armor,
      armorPer: maximumArmor > 0 ? Math.round(armor / maximumArmor * 100) : 0,
      internal: entity.totalInternalPoints(),
      squads: 0,
      squadSize: 0,
      heat: -1,
      dissipation: -1,
      moveType: 'None',
      walk: 0,
      walk2: 0,
      run: 0,
      run2: 0,
      jump: 0,
      jump2: 0,
      umu: 0,
      c3: entity.c3System(),
      dpt: 0,
      comp: components,
      su: 0,
      crewSize: entity.crewSlotCount(),
      quirks: entity.quirks().map(({ quirk }) => quirk.name),
      features: [...entity.entityFeatures()],
      icon: this.resolveIcon(entity),
      as: alphaStrike,
    };
  }
}

function validateIdentityAndSource(
  entity: BaseEntity,
  context: UnitSummaryBuildContext,
): ReturnType<typeof asUnitUuid> {
  const uuid = asUnitUuid(entity.uuid());
  if (uuid !== context.entryKey.design.uuid) {
    throw new Error(`Entity UUID ${uuid} does not match catalog UUID ${context.entryKey.design.uuid}`);
  }

  if (context.entryKey.origin === 'megamek') {
    if (!context.format) throw new Error('MegaMek summary entries require a native MTF/BLK source');
    const requiredFormat = entity.entityType === 'Mek' ? 'mtf' : 'blk';
    if (context.format !== requiredFormat) {
      throw new Error(`${entity.entityType} requires native ${requiredFormat.toUpperCase()} source`);
    }
  }
  return uuid;
}

function assertCompleteMetadata(metadata: Partial<UnitSummary>): asserts metadata is CompleteMetadata {
  for (const field of REQUIRED_METADATA_FIELDS) {
    if (metadata[field] === undefined) {
      throw new Error(`Unit metadata projection omitted required field: ${field}`);
    }
  }
}

function cloneComponents(components: readonly UnitComponent[]): UnitSummaryComponent[] {
  return components.map(component => {
    const { eq: _equipment, bay, ...plain } = component;
    return {
      ...plain,
      ...(bay !== undefined && { bay: cloneComponents(bay) }),
    };
  });
}

function optionalClanName(entity: BaseEntity): { readonly clanName?: string } {
  const clanName = canonicalOptionalClanName(entity.clanName());
  return clanName === undefined ? {} : { clanName };
}

function cloneAlphaStrike(as: AlphaStrikeUnitStats): AlphaStrikeUnitStats {
  const cloneArc = (arc: AlphaStrikeUnitStats['frontArc']) => arc === undefined ? undefined : {
    STD: { ...arc.STD }, CAP: { ...arc.CAP }, MSL: { ...arc.MSL }, SCAP: { ...arc.SCAP },
    specials: [...arc.specials],
  };
  return {
    ...as,
    MVm: { ...as.MVm },
    specials: [...as.specials],
    dmg: { ...as.dmg },
    ...(as.frontArc !== undefined && { frontArc: cloneArc(as.frontArc)! }),
    ...(as.rearArc !== undefined && { rearArc: cloneArc(as.rearArc)! }),
    ...(as.leftArc !== undefined && { leftArc: cloneArc(as.leftArc)! }),
    ...(as.rightArc !== undefined && { rightArc: cloneArc(as.rightArc)! }),
  };
}

function unavailableAlphaStrike(): AlphaStrikeUnitStats {
  return {
    TP: 'XX', PV: 0, SZ: 0, TMM: null,
    usesOV: false, OV: 0, MV: '', MVm: {}, MVp: '',
    usesTh: false, Th: -1, Arm: 0, Str: 0, specials: [],
    dmg: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
    usesE: false, usesArcs: false,
  };
}

function buildStaticName(entity: StaticEmplacementEntity): string {
  return `${entity.chassis()}_${entity.model()}`
    .replace(/[^a-zA-Z0-9_]/gu, '')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function exportWeightClass(entity: BaseEntity): WeightClass {
  switch (entity.weightClass()) {
    case 'Ultra Light': return 'Ultra Light/PA(L)/Exoskeleton';
    case 'Light': return 'Light';
    case 'Medium': return 'Medium';
    case 'Heavy': return 'Heavy';
    case 'Assault': return 'Assault';
    case 'Super Heavy': return 'Colossal/Super-Heavy';
    case 'Small Craft': return 'Small Craft';
    case 'Small DropShip': return 'Small DropShip';
    case 'Medium DropShip': return 'Medium DropShip';
    case 'Large DropShip': return 'Large DropShip';
    case 'Small Support': return 'Small Support Vehicle';
    case 'Medium Support': return 'Medium Support Vehicle';
    case 'Large Support': return 'Large Support Vehicle';
    case 'Small Capital': return capitalWeightClass(entity.entityType, 'Small');
    case 'Large Capital': return capitalWeightClass(entity.entityType, 'Large');
  }
}

function capitalWeightClass(entityType: EntityType, size: 'Small' | 'Large'): WeightClass {
  if (entityType === 'WarShip') return `${size} WarShip`;
  if (entityType === 'SpaceStation') return `${size} Space Station`;
  return `${size} JumpShip`;
}
