import type { EntityTechBase } from '../types/tech';
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

function infantryType(value: string): InfantryTransportType {
  switch (value.toLowerCase()) {
    case 'jump': return 'Jump';
    case 'motorized': return 'Motorized';
    case 'mechanized': return 'Mechanized';
    default: return 'Foot';
  }
}

function normalizeBayFields(fields: readonly string[], clanTechBase: boolean): string[] | undefined {
  if (fields.length === 6) return [...fields];
  if (fields.length < 2 || fields.length > 6) return undefined;

  const normalized = [fields[0], fields[1], '-1', '', '-1', clanTechBase ? String(CLAN_BIT) : '0'];
  if (fields.length === 2) return normalized;

  if (/^-?\d+$/.test(fields[2])) normalized[2] = fields[2];
  const indicator = fields.length === 3 ? fields[2] : fields[3];
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
  platoonType: string,
  facing: number,
  bitmap: number,
): TransportBayConfiguration | undefined {
  const standardType = resolveStandardBayType(type);
  if (standardType) return { type: standardType };
  switch (type) {
    case 'asfbay': return { type: 'fighter', arts };
    case 'smallcraftbay': return { type: 'small-craft', arts };
    case 'infantrybay': return { type: 'infantry', infantryType: infantryType(platoonType) };
    case 'battlearmorbay':
      return { type: 'battle-armor', techBase: (bitmap & CLAN_BIT) !== 0 ? 'Clan' : 'IS', comStar: (bitmap & COMSTAR_BIT) !== 0 };
    case 'dropshuttlebay': return { type: 'drop-shuttle', facing };
    case 'navalrepairpressurized': return { type: 'naval-repair', facing, pressurized: true, arts };
    case 'navalrepairunpressurized': return { type: 'naval-repair', facing, pressurized: false, arts };
    case 'reinforcedrepairfacility': return { type: 'reinforced-repair', facing };
    default: return undefined;
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
    if (requested !== -1 && !usedBayNumbers.has(requested)) {
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
    let fields = trimmed.split(':');
    const omni = fields.at(-1)?.toLowerCase() === 'omni';
    if (omni) fields = fields.slice(0, -1);

    let rawType = fields[0].toLowerCase();
    const arts = rawType.startsWith('arts');
    if (arts) rawType = rawType.substring(4);

    if (rawType === 'troopspace') {
      const totalSpace = Number(fields[1]);
      if (Number.isFinite(totalSpace)) {
        transporters.push({ id, kind: 'troop-space', totalSpace, omni });
      } else {
        context.warn('transporters', `Invalid troop-space capacity in "${trimmed}"`);
        transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      }
      continue;
    }

    if (rawType.startsWith('battlearmorhandles')) {
      transporters.push({ id, kind: 'battle-armor-handles', troopers: Number(fields[1] ?? -1), omni });
      continue;
    }

    if (rawType === 'dockingcollar') {
      transporters.push({ id, kind: 'docking-collar', collarNumber: allocateBayNumber(-1), omni });
      continue;
    }

    const normalized = normalizeBayFields(fields.slice(1), rawType === 'battlearmorbay' && entityTechBase === 'Clan');
    if (!normalized) {
      context.warn('transporters', `Invalid transporter fields in "${trimmed}"`);
      transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      continue;
    }

    const sourceSpace = Number(normalized[0]);
    const doors = Number(normalized[1]);
    const requestedBayNumber = Number(normalized[2]);
    const facing = Number(normalized[4]);
    const bitmap = Number(normalized[5]);
    const configuration = bayConfiguration(rawType, arts, normalized[3], facing, bitmap);
    if (!configuration || ![sourceSpace, doors, requestedBayNumber, facing, bitmap].every(Number.isFinite)) {
      context.warn('transporters', `Unknown or invalid transporter "${trimmed}"`);
      transporters.push({ id, kind: 'unknown', rawLine: trimmed, omni });
      continue;
    }

    const size = decodeBaySize(configuration, sourceSpace);
    const bay: EntityTransportBay = {
      id,
      kind: 'bay',
      configuration,
      ...size,
      doors,
      bayNumber: allocateBayNumber(requestedBayNumber),
      omni,
    };
    transporters.push(bay);
  }

  return transporters;
}

function formatTransportSpace(value: number): string {
  return Number.isInteger(value) && value >= 0 ? value.toFixed(1) : String(value);
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
    case 'docking-collar': return `dockingcollar${omni}`;
    case 'battle-armor-handles': return `BattleArmorHandles - troopers:${transporter.troopers}${omni}`;
    case 'unknown': return transporter.rawLine;
    case 'bay': {
      const fields = serializeBayConfiguration(transporter);
      return `${fields.type}:${formatTransportSpace(fields.space)}:${transporter.doors}:${transporter.bayNumber}:${fields.infantryType}:${fields.facing}:${fields.bitmap}${omni}`;
    }
  }
}

export function serializeTransporterLines(transporters: readonly EntityTransporter[]): string[] {
  return transporters.map(serializeTransporter);
}