import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import type { UnitArtwork } from '../../models/unit-artwork.model';

/** The parts of an undo snapshot that tell two neighbouring design states apart. */
export interface ConstructionHistorySnapshot {
  readonly source: string;
  readonly equipment: readonly EntityMountedEquipment[];
  readonly artwork: UnitArtwork | null | undefined;
}

/**
 * Values of a native source by key: an MTF `key:value` line, the rows under an MTF location header, or the rows of a
 * BLK block. `slots` names the keys whose rows list installed equipment by file name.
 */
function sourceValues(source: string): { values: Map<string, string[]>; slots: Set<string> } {
  const values = new Map<string, string[]>();
  const slots = new Set<string>();
  const add = (key: string, value: string) => {
    if (value !== '-Empty-') values.set(key, [...(values.get(key) ?? []), value]);
  };
  let section: string | null = null;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('</')) section = null;
    else if (line.startsWith('<')) {
      section = line.slice(1, -1);
      if (/equipment$/i.test(section)) slots.add(section);
    } else if (section !== null) add(section, line);
    else {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon);
      if (colon === line.length - 1) slots.add((section = key));
      // The weapon list repeats the critical slots.
      else if (key !== 'Weapons') add(key, line.slice(colon + 1));
      if (key === 'nocrit') slots.add(key);
    }
  }
  return { values, slots };
}

/** Values of `from` that `to` lacks, counting repeats. */
function without(from: readonly string[], to: readonly string[]): string[] {
  const left = [...to];
  return from.filter((value) => {
    const index = left.indexOf(value);
    if (index >= 0) left.splice(index, 1);
    return index < 0;
  });
}

/** Where a mount sits: its primary location, then any other location a split or spread item reaches. */
export function mountLocationLabel(mount: EntityMountedEquipment, locationLabel: (id: string) => string): string {
  const locations = new Set([mount.location, ...(mount.placements ?? []).map((placement) => placement.location)]);
  return [...locations].map(locationLabel).join('/');
}

/** Equipment added, removed and moved, by display name and location. */
function equipmentChanges(
  before: readonly EntityMountedEquipment[],
  after: readonly EntityMountedEquipment[],
  locationLabel: (id: string) => string,
): string[] {
  const [old, current] = [before, after].map((mounts) => {
    const locations = new Map<string, string[]>();
    for (const mount of mounts) {
      const name = mount.displayName();
      locations.set(name, [...(locations.get(name) ?? []), mountLocationLabel(mount, locationLabel)]);
    }
    return locations;
  });
  const counts = new Map<string, number>();
  const add = (line: string) => counts.set(line, (counts.get(line) ?? 0) + 1);
  for (const name of new Set([...old.keys(), ...current.keys()])) {
    const removed = without(old.get(name) ?? [], current.get(name) ?? []);
    const added = without(current.get(name) ?? [], old.get(name) ?? []);
    removed.forEach((from, index) =>
      add(index < added.length ? `Moved ${name}: ${from} → ${added[index]}` : `Removed ${name} (${from})`),
    );
    added.slice(removed.length).forEach((to) => add(`Added ${name} (${to})`));
  }
  return [...counts].map(([line, count]) => (count > 1 ? `${line} ×${count}` : line));
}

/**
 * What one design edit changed, read off the snapshots on either side of it. Equipment is named as the loadout shows
 * it; every other value comes from the native source, whose slot rows only speak when no equipment changed.
 */
export function describeConstructionChange(
  before: ConstructionHistorySnapshot,
  after: ConstructionHistorySnapshot,
  locationLabel: (id: string) => string,
): string[] {
  const lines = equipmentChanges(before.equipment, after.equipment, locationLabel);
  const equipmentChanged = lines.length > 0;
  const [old, current] = [before, after].map((snapshot) => sourceValues(snapshot.source));
  for (const key of new Set([...old.values.keys(), ...current.values.keys()])) {
    if (equipmentChanged && (old.slots.has(key) || current.slots.has(key))) continue;
    const removed = [...new Set(without(old.values.get(key) ?? [], current.values.get(key) ?? []))];
    const added = [...new Set(without(current.values.get(key) ?? [], old.values.get(key) ?? []))];
    if (removed.length === 1 && added.length === 1) lines.push(`${key}: ${removed[0]} → ${added[0]}`);
    else if (removed.length || added.length)
      lines.push(`${key}: ${[...added.map((value) => `+ ${value}`), ...removed.map((value) => `− ${value}`)].join(', ')}`);
  }
  if (before.artwork?.fluff !== after.artwork?.fluff || before.artwork?.icon !== after.artwork?.icon)
    lines.push('Artwork');
  return lines;
}
