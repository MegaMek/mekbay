import type { EntityTechBase } from '../types/tech';
import {
  DEFAULT_TRANSPORT_BAY_NUMBER,
  UNSET_TRANSPORT_BAY_NUMBER,
} from '../types/transport';
import type {
  EntityTransportBay,
  EntityTransporter,
  InfantryTransportType,
  TransportBayConfiguration,
} from '../types/transport';
import { decodeBaySize, encodeBaySize, getBayBlkType, resolveStandardBayType } from '../bays/bay-definitions';
import type { ParseContext } from './parse-context';

const COMSTAR_BIT = 1;
const CLAN_BIT = 2;

function parseInteger(value: string): number | undefined {
  if (!/^[+-]?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647
    ? parsed
    : undefined;
}

function parseFiniteDouble(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitTransporterNumbers(numbers: string): string[] {
  const fields = numbers.split(':');
  while (fields.at(-1) === '') fields.pop();
  return fields;
}

function infantryType(value: string): InfantryTransportType | undefined {
  switch (value.toLowerCase()) {
    case '':
    case 'foot': return 'Foot';
    case 'jump': return 'Jump';
    case 'motorized': return 'Motorized';
    case 'mechanized': return 'Mechanized';
    default: return undefined;
  }
}

function normalizeBayFields(fields: readonly string[], clanTechBase: boolean): string[] | undefined {
  if (fields.length === 6) return [...fields];
  if (fields.length < 2 || fields.length > 6) return undefined;

  const normalized = [fields[0], fields[1], '-1', '', '-1', clanTechBase ? String(CLAN_BIT) : '0'];
  if (fields.length === 2) return normalized;

  if (parseInteger(fields[2]) !== undefined) normalized[2] = fields[2];
  const indicator = fields.length === 3
    ? fields[2]
    : fields.length === 4
      ? fields[3]
      : '';
  if (fields.length === 4) normalized[2] = fields[2];
  if (indicator) {
    const normalizedIndicator = indicator.toLowerCase();
    if (normalizedIndicator === 'c*') {
      normalized[5] = String(Number(normalized[5]) | COMSTAR_BIT);
    } else if (['foot', 'jump', 'motorized', 'mechanized'].includes(normalizedIndicator)) {
      normalized[3] = indicator;
      if (normalized[2] === indicator) normalized[2] = '-1';
    } else if (normalizedIndicator.startsWith('f')) {
      normalized[4] = indicator.substring(1);
    }
  }
  return normalized;
}

function bayConfiguration(
  type: string,
  arts: boolean,
  platoonType: InfantryTransportType,
  facing: number,
  bitmap: number,
): TransportBayConfiguration | undefined {
  const standardType = resolveStandardBayType(type);
  if (standardType) return { type: standardType };

  switch (type) {
    case 'asfbay': return { type: 'fighter', arts };
    case 'smallcraftbay': return { type: 'small-craft', arts };
    case 'infantrybay': return { type: 'infantry', infantryType: platoonType };
    case 'battlearmorbay':
      return { type: 'battle-armor', techBase: (bitmap & CLAN_BIT) !== 0 ? 'Clan' : 'IS', comStar: (bitmap & COMSTAR_BIT) !== 0 };
    case 'dropshuttlebay': return { type: 'drop-shuttle', facing };
    case 'navalrepairpressurized': return { type: 'naval-repair', facing, pressurized: true, arts };
    case 'navalrepairunpressurized': return { type: 'naval-repair', facing, pressurized: false, arts };
    case 'reinforcedrepairfacility': return { type: 'reinforced-repair', facing };
    default: return undefined;
  }
}

function usesDefaultRuntimeBayNumber(configuration: TransportBayConfiguration): boolean {
  switch (configuration.type) {
    case 'crew-quarters':
    case 'steerage-quarters':
    case 'second-class-quarters':
    case 'first-class-quarters':
    case 'pillion-seats':
    case 'standard-seats':
    case 'ejection-seats':
      return true;
    default:
      return false;
  }
}

function runtimeBayNumber(configuration: TransportBayConfiguration, allocatedBayNumber: number): number {
  return usesDefaultRuntimeBayNumber(configuration)
    ? DEFAULT_TRANSPORT_BAY_NUMBER
    : allocatedBayNumber;
}

function runtimeDoors(configuration: TransportBayConfiguration, parsedDoors: number): number {
  switch (configuration.type) {
    case 'pillion-seats':
    case 'standard-seats':
    case 'ejection-seats':
      return 0;
    default:
      return parsedDoors;
  }
}

function serializedBayNumber(bay: EntityTransportBay): number {
  switch (bay.configuration.type) {
    case 'mek':
    case 'crew-quarters':
    case 'steerage-quarters':
    case 'second-class-quarters':
    case 'first-class-quarters':
    case 'pillion-seats':
    case 'standard-seats':
    case 'ejection-seats':
      return UNSET_TRANSPORT_BAY_NUMBER;
    default:
      return bay.bayNumber;
  }
}

export function parseTransporterLines(
  lines: readonly string[],
  entityTechBase: EntityTechBase,
  context: ParseContext,
): EntityTransporter[] {
  const transporters: EntityTransporter[] = [];
  const usedBayNumbers = new Set<number>();

  const allocateBayNumber = (requested: number): number => {
    if (requested !== UNSET_TRANSPORT_BAY_NUMBER && !usedBayNumbers.has(requested)) {
      usedBayNumbers.add(requested);
      return requested;
    }
    let assigned = 1;
    while (usedBayNumbers.has(assigned)) assigned++;
    usedBayNumbers.add(assigned);
    return assigned;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const id = `transporter-${transporters.length + 1}`;
    const normalizedLine = trimmed.toLowerCase();
    const omni = normalizedLine.endsWith(':omni');
    const transporter = normalizedLine.replace(/:omni/g, '');
    const separator = transporter.indexOf(':');
    let rawType = separator === -1 ? transporter : transporter.substring(0, separator);
    const numbers = separator === -1 ? '' : transporter.substring(separator + 1);
    const fields = splitTransporterNumbers(numbers);
    const arts = rawType.startsWith('arts');
    if (arts) rawType = rawType.substring(4);

    if (rawType === 'troopspace') {
      const totalSpace = parseFiniteDouble(numbers);
      if (totalSpace !== undefined) {
        transporters.push({ id, kind: 'troop-space', totalSpace, omni });
      } else {
        context.warn('transporters', `Invalid troop-space capacity in "${trimmed}"`);
        transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      }
      continue;
    }

    // This is runtime carriage state emitted by MegaMek. BLKFile ignores it;
    // OmniMeks and OmniVehicles get their handles during entity construction.
    if (rawType.startsWith('battlearmorhandles')) {
      continue;
    }

    if (rawType === 'dockingcollar') {
      // BLKFile gives a collar an implicit allocated number, but does not pass
      // its pod flag to DockingCollar.
      transporters.push({ id, kind: 'docking-collar', collarNumber: allocateBayNumber(UNSET_TRANSPORT_BAY_NUMBER), omni: false });
      continue;
    }

    const normalized = normalizeBayFields(fields, rawType === 'battlearmorbay' && entityTechBase === 'Clan');
    if (!normalized) {
      context.warn('transporters', `Invalid transporter fields in "${trimmed}"`);
      transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      continue;
    }

    const sourceSpace = parseFiniteDouble(normalized[0]);
    const doors = parseInteger(normalized[1]);
    const requestedBayNumber = parseInteger(normalized[2]);
    const platoonType = infantryType(normalized[3]);
    const facing = parseInteger(normalized[4]);
    const bitmap = parseInteger(normalized[5]);
    if (
      sourceSpace === undefined
      || doors === undefined
      || requestedBayNumber === undefined
      || platoonType === undefined
      || facing === undefined
      || bitmap === undefined
    ) {
      context.warn('transporters', `Unknown or invalid transporter "${trimmed}"`);
      transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      continue;
    }

    const configuration = bayConfiguration(rawType, arts, platoonType, facing, bitmap);
    if (!configuration) {
      context.warn('transporters', `Unknown or invalid transporter "${trimmed}"`);
      transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      continue;
    }

    const size = decodeBaySize(configuration, sourceSpace);
    const allocatedBayNumber = allocateBayNumber(requestedBayNumber);
    transporters.push({
      id,
      kind: 'bay',
      configuration,
      ...size,
      doors: runtimeDoors(configuration, doors),
      bayNumber: runtimeBayNumber(configuration, allocatedBayNumber),
      omni,
    });
  }

  return transporters;
}

function formatTransportSpace(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function serializeBayConfiguration(bay: EntityTransportBay): { type: string; space: number; infantryType: string; facing: number; bitmap: number } {
  const configuration = bay.configuration;
  const facing = configuration.type === 'drop-shuttle'
    || configuration.type === 'naval-repair'
    || configuration.type === 'reinforced-repair'
    ? configuration.facing : -1;
  const bitmap = configuration.type === 'battle-armor'
    ? (configuration.comStar ? COMSTAR_BIT : 0) | (configuration.techBase === 'Clan' ? CLAN_BIT : 0)
    : 0;
  return {
    type: getBayBlkType(configuration),
    space: encodeBaySize(bay),
    infantryType: configuration.type === 'infantry' ? configuration.infantryType : '',
    facing,
    bitmap,
  };
}

function serializeTransporter(transporter: EntityTransporter): string {
  const omni = transporter.omni ? ':omni' : '';
  switch (transporter.kind) {
    case 'troop-space': return `troopspace:${formatTransportSpace(transporter.totalSpace)}${omni}`;
    // DockingCollar is not registered as an Omni pod by BLKFile.
    case 'docking-collar': return 'dockingcollar';
    case 'battle-armor-handles': return `BattleArmorHandles - troopers:${transporter.troopers}${omni}`;
    case 'unknown': return transporter.rawLine;
    case 'bay': {
      const fields = serializeBayConfiguration(transporter);
      const bayNumber = serializedBayNumber(transporter);
      const doors = runtimeDoors(transporter.configuration, transporter.doors);
      if (
        transporter.configuration.type === 'naval-repair'
        || transporter.configuration.type === 'reinforced-repair'
      ) {
        return `${fields.type}:${formatTransportSpace(fields.space)}:${doors}:${bayNumber}:f${fields.facing}${omni}`;
      }
      return `${fields.type}:${formatTransportSpace(fields.space)}:${doors}:${bayNumber}:${fields.infantryType}:${fields.facing}:${fields.bitmap}${omni}`;
    }
  }
}

export function serializeTransporterLines(transporters: readonly EntityTransporter[]): string[] {
  return transporters.map(serializeTransporter);
}
