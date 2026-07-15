import type { EntityTransportBay, EntityTransporter } from '../types/transport';
import { getBayRecordSheetCapacity, getBayRecordSheetName, isQuartersBay } from './bay-definitions';

export interface RecordSheetBayMember {
  typeName: string;
  capacity: number;
}

export interface RecordSheetBayGroup {
  bayNumber: number;
  members: readonly RecordSheetBayMember[];
  doors: number;
}

export function projectRecordSheetBays(transporters: readonly EntityTransporter[]): readonly RecordSheetBayGroup[] {
  const bays = transporters
    .filter((transporter): transporter is EntityTransportBay => transporter.kind === 'bay')
    .filter(bay => !isQuartersBay(bay));
  const grouped = new Map<number, EntityTransportBay[]>();
  for (const bay of bays) {
    const members = grouped.get(bay.bayNumber) ?? [];
    members.push(bay);
    grouped.set(bay.bayNumber, members);
  }

  return [...grouped.entries()]
    .sort(([leftBay], [rightBay]) => leftBay - rightBay)
    .map(([bayNumber, members]) => ({
      bayNumber,
      members: [...members]
        .sort((left, right) => left.capacity - right.capacity)
        .map(bay => ({
          typeName: getBayRecordSheetName(bay.configuration),
          capacity: getBayRecordSheetCapacity(bay),
        })),
      doors: Math.max(...members.map(member => member.doors)),
    }));
}