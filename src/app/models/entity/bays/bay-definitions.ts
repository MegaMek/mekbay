import { INFANTRY_TRANSPORT_WEIGHTS } from '../types/transport';
import type {
  EntityTransportBay,
  StandardTransportBayType,
  TransportBayConfiguration,
} from '../types/transport';

/** Returns the verifier construction mass represented by a canonical transport bay. */
export function getBayConstructionWeight(bay: EntityTransportBay): number {
  if (bay.constructionWeight !== undefined) return bay.constructionWeight;
  const capacity = bay.capacity;
  switch (bay.configuration.type) {
    case 'mek': return capacity * 150;
    case 'protomek':
    case 'light-vehicle': return capacity * 50;
    case 'heavy-vehicle': return capacity * 100;
    case 'super-heavy-vehicle': return capacity * 200;
    case 'fighter': return capacity * (bay.configuration.arts ? 187.5 : 150);
    case 'small-craft': return capacity * (bay.configuration.arts ? 250 : 200);
    case 'battle-armor': return capacity * (bay.configuration.techBase === 'Clan'
      ? 10 : bay.configuration.comStar ? 12 : 8);
    case 'drop-shuttle': return 11_000;
    case 'naval-repair': {
      const factor = (bay.configuration.pressurized ? 0.075 : 0.025)
        * (bay.configuration.arts ? 1.25 : 1);
      return Math.ceil(capacity * factor * 2) / 2;
    }
    case 'reinforced-repair': return Math.ceil(capacity * 0.1 * 2) / 2;
    default: return capacity;
  }
}

interface StandardBayDefinition {
  blkType: string;
  aliases?: readonly string[];
  transporterType: string;
  recordSheetName?: string;
  quarters?: boolean;
  tonsPerPerson?: number;
}

const STANDARD_BAY_DEFINITIONS: Readonly<Record<StandardTransportBayType, StandardBayDefinition>> = {
  generic: { blkType: 'bay', transporterType: 'Unknown' },
  cargo: { blkType: 'cargobay', transporterType: 'Cargo' },
  'liquid-cargo': { blkType: 'LiquidCargoBay', transporterType: 'Liquid Cargo' },
  'insulated-cargo': { blkType: 'insulatedcargobay', transporterType: 'Insulated Cargo' },
  'refrigerated-cargo': { blkType: 'refrigeratedcargobay', transporterType: 'Reefer' },
  'livestock-cargo': { blkType: 'livestockcargobay', transporterType: 'Livestock Cargo' },
  mek: { blkType: 'mekbay', aliases: ['mechbay'], transporterType: 'Mek', recordSheetName: 'Mech' },
  'light-vehicle': { blkType: 'lightvehiclebay', transporterType: 'Light Vehicle' },
  'heavy-vehicle': { blkType: 'heavyvehiclebay', transporterType: 'Heavy Vehicle' },
  'super-heavy-vehicle': { blkType: 'superheavyvehiclebay', transporterType: 'Superheavy Vehicle' },
  protomek: { blkType: 'ProtoMekBay', transporterType: 'ProtoMek', recordSheetName: 'ProtoMech' },
  'crew-quarters': { blkType: 'crewquarters', transporterType: 'Crew Quarters', quarters: true, tonsPerPerson: 7 },
  'steerage-quarters': { blkType: 'steeragequarters', transporterType: 'Steerage Quarters', quarters: true, tonsPerPerson: 5 },
  'second-class-quarters': { blkType: '2ndclassquarters', transporterType: '2nd Class Quarters', quarters: true, tonsPerPerson: 7 },
  'first-class-quarters': { blkType: '1stclassquarters', transporterType: '1st Class Quarters', quarters: true, tonsPerPerson: 10 },
  'pillion-seats': { blkType: 'pillionseats', transporterType: 'Pillion Seats', quarters: true },
  'standard-seats': { blkType: 'standardseats', transporterType: 'Standard Seats', quarters: true },
  'ejection-seats': { blkType: 'ejectionseats', transporterType: 'Ejection Seats', quarters: true },
};

const STANDARD_TYPE_BY_BLK = new Map<string, StandardTransportBayType>();
for (const [type, definition] of Object.entries(STANDARD_BAY_DEFINITIONS) as [StandardTransportBayType, StandardBayDefinition][]) {
  STANDARD_TYPE_BY_BLK.set(definition.blkType.toLowerCase(), type);
  for (const alias of definition.aliases ?? []) STANDARD_TYPE_BY_BLK.set(alias.toLowerCase(), type);
}

export function resolveStandardBayType(blkType: string): StandardTransportBayType | undefined {
  return STANDARD_TYPE_BY_BLK.get(blkType.toLowerCase());
}

export function decodeBaySize(
  configuration: TransportBayConfiguration,
  sourceSize: number,
): Pick<EntityTransportBay, 'capacity' | 'constructionWeight'> {
  if (configuration.type === 'infantry') {
    return { capacity: sourceSize * INFANTRY_TRANSPORT_WEIGHTS[configuration.infantryType] };
  }
  if (configuration.type === 'drop-shuttle') return { capacity: 2 };
  if (configuration.type === 'liquid-cargo') {
    return { capacity: sourceSize, constructionWeight: sourceSize / 0.91 };
  }
  if (configuration.type === 'insulated-cargo' || configuration.type === 'refrigerated-cargo') {
    return { capacity: sourceSize, constructionWeight: sourceSize / 0.87 };
  }
  if (configuration.type === 'livestock-cargo') {
    return { capacity: sourceSize, constructionWeight: sourceSize / 0.83 };
  }

  const definition = STANDARD_BAY_DEFINITIONS[configuration.type as StandardTransportBayType];
  if (definition?.tonsPerPerson) {
    return { capacity: Math.floor(sourceSize / definition.tonsPerPerson), constructionWeight: sourceSize };
  }
  return { capacity: sourceSize };
}

export function encodeBaySize(bay: EntityTransportBay): number {
  if (bay.configuration.type === 'infantry') {
    return bay.capacity / INFANTRY_TRANSPORT_WEIGHTS[bay.configuration.infantryType];
  }
  if (['liquid-cargo', 'insulated-cargo', 'refrigerated-cargo', 'livestock-cargo']
    .includes(bay.configuration.type)) {
    return bay.capacity;
  }
  const definition = STANDARD_BAY_DEFINITIONS[bay.configuration.type as StandardTransportBayType];
  if (definition?.tonsPerPerson) {
    return bay.constructionWeight ?? bay.capacity * definition.tonsPerPerson;
  }
  return bay.constructionWeight ?? bay.capacity;
}

export function getBayBlkType(configuration: TransportBayConfiguration): string {
  switch (configuration.type) {
    case 'fighter': return `${configuration.arts ? 'arts' : ''}asfbay`;
    case 'small-craft': return `${configuration.arts ? 'arts' : ''}smallcraftbay`;
    case 'infantry': return 'infantrybay';
    case 'battle-armor': return 'battlearmorbay';
    case 'drop-shuttle': return 'dropshuttlebay';
    case 'naval-repair': return `${configuration.arts ? 'arts' : ''}navalrepair${configuration.pressurized ? 'pressurized' : 'unpressurized'}`;
    case 'reinforced-repair': return 'reinforcedrepairfacility';
    default: return STANDARD_BAY_DEFINITIONS[configuration.type].blkType;
  }
}

export function getBayTransporterType(configuration: TransportBayConfiguration): string {
  switch (configuration.type) {
    case 'fighter': return `${configuration.arts ? 'ARTS ' : ''}Fighter`;
    case 'small-craft': return `${configuration.arts ? 'ARTS ' : ''}Small Craft`;
    case 'infantry': return `Infantry (${configuration.infantryType})`;
    case 'battle-armor': return 'Battle Armor';
    case 'drop-shuttle': return 'DropShuttle Bay';
    case 'naval-repair': {
      const pressure = configuration.pressurized ? '(Pressurized)' : 'Unpressurized';
      return `${configuration.arts ? 'ARTS ' : ''}Naval Repair Facility ${pressure}`;
    }
    case 'reinforced-repair': return 'Naval Repair Facility (Reinforced)';
    default: return STANDARD_BAY_DEFINITIONS[configuration.type].transporterType;
  }
}

export function getBayRecordSheetName(configuration: TransportBayConfiguration): string {
  if (configuration.type in STANDARD_BAY_DEFINITIONS) {
    const definition = STANDARD_BAY_DEFINITIONS[configuration.type as StandardTransportBayType];
    return definition.recordSheetName ?? definition.transporterType;
  }
  return getBayTransporterType(configuration);
}

export function getBayRecordSheetCapacity(bay: EntityTransportBay): number {
  switch (bay.configuration.type) {
    case 'battle-armor':
      return bay.capacity * (bay.configuration.techBase === 'Clan' ? 5 : bay.configuration.comStar ? 6 : 4);
    case 'infantry':
      return bay.capacity / INFANTRY_TRANSPORT_WEIGHTS[bay.configuration.infantryType];
    case 'protomek': return bay.capacity * 5;
    default: return bay.capacity;
  }
}

export function isQuartersBay(bay: EntityTransportBay): boolean {
  if (!(bay.configuration.type in STANDARD_BAY_DEFINITIONS)) return false;
  return STANDARD_BAY_DEFINITIONS[bay.configuration.type as StandardTransportBayType].quarters ?? false;
}