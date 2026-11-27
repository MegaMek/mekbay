// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity } from '../../models/entity/entities/aero/aero-entity';
import { DropShipEntity } from '../../models/entity/entities/aero/dropship-entity';
import { JumpShipEntity } from '../../models/entity/entities/largecraft/jumpship-entity';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { VehicleEntity } from '../../models/entity/entities/vehicle/vehicle-entity';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { AmmoEquipment } from '../../models/equipment.model';
import { decodeBaySize, getBayConstructionWeight, getBayTransporterType } from '../../models/entity/bays/bay-definitions';
import { EquipmentBay, EntityMountedEquipment, isEntityMountedWeapon } from '../../models/entity/types/equipment';
import type { EntityTransporter, EntityTransportBay, TransportBayConfiguration, InfantryTransportType } from '../../models/entity/types/transport';
import { INFANTRY_TRANSPORT_WEIGHTS } from '../../models/entity/types/transport';
import { inferWeaponBayWeaponGroups, standardWeaponBayDamage, weaponBayDamageLimit, weaponBayGroupingKey } from '../../models/entity/utils/weapon-bay-grouping';
import { InfantryEntity } from '../../models/entity/entities/infantry/infantry-entity';
import { ConstructionInfantryComponent } from './construction-infantry.component';

type TransportChoice = TransportBayConfiguration['type'] | 'troop-space' | 'docking-collar';
const BAY_TYPES: readonly TransportBayConfiguration['type'][] = [
    'cargo', 'liquid-cargo', 'insulated-cargo', 'refrigerated-cargo', 'livestock-cargo',
    'mek', 'protomek', 'light-vehicle', 'heavy-vehicle', 'super-heavy-vehicle', 'fighter', 'small-craft',
    'infantry', 'battle-armor', 'crew-quarters', 'steerage-quarters', 'first-class-quarters', 'second-class-quarters',
    'standard-seats', 'pillion-seats', 'ejection-seats', 'drop-shuttle', 'naval-repair', 'reinforced-repair',
];
const QUARTERS_TONS: Readonly<Record<string, number>> = {
    'crew-quarters': 7, 'steerage-quarters': 5, 'first-class-quarters': 10, 'second-class-quarters': 7,
};

@Component({
    selector: 'construction-extras',
    imports: [FormsModule, DecimalPipe, ConstructionInfantryComponent],
    templateUrl: './construction-extras.component.html',
    styleUrl: './construction-extras.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionExtrasComponent {
    readonly entity = input.required<BaseEntity>();
    readonly editRequested = output<() => void>();
    readonly newTransport = signal<TransportChoice>('cargo');
    readonly infantryTypes: readonly InfantryTransportType[] = ['Foot', 'Jump', 'Motorized', 'Mechanized'];
    readonly infantry = computed(() => { const entity = this.entity(); return entity instanceof InfantryEntity ? entity : null; });
    readonly isMek = computed(() => this.entity() instanceof MekEntity);
    readonly hasWeaponBays = computed(() => this.entity() instanceof DropShipEntity || this.entity() instanceof JumpShipEntity);
    readonly bays = computed(() => this.entity().equipmentBays().filter(bay => bay.kind === 'weapon-bay'));
    readonly bayMounts = computed(() => this.entity().equipment().filter(mount =>
        isEntityMountedWeapon(mount) || mount.equipment instanceof AmmoEquipment));
    readonly transportChoices = computed(() => {
        const entity = this.entity();
        const types: TransportChoice[] = BAY_TYPES.filter(type => {
            // MTF represents Mek cargo through installed equipment, not BLK bays.
            if (entity instanceof MekEntity) return false;
            if (['drop-shuttle', 'naval-repair', 'reinforced-repair'].includes(type)) return entity instanceof JumpShipEntity;
            return entity instanceof VehicleEntity || entity instanceof AeroEntity || entity instanceof JumpShipEntity || entity instanceof StaticEmplacementEntity;
        });
        if (entity instanceof VehicleEntity || entity instanceof StaticEmplacementEntity) types.push('troop-space');
        if (entity instanceof JumpShipEntity) types.push('docking-collar');
        return types.map(value => ({ value, label: this.choiceLabel(value) }));
    });
    private readonly selectAvailableTransport = effect(() => {
        const choices = this.transportChoices();
        if (choices.length && !choices.some(choice => choice.value === this.newTransport())) {
            this.newTransport.set(choices[0].value);
        }
    });

    private configuration(type: TransportBayConfiguration['type']): TransportBayConfiguration {
        switch (type) {
            case 'fighter': case 'small-craft': return { type, arts: false };
            case 'infantry': return { type, infantryType: 'Foot' };
            case 'battle-armor': return { type, techBase: this.entity().techBase() === 'Clan' ? 'Clan' : 'IS', comStar: false };
            case 'drop-shuttle': case 'reinforced-repair': return { type, facing: 0 };
            case 'naval-repair': return { type, facing: 0, pressurized: false, arts: false };
            default: return { type };
        }
    }

    choiceLabel(type: TransportChoice): string {
        switch (type) {
            case 'troop-space': return 'Troop transport space';
            case 'docking-collar': return 'Docking collar';
            default: return getBayTransporterType(this.configuration(type));
        }
    }

    transportLabel(transport: EntityTransporter): string {
        return transport.kind === 'bay' ? getBayTransporterType(transport.configuration)
            : transport.kind === 'battle-armor-handles' ? 'Battle armor handles' : this.choiceLabel(transport.kind);
    }

    capacityLabel(bay: EntityTransportBay): string {
        const type = bay.configuration.type;
        if (type === 'infantry') return 'Platoons / squads';
        if (type === 'battle-armor') return 'Squads / points';
        if (type === 'protomek') return 'Points';
        if (type.includes('quarters') || type.includes('seats')) return 'Personnel';
        if (type.includes('cargo') || type.includes('repair') || type === 'generic') return 'Capacity (t)';
        return 'Unit capacity';
    }

    capacity(bay: EntityTransportBay): number {
        return bay.configuration.type === 'infantry'
            ? bay.capacity / INFANTRY_TRANSPORT_WEIGHTS[bay.configuration.infantryType] : bay.capacity;
    }

    mass(bay: EntityTransportBay): number { return getBayConstructionWeight(bay); }

    addTransport(): void {
        this.editRequested.emit(() => {
            const type = this.newTransport();
            if (!this.transportChoices().some(choice => choice.value === type)) throw new Error('Choose a transport type for this chassis.');
            const id = crypto.randomUUID();
            const current = this.entity().transporters();
            const number = Math.max(0, ...current.map(t => t.kind === 'bay' ? t.bayNumber : t.kind === 'docking-collar' ? t.collarNumber : 0)) + 1;
            let transport: EntityTransporter;
            if (type === 'troop-space') transport = { id, kind: type, totalSpace: 1, omni: false };
            else if (type === 'docking-collar') transport = { id, kind: type, collarNumber: number, omni: false };
            else {
                const configuration = this.configuration(type);
                const size = decodeBaySize(configuration, QUARTERS_TONS[type] ?? 1);
                transport = { id, kind: 'bay', configuration, ...size, doors: this.minimumDoors(type), bayNumber: number, omni: false };
            }
            this.entity().transporters.set([...current, transport]);
        });
    }

    minimumDoors(type: TransportBayConfiguration['type']): number {
        return type.includes('cargo') || type.includes('quarters') || type.includes('seats')
            || type === 'infantry' || type === 'battle-armor' || type === 'generic' ? 0 : 1;
    }

    private updateTransport(id: string, update: (transport: EntityTransporter) => EntityTransporter): void {
        this.editRequested.emit(() => {
            const entity = this.entity();
            entity.transporters.update(rows => rows.map(row => {
                if (row.id !== id) return row;
                const next = update(row);
                if (entity instanceof StaticEmplacementEntity && row.kind === 'bay' && next.kind === 'bay') {
                    const spaces = entity.baySpace().get(id), previous = getBayConstructionWeight(row);
                    if (spaces && previous > 0) entity.baySpace.update(values => new Map(values).set(id,
                        spaces.map(space => ({ ...space, tons: space.tons * getBayConstructionWeight(next) / previous }))));
                    let keptDoors = 0;
                    entity.bayDoors.update(doors => doors.filter(door => door.bayId !== id || ++keptDoors <= next.doors));
                }
                return next;
            }));
        });
    }

    setCapacity(transport: EntityTransporter, value: unknown): void {
        this.updateTransport(transport.id, row => {
            const capacity = this.number(value, 0);
            if (row.kind === 'troop-space') return { ...row, totalSpace: capacity };
            if (row.kind === 'docking-collar' || row.kind === 'battle-armor-handles') return row;
            if (row.configuration.type === 'drop-shuttle') return row;
            const { constructionWeight: _oldWeight, ...rest } = row;
            return { ...rest, ...decodeBaySize(row.configuration, capacity * (QUARTERS_TONS[row.configuration.type] ?? 1)) };
        });
    }

    setDoors(bay: EntityTransportBay, value: unknown): void {
        this.updateTransport(bay.id, row => row.kind === 'bay'
            ? { ...row, doors: row.configuration.type.includes('seats') ? 0 : this.number(value, this.minimumDoors(row.configuration.type), true) } : row);
    }

    setOmni(transport: EntityTransporter, value: boolean): void {
        this.updateTransport(transport.id, row => ({ ...row, omni: value }));
    }

    setBayOption(bay: EntityTransportBay, key: 'arts' | 'pressurized' | 'facing' | 'infantryType' | 'techBase' | 'comStar', value: unknown): void {
        this.updateTransport(bay.id, row => {
            if (row.kind !== 'bay' || !(key in row.configuration)) return row;
            const option = key === 'facing' ? this.number(value, 0, true, 5) : value;
            const configuration = { ...row.configuration, [key]: option } as TransportBayConfiguration;
            const { constructionWeight: _oldWeight, ...rest } = row;
            return { ...rest, configuration, ...decodeBaySize(configuration, this.capacity(row) * (QUARTERS_TONS[configuration.type] ?? 1)) };
        });
    }

    removeTransport(transport: EntityTransporter): void {
        if (transport.kind === 'battle-armor-handles') return;
        this.editRequested.emit(() => {
            const entity = this.entity();
            entity.transporters.update(rows => rows.filter(row => row.id !== transport.id));
            if (entity instanceof StaticEmplacementEntity) {
                entity.baySpace.update(values => { const next = new Map(values); next.delete(transport.id); return next; });
                entity.bayDoors.update(doors => doors.filter(door => door.bayId !== transport.id));
            }
        });
    }

    private number(value: unknown, min: number, integer = false, max = integer ? 2_147_483_647 : Number.MAX_SAFE_INTEGER): number {
        const parsed = Number(value);
        if (value === '' || value == null || !Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
            throw new Error(`Enter ${integer ? 'a whole number' : 'a number'} from ${min}${Number.isFinite(max) ? ` to ${max}` : ' upwards'}.`);
        }
        return parsed;
    }

    bayLabel(bay: EquipmentBay, index: number): string {
        const first = bay.weapons[0];
        return `Bay ${index + 1} · ${first?.location ?? '?'}${first?.rearMounted ? ' rear' : ''} · ${first?.equipment.weapon.atClass ?? 'Weapons'}`;
    }

    bayDamage(bay: EquipmentBay): number { return bay.weapons.reduce((total, mount) => total + standardWeaponBayDamage(mount), 0); }
    mountBay(mount: EntityMountedEquipment): string {
        const index = this.bays().findIndex(bay => bay.mounts.some(member => member.mountId === mount.mountId));
        return index < 0 ? '' : String(index);
    }
    isWeapon(mount: EntityMountedEquipment): boolean { return isEntityMountedWeapon(mount); }

    canAssign(bay: EquipmentBay, mount: EntityMountedEquipment): boolean {
        const first = bay.weapons[0];
        if (!first) return false;
        if (isEntityMountedWeapon(mount)) {
            return weaponBayGroupingKey(first) === weaponBayGroupingKey(mount)
                && bay.weapons.filter(member => member.mountId !== mount.mountId).reduce((total, member) => total + standardWeaponBayDamage(member), 0)
                    + standardWeaponBayDamage(mount) <= weaponBayDamageLimit(first);
        }
        const ammo = mount.equipment;
        return ammo instanceof AmmoEquipment && mount.location === first.location && mount.rearMounted === first.rearMounted
            && bay.weapons.some(weapon => weapon.equipment.ammoType === ammo.ammoType && weapon.equipment.rackSize === ammo.rackSize);
    }

    assignBay(mount: EntityMountedEquipment, target: string): void {
        this.editRequested.emit(() => {
            const bays = this.bays();
            if (!target || (target === 'new' && !isEntityMountedWeapon(mount))
                || (target !== 'new' && (!bays[Number(target)] || !this.canAssign(bays[Number(target)], mount)))) {
                throw new Error('Bay members must share their weapon class and firing arc, and stay within the bay damage limit.');
            }
            const groups = bays.map(bay => ({ mounts: bay.mounts.filter(member => member.mountId !== mount.mountId) }));
            if (target === 'new' && isEntityMountedWeapon(mount)) groups.push({ mounts: [mount] });
            else groups[Number(target)].mounts.push(mount);
            this.entity().replaceEquipmentBays('weapon-bay', groups.filter(group => group.mounts.some(isEntityMountedWeapon)));
        });
    }

    autoGroupBays(): void {
        this.editRequested.emit(() => {
            const groups = inferWeaponBayWeaponGroups(this.entity().equipment().filter(isEntityMountedWeapon))
                .map(weapons => ({ mounts: [...weapons] as EntityMountedEquipment[] }));
            for (const ammo of this.entity().equipment().filter(mount => mount.equipment instanceof AmmoEquipment)) {
                const group = groups.filter(candidate => this.canAssign(new EquipmentBay('weapon-bay', candidate.mounts), ammo))
                    .sort((a, b) => a.mounts.filter(mount => mount.equipment instanceof AmmoEquipment).length - b.mounts.filter(mount => mount.equipment instanceof AmmoEquipment).length)[0];
                group?.mounts.push(ammo);
            }
            this.entity().replaceEquipmentBays('weapon-bay', groups);
        });
    }

}
