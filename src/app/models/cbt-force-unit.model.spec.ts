// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideHttpClient } from '@angular/common/http';
import { computed, Injector, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, Equipment, MiscEquipment, resolveWeaponDamage, WeaponEquipment, type EquipmentMap } from './equipment.model';
import { CBTForce } from './cbt-force.model';
import { CBTForceUnit, type CBTUnitAutomationTrigger } from './cbt-force-unit.model';
import { DEAD_CREW_HIT_THRESHOLD } from './crew-member.model';
import { INVENTORY_CONTROL_TARGET_MAX_COUNT } from './inventory-control-runtime-state.model';
import { MountedAmmo, MountedEquipment, MountedMisc, MountedWeapon } from './mounted-equipment.model';
import { type CBTSerializedUnit, type CriticalSlot } from './force-serialization';
import { DataService } from '../services/data.service';
import { UnitInitializerService } from '../services/unit-initializer.service';
import { UnitSvgService } from '../services/unit-svg.service';
import { UnitSvgVehicleService } from '../services/unit-svg-vehicle.service';
import { UnitSvgMekService } from '../services/unit-svg-mek.service';
import { UnitSvgAeroService } from '../services/unit-svg-aero.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { UnitSummary } from './unit-summary.model';
import { createHandlerCommandContext, createHandlerQueryContext, EquipmentInteractionHandler, EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import { LaserInsulatorHandler } from '../equipment-handlers/laser-insulator.handler';
import { RISC_LASER_PULSE_MODE, RiscLaserPulseModuleHandler } from '../equipment-handlers/risc-laser-pulse-module.handler';
import { DialogsService } from '../services/dialogs.service';
import { ToastService } from '../services/toast.service';
import { getInventoryControlAmmoProfileId, getInventoryControlAmmoSelectionOptions, getInventoryControlGroups, getInventoryControlModeAmmoSummary, INVENTORY_CONTROL_MODE_STATE, syncSvgMode } from '../utils/inventory-control.util';
import { AtmHandler } from '../equipment-handlers/atm.handler';
import { MmlHandler } from '../equipment-handlers/mml.handler';
import { ATM_EXTENDED_RANGE_PROFILE, ATM_HIGH_EXPLOSIVE_PROFILE, ATM_STANDARD_PROFILE } from './ammo-weapon-profile.model';
import { VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE, VibrobladeHandler } from '../equipment-handlers/vibroblade.handler';
import { UACFiringModeHandler } from '../equipment-handlers/uac-firing-mode.handler';
import { EquipmentFlag } from './equipment-flags.type';
import { EquipmentRegistry } from './equipment-lookup';
import { OptionsService } from '../services/options.service';
import { FALL_PSR_FAILURE, formatPilotingDisplay, PSR_CHECK_KIND, type ChargeDamage } from './rules/unit-type-rules';
import { registerAllHandlers } from '../equipment-handlers';
import {
    PPC_CAPACITOR_CHARGING_STATE,
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_STATE_KEY,
    PpcCapacitorHandler,
} from '../equipment-handlers/ppc-capacitor.handler';
import {
    BOMBAST_LASER_CHARGE_STATE_KEY,
    BOMBAST_LASER_CHARGING_STATE,
    BombastLaserHandler,
} from '../equipment-handlers/bombast-laser.handler';
import { applyMekCriticalRoll } from '../utils/mek-critical-hit.util';
import type { AutomationMode, CBTAutomationKey } from './options.model';
import { NovaCewsHandler } from '../equipment-handlers/nova-cews.handler';
import { NOVA_CEWS_OFF_STATE, NOVA_CEWS_STATE_KEY } from '../utils/ecm-state.util';

function createEquipment(): EquipmentMap {
    const ultraAc20 = new WeaponEquipment({
        id: 'CLUltraAC20',
        name: 'Ultra AC/20',
        type: 'weapon',
        weapon: { ammoType: 'AC_ULTRA', rackSize: 20, ranges: [4, 8, 12, 16] }
    });
    const ultraAc20Ammo = new AmmoEquipment({
        id: 'Clan Ultra AC/20 Ammo',
        name: 'Clan Ultra AC/20 Ammo',
        shortName: 'Ultra AC/20 Ammo',
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5, kgPerShot: 200 }
    });
    const ultraAc20PrecisionAmmo = new AmmoEquipment({
        id: 'Clan Ultra AC/20 Precision Ammo',
        name: 'Clan Ultra AC/20 Precision Ammo',
        shortName: 'Ultra AC/20 Precision Ammo',
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 4, kgPerShot: 250 }
    });
    const variableDamageLaser = new WeaponEquipment({
        id: 'VariableDamageLaser',
        name: 'Variable Damage Laser',
        type: 'weapon',
        weapon: { ammoType: 'NA', heat: 7, damage: [9, 7, 5], ranges: [2, 5, 9, 13] }
    });
    const mml9 = new WeaponEquipment({
        id: 'ISMML9',
        name: 'MML 9',
        type: 'weapon',
        flags: ['F_MISSILE', 'F_MML'],
        weapon: { ammoType: 'MML', rackSize: 9, heat: 5, damage: 'cluster', ranges: [0, 0, 0, 0] }
    });
    const mml9LrmAmmo = new AmmoEquipment({
        id: 'ISMML9LRMAmmo',
        name: 'MML 9 LRM Ammo',
        type: 'ammo',
        flags: ['F_MML_LRM'],
        ammo: { type: 'MML', rackSize: 9, shots: 12, damagePerShot: 7 }
    });
    const mml9SrmAmmo = new AmmoEquipment({
        id: 'ISMML9SRMAmmo',
        name: 'MML 9 SRM Ammo',
        type: 'ammo',
        flags: ['F_MML_SRM'],
        ammo: { type: 'MML', rackSize: 9, shots: 12, damagePerShot: 8 }
    });
    const atm6 = new WeaponEquipment({
        id: 'ISATM6',
        name: 'ATM 6',
        type: 'weapon',
        flags: ['F_MISSILE'],
        weapon: { ammoType: 'ATM', rackSize: 6, heat: 4, damage: 'cluster', ranges: [0, 0, 0, 0] }
    });
    const iatm6 = new WeaponEquipment({
        id: 'ISIATM6',
        name: 'IATM 6',
        type: 'weapon',
        flags: ['F_MISSILE'],
        weapon: { ammoType: 'IATM', rackSize: 6, heat: 4, damage: 'cluster', ranges: [0, 0, 0, 0] }
    });
    const atm6ErAmmo = new AmmoEquipment({
        id: 'ISATM6ERAmmo',
        name: 'ATM 6 ER Ammo',
        type: 'ammo',
        ammo: { type: 'ATM', rackSize: 6, shots: 10, damagePerShot: 7, munitionType: ['M_EXTENDED_RANGE'] }
    });
    const atm6HeAmmo = new AmmoEquipment({
        id: 'ISATM6HEAmmo',
        name: 'ATM 6 HE Ammo',
        type: 'ammo',
        ammo: { type: 'ATM', rackSize: 6, shots: 10, damagePerShot: 8, munitionType: ['M_HIGH_EXPLOSIVE'] }
    });
    const mediumLaser = new WeaponEquipment({
        id: 'ISMediumLaser',
        name: 'Medium Laser',
        type: 'weapon',
        flags: ['F_ENERGY', 'F_LASER'],
        weapon: { ammoType: 'NA', heat: 3, damage: 5, ranges: [3, 6, 9, 12] }
    });
    const laserInsulator = new MiscEquipment({
        id: 'ISLaserInsulator',
        name: 'Laser Insulator',
        type: 'misc',
        flags: ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR']
    });
    const riscLaserPulseModule = new MiscEquipment({
        id: 'ISRISCLaserPulseModule',
        name: 'RISC Laser Pulse Module',
        type: 'misc',
        flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE']
    });
    const droneOperatingSystem = new Equipment({
        id: 'ISDroneOperatingSystem',
        name: 'Drone (Remote) Operating System',
        type: 'misc',
        flags: ['F_DRONE_OPERATING_SYSTEM'],
    });

    return {
        [ultraAc20.internalName]: ultraAc20,
        [ultraAc20Ammo.internalName]: ultraAc20Ammo,
        [ultraAc20PrecisionAmmo.internalName]: ultraAc20PrecisionAmmo,
        [variableDamageLaser.internalName]: variableDamageLaser,
        [mml9.internalName]: mml9,
        [mml9LrmAmmo.internalName]: mml9LrmAmmo,
        [mml9SrmAmmo.internalName]: mml9SrmAmmo,
        [atm6.internalName]: atm6,
        [iatm6.internalName]: iatm6,
        [atm6ErAmmo.internalName]: atm6ErAmmo,
        [atm6HeAmmo.internalName]: atm6HeAmmo,
        [mediumLaser.internalName]: mediumLaser,
        [laserInsulator.internalName]: laserInsulator,
        [riscLaserPulseModule.internalName]: riscLaserPulseModule,
        [droneOperatingSystem.internalName]: droneOperatingSystem,
    };
}

function createMekUnit(): UnitSummary {
    return createEmptyUnit({
        name: 'BMTest_MEK-1',
        chassis: 'Test Mek',
        model: 'MEK-1',
        type: 'Mek',
        subtype: 'BattleMek',
    });
}

function createMekUnitWithDissipation(dissipation: number): UnitSummary {
    const heatSink = new MiscEquipment({
        id: 'test-heat-sink',
        name: 'Test Heat Sink',
        type: 'misc',
        flags: ['F_HEAT_SINK'],
    });
    return createEmptyUnit({
        ...createMekUnit(),
        heat: 20,
        comp: [{
            id: 'test-heat-sinks',
            q: dissipation,
            q2: 0,
            n: 'Test Heat Sink',
            t: 'E',
            p: -1,
            l: '',
            c: '',
            os: 0,
            eq: heatSink,
        }],
    });
}

function createMekUnitWithCriticalHeatsinks(): { unit: UnitSummary; single: MiscEquipment; double: MiscEquipment } {
    const single = new MiscEquipment({
        id: 'test-single-heat-sink',
        name: 'Test Single Heat Sink',
        type: 'misc',
        flags: ['F_HEAT_SINK'],
    });
    const double = new MiscEquipment({
        id: 'test-double-heat-sink',
        name: 'Test Double Heat Sink',
        type: 'misc',
        flags: ['F_DOUBLE_HEAT_SINK'],
    });
    const component = (id: string, equipment: Equipment, location: string, position: number, quantity = 1): UnitSummary['comp'][number] => ({
        id,
        q: quantity,
        q2: 0,
        n: equipment.name,
        t: 'E',
        p: position,
        l: location,
        c: '',
        os: 0,
        eq: equipment,
    });
    return {
        single,
        double,
        unit: createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            comp: [
                component('engine-sinks', single, '', -1, 2),
                component('leg-sink', single, 'LL', 0),
                component('torso-sink', double, 'LT', 0),
            ],
        }),
    };
}

function createSelectedHeatUnit(equipment: EquipmentMap, dissipation: number): UnitSummary {
    const unit = createMekUnitWithDissipation(dissipation);
    return createEmptyUnit({
        ...unit,
        name: 'Selected Heat Test Unit',
        chassis: 'Selected Heat Test',
        model: 'T1',
        comp: [
            ...unit.comp,
            { id: 'VariableDamageLaser', q: 1, q2: 0, n: 'Variable Damage Laser', t: 'E', p: 1, l: 'RA', r: '2/5/9', m: '-4', d: '9/7/5', md: '9.0', c: '1', os: 0, eq: equipment['VariableDamageLaser'] },
            { id: 'ISMediumLaser', q: 1, q2: 0, n: 'Medium Laser', t: 'E', p: 1, l: 'LA', r: '3/6/9', m: '0', d: '5', md: '5.0', c: '1', os: 0, eq: equipment['ISMediumLaser'] },
        ],
    });
}

function createSelectedHeatSvg(): SVGSVGElement {
    return new DOMParser().parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="VariableDamageLaser@RA#0" hitMod="-4"></g>
            <g class="inventoryEntry" id="ISMediumLaser@LA#0" hitMod="0"></g>
            <text id="damagedEngineHeatText" x="10" y="100"></text>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createHeatProfileSvg(entryId: string, totalHeat: number): SVGSVGElement {
    return new DOMParser().parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="${entryId}" hitMod="0"></g>
            <g class="hsPips"><circle class="pip"></circle></g>
            <text id="heatProfile">Total Heat (Dissipation): ${totalHeat}</text>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createSelectedHeatScaleSvg(): SVGSVGElement {
    return new DOMParser().parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="VariableDamageLaser@RA#0" hitMod="-4"></g>
            <g class="inventoryEntry" id="ISMediumLaser@LA#0" hitMod="0"></g>
            <g id="heatScale">
                ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function expectHeatMarkerAt(
    svg: SVGSVGElement,
    markerId: string,
    expectedHeat: number
): SVGPolygonElement {
    const marker = svg.querySelector<SVGPolygonElement>(`#${markerId}`);
    const heatElement = svg.querySelector<SVGRectElement>(`.heat[heat="${expectedHeat}"]`);
    expect(marker).withContext(`marker #${markerId}`).not.toBeNull();
    expect(heatElement).withContext(`heat scale value ${expectedHeat}`).not.toBeNull();

    const markerYCoordinates = (marker?.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map(point => Number(point.split(',')[1]));
    expect(markerYCoordinates.length).withContext(`marker #${markerId} points`).toBeGreaterThanOrEqual(3);
    expect(markerYCoordinates.every(Number.isFinite)).withContext(`marker #${markerId} coordinates`).toBeTrue();

    const heatCenterY = Number(heatElement!.getAttribute('y')) + Number(heatElement!.getAttribute('height')) / 2;
    expect(markerYCoordinates[0]).withContext(`marker #${markerId} tip position`).toBeCloseTo(heatCenterY, 5);
    return marker!;
}

function createProtoMekUnit(): UnitSummary {
    return createEmptyUnit({
        name: 'PMTest_PROTO-1',
        chassis: 'Test ProtoMek',
        model: 'PROTO-1',
        type: 'ProtoMek',
        subtype: 'ProtoMek',
    });
}

function createDroneMekUnit(equipment: EquipmentMap): UnitSummary {
    return createEmptyUnit({
        name: 'DroneMek_TEST-1',
        chassis: 'Drone Mek',
        model: 'TEST-1',
        type: 'Mek',
        subtype: 'BattleMek',
        comp: [
            { id: 'ISDroneOperatingSystem', q: 1, q2: 0, n: 'Drone (Remote) Operating System', t: 'E', p: 1, l: 'HD', c: '1', os: 0, eq: equipment['ISDroneOperatingSystem'] },
        ],
    });
}

function createVehicleUnit(equipment: EquipmentMap): UnitSummary {
    return createEmptyUnit({
        name: 'CVSMTankDestroyer_SM1',
        chassis: 'SM Tank Destroyer',
        model: 'SM1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'CLUltraAC20', q: 1, q2: 0, n: 'Ultra AC/20', t: 'B', p: 1, l: 'FR', r: '4/8/12', m: '0', d: '20/Sht', md: '40.0', c: '1', os: 0, eq: equipment['CLUltraAC20'] },
            { id: 'Clan Ultra AC/20 Ammo', q: 6, q2: 30, n: 'Ultra AC/20 Ammo', t: 'X', p: 0, l: 'BD', c: '0', os: 0, eq: equipment['Clan Ultra AC/20 Ammo'] },
        ],
        sheets: ['vehicle/test.svg'],
    });
}

function createVehicleSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="CLUltraAC20@FR#0" hitMod="0">
                <g class="name"><text>Ultra AC/20</text></g>
                <text class="location">FR</text>
                <text class="range_short">4</text>
                <text class="range_medium">8</text>
                <text class="range_long">12</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">+0</text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
            <g id="ammoProfile"><text>Ammo: (Ultra AC/20) 30</text></g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createKamisoriAInventorySvg(): SVGSVGElement {
    return new DOMParser().parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <circle class="pip armor" loc="TU"></circle>
            <circle class="pip structure" loc="TU"></circle>
            <g class="inventoryEntry" id="Light PPC@TU#0" hitMod="0">
                <text class="location">TU</text>
                <g class="inventoryEntry linked" id="PPC Capacitor@TU#1"></g>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createVariableDamageUnit(equipment: EquipmentMap): UnitSummary {
    return createEmptyUnit({
        name: 'Variable Damage Test Unit',
        chassis: 'Variable Damage Test',
        model: 'T1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'VariableDamageLaser', q: 1, q2: 0, n: 'Variable Damage Laser', t: 'E', p: 1, l: 'FR', r: '2/5/9', m: '-4', d: '9/7/5', md: '9.0', c: '1', os: 0, eq: equipment['VariableDamageLaser'] },
        ],
        sheets: ['vehicle/variable-damage-test.svg'],
    });
}

function createVariableDamageSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="VariableDamageLaser@FR#0" hitMod="-4">
                <g class="name"><text>Variable Damage Laser</text></g>
                <g class="damage"><text>9/7/5 [V]</text></g>
                <text class="location">FR</text>
                <text class="range_short">2</text>
                <text class="range_medium">5</text>
                <text class="range_long">9</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">-4</text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createMultiRowVariableDamageSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="VariableDamageLaser@FR#0" hitMod="-4">
                <g class="name"><text>Variable Damage Laser</text></g>
                <g class="damage">
                    <text x="94" font-size="6.76">legacy first row</text>
                    <text x="94" font-size="6.76">legacy second row</text>
                </g>
                <text class="location">FR</text>
                <text class="range_min" x="125">—</text>
                <text class="range_short">2</text>
                <text class="range_medium">5</text>
                <text class="range_long">9</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">-4</text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createLaserInsulatorUnit(equipment: EquipmentMap): UnitSummary {
    return createEmptyUnit({
        name: 'Laser Insulator Test Unit',
        chassis: 'Laser Insulator Test',
        model: 'T1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'ISMediumLaser', q: 1, q2: 0, n: 'Medium Laser', t: 'E', p: 1, l: 'FR', r: '3/6/9', m: '0', d: '5', md: '5.0', c: '1', os: 0, eq: equipment['ISMediumLaser'] },
            { id: 'ISLaserInsulator', q: 1, q2: 0, n: 'Laser Insulator', t: 'E', p: 0, l: 'FR', c: '1', os: 0, eq: equipment['ISLaserInsulator'] },
        ],
        sheets: ['vehicle/laser-insulator-test.svg'],
    });
}

function createLaserInsulatorSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="ISMediumLaser@FR#0" hitMod="0">
                <g class="name"><text>Medium Laser</text></g>
                <text class="heat">3*</text>
                <text class="location">FR</text>
                <text class="range_short">3</text>
                <text class="range_medium">6</text>
                <text class="range_long">9</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">+0</text>
                <g class="inventoryEntry" id="ISLaserInsulator@FR#0">
                    <g class="name"><text>Laser Insulator</text></g>
                </g>
            </g>
            <text id="damagedEngineHeatText" x="10" y="100"></text>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createRiscLaserUnit(equipment: EquipmentMap): UnitSummary {
    return createEmptyUnit({
        name: 'RISC Laser Test Unit',
        chassis: 'RISC Laser Test',
        model: 'T1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'ISMediumLaser', q: 1, q2: 0, n: 'Medium Laser', t: 'E', p: 1, l: 'FR', r: '3/6/9', m: '0', d: '5', md: '5.0', c: '1', os: 0, eq: equipment['ISMediumLaser'] },
            { id: 'ISRISCLaserPulseModule', q: 1, q2: 0, n: 'RISC Laser Pulse Module', t: 'E', p: 0, l: 'FR', c: '1', os: 0, eq: equipment['ISRISCLaserPulseModule'] },
        ],
        sheets: ['vehicle/risc-laser-test.svg'],
    });
}

function createRiscLaserSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="ISMediumLaser@FR#0" hitMod="0" hitMod2="0">
                <rect class="mainButton inventoryEntryButton" inventory-id="ISMediumLaser@FR#0"></rect>
                <rect class="shrButton inventoryEntryButton" inventory-id="ISMediumLaser@FR#0"></rect>
                <g class="name"><text>Medium Laser</text></g>
                <text class="heat">3</text>
                <text class="location">FR</text>
                <text class="range_short">3</text>
                <text class="range_medium">6</text>
                <text class="range_long">9</text>
                <rect class="hitMod-rect" display="block"></rect>
                <text class="hitMod-text" display="block">+0</text>
                <g class="inventoryEntry linked" id="ISRISCLaserPulseModule@FR#1">
                    <g class="name"><text>w/RISC Laser Module</text></g>
                    <text class="heat">5</text>
                    <rect class="hitMod-rect" display="block"></rect>
                    <text class="hitMod-text" display="block">+0</text>
                </g>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createMmlUnit(equipment: EquipmentMap): UnitSummary {
    return createEmptyUnit({
        name: 'MML Test Unit',
        chassis: 'MML Test',
        model: 'T1',
        type: 'Tank',
        subtype: 'Hovercraft',
        heat: -1,
        dissipation: -1,
        comp: [
            { id: 'ISMML9', q: 1, q2: 0, n: 'MML 9', t: 'M', p: 1, l: 'LT', r: '', m: '0', d: '[M,C,S]', md: '0.0', c: '1', os: 0, eq: equipment['ISMML9'] },
            { id: 'ISMML9LRMAmmo', q: 1, q2: 12, n: 'MML 9 LRM Ammo', t: 'X', p: 0, l: 'BD', c: '0', os: 0, eq: equipment['ISMML9LRMAmmo'] },
            { id: 'ISMML9SRMAmmo', q: 1, q2: 12, n: 'MML 9 SRM Ammo', t: 'X', p: 0, l: 'BD', c: '0', os: 0, eq: equipment['ISMML9SRMAmmo'] },
        ],
        sheets: ['vehicle/mml-test.svg'],
    });
}

function createMmlSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="ISMML9@LT#0" hitMod="0">
                <rect class="shrButton inventoryEntryButton"></rect>
                <rect class="medButton inventoryEntryButton"></rect>
                <rect class="lngButton inventoryEntryButton"></rect>
                <g class="name"><text>MML 9</text></g>
                <g class="damage"><text>[M,C,S]</text></g>
                <text class="location">LT</text>
                <text class="range_min"></text>
                <text class="range_short"></text>
                <text class="range_medium"></text>
                <text class="range_long"></text>
                <g class="alternativeMode" mode="LRM">
                    <rect class="shrButton inventoryEntryButton"></rect>
                    <rect class="medButton inventoryEntryButton"></rect>
                    <rect class="lngButton inventoryEntryButton"></rect>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                    <g class="name"><text>LRM</text></g>
                    <g class="damage"><text>1/Msl</text></g>
                    <text class="range_min">6</text>
                    <text class="range_short">7</text>
                    <text class="range_medium">14</text>
                    <text class="range_long">21</text>
                </g>
                <g class="alternativeMode selected" mode="SRM">
                    <rect class="shrButton inventoryEntryButton"></rect>
                    <rect class="medButton inventoryEntryButton"></rect>
                    <rect class="lngButton inventoryEntryButton"></rect>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                    <g class="name"><text>SRM</text></g>
                    <g class="damage"><text>2/Msl</text></g>
                    <text class="range_min">—</text>
                    <text class="range_short">3</text>
                    <text class="range_medium">6</text>
                    <text class="range_long">9</text>
                </g>
                <rect class="hitMod-rect" display="none"></rect>
                <text class="hitMod-text" display="none"></text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createAtmSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="inventoryEntry" id="ISATM6@LT#0" hitMod="0">
                <rect class="shrButton inventoryEntryButton"></rect>
                <rect class="medButton inventoryEntryButton"></rect>
                <rect class="lngButton inventoryEntryButton"></rect>
                <g class="name"><text>ATM 6</text></g>
                <g class="damage"><text>legacy</text></g>
                <text class="location">LT</text>
                <text class="range_min"></text>
                <text class="range_short"></text>
                <text class="range_medium"></text>
                <text class="range_long"></text>
                <g class="alternativeMode" mode="Extended Range">
                    <rect class="shrButton inventoryEntryButton"></rect>
                    <rect class="medButton inventoryEntryButton"></rect>
                    <rect class="lngButton inventoryEntryButton"></rect>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                    <g class="name"><text>ER</text></g>
                    <g class="damage"><text></text></g>
                    <text class="range_min">6</text>
                    <text class="range_short">7</text>
                    <text class="range_medium">12</text>
                    <text class="range_long">18</text>
                </g>
                <g class="alternativeMode selected" mode="High Explosive">
                    <rect class="shrButton inventoryEntryButton"></rect>
                    <rect class="medButton inventoryEntryButton"></rect>
                    <rect class="lngButton inventoryEntryButton"></rect>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                    <g class="name"><text>HE</text></g>
                    <g class="damage"><text></text></g>
                    <text class="range_min">—</text>
                    <text class="range_short">3</text>
                    <text class="range_medium">6</text>
                    <text class="range_long">9</text>
                </g>
                <rect class="hitMod-rect" display="none"></rect>
                <text class="hitMod-text" display="none"></text>
                <rect class="targetTn-rect" display="none"></rect>
                <text class="targetTn-text" display="none"></text>
            </g>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

function createMekDamageSvg(): SVGSVGElement {
    const parser = new DOMParser();
    return parser.parseFromString(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g class="unitLocation armor" loc="LT"></g>
            <g class="unitLocation structure" loc="LT"></g>
            <rect class="pip armor" loc="LT"></rect>
            <rect class="pip structure" loc="LT"></rect>
            <g class="critGroup" loc="LT"><rect class="critSlot-bg-rect"></rect></g>
            <rect class="critSlot" loc="LT" uid="lt-slot" slot="0"></rect>

            <g class="unitLocation armor" loc="LA"></g>
            <g class="unitLocation structure" loc="LA"></g>
            <rect class="pip armor" loc="LA"></rect>
            <rect class="pip structure" loc="LA"></rect>
            <g class="critGroup" loc="LA"><rect class="critSlot-bg-rect"></rect></g>
            <rect class="critSlot" loc="LA" uid="la-slot" slot="0"></rect>
        </svg>
    `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

class ExposedUnitSvgService extends UnitSvgService {
    refreshHeat(): void {
        this.updateHeatDisplay(this.unit.getHeat());
    }

    refreshConditions(): void {
        this.updateConditionsDisplay();
    }

    refreshCrew(): void {
        this.updateCrewDisplay(this.unit.getCrewMembers());
    }

    refreshInventory(): void {
        this.updateInventory();
    }

    refreshTurnState(): void {
        this.updateTurnState();
    }

    renderHitModifier(entry: MountedEquipment, hitModifier: number, forceWeakened = false): void {
        const baseResolution = this.unit.gameRules.resolveToHit({ subject: entry });
        const baseValue = typeof baseResolution.value === 'number' ? baseResolution.value : 0;
        const resolution = this.unit.gameRules.resolveToHit({
            subject: entry,
            stateModifiers: [{
                label: 'Test modifier',
                modifier: hitModifier - baseValue,
                ...(forceWeakened && { weakened: true }),
            }],
        });
        this.renderHitModEntry(entry, resolution);
    }

    refreshArmor(): void {
        this.updateArmorDisplay();
    }

    renderProfile(profile: ReadonlyMap<string, number>): void {
        this.renderAmmoProfile(profile);
    }

    renderDamage(damageText: SVGElement, damage: string): void {
        this.renderInventoryDamageText(damageText, damage);
    }

    renderCharge(entry: MountedEquipment, chargeDamage: ChargeDamage): void {
        this.renderChargeDamage(entry, chargeDamage);
    }
}

class ExposedUnitSvgVehicleService extends UnitSvgVehicleService {
    refreshCrew(): void {
        this.updateCrewDisplay(this.unit.getCrewMembers());
    }

    refreshInventory(): void {
        this.updateInventory();
    }

    refreshCritLocs(critLocs = this.unit.getCritSlots()): void {
        this.updateCritLocDisplay(critLocs);
    }
}

class ExposedUnitSvgMekService extends UnitSvgMekService {
    refreshHeat(): void {
        this.updateHeatDisplay(this.unit.getHeat());
    }

    refreshInventory(): void {
        this.updateInventory();
    }

    refreshHeatSinks(): void {
        this.updateHeatSinkPips();
    }

    refreshCriticalSlots(criticalSlots = this.unit.getCritSlots()): void {
        this.updateCritSlotDisplay(criticalSlots);
    }
}

class ExposedUnitSvgAeroService extends UnitSvgAeroService {
    refreshInventory(): void {
        this.updateInventory();
    }

    refreshHeatSinks(): void {
        this.updateHeatSinkPips();
    }
}

class TestCBTForce extends CBTForce {
    emitCount = 0;

    override emitChanged(): void {
        this.emitCount++;
    }
}

class EndTurnTestHandler extends EquipmentInteractionHandler {
    readonly id = 'end-turn-test-handler';
    override readonly flags: EquipmentFlag[] = ['F_TEST_ONLY'];
    calls = 0;
    readonly receivedCurrentEntries: boolean[] = [];

    constructor(private readonly rebuildInventory = false) {
        super();
    }

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment?.id === 'end-turn-test';
    }

    getChoices(): [] {
        return [];
    }

    handleSelection(): boolean {
        return false;
    }

    override onEndTurn(equipment: MountedEquipment): void {
        this.calls++;
        this.receivedCurrentEntries.push(
            equipment.owner.getInventory().find(candidate => candidate.id === equipment.id) === equipment
        );
        if (this.rebuildInventory) equipment.owner.setInventoryEntry(equipment);
    }
}

class RunMovementBonusTestHandler extends EquipmentInteractionHandler {
    readonly id = 'run-movement-bonus-test-handler';
    override readonly flags: EquipmentFlag[] = ['F_TEST_ONLY'];

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.equipment?.id === 'run-movement-bonus-test';
    }

    getChoices(): [] {
        return [];
    }

    handleSelection(): boolean {
        return false;
    }

    override getRunMovementMultiplierBonus(equipment: MountedEquipment): number {
        return equipment.states.get('active') === 'true' ? 0.5 : 0;
    }
}

describe('CBTForceUnit live catalog integration', () => {
    xit('loads every unit available in the live catalog', async () => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
            ],
        });

        const liveDataService = TestBed.inject(DataService);
        const liveUnitInitializer = TestBed.inject(UnitInitializerService);
        const liveInjector = TestBed.inject(Injector);
        registerAllHandlers(TestBed.inject(EquipmentInteractionRegistryService));

        await liveDataService.initialize();

        const catalogUnits = liveDataService.getUnits();
        expect(liveDataService.isDataReady())
            .withContext('The live catalogs did not initialize successfully')
            .toBeTrue();
        expect(catalogUnits.length)
            .withContext('The live unit catalog is empty')
            .toBeGreaterThan(0);

        const force = new TestCBTForce(
            'Live Catalog Test Force',
            liveDataService,
            liveUnitInitializer,
            liveInjector,
        );
        const failures: string[] = [];

        for (const catalogUnit of catalogUnits) {
            let forceUnit: CBTForceUnit | undefined;
            try {
                forceUnit = force.createCompatibleUnit(catalogUnit);
                await forceUnit.load();

                if (!forceUnit.initialized || !forceUnit.isLoaded() || !forceUnit.svg() || !forceUnit.svgService) {
                    throw new Error('load completed without a fully initialized SVG unit');
                }
            } catch (error) {
                const message = error instanceof Error ? error.stack ?? error.message : String(error);
                failures.push(`${catalogUnit.name} [${catalogUnit.sheets[0] ?? 'no sheet'}]: ${message}`);
            } finally {
                forceUnit?.destroy();
            }
        }

        expect(failures)
            .withContext(`Failed to load ${failures.length} of ${catalogUnits.length} live catalog units:\n${failures.join('\n')}`)
            .toEqual([]);
    }, 30 * 60 * 1000);
});

describe('CBTForceUnit direct inventory ammo bins', () => {
    let equipment: EquipmentMap;
    let dataService: jasmine.SpyObj<DataService>;
    let unitInitializer: UnitInitializerService;
    let injector: Injector;
    let toastService: jasmine.SpyObj<ToastService>;
    let heatAutomationMode: ReturnType<typeof signal<'yes' | 'ask' | 'no'>>;
    let automationModes: Partial<Record<CBTAutomationKey, AutomationMode>>;
    let extremeRange: ReturnType<typeof signal<boolean>>;
    let cbtRules: 'core2026' | 'tw';

    beforeEach(() => {
        equipment = createEquipment();
        dataService = jasmine.createSpyObj<DataService>('DataService', ['getEquipmentRegistry', 'findEquipment', 'getUnitByName']);
        dataService.getEquipmentRegistry.and.callFake(() => new EquipmentRegistry(equipment));
        dataService.findEquipment.and.callFake((name: string) => dataService.getEquipmentRegistry().findEquipment(name) ?? undefined);
        heatAutomationMode = signal('yes');
        automationModes = {};
        extremeRange = signal(false);
        cbtRules = 'core2026';
        toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);

        TestBed.configureTestingModule({
            providers: [
                UnitInitializerService,
                { provide: DataService, useValue: dataService },
                { provide: DialogsService, useValue: jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog', 'showError']) },
                { provide: ToastService, useValue: toastService },
                { provide: OptionsService, useValue: {
                    cbtAutomationMode: (key: CBTAutomationKey) => key === 'heatAndDissipationResolution'
                        ? heatAutomationMode()
                        : automationModes[key] ?? 'yes',
                    options: () => ({
                        CBTRules: cbtRules,
                        CBTOptionalRules: {
                            forcedWithdrawal: true,
                            extremeRange: extremeRange(),
                            sprinting: false,
                        },
                    }),
                } },
            ],
        });

        unitInitializer = TestBed.inject(UnitInitializerService);
        injector = TestBed.inject(Injector);
    });

    function createForceUnit(unit: UnitSummary = createMekUnit()): CBTForceUnit {
        dataService.getUnitByName.and.callFake((name: string) => name === unit.name ? unit : undefined);
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        return new CBTForceUnit(unit, force, dataService, unitInitializer, injector);
    }

    function initialize(unit: CBTForceUnit, svg = createVehicleSvg()): void {
        unit.svg.set(svg);
        unitInitializer.initializeUnitIfNeeded(unit, svg);
        unit.isLoaded.set(true);
    }

    function createCriticalHeatSinkForceUnit(): {
        forceUnit: CBTForceUnit;
        legSlot: CriticalSlot;
        torsoSlots: CriticalSlot[];
    } {
        const { unit, single, double } = createMekUnitWithCriticalHeatsinks();
        const forceUnit = createForceUnit(unit);
        forceUnit.locations = {
            armor: new Map([
                ['LL', { loc: 'LL', rear: false, points: 5 }],
                ['LT', { loc: 'LT', rear: false, points: 5 }],
            ]),
            internal: new Map([
                ['LL', { loc: 'LL', points: 5 }],
                ['LT', { loc: 'LT', points: 5 }],
            ]),
        };
        const legSlot: CriticalSlot = { id: 'leg-sink', name: single.name, loc: 'LL', slot: 0, hits: 0, eq: single };
        const torsoSlots: CriticalSlot[] = [0, 1, 2].map(slot => ({
            id: 'torso-sink',
            name: double.name,
            loc: 'LT',
            slot,
            hits: 0,
            eq: double,
        }));
        forceUnit.setCritSlots([legSlot, ...torsoSlots], true);
        return { forceUnit, legSlot, torsoSlots };
    }

    function expectControlRollDisplay(element: Element | null, expectedText: string, expectedLabel: string): void {
        expect(element?.textContent).toBe(expectedText);
        const suffix = element?.querySelector<SVGTSpanElement>(':scope > .controlRollModifier');
        const label = suffix?.querySelector<SVGTSpanElement>(':scope > .controlRollLabel');
        const suffixScale = Number.parseFloat(suffix?.getAttribute('font-size') ?? '');
        const labelScale = Number.parseFloat(label?.getAttribute('font-size') ?? '');
        const labelOffset = Number.parseFloat(label?.getAttribute('dy') ?? '');
        expect(suffixScale).toBeLessThan(1);
        expect(suffix?.getAttribute('dominant-baseline')).toBe('central');
        expect(Number.parseFloat(suffix?.getAttribute('dy') ?? '')).toBeLessThan(0);
        expect(labelScale).toBeLessThan(1);
        expect(labelOffset).toBeLessThan(0);
        expect(label?.textContent).toBe(expectedLabel);
        expect(label?.getAttribute('font-family')).toBe('Roboto Condensed');
    }

    it('exposes live Extreme Range option state', () => {
        const forceUnit = createForceUnit();

        expect(forceUnit.allowsExtremeRangeAttacks()).toBeFalse();

        extremeRange.set(true);

        expect(forceUnit.allowsExtremeRangeAttacks()).toBeTrue();
    });

    function createAmmoProfileSvg(lineCount: number, availableWidth: number): SVGSVGElement {
        const lines = Array.from({ length: lineCount }, (_, index) => `<text x="0" y="${index * 10}"></text>`).join('');
        return new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="ammoProfile">
                    ${lines}
                    <rect class="ammoProfileButton" x="0" width="${availableWidth + 1}"></rect>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
    }

    function useFixedAmmoProfileCharacterWidth(svg: SVGSVGElement, characterWidth = 5): void {
        svg.querySelectorAll<SVGTextElement>('#ammoProfile > text').forEach(line => {
            spyOn(line, 'getComputedTextLength').and.callFake(() => (line.textContent?.length ?? 0) * characterWidth);
        });
    }

    it('resolves linked intrinsic ammo without recursively evaluating its parent weapon', () => {
        const forceUnit = createForceUnit();
        const oneShotWeapon = new WeaponEquipment({
            id: 'OneShotAC2',
            name: 'One-Shot AC/2',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE', 'F_ONE_SHOT'],
            weapon: { ammoType: 'AC', rackSize: 2, damage: 2, ranges: [8, 16, 24, 32] }
        });
        const intrinsicAmmo = new AmmoEquipment({
            id: 'OneShotAC2Ammo',
            name: 'One-Shot AC/2 Ammo',
            type: 'ammo',
            ammo: { type: 'AC', rackSize: 2, munitionType: ['M_STANDARD'] }
        });
        const weaponEntry = new MountedWeapon({
            owner: forceUnit,
            id: 'OneShotAC2@RA#0',
            name: oneShotWeapon.internalName,
            equipment: oneShotWeapon,
            locations: new Set(['RA'])
        });
        const ammoEntry = new MountedAmmo({
            owner: forceUnit,
            id: 'OneShotAC2@RA#0:intrinsic-one-shot-ammo',
            name: intrinsicAmmo.internalName,
            equipment: intrinsicAmmo,
            parent: weaponEntry,
            totalAmmo: 1,
            intrinsicOneShotAmmo: true
        });
        weaponEntry.linkedWith = [ammoEntry];
        forceUnit.setInventory([weaponEntry, ammoEntry], true);
        const availabilitySpy = spyOn(forceUnit, 'isEquipmentOperational')
            .and.throwError('selected profile must not inspect source availability');

        expect(forceUnit.getInventoryControlSelectedAmmo(weaponEntry)).toBe(intrinsicAmmo);
        expect(availabilitySpy).not.toHaveBeenCalled();
        availabilitySpy.and.callThrough();
        expect(() => weaponEntry.owner.rules.getEquipmentToHitModifiers(weaponEntry)).not.toThrow();
    });

    it('clones virtual inventory rows from a computed without writing signals', () => {
        const forceUnit = createForceUnit();
        const weapon = new WeaponEquipment({
            id: 'VirtualRowWeapon',
            name: 'Virtual Row Weapon',
            type: 'weapon',
            weapon: { ammoType: 'NA', damage: 1, ranges: [1, 2, 3, 4] }
        });
        const entry = new MountedWeapon({
            owner: forceUnit,
            id: 'VirtualRowWeapon@T1#0',
            name: weapon.internalName,
            equipment: weapon,
            destroyed: true
        });
        const virtualRow = computed(() => entry.clone({ id: `${entry.id}:T1` }));

        expect(() => virtualRow()).not.toThrow();
        expect(virtualRow().committedDestroyed()).toBeTrue();
    });

    it('wraps complete ammo profile entries before compressing text', () => {
        const forceUnit = createForceUnit();
        const svg = createAmmoProfileSvg(2, 65);
        initialize(forceUnit, svg);
        useFixedAmmoProfileCharacterWidth(svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.renderProfile(new Map([['(A)', 1], ['(B)', 2]]));

        const lines = svg.querySelectorAll<SVGTextElement>('#ammoProfile > text');
        expect(lines[0].textContent).toBe('Ammo: (A) 1,');
        expect(lines[1].textContent).toBe('(B) 2');
        expect(lines[0].hasAttribute('textLength')).toBeFalse();
        expect(lines[1].hasAttribute('textLength')).toBeFalse();
    });

    it('compresses an overflowing ammo profile only to the configured readability limit', () => {
        const forceUnit = createForceUnit();
        const svg = createAmmoProfileSvg(1, 82);
        initialize(forceUnit, svg);
        useFixedAmmoProfileCharacterWidth(svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.renderProfile(new Map([['(A)', 1], ['(B)', 2]]));

        const line = svg.querySelector<SVGTextElement>('#ammoProfile > text')!;
        expect(line.textContent).toBe('Ammo: (A) 1, (B) 2');
        expect(line.getAttribute('textLength')).toBe('82');
        expect(line.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    });

    it('uses an ellipsis when complete text would exceed the compression limit', () => {
        const forceUnit = createForceUnit();
        const svg = createAmmoProfileSvg(1, 73);
        initialize(forceUnit, svg);
        useFixedAmmoProfileCharacterWidth(svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.renderProfile(new Map([['(A)', 1], ['(B)', 2]]));

        const line = svg.querySelector<SVGTextElement>('#ammoProfile > text')!;
        expect(line.textContent).toBe('Ammo: (A) 1, ...');
        expect(line.textContent).not.toContain('(B) 2');
        expect(line.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    });

    it('recalculates a cached ammo profile after its visible layout becomes available', () => {
        const forceUnit = createForceUnit();
        const svg = createAmmoProfileSvg(1, 0);
        initialize(forceUnit, svg);
        useFixedAmmoProfileCharacterWidth(svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));
        const profile = new Map([['(A)', 1], ['(B)', 2]]);

        svgService.renderProfile(profile);
        expect(svg.querySelector('#ammoProfile > text')?.textContent).toBe('Ammo: (A) 1, (B) 2');

        svg.querySelector('.ammoProfileButton')?.setAttribute('width', '83');
        svgService.refreshLayoutDependentDisplays();

        const line = svg.querySelector<SVGTextElement>('#ammoProfile > text')!;
        expect(line.textContent).toBe('Ammo: (A) 1, (B) 2');
        expect(line.getAttribute('textLength')).toBe('82');
    });

    it('calls equipment handler end-turn hooks when ending turn', () => {
        const handler = new EndTurnTestHandler();
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(handler);
        const forceUnit = createForceUnit();
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'end-turn-test@FR#0',
            name: 'End Turn Test',
            equipment: new Equipment({ id: 'end-turn-test', name: 'End Turn Test', type: 'misc', flags: ['F_TEST_ONLY'] }),
        })], true);

        forceUnit.endTurn();

        expect(handler.calls).toBe(1);
    });

    it('resets stand attempts and cover when ending the turn', () => {
        const forceUnit = createForceUnit();
        forceUnit.turnState().standAttempts.set(3);
        forceUnit.turnState().setCover('heavy');

        forceUnit.endTurn();

        expect(forceUnit.turnState().standAttempts()).toBeUndefined();
        expect(forceUnit.turnState().cover()).toBeUndefined();
    });

    it('carries unresolved criticals across turn reset with committed resolution context', () => {
        const forceUnit = createForceUnit();
        const pilotDamageGroup = forceUnit.turnState().currentPilotDamageGroup();
        forceUnit.turnState().queuePendingCriticalChance({
            id: 'chance:1',
            location: 'CT',
            result: 2,
            pilotDamageGroup,
        });
        forceUnit.turnState().queuePendingCriticalHits({
            id: 'critical:1',
            location: 'LT',
            targetLocation: 'LT',
            remainingHits: 2,
            roll: [3, 4],
            pilotDamageGroup,
        });

        forceUnit.endTurn();

        expect(forceUnit.turnState().getPendingCriticalChances()).toEqual([{
            type: 'mek-critical-chance',
            id: 'chance:1',
            location: 'CT',
            result: 2,
            consolidateImmediately: true,
            pilotDamageGroup: `turn-closed:${pilotDamageGroup}`,
        }]);
        expect(forceUnit.turnState().getPendingCriticalHits()).toEqual([{
            type: 'mek-critical-hit',
            id: 'critical:1',
            location: 'LT',
            targetLocation: 'LT',
            remainingHits: 2,
            consolidateImmediately: true,
            roll: [3, 4],
            pilotDamageGroup: `turn-closed:${pilotDamageGroup}`,
        }]);
        expect(forceUnit.serialize().state.turnState?.pendingEvents).toEqual([
            {
                type: 'mek-critical-chance',
                id: 'chance:1',
                location: 'CT',
                result: 2,
                consolidateImmediately: true,
                pilotDamageGroup: `turn-closed:${pilotDamageGroup}`,
            },
            {
                type: 'mek-critical-hit',
                id: 'critical:1',
                location: 'LT',
                targetLocation: 'LT',
                remainingHits: 2,
                consolidateImmediately: true,
                roll: [3, 4],
                pilotDamageGroup: `turn-closed:${pilotDamageGroup}`,
            },
        ]);
    });

    it('reacquires each current mount when an end-turn hook rebuilds inventory', () => {
        const handler = new EndTurnTestHandler(true);
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(handler);
        const forceUnit = createForceUnit();
        const testWeapon = new WeaponEquipment({
            id: 'end-turn-test',
            name: 'End Turn Test',
            type: 'weapon',
            flags: ['F_TEST_ONLY'],
            weapon: { damage: 1 },
        });
        forceUnit.setInventory(['A', 'B'].map(id => new MountedWeapon({
            owner: forceUnit,
            id: `end-turn-test@${id}#0`,
            name: 'End Turn Test',
            equipment: testWeapon,
            intrinsicPhysicalAttack: true,
        })), true);

        forceUnit.endTurn();

        expect(handler.calls).toBe(2);
        expect(handler.receivedCurrentEntries).toEqual([true, true]);
    });

    it('applies a manual heat correction without resolving turn heat sources', () => {
        const forceUnit = createForceUnit();
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().addFiredHeat(8);
        forceUnit.setHeat(12);

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(12);
        expect(forceUnit.getHeat().next).toBeUndefined();
        expect(forceUnit.turnState().weaponsHeat()).toBe(8);
        expect(forceUnit.turnState().heatSources().map(source => source.id)).toEqual(['movement', 'weapons']);
        expect(forceUnit.turnState().heatProjectionVisible()).toBeTrue();
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();
        expect(forceUnit.turnState().serialize()?.acknowledgedHeatSources).toBeUndefined();

        const projectedHeat = forceUnit.turnState().heatProjection().projected;

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(projectedHeat);
        expect(forceUnit.turnState().heatSources()).toContain(jasmine.objectContaining({
            id: 'movement',
            value: 0,
        }));
        expect(forceUnit.turnState().heatProjection().projected).toBe(forceUnit.getHeat().current);
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeFalse();
        expect(forceUnit.turnState().heatProjectionVisible()).toBeFalse();
    });

    it('consolidates an unchanged pending heat value when requested', () => {
        const forceUnit = createForceUnit();
        forceUnit.setHeat(12);

        forceUnit.setHeat(12, true);

        expect(forceUnit.getHeat().current).toBe(12);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('returns an isolated serialized heat snapshot', () => {
        const forceUnit = createForceUnit();
        const serialized = forceUnit.serialize();

        serialized.state.heat.current = 99;

        expect(forceUnit.getHeat().current).not.toBe(99);
    });

    it('applies calculated heat when approved at end turn', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        const projectedHeat = forceUnit.turnState().heatProjection().projected;

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(projectedHeat);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('uses the calculated projection instead of an unapplied manual target when ending the turn', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        const projectedHeat = forceUnit.turnState().heatProjection().projected;
        forceUnit.setHeat(25);

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(projectedHeat);
        expect(forceUnit.getHeat().current).not.toBe(25);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('cleans a destroyed turn and a subsequent repair turn with recurring engine heat', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(0));
        initialize(forceUnit);
        const engineCrits: CriticalSlot[] = [0, 1, 2].map(index => ({
            id: `engine@CT#${index}`,
            name: 'Engine',
            loc: 'CT',
            slot: index,
            hits: 1,
            destroyed: 1,
            destroying: 1,
        }));
        forceUnit.writeCrits(engineCrits);
        forceUnit.evaluateDestroyed();

        expect(forceUnit.destroyed).toBeTrue();
        expect(forceUnit.turnState().dirty()).toBeFalse();

        forceUnit.endTurn();

        expect(forceUnit.turnState().dirty()).toBeFalse();
        expect(forceUnit.getHeat().current).toBe(0);

        forceUnit.applyHitToCritSlot(engineCrits[2], -1);

        expect(forceUnit.destroyed).toBeFalse();
        expect(forceUnit.turnState().heatSources()).toContain(jasmine.objectContaining({
            id: 'damaged-engine',
            value: 10,
        }));
        expect(forceUnit.turnState().dirty()).toBeTrue();

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(10);
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeTrue();
        expect(forceUnit.turnState().dirty()).toBeFalse();
    });

    it('applies approved Aero cooling without requiring a heat source', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'Cooling Test Aero',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            heat: 20,
            engineHS: 5,
            engineHSType: 'Single',
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });

        expect(forceUnit.turnState().heatSources()).toEqual([]);
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeTrue();

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(5);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('does not calculate or apply heat automatically when heat automation is no', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);

        expect(forceUnit.automationMode('heatAndDissipationResolution')).toBe('no');

        forceUnit.applyHeat();
        expect(forceUnit.getHeat().current).toBe(10);

        forceUnit.endTurn();
        expect(forceUnit.getHeat().current).toBe(10);
    });

    it('resolves yes-mode heat at end turn without an approval decision', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);

        expect(forceUnit.automationMode('heatAndDissipationResolution')).toBe('yes');
        expect(forceUnit.hasPendingEndTurnHeat()).toBeTrue();
        const projectedHeat = forceUnit.turnState().heatProjection().projected;

        forceUnit.endTurn();

        expect(forceUnit.getHeat().current).toBe(projectedHeat);
        expect(toastService.showToast).toHaveBeenCalledWith(
            jasmine.stringContaining(`Heat and dissipation: Heat 10 → ${projectedHeat}`),
            'info',
        );
    });

    it('does not turn an unapplied manual heat arrow into an end-turn automation event', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 0, previous: 0 });
        forceUnit.setHeat(12);

        expect(forceUnit.getHeat().next).toBe(12);
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeFalse();
        expect(forceUnit.hasPendingEndTurnHeat()).toBeFalse();

        forceUnit.endTurn();

        expect(forceUnit.getHeat().current).toBe(0);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('requires an explicit approval to resolve ask-mode heat at end turn', () => {
        heatAutomationMode.set('ask');
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        forceUnit.setHeat(27);

        expect(forceUnit.automationMode('heatAndDissipationResolution')).toBe('ask');
        expect(forceUnit.hasPendingEndTurnHeat()).toBeTrue();

        forceUnit.endTurn({ heatAndDissipationResolution: false });

        expect(forceUnit.getHeat().current).toBe(10);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('resolves an approved ask-mode heat projection at end turn', () => {
        heatAutomationMode.set('ask');
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        const projectedHeat = forceUnit.turnState().heatProjection().projected;

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(projectedHeat);
    });

    it('keeps sources unresolved when the heat automation mode changes after a manual heat correction', () => {
        const forceUnit = createForceUnit();
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().addFiredHeat(8);
        forceUnit.setHeat(12);
        forceUnit.applyHeat();
        expect(forceUnit.turnState().heatSources().map(source => source.id)).toEqual(['movement', 'weapons']);

        heatAutomationMode.set('no');

        expect(forceUnit.turnState().heatSources().map(source => source.id)).toEqual(['movement', 'weapons']);
        expect(forceUnit.turnState().heatProjectionVisible()).toBeTrue();

        heatAutomationMode.set('yes');

        expect(forceUnit.turnState().heatSources().map(source => source.id)).toEqual(['movement', 'weapons']);
        expect(forceUnit.turnState().heatProjectionVisible()).toBeTrue();
    });

    it('applies an explicit user heat target without acknowledging sources when heat automation is no', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit();
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        forceUnit.setHeat(17);

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(17);
        expect(forceUnit.getHeat().next).toBeUndefined();
        expect(forceUnit.turnState().weaponsHeat()).toBe(8);
        expect(forceUnit.turnState().heatSources().some(source => source.id === 'weapons')).toBeTrue();
        expect(forceUnit.turnState().heatProjectionVisible()).toBeTrue();
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();
        expect(forceUnit.turnState().serialize()?.acknowledgedHeatSources).toBeUndefined();
    });

    it('does not apply the calculated projection without a manual heat target', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().addFiredHeat(8);
        const projectedHeat = forceUnit.turnState().heatProjection().projected;

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(10);
        expect(forceUnit.getHeat().next).toBeUndefined();
        expect(forceUnit.turnState().heatProjection().projected).toBe(projectedHeat);
        expect(forceUnit.turnState().heatSources().map(source => source.id)).toEqual(['movement', 'weapons']);
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();
        expect(forceUnit.turnState().serialize()?.acknowledgedHeatSources).toBeUndefined();
    });

    it('sets a user-selected heat target without consuming the calculated projection', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        forceUnit.setHeat(23);

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(23);
        expect(forceUnit.getHeat().next).toBeUndefined();
        expect(forceUnit.turnState().heatSources().some(source => source.id === 'weapons')).toBeTrue();
        expect(forceUnit.turnState().heatProjection().projected).not.toBe(23);
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();
        expect(forceUnit.turnState().serialize()?.acknowledgedHeatSources).toBeUndefined();
    });

    it('keeps recalculating from current heat until the turn ends', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 5,
        }));
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(8);
        const firstProjection = forceUnit.turnState().heatProjection().projected;

        forceUnit.applyHeat();
        forceUnit.turnState().addFiredHeat(3);

        expect(forceUnit.getHeat().current).toBe(10);
        expect(forceUnit.turnState().heatProjection().projected).toBe(firstProjection + 3);

        const finalProjection = forceUnit.turnState().heatProjection().projected;
        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(finalProjection);
    });

    it('applies a cooling projection only when the turn ends', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(20));
        forceUnit.setHeatData({ current: 5, previous: 5 });
        forceUnit.turnState().moveMode.set('walk');
        expect(forceUnit.turnState().heatProjection().projected).toBe(0);

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(5);
        expect(forceUnit.turnState().effectiveHeatDissipation()).toBe(20);
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(0);
    });

    it('shows the full turn dissipation in the SVG heat source stack until end turn', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(20));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 5, previous: 5 });
        forceUnit.turnState().moveMode.set('walk');
        forceUnit.applyHeat();
        forceUnit.turnState().addFiredHeat(5);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(lines.map(line => line.textContent)).toEqual([
            'Movement: +1',
            'Weapons: +5',
            'Sink (20): -11',
        ]);
        expect(lines[2].getAttribute('fill')).toBe('#2070d1');
        expect(lines[2].getAttribute('y')).toBe('100');
    });

    it('renders committed and selected inventory heat separately with committed sink usage', () => {
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 5));
        const svg = createSelectedHeatSvg();
        initialize(forceUnit, svg);
        const [variableLaser, mediumLaser] = forceUnit.getInventory()
            .filter(entry => entry.equipment instanceof WeaponEquipment);
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        forceUnit.setInventoryControlEntrySelected(mediumLaser, true);
        forceUnit.setHeatData({ current: 10, previous: 10 });
        forceUnit.turnState().addFiredHeat(2);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(lines.map(line => line.textContent)).toEqual([
            'Selected: +10',
            'Weapons: +2',
            'Sink: -5',
        ]);
        expect(forceUnit.turnState().weaponsHeat()).toBe(2);
        expect(forceUnit.turnState().heatSources().filter(source => source.id === 'weapons'))
            .toEqual([jasmine.objectContaining({ label: 'Weapons', value: 2 })]);
        expect(lines[0].getAttribute('fill')).toBe('orange');
        expect(lines.map(line => line.getAttribute('y'))).toEqual(['84', '92', '100']);
    });

    it('shows selected heat in bold in the Mek heat profile and restores total heat after deselection', () => {
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 5));
        const svg = createHeatProfileSvg('VariableDamageLaser@RA#0', 17);
        initialize(forceUnit, svg);
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgMekService(forceUnit, unitInitializer));

        svgService.refreshHeatSinks();
        expect(svg.querySelector('#heatProfile')?.textContent).toBe('Total Heat (Dissipation): 17 (5)');

        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        svgService.refreshHeatSinks();
        const selectedHeat = svg.querySelector<SVGTSpanElement>('#heatProfile > tspan');
        expect(svg.querySelector('#heatProfile')?.textContent).toBe('Selected Heat (Dissipation): 7 (5)');
        expect(selectedHeat?.textContent).toBe('7');
        expect(selectedHeat?.getAttribute('font-weight')).toBe('bold');

        forceUnit.setInventoryControlEntrySelected(variableLaser, false);
        svgService.refreshHeatSinks();
        expect(svg.querySelector('#heatProfile')?.textContent).toBe('Total Heat (Dissipation): 17 (5)');
        expect(svg.querySelector('#heatProfile > tspan')).toBeNull();
    });

    it('shows a selected zero-heat Aero weapon with Aero dissipation', () => {
        const zeroHeatWeapon = new WeaponEquipment({
            id: 'ZeroHeatWeapon',
            name: 'Zero Heat Weapon',
            type: 'weapon',
            weapon: { ammoType: 'NA', heat: 0, damage: 1, ranges: [1, 2, 3, 4] },
        });
        equipment[zeroHeatWeapon.internalName] = zeroHeatWeapon;
        const unit = createEmptyUnit({
            name: 'Aero Heat Profile Test',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            heat: 12,
            engineHS: 6,
            engineHSType: 'Single',
            comp: [{
                id: zeroHeatWeapon.internalName, q: 1, q2: 0, n: zeroHeatWeapon.name, t: 'E', p: 1,
                l: 'NOS', r: '1/2/3', m: '0', d: '1', md: '1', c: '1', os: 0, eq: zeroHeatWeapon,
            }],
        });
        const forceUnit = createForceUnit(unit);
        const svg = createHeatProfileSvg('ZeroHeatWeapon@NOS#0', 12);
        initialize(forceUnit, svg);
        const entry = forceUnit.getInventory().find(candidate => candidate.equipment === zeroHeatWeapon)!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgAeroService(forceUnit, unitInitializer));

        forceUnit.setInventoryControlEntrySelected(entry, true);
        svgService.refreshHeatSinks();

        const selectedHeat = svg.querySelector<SVGTSpanElement>('#heatProfile > tspan');
        expect(svg.querySelector('#heatProfile')?.textContent).toBe('Selected Heat (Dissipation): 0 (6)');
        expect(selectedHeat?.textContent).toBe('0');
        expect(selectedHeat?.getAttribute('font-weight')).toBe('bold');
    });

    it('previews sink capacity consumed by selected inventory heat', () => {
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 20));
        const svg = createSelectedHeatSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        const [variableLaser, mediumLaser] = forceUnit.getInventory()
            .filter(entry => entry.equipment instanceof WeaponEquipment);
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        forceUnit.setInventoryControlEntrySelected(mediumLaser, true);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(lines.map(line => line.textContent)).toEqual([
            'Selected: +10',
            'Sink (20): -10',
        ]);
        expect(lines[0].getAttribute('fill')).toBe('orange');
        expect(lines[1].getAttribute('fill')).toBe('#2070d1');
    });

    it('keeps committed weapons heat authoritative when a weapon is selected', () => {
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 20));
        const svg = createSelectedHeatSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        forceUnit.turnState().addFiredHeat(2);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(lines.map(line => line.textContent)).toEqual([
            'Selected: +7',
            'Weapons: +2',
            'Sink (20): -7',
        ]);
        expect(forceUnit.turnState().weaponsHeat()).toBe(2);

    });

    it('removes selected inventory heat and hides an otherwise empty summary after deselection', () => {
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 0));
        const svg = createSelectedHeatSvg();
        initialize(forceUnit, svg);
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        svgService.refreshTurnState();
        expect(svg.querySelector('#damagedEngineHeatText > tspan')?.textContent).toBe('Selected: +7');

        forceUnit.setInventoryControlEntrySelected(variableLaser, false);
        svgService.refreshTurnState();

        const summary = svg.querySelector<SVGTextElement>('#damagedEngineHeatText');
        expect(summary?.querySelector('tspan')).toBeNull();
        expect(summary?.getAttribute('display')).toBe('none');
        expect(summary?.style.display).toBe('none');
    });

    it('uses equipment effects when totaling selected inventory heat', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new LaserInsulatorHandler());
        const forceUnit = createForceUnit(createLaserInsulatorUnit(equipment));
        const svg = createLaserInsulatorSvg();
        initialize(forceUnit, svg);
        const laser = forceUnit.getInventory().find(entry => entry.id === 'ISMediumLaser@FR#0')!;
        const insulator = laser.linkedWith![0];
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));
        forceUnit.setInventoryControlEntrySelected(laser, true);

        svgService.refreshTurnState();
        expect(svg.querySelector('#damagedEngineHeatText > tspan')?.textContent).toBe('Selected: +2');

        insulator.setCommittedDestroyed(true);
        svgService.refreshTurnState();
        expect(svg.querySelector('#damagedEngineHeatText > tspan')?.textContent).toBe('Selected: +3');
    });

    it('tracks consumed dissipation when cooling clips heat to zero', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(28));
        forceUnit.setHeatData({ current: 3, previous: 3 });

        expect(forceUnit.turnState().heatProjection().consumedDissipation).toBe(3);
        expect(forceUnit.turnState().heatProjection().projected).toBe(0);
    });

    it('includes generated heat in effective dissipation when heat automation is no', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createMekUnitWithDissipation(28));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 5, previous: 5 });
        forceUnit.turnState().addFiredHeat(30);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(forceUnit.turnState().heatProjection().consumedDissipation).toBe(28);
        expect(lines.map(line => line.textContent)).toEqual([
            'Weapons: +30',
            'Sink: -28',
        ]);
        expect(lines[1].getAttribute('fill')).toBe('#2070d1');
    });

    it('shows full dissipation capacity when current heat exceeds it with automations disabled', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createMekUnitWithDissipation(28));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 30, previous: 30 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        expect(svg.querySelector('#damagedEngineHeatText > tspan')?.textContent).toBe('Sink: -28');
    });

    it('shows dissipation for generated heat when current heat is zero with automations disabled', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createMekUnitWithDissipation(28));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        forceUnit.turnState().addFiredHeat(30);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(lines.map(line => line.textContent)).toEqual([
            'Weapons: +30',
            'Sink: -28',
        ]);
    });

    it('omits dissipation when current and generated heat are both zero with automations disabled', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createMekUnitWithDissipation(28));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const summary = svg.querySelector<SVGTextElement>('#damagedEngineHeatText');
        expect(summary?.querySelector('tspan')).toBeNull();
        expect(summary?.getAttribute('display')).toBe('none');
    });

    it('doubles submerged operational sinks, including engine sinks once the torso is underwater', () => {
        const { forceUnit, legSlot } = createCriticalHeatSinkForceUnit();

        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(5);

        forceUnit.turnState().setCover('underwater-depth-1');
        expect(forceUnit.turnState().partiallyUnderwater()).toBeTrue();
        expect(forceUnit.turnState().submerged()).toBeFalse();
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(6);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(1);

        forceUnit.setCondition('prone', true);
        expect(forceUnit.turnState().partiallyUnderwater()).toBeFalse();
        expect(forceUnit.turnState().submerged()).toBeTrue();
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(10);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(5);

        forceUnit.applyHitToCritSlot(legSlot, 1, true);
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(8);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(4);

        forceUnit.setLocationCondition('LT', 'blown-off', true);
        forceUnit.endPhase();
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(4);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(2);
    });

    it('does not double directly destroyed heat sinks', () => {
        const { forceUnit, torsoSlots } = createCriticalHeatSinkForceUnit();
        const torsoSink = new MountedMisc({
            owner: forceUnit,
            id: 'torso-sink',
            name: torsoSlots[0].name!,
            equipment: torsoSlots[0].eq as MiscEquipment,
            locations: new Set(['LT']),
            critSlots: torsoSlots,
            destroyed: true,
        });
        forceUnit.setInventory([torsoSink], true);

        forceUnit.turnState().setCover('underwater-depth-2');

        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(3);
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(6);
    });

    it('keeps the best underwater heat sinks active when sinks are turned off', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-2');

        forceUnit.setHeatsinksOff(2);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(3);

        forceUnit.setHeatsinksOff(3);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(2);

        forceUnit.setHeatsinksOff(4);
        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(1);
    });

    it('offsets superheavy submersion and heat-sink bonuses by one depth', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.getUnit().tons = 150;

        forceUnit.turnState().setCover('underwater-depth-1');
        expect(forceUnit.turnState().partiallyUnderwater()).toBeFalse();
        expect(forceUnit.turnState().submerged()).toBeFalse();
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(5);

        forceUnit.turnState().setCover('underwater-depth-2');
        expect(forceUnit.turnState().partiallyUnderwater()).toBeTrue();
        expect(forceUnit.turnState().submerged()).toBeFalse();
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(6);

        forceUnit.setCondition('prone', true);
        expect(forceUnit.turnState().partiallyUnderwater()).toBeFalse();
        expect(forceUnit.turnState().submerged()).toBeTrue();
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(10);
    });

    it('caps the underwater heat-sink bonus at 6', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(10));

        forceUnit.turnState().setCover('underwater-depth-2');

        expect(forceUnit.rules.heatDissipation()?.underwaterBonus).toBe(6);
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(16);
    });

    it('reports effective height from unit size and posture', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();

        expect(forceUnit.getHeight()).toBe(2);

        forceUnit.getUnit().tons = 150;
        expect(forceUnit.getHeight()).toBe(3);

        forceUnit.setCondition('prone', true);
        expect(forceUnit.getHeight()).toBe(2);
    });

    it('resolves patchwork armor and hybrid structure from typed location layouts', () => {
        const forceUnit = createForceUnit({
            ...createMekUnit(),
            armorType: 'Patchwork',
            structureType: 'Hybrid',
            patchworkLayout: {
                CT: { type: 0, clan: false },
                LA: { type: 4, clan: false },
                LT: { type: 25, clan: false },
            },
            hybridLayout: {
                CT: { type: 0, clan: false },
                LA: { type: 5, clan: false },
            },
        });
        forceUnit.locations = {
            armor: new Map([['LA', { loc: 'LA', rear: false, points: 20 }]]),
            internal: new Map([['LA', { loc: 'LA', points: 5 }]]),
        };

        expect(forceUnit.getArmorTypeAt('CT')).toBe('STANDARD');
        expect(forceUnit.getArmorTypeAt('LA')).toBe('HARDENED');
        expect(forceUnit.getArmorTypeAt('LT')).toBe('IMPACT_RESISTANT');
        expect(forceUnit.hasArmorType('HARDENED')).toBeTrue();
        expect(forceUnit.hasArmorType('IMPACT_RESISTANT')).toBeTrue();
        expect(forceUnit.getStructureKindAt('CT')).toBe('standard');
        expect(forceUnit.getStructureKindAt('LA')).toBe('composite');

        forceUnit.addArmorHits('LA', 1);
        expect(forceUnit.turnState().dmgReceived()).toBe(0);
        forceUnit.addArmorHits('LA', 1);
        expect(forceUnit.turnState().dmgReceived()).toBe(1);
    });

    it('owns modular armor state and damage accounting across multiple slots', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const modularArmor = new MiscEquipment({
            id: 'test-modular-armor',
            name: 'Modular Armor',
            type: 'misc',
            flags: ['F_MODULAR_ARMOR'],
        });
        forceUnit.setCritSlots([0, 1].map(slot => ({
            id: `modular-armor-${slot}`,
            name: modularArmor.name,
            loc: 'LT',
            slot,
            hits: 0,
            eq: modularArmor,
        })), true);

        expect(forceUnit.addModularArmorHits('LT', 15)).toBe(15);
        expect(forceUnit.getModularArmorState('LT')).toEqual({ hits: 15, points: 20, remaining: 5 });
        expect(forceUnit.getCritSlots().map(slot => slot.consumed)).toEqual([10, 5]);
        expect(forceUnit.turnState().dmgReceived()).toBe(15);

        expect(forceUnit.addModularArmorHits('LT', -12)).toBe(-12);
        expect(forceUnit.getModularArmorState('LT')).toEqual({ hits: 3, points: 20, remaining: 17 });
        expect(forceUnit.getCritSlots().map(slot => slot.consumed)).toEqual([0, 3]);
        expect(forceUnit.turnState().dmgReceived()).toBe(3);
    });

    it('automatically floods armorless submerged locations based on posture', () => {
        // Keep posture under this test's explicit control; Core's flooded-leg
        // automatic fall is exercised by the phase-resolution coverage.
        automationModes.pilotSkillCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.setArmorHits('LT', 5);
        forceUnit.turnState().setCover('underwater-depth-1');

        expect(forceUnit.getLocationCondition('LT', 'flooded')).toBeFalse();

        forceUnit.addArmorHits('LL', 5);
        forceUnit.endPhase();
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(toastService.showToast).toHaveBeenCalledWith(
            jasmine.stringContaining('Breach and flooding: Left Leg flooded'),
            'error',
        );
        expect(forceUnit.getLocationCondition('LT', 'flooded')).toBeFalse();

        forceUnit.setCondition('prone', true);
        expect(forceUnit.getLocationCondition('LT', 'flooded')).toBeTrue();
    });

    it('floods a structurally destroyed location with depleted armor when it becomes submerged', () => {
        automationModes.pilotSkillCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.setArmorHits('LL', forceUnit.getArmorPoints('LL'));
        forceUnit.setInternalHits('LL', forceUnit.getInternalPoints('LL'));

        expect(forceUnit.isInternalLocStructurallyDestroyed('LL')).toBeTrue();
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();

        forceUnit.turnState().setCover('underwater-depth-1');

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
    });

    it('does not use structural destruction as a substitute for depleted armor', () => {
        automationModes.pilotSkillCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.setInternalHits('LL', forceUnit.getInternalPoints('LL'));

        forceUnit.turnState().setCover('underwater-depth-1');

        expect(forceUnit.isInternalLocStructurallyDestroyed('LL')).toBeTrue();
        expect(forceUnit.getArmorHits('LL')).toBe(0);
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
    });

    it('automatically resolves a successful Core hull-breach check after underwater damage', () => {
        automationModes.pilotSkillCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        spyOn(Math, 'random').and.returnValues(0, 0);

        forceUnit.addArmorHits('LL', 1);

        expect(Math.random).toHaveBeenCalledTimes(2);
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(toastService.showToast).toHaveBeenCalledWith(
            jasmine.stringContaining('Hull breach check: Left Leg breached and flooded (2 on 2D6; breach on 2–4)'),
            'error',
        );
    });

    it('does not flood when a Core hull-breach check rolls above 4', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        spyOn(Math, 'random').and.returnValues(0.5, 0.5);

        forceUnit.addArmorHits('LL', 1);

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(toastService.showToast).toHaveBeenCalledWith(
            jasmine.stringContaining('Hull breach check: Left Leg held (8 on 2D6; breach on 2–4)'),
            'success',
        );
    });

    it('uses the Total Warfare 10+ hull-breach result', () => {
        cbtRules = 'tw';
        automationModes.pilotSkillCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        spyOn(Math, 'random').and.returnValues(0.7, 0.7);

        forceUnit.addArmorHits('LL', 1);

        expect(forceUnit.gameRules.id).toBe('tw');
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(toastService.showToast).toHaveBeenCalledWith(
            jasmine.stringContaining('Hull breach check: Left Leg breached and flooded (10 on 2D6; breach on 10+)'),
            'error',
        );
    });

    it('does not breach on a low Total Warfare hull-breach roll', () => {
        cbtRules = 'tw';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        spyOn(Math, 'random').and.returnValues(0, 0);

        forceUnit.addArmorHits('LL', 1);

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(toastService.showToast).toHaveBeenCalledWith(
            jasmine.stringContaining('Hull breach check: Left Leg held (2 on 2D6; breach on 10+)'),
            'success',
        );
    });

    it('does not roll when depleted armor makes the underwater breach automatic', () => {
        automationModes.pilotSkillCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        spyOn(Math, 'random');

        forceUnit.addArmorHits('LL', forceUnit.getArmorPoints('LL'));

        expect(Math.random).not.toHaveBeenCalled();
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
    });

    it('requests a hull-breach check in ask mode without resolving it', () => {
        automationModes.breachAndFloodCheck = 'ask';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));
        forceUnit.turnState().setCover('underwater-depth-1');

        forceUnit.addArmorHits('LL', 1);

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(triggers).toEqual([
            jasmine.objectContaining({
                kind: 'hull-breach-check',
                location: 'LL',
                commit: false,
            }),
        ]);
    });

    it('marks flooding when pending armor breaches underwater and commits it at phase end', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');

        forceUnit.addArmorHits('LL', 5);

        expect(forceUnit.getCommittedArmorHits('LL')).toBe(0);
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(forceUnit.serialize().state.locations['LL'].conditions)
            .toEqual([{ key: 'flooded', pending: true }]);

        forceUnit.endPhase();

        expect(forceUnit.getCommittedArmorHits('LL')).toBe(5);
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(forceUnit.serialize().state.locations['LL'].conditions).toEqual(['flooded']);
    });

    it('does not flood or request review when breach and flood automation is no', () => {
        automationModes.breachAndFloodCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));
        forceUnit.turnState().setCover('underwater-depth-1');

        forceUnit.addArmorHits('LL', 1);
        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(triggers).toEqual([]);

        forceUnit.addArmorHits('LL', 4);
        forceUnit.endPhase();

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(triggers.filter(trigger => trigger.kind === 'breach-and-flood')).toEqual([]);
    });

    it('requests one flood review as soon as armor breaches while already underwater', () => {
        automationModes.breachAndFloodCheck = 'ask';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));
        forceUnit.turnState().setCover('underwater-depth-1');

        forceUnit.addArmorHits('LL', 5);

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeFalse();
        expect(triggers.filter(trigger => trigger.kind === 'breach-and-flood')).toEqual([
            jasmine.objectContaining({
                kind: 'breach-and-flood',
                locations: ['LL'],
                commit: false,
            }),
        ]);
    });

    it('can request a deferred flood review again', () => {
        automationModes.breachAndFloodCheck = 'ask';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));
        forceUnit.turnState().setCover('underwater-depth-1');
        forceUnit.addArmorHits('LL', 5);
        forceUnit.endPhase();

        forceUnit.deferUnderwaterBreachAndFloodingReview(['LL']);
        forceUnit.applyUnderwaterBreachAndFlooding(true);

        expect(triggers.filter(trigger => trigger.kind === 'breach-and-flood')).toHaveSize(2);
    });

    it('keeps an unobserved flood review eligible until the unit sheet is opened', () => {
        automationModes.breachAndFloodCheck = 'ask';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        forceUnit.addArmorHits('LL', 5);
        forceUnit.endPhase();

        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));
        forceUnit.applyUnderwaterBreachAndFlooding(true);

        expect(triggers.filter(trigger => trigger.kind === 'breach-and-flood')).toEqual([
            jasmine.objectContaining({ locations: ['LL'], commit: true }),
        ]);
    });

    it('emits one critical chance for each internal-damage assignment', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        forceUnit.addInternalHits('LT', 2);
        forceUnit.addInternalHits('LT', 2);
        forceUnit.addInternalHits('LT', -1);

        const criticalTriggers = triggers.filter(trigger => trigger.kind === 'critical-hit-chance');
        expect(criticalTriggers).toEqual([
            jasmine.objectContaining({
                kind: 'critical-hit-chance',
            }),
            jasmine.objectContaining({
                kind: 'critical-hit-chance',
            }),
        ]);
        expect(criticalTriggers.map(trigger => trigger.id)).toEqual([
            jasmine.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
            jasmine.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        ]);
        expect(criticalTriggers[0].id).not.toBe(criticalTriggers[1].id);
        expect(forceUnit.turnState().getPendingCriticalChances()).toEqual([
            jasmine.objectContaining({
                id: criticalTriggers[0].id,
                location: 'LT',
            }),
            jasmine.objectContaining({
                id: criticalTriggers[1].id,
                location: 'LT',
            }),
        ]);
        expect(forceUnit.turnState().getPendingCriticalChances()
            .every(chance => !chance.locationDestroyed)).toBeTrue();
    });

    it('derives phase damage from the typed structure kind', () => {
        const composite = createCriticalHeatSinkForceUnit().forceUnit;
        spyOn(composite, 'getStructureKindAt').and.returnValue('composite');

        composite.addInternalHits('LT', 2);

        expect(composite.turnState().dmgReceived()).toBe(1);

        const sequentialComposite = createCriticalHeatSinkForceUnit().forceUnit;
        spyOn(sequentialComposite, 'getStructureKindAt').and.returnValue('composite');
        sequentialComposite.addInternalHits('LT', 1);
        sequentialComposite.addInternalHits('LT', 1);
        expect(sequentialComposite.turnState().dmgReceived()).toBe(1);

        const reinforced = createCriticalHeatSinkForceUnit().forceUnit;
        spyOn(reinforced, 'getStructureKindAt').and.returnValue('reinforced');
        reinforced.locations!.internal.set('LT', { loc: 'LT', points: 10 });

        reinforced.addInternalHits('LT', 1);
        expect(reinforced.turnState().dmgReceived()).toBe(0);

        reinforced.addInternalHits('LT', 1);
        expect(reinforced.turnState().dmgReceived()).toBe(1);
    });

    it('counts every Core composite pip destroyed by an internal explosion toward the damage PSR', () => {
        const explosion = createCriticalHeatSinkForceUnit().forceUnit;
        spyOn(explosion, 'getStructureKindAt').and.returnValue('composite');
        explosion.locations!.internal.set('LT', { loc: 'LT', points: 20 });

        // Explosion resolution has already capped 10 damage and doubled it to 20 structure pips.
        expect(explosion.addInternalHits('LT', 20, false, {
            explosionProtection: 'none',
        })).toBe(20);

        expect(explosion.turnState().dmgReceived()).toBe(20);
        expect(explosion.turnState().getPSRChecks()).toContain(jasmine.objectContaining({
            kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
        }));

        const transferred = createCriticalHeatSinkForceUnit().forceUnit;
        spyOn(transferred, 'getStructureKindAt').and.returnValue('composite');

        expect(transferred.addInternalHits('LT', 1, false, {
            explosionProtection: 'none',
            sharedCompositePip: true,
        })).toBe(1);
        expect(transferred.turnState().dmgReceived()).toBe(1);
    });

    it('does not queue automatic critical chances when that automation is no', () => {
        automationModes.criticalHitChanceCheck = 'no';
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        forceUnit.addInternalHits('LT', 2);

        expect(triggers.filter(trigger => trigger.kind === 'critical-hit-chance')).toEqual([]);
        expect(forceUnit.turnState().getPendingCriticalChances()).toEqual([]);
    });

    it('carries explosion protection on the critical chance created by internal damage', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        forceUnit.addInternalHits('LT', 1, false, {
            explosionProtection: 'case-ii',
            hardenedArmorApplies: false,
            pilotDamageGroup: 'turn-closed:immediate:end-turn:heat',
        });

        expect(triggers).toEqual([
            jasmine.objectContaining({
                kind: 'critical-hit-chance',
            }),
        ]);
        const criticalTrigger = triggers.find(trigger => trigger.kind === 'critical-hit-chance');
        expect(criticalTrigger).toBeDefined();
        expect(forceUnit.turnState().getPendingCriticalChances()).toEqual([
            jasmine.objectContaining({
                id: criticalTrigger!.id,
                location: 'LT',
                explosionProtection: 'case-ii',
                hardenedArmorApplies: false,
                pilotDamageGroup: 'turn-closed:immediate:end-turn:heat',
            }),
        ]);
    });

    it('marks the chance that destroys a location and ignores damage beyond its structure', () => {
        const { forceUnit } = createCriticalHeatSinkForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));
        const structure = forceUnit.getInternalPoints('LT');

        forceUnit.addInternalHits('LT', structure - 1);
        forceUnit.addInternalHits('LT', 5);
        forceUnit.addInternalHits('LT', 1);

        const criticalTriggers = triggers.filter(trigger => trigger.kind === 'critical-hit-chance');
        expect(forceUnit.turnState().getPendingCriticalChances()).toEqual([
            jasmine.objectContaining({
                id: criticalTriggers[0].id,
            }),
            jasmine.objectContaining({
                id: criticalTriggers[1].id,
                locationDestroyed: true,
            }),
        ]);
        expect(forceUnit.turnState().getPendingCriticalChances()[0].locationDestroyed).toBeUndefined();
    });

    it('floods all submerged locations at the unit-specific full-submersion depth', () => {
        const normal = createCriticalHeatSinkForceUnit().forceUnit;
        normal.setArmorHits('LT', 5);
        normal.turnState().setCover('underwater-depth-2');
        expect(normal.getLocationCondition('LT', 'flooded')).toBeTrue();

        const superheavy = createCriticalHeatSinkForceUnit().forceUnit;
        superheavy.getUnit().tons = 150;
        superheavy.setArmorHits('LT', 5);
        superheavy.turnState().setCover('underwater-depth-1');
        expect(superheavy.getLocationCondition('LT', 'flooded')).toBeFalse();
        superheavy.turnState().setCover('underwater-depth-2');
        expect(superheavy.getLocationCondition('LT', 'flooded')).toBeFalse();
        superheavy.turnState().setCover('underwater-depth-3');
        expect(superheavy.getLocationCondition('LT', 'flooded')).toBeTrue();
    });

    it('floods a location when either front or rear armor facing is breached', () => {
        const rearBreached = createCriticalHeatSinkForceUnit().forceUnit;
        rearBreached.locations!.armor.set('LT-rear', { loc: 'LT', rear: true, points: 5 });
        rearBreached.setLocations({
            LT: { armor: 5 },
            'LT-rear': { armor: 0 },
        }, true);
        rearBreached.turnState().setCover('underwater-depth-1');
        rearBreached.setCondition('prone', true);
        expect(rearBreached.getLocationCondition('LT', 'flooded')).toBeTrue();

        const frontBreached = createCriticalHeatSinkForceUnit().forceUnit;
        frontBreached.locations!.armor.set('LT-rear', { loc: 'LT', rear: true, points: 5 });
        frontBreached.setLocations({
            LT: { armor: 0 },
            'LT-rear': { armor: 5 },
        }, true);
        frontBreached.turnState().setCover('underwater-depth-1');
        frontBreached.setCondition('prone', true);
        expect(frontBreached.getLocationCondition('LT', 'flooded')).toBeTrue();
    });

    it('disables heat sinks in flooded and blown-off locations', () => {
        const { forceUnit, legSlot } = createCriticalHeatSinkForceUnit();
        forceUnit.turnState().setCover('underwater-depth-1');
        forceUnit.addArmorHits('LL', 5);
        forceUnit.endPhase();

        expect(forceUnit.getLocationCondition('LL', 'flooded')).toBeTrue();
        expect(forceUnit.getEquipmentStatus(legSlot)).toBe('disabled');
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(4);

        forceUnit.setLocationCondition('LL', 'blown-off', true);
        forceUnit.endPhase();

        expect(forceUnit.getEquipmentStatus(legSlot)).toBe('destroyed');
        expect(forceUnit.rules.heatDissipation()?.totalDissipation).toBe(4);
    });

    it('shows a single dissipation value when all remaining cooling is used', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(5));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 2, previous: 2 });
        forceUnit.turnState().addFiredHeat(6);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshTurnState();

        const lines = Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'));
        expect(forceUnit.turnState().heatProjection().projected).toBe(3);
        expect(lines.map(line => line.textContent)).toEqual([
            'Weapons: +6',
            'Sink: -5',
        ]);
        expect(lines[1].getAttribute('fill')).toBe('#2070d1');
    });

    it('keeps heatsink changes in the projection until the turn ends', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(20));
        forceUnit.setHeatData({ current: 15, previous: 15 });
        forceUnit.turnState().moveMode.set('walk');

        expect(forceUnit.turnState().heatProjection().projected).toBe(0);
        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(15);
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();

        forceUnit.setHeatsinksOff(7);

        expect(forceUnit.turnState().heatDissipationBalance()).toBe(13);
        expect(forceUnit.turnState().heatProjection().projected).toBe(3);

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(15);
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBeUndefined();

        forceUnit.setHeatsinksOff(3);
        expect(forceUnit.turnState().heatDissipationBalance()).toBe(17);
        expect(forceUnit.turnState().heatProjection().projected).toBe(0);

        forceUnit.endTurn({ heatAndDissipationResolution: true });

        expect(forceUnit.getHeat().current).toBe(0);
        expect(forceUnit.getHeat().next).toBeUndefined();
    });

    it('settles a persisted dissipation deficit when heat automation is no', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(20));
        forceUnit.setHeatData({ current: 15, previous: 15 });
        forceUnit.turnState().moveMode.set('walk');
        forceUnit.turnState().acknowledgeHeatSources(16);
        forceUnit.setHeatsinksOff(7);
        heatAutomationMode.set('no');
        forceUnit.setHeat(3);

        forceUnit.applyHeat();

        expect(forceUnit.getHeat().current).toBe(3);
        expect(forceUnit.turnState().serialize()?.heatDissipationConsumed).toBe(13);
        expect(forceUnit.turnState().heatDissipationBalance()).toBe(0);
        expect(forceUnit.turnState().heatSources()).toContain(jasmine.objectContaining({ id: 'movement' }));
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeTrue();
    });

    it('reactivates only damaged-engine heat for rules-driven critical writes', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit, createMekDamageSvg());
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().acknowledgeHeatSources();

        forceUnit.writeCrits([{ id: 'engine@CT#0', name: 'Engine', loc: 'CT', slot: 0, destroying: 1 }]);

        expect(forceUnit.turnState().heatSources().map(source => source.id)).toEqual(['damaged-engine']);
    });

    it('keeps projection graphics until automated end-turn resolution', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 0,
        }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="heatScale">
                    ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 2, previous: 2 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));
        forceUnit.turnState().addFiredHeat(5);

        svgService.refreshHeat();
        const projectionPath = svg.querySelector('#heat-projection-path');
        expect(projectionPath).not.toBeNull();

        forceUnit.applyHeat();
        svgService.refreshHeat();

        expect(svg.querySelector('#heat-projection-path')).toBe(projectionPath);

        forceUnit.endTurn({ heatAndDissipationResolution: true });
        svgService.refreshHeat();

        expect(svg.querySelector('#heat-projection-path')).toBeNull();
        expect(svg.querySelector('#projection-arrow')).toBeNull();
    });

    it('centers the overflow projection arrow over its body', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            dissipation: 0,
        }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="heatScale">
                    ${Array.from({ length: 31 }, (_, value) => `<rect class="heat" heat="${value}" x="10" y="${300 - value * 10}" width="10" height="10"></rect>`).join('')}
                    <rect class="overflowFrame" x="10" y="-20" width="10" height="10"></rect>
                    <rect class="overflowButton" x="10" y="-20" width="10" height="10"></rect>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 27, previous: 27 });
        forceUnit.turnState().addFiredHeat(8);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const pathData = svg.querySelector('#heat-projection-path')?.getAttribute('d') ?? '';
        const coordinates = Array.from(pathData.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g), match => ({
            x: Number(match[1]),
            y: Number(match[2]),
        }));
        expect(forceUnit.turnState().heatProjection().projected).toBe(35);
        expect(coordinates.length).toBeGreaterThanOrEqual(3);
        expect(coordinates[0].y).toBe(coordinates[2].y);
        expect(coordinates[1].x).toBeCloseTo((coordinates[0].x + coordinates[2].x) / 2, 10);
        expect(coordinates[1].y).toBeLessThan(coordinates[0].y);
    });

    it('hides the faded arrow when it shares the calculated projection location', () => {
        const forceUnit = createForceUnit(createEmptyUnit({ ...createMekUnit(), heat: 20, dissipation: 0 }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg"><g id="heatScale">
                ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
            </g></svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 2, previous: 7 });
        forceUnit.turnState().addFiredHeat(5);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        expect(svg.querySelector('#projection-arrow')).not.toBeNull();
        expect(svg.querySelector('#faded-arrow')).toBeNull();
    });

    it('hides the faded arrow when it shares the user target location', () => {
        const forceUnit = createForceUnit();
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg"><g id="heatScale">
                ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
            </g></svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 2, previous: 7, next: 7 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        expect(svg.querySelector('#next-arrow')).not.toBeNull();
        expect(svg.querySelector('#faded-arrow')).toBeNull();
    });

    it('renders a coincident user target arrow above the NOW arrow', () => {
        const forceUnit = createForceUnit();
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg"><g id="heatScale">
                ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
            </g></svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 4, previous: 2, next: 4 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const nowArrow = svg.querySelector('#now-arrow');
        const nextArrow = svg.querySelector('#next-arrow');
        expect(nowArrow).not.toBeNull();
        expect(nextArrow).not.toBeNull();
        expect(nowArrow!.compareDocumentPosition(nextArrow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders a coincident calculated target arrow above the NOW arrow', () => {
        const forceUnit = createForceUnit(createMekUnitWithDissipation(2));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg"><g id="heatScale">
                ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
            </g></svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 5, previous: 2 });
        forceUnit.turnState().moveMode.set('run');
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const nowArrow = svg.querySelector('#now-arrow');
        const projectionArrow = svg.querySelector('#projection-arrow');
        expect(forceUnit.turnState().heatProjection().projected).toBe(5);
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeTrue();
        expect(nowArrow).not.toBeNull();
        expect(projectionArrow).not.toBeNull();
        expect(nowArrow!.compareDocumentPosition(projectionArrow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides automatic heat application for an unchanged zero-source projection', () => {
        const forceUnit = createForceUnit(createEmptyUnit({ ...createMekUnit(), heat: 20, dissipation: 0 }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="heatDataPanel"><g id="applyHeatButton"></g></g>
                <g id="heatScale">
                    ${Array.from({ length: 11 }, (_, value) => `<rect class="heat" heat="${value}" x="0" y="${100 - value * 5}" width="5" height="5"></rect>`).join('')}
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        forceUnit.setHeatData({ current: 5, previous: 5 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const heatDataPanel = svg.querySelector('#heatDataPanel');
        expect(forceUnit.turnState().hasPendingHeatResolution()).toBeFalse();
        expect(heatDataPanel?.classList.contains('heatApplicationAvailable')).toBeFalse();
        expect(heatDataPanel?.classList.contains('hot')).toBeFalse();
        expect(heatDataPanel?.classList.contains('cold')).toBeFalse();
        expect(svg.querySelector('#projection-arrow')).toBeNull();
        expect(svg.querySelector('#heat-projection-path')).toBeNull();
    });

    it('shows an orange manual marker for selected weapons when committed heat is zero', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 0));
        const svg = createSelectedHeatScaleSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        expect(svg.querySelector('#heat-projection-target-marker')).toBeNull();
        const marker = expectHeatMarkerAt(svg, 'heat-selected-weapons-target-marker', 7);
        expect(marker?.getAttribute('fill')).toBe('orange');

        forceUnit.setInventoryControlEntrySelected(variableLaser, false);
        svgService.refreshHeat();
        expect(svg.querySelector('#heat-selected-weapons-target-marker')).toBeNull();
    });

    it('shows the orange manual marker at zero when sinks fully dissipate selected heat', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 20));
        const svg = createSelectedHeatScaleSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        expect(svg.querySelector('#heat-projection-target-marker')).toBeNull();
        const marker = expectHeatMarkerAt(svg, 'heat-selected-weapons-target-marker', 0);
        expect(marker?.getAttribute('fill')).toBe('orange');
    });

    it('shows the committed manual marker at zero when sinks fully dissipate committed heat', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 20));
        const svg = createSelectedHeatScaleSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        forceUnit.turnState().addFiredHeat(5);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const marker = expectHeatMarkerAt(svg, 'heat-projection-target-marker', 0);
        expect(marker?.getAttribute('fill')).toBe('#2070d1');
    });

    it('shows the committed manual marker for pure cooling without a committed heat source', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 20));
        const svg = createSelectedHeatScaleSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 5, previous: 5 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const marker = expectHeatMarkerAt(svg, 'heat-projection-target-marker', 0);
        expect(marker?.getAttribute('fill')).toBe('#2070d1');
    });

    it('paints an orange selected marker over a committed marker when both target zero', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 20));
        const svg = createSelectedHeatScaleSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 5, previous: 5 });
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        forceUnit.turnState().addFiredHeat(2);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        const committedMarker = svg.querySelector<SVGPolygonElement>('#heat-projection-target-marker')!;
        const selectedMarker = svg.querySelector<SVGPolygonElement>('#heat-selected-weapons-target-marker')!;
    expectHeatMarkerAt(svg, 'heat-projection-target-marker', 0);
    expectHeatMarkerAt(svg, 'heat-selected-weapons-target-marker', 0);
        expect(selectedMarker.getAttribute('fill')).toBe('orange');
        expect(committedMarker.compareDocumentPosition(selectedMarker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows committed and selected manual heat markers independently', () => {
        heatAutomationMode.set('no');
        const forceUnit = createForceUnit(createSelectedHeatUnit(equipment, 0));
        const svg = createSelectedHeatScaleSvg();
        initialize(forceUnit, svg);
        forceUnit.setHeatData({ current: 0, previous: 0 });
        const variableLaser = forceUnit.getInventory()
            .find(entry => entry.equipment?.id === 'VariableDamageLaser')!;
        forceUnit.setInventoryControlEntrySelected(variableLaser, true);
        forceUnit.turnState().addFiredHeat(2);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshHeat();

        expectHeatMarkerAt(svg, 'heat-projection-target-marker', 2);
        expectHeatMarkerAt(svg, 'heat-selected-weapons-target-marker', 7);
        expect(svg.querySelector('#heat-selected-weapons-target-marker')?.getAttribute('fill')).toBe('orange');
    });

    it('applies head, heat, drowning, and internal-explosion damage to every crew member aboard', () => {
        const cases: readonly [string, (unit: CBTForceUnit) => number][] = [
            ['head hit', unit => unit.applyHeadHitCrewHits('combat:head')],
            ['heat', unit => unit.applyHeatCrewHits(1, 'heat:end-turn')],
            ['drowning', unit => unit.applyLifeSupportDrowningCrewHits(1, 'end:drowning')],
            ['internal explosion', unit => unit.applyInternalExplosionCrewHits(1, 'combat:explosion')],
        ];

        for (const [label, apply] of cases) {
            const forceUnit = createForceUnit(createEmptyUnit({
                type: 'Mek',
                subtype: 'BattleMek',
                crewSize: 3,
            }));
            const crew = forceUnit.getCrewMembers();
            crew[1].setState('unconscious');

            expect(apply(forceUnit)).withContext(label).toBe(3);
            expect(crew.map(member => member.getHits())).withContext(label).toEqual([1, 1, 1]);
        }
    });

    it('queues independent consciousness targets for every crew member hit', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 3,
        }));
        const crew = forceUnit.getCrewMembers();
        crew[1].setHits(1);
        crew[2].setHits(2);

        expect(forceUnit.applyHeadHitCrewHits('combat:head')).toBe(3);

        expect(crew.map(member => member.getHits())).toEqual([1, 2, 3]);
        expect(forceUnit.turnState().getPendingUnitChecks()
            .filter(check => check.kind === 'consciousness')
            .map(check => ({ crewId: check.crewId, target: check.target })))
            .toEqual([
                { crewId: 0, target: 3 },
                { crewId: 1, target: 5 },
                { crewId: 2, target: 7 },
            ]);
    });

    it('keeps consciousness recovery independent for each crew member and hit total', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 3,
        }));
        forceUnit.getCrewMember(0).setHits(1);
        forceUnit.getCrewMember(1).setHits(3);

        expect(forceUnit.setCrewState(0, 'unconscious')).toBeTrue();
        expect(forceUnit.setCrewState(1, 'unconscious')).toBeTrue();

        expect(forceUnit.turnState().getPendingUnitChecks()
            .filter(check => check.kind === 'consciousness-recovery')
            .map(check => ({ crewId: check.crewId, target: check.target })))
            .toEqual([
                { crewId: 0, target: 3 },
                { crewId: 1, target: 7 },
            ]);

        expect(forceUnit.setCrewState(0, 'healthy')).toBeTrue();
        expect(forceUnit.turnState().getPendingUnitChecks()
            .filter(check => check.kind === 'consciousness-recovery')
            .map(check => ({ crewId: check.crewId, target: check.target })))
            .toEqual([{ crewId: 1, target: 7 }]);
    });

    it('aggregates Core combat and Heat Phase pilot damage at the highest consciousness target', () => {
        const combatUnit = createForceUnit();
        combatUnit.applyPilotHits(1, 'combat:test');
        combatUnit.applyPilotHits(1, 'combat:test');

        expect(combatUnit.turnState().getPendingUnitChecks()).toEqual([
            jasmine.objectContaining({
                kind: 'consciousness',
                pilotDamageGroup: 'combat:test',
                target: 5,
            }),
        ]);

        const heatUnit = createForceUnit();
        heatUnit.applyHeatCrewHits(2, 'turn-closed:heat:end-turn:test');
        heatUnit.applyInternalExplosionCrewHits(1, 'turn-closed:heat:end-turn:test');

        expect(heatUnit.turnState().getPendingUnitChecks()).toEqual([
            jasmine.objectContaining({
                kind: 'consciousness',
                pilotDamageGroup: 'turn-closed:heat:end-turn:test',
                target: 7,
            }),
        ]);
    });

    it('preserves unresolved Heat Phase consciousness work across the turn boundary', () => {
        const forceUnit = createForceUnit();
        forceUnit.applyHeatCrewHits(1, 'heat:end-turn:test');

        forceUnit.endTurn();

        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([
            jasmine.objectContaining({
                kind: 'consciousness',
                pilotDamageGroup: 'turn-closed:heat:end-turn:test',
                target: 3,
            }),
        ]);
        expect(forceUnit.turnState().pendingUnitCheckCount()).toBe(1);
    });

    it('defers Core Movement Phase consciousness until the phase boundary', () => {
        const forceUnit = createForceUnit();
        spyOn(forceUnit, 'tracksPhaseAndTurn').and.returnValue(true);
        const automationTrigger = jasmine.createSpy('automationTrigger');
        const subscription = forceUnit.automationTriggers.subscribe(automationTrigger);
        expect(forceUnit.turnState().currentPhase()).toBe('M');

        forceUnit.applyPilotHits(1);

        const check = forceUnit.turnState().getPendingUnitChecks()[0];
        expect(check).toEqual(jasmine.objectContaining({
            kind: 'consciousness',
            target: 3,
        }));
        expect(check.pilotDamageGroup?.startsWith('combat:')).toBeTrue();
        expect(forceUnit.turnState().actionablePendingUnitChecks().some(check =>
            check.kind === 'consciousness')).toBeFalse();
        expect(forceUnit.turnState().pendingUnitCheckCountAtPhaseEnd()).toBe(1);
        expect(automationTrigger).not.toHaveBeenCalled();
        subscription.unsubscribe();
    });

    it('folds Core seatbelt damage into the phase consciousness target', () => {
        const forceUnit = createForceUnit();
        spyOn(forceUnit, 'tracksPhaseAndTurn').and.returnValue(true);
        const group = forceUnit.turnState().currentPilotDamageGroup();
        forceUnit.applyPilotHits(1, group);
        expect(forceUnit.queueFall('psr')).toBeTrue();
        expect(forceUnit.completePendingFall(forceUnit.getPendingFall()!.id)).toBeTrue();
        const seatbelt = forceUnit.turnState().getPendingUnitChecks().find(check =>
            check.kind === 'seatbelt')!;

        forceUnit.applyPilotHits(1, seatbelt.pilotDamageGroup, seatbelt.crewId);

        expect(seatbelt.pilotDamageGroup).toBe(group);
        expect(forceUnit.turnState().getPendingUnitChecks().filter(check =>
            check.kind === 'consciousness')).toEqual([
            jasmine.objectContaining({ pilotDamageGroup: group, target: 5 }),
        ]);
        expect(forceUnit.turnState().actionablePendingUnitChecks().some(check =>
            check.kind === 'consciousness')).toBeFalse();
    });

    it('applies tabletop pilot damage but queues no consciousness or recovery automation in no mode', () => {
        automationModes.pilotHitsAndConsciousnessCheck = 'no';
        const forceUnit = createForceUnit();

        expect(forceUnit.applyPilotHits(1)).toBe(1);
        expect(forceUnit.getCrewMember(0).getHits()).toBe(1);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);

        expect(forceUnit.setCrewState(0, 'unconscious')).toBeTrue();
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
    });

    it('uses the roll dialog itself as the ask interaction for consciousness and recovery', () => {
        automationModes.pilotHitsAndConsciousnessCheck = 'ask';
        const forceUnit = createForceUnit();

        forceUnit.applyPilotHits(1);
        expect(forceUnit.turnState().getPendingUnitChecks()).toContain(jasmine.objectContaining({
            kind: 'consciousness',
            target: 3,
        }));

        forceUnit.setCrewState(0, 'unconscious');
        expect(forceUnit.turnState().getPendingUnitChecks()).toContain(jasmine.objectContaining({
            kind: 'consciousness-recovery',
        }));
    });

    it('makes consciousness recovery actionable during the following turn', () => {
        const forceUnit = createForceUnit();

        forceUnit.applyPilotHits(1);
        forceUnit.setCrewState(0, 'unconscious');

        expect(forceUnit.turnState().getPendingUnitChecks()).toContain(jasmine.objectContaining({
            kind: 'consciousness-recovery',
            readyTurn: 1,
        }));
        expect(forceUnit.turnState().pendingUnitCheckCount()).toBe(0);

        forceUnit.endTurn();

        expect(forceUnit.turnState().getTurnCounter()).toBe(1);
        expect(forceUnit.turnState().pendingUnitCheckCount()).toBe(1);
    });

    it('records a fatal sixth pilot hit immediately but resolves death at phase end', () => {
        const forceUnit = createForceUnit();
        forceUnit.applyPilotHits(5);
        forceUnit.setCrewState(0, 'unconscious');

        expect(forceUnit.turnState().getPendingUnitChecks().some(check =>
            check.kind === 'consciousness-recovery')).toBeTrue();

        expect(forceUnit.applyPilotHits(3)).toBe(1);

        const crew = forceUnit.getCrewMember(0);
        expect(crew.getState()).toBe('unconscious');
        expect(crew.getHits()).toBe(DEAD_CREW_HIT_THRESHOLD);
        expect(forceUnit.serialize().state.crew[0].state).toBe(1);
        expect(forceUnit.getCondition('abandoned')).toBeFalse();
        expect(forceUnit.turnState().getPendingUnitChecks().filter(check =>
            check.kind === 'consciousness' || check.kind === 'consciousness-recovery')).toEqual([]);

        forceUnit.endPhase();

        expect(crew.getState()).toBe('dead');
        expect(forceUnit.serialize().state.crew[0].state).toBe(2);
        expect(forceUnit.getCondition('abandoned')).toBeTrue();
    });

    it('routes tabletop pilot damage through Core consciousness aggregation', () => {
        const forceUnit = createForceUnit();
        spyOn(forceUnit, 'tracksPhaseAndTurn').and.returnValue(true);
        forceUnit.turnState().moveMode.set('stationary');
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        expect(forceUnit.setCrewHits(0, 1)).toBeTrue();
        expect(forceUnit.setCrewHits(0, 2)).toBeTrue();

        expect(forceUnit.getCrewMember(0).getHits()).toBe(2);
        expect(forceUnit.turnState().dirtyPhase()).toBeTrue();
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([
            jasmine.objectContaining({
                kind: 'consciousness',
                target: 5,
                pilotDamageGroup: jasmine.stringMatching(/^combat:/),
            }),
        ]);
        expect(forceUnit.turnState().pendingUnitCheckCount()).toBe(0);
        expect(forceUnit.turnState().pendingUnitCheckCountAtPhaseEnd()).toBe(1);
        expect(triggers).toEqual([]);
    });

    it('routes each tabletop pilot hit through Total Warfare consciousness checks', () => {
        cbtRules = 'tw';
        const forceUnit = createForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        expect(forceUnit.setCrewHits(0, 2)).toBeTrue();

        expect(forceUnit.getCrewMember(0).getHits()).toBe(2);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([
            jasmine.objectContaining({ kind: 'consciousness', target: 3 }),
            jasmine.objectContaining({ kind: 'consciousness', target: 5 }),
        ]);
        expect(forceUnit.turnState().pendingUnitCheckCount()).toBe(2);
        expect(triggers).toEqual([{ kind: 'pending-unit-check' }]);

        expect(forceUnit.setCrewHits(0, 1)).toBeTrue();

        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([
            jasmine.objectContaining({ kind: 'consciousness', target: 3 }),
        ]);
        expect(triggers).toEqual([{ kind: 'pending-unit-check' }]);
    });

    it('reconciles pending consciousness tiers after a tabletop hit correction', () => {
        const forceUnit = createForceUnit();
        forceUnit.applyPilotHits(2);
        expect(forceUnit.turnState().getPendingUnitChecks().map(check => check.target)).toEqual([5]);

        expect(forceUnit.setCrewHits(0, 1)).toBeTrue();

        expect(forceUnit.turnState().getPendingUnitChecks().map(check => check.target)).toEqual([3]);
    });

    it('automatically fails an unconscious pilot\'s PSR before committing the phase', () => {
        const forceUnit = createForceUnit();
        forceUnit.setCrewState(0, 'unconscious');
        forceUnit.turnState().addDmgReceived(20);

        expect(forceUnit.turnState().PSRRollsCount()).toBe(1);
        expect(forceUnit.turnState().actionablePSRRollsCount()).toBe(0);

        forceUnit.endPhase();

        expect(forceUnit.getCondition('prone')).toBeTrue();
        expect(forceUnit.turnState().PSRRollsCount()).toBe(0);
        expect(forceUnit.pendingFallCount()).toBe(1);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);

        expect(forceUnit.completePendingFall(forceUnit.getPendingFall()!.id)).toBeTrue();
        expect(forceUnit.turnState().getPendingUnitChecks()).toContain(jasmine.objectContaining({
            kind: 'seatbelt',
            result: { kind: 'automatic', outcome: 'failed' },
        }));
    });

    it('keeps crew 0 on PSRs while available and uses the best available alternate only after takeover', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 3,
        }));
        forceUnit.getCrewMember(0).setSkill('piloting', 6);
        forceUnit.getCrewMember(1).setSkill('piloting', 5);
        forceUnit.getCrewMember(2).setSkill('piloting', 3);

        expect(forceUnit.rules.getActivePilotCrewId()).toBe(0);
        expect(forceUnit.rules.getBasePilotingSkill()).toBe(6);

        forceUnit.getCrewMember(0).setState('unconscious');
        forceUnit.turnState().addDmgReceived(20);

        expect(forceUnit.rules.getActivePilotCrewId()).toBe(2);
        expect(forceUnit.rules.getBasePilotingSkill()).toBe(3);
        expect(forceUnit.turnState().automaticPSRFailure()).toBeFalse();
        expect(forceUnit.turnState().actionablePSRRollsCount()).toBe(1);
    });

    it('keeps the TW involuntary shutdown PSR rollable while the Mek is standing', () => {
        cbtRules = 'tw';
        const forceUnit = createForceUnit();
        forceUnit.setCondition('shutdown', true);
        forceUnit.turnState().setPSRCheckState({ shutdown: true });

        const [shutdownCheck] = forceUnit.turnState().getPSRChecks();
        expect(shutdownCheck.kind).toBe(PSR_CHECK_KIND.SHUTDOWN);
        expect(forceUnit.turnState().PSRRollsCount()).toBe(1);
        expect(forceUnit.turnState().actionablePSRRollsCount()).toBe(1);
        expect(forceUnit.turnState().automaticPSRFailure()).toBeFalse();

        expect(forceUnit.turnState().resolvePSRCheck(shutdownCheck.id!, 'success')).toBeTrue();
        expect(forceUnit.getCondition('prone')).toBeFalse();
        expect(forceUnit.pendingFallCount()).toBe(0);
    });

    it('keeps a fall and its exact dice across save/reload until completion', () => {
        const forceUnit = createForceUnit();
        forceUnit.setCondition('prone', true);
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        expect(forceUnit.queueFall('stand-attempt')).toBeTrue();

        expect(triggers).toEqual([
            jasmine.objectContaining({
                kind: 'falling',
                source: 'stand-attempt',
                levelsFallen: 0,
            }),
        ]);
        expect(forceUnit.pendingFallCount()).toBe(1);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
        const pending = forceUnit.getPendingFall()!;

        expect(forceUnit.setPendingFallRolls(pending.id, 4, [{
            hitLocationDice: [5, 2],
            tripodLegRoll: null,
        }])).toBeTrue();
        expect(forceUnit.getPendingFall(pending.id)).toEqual(jasmine.objectContaining({
            orientationRoll: 4,
            damageRolls: [{
                hitLocationDice: [5, 2],
                tripodLegRoll: null,
            }],
        }));
        expect('falling' in forceUnit.serialize().state).toBeFalse();

        const restored = CBTForceUnit.deserialize(
            forceUnit.serialize(),
            new TestCBTForce('Restored Fall Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector,
        );
        expect(restored.getPendingFall(pending.id)).toEqual(jasmine.objectContaining({
            orientationRoll: 4,
            damageRolls: [{
                hitLocationDice: [5, 2],
                tripodLegRoll: null,
            }],
        }));

        expect(forceUnit.completePendingFall(pending.id)).toBeTrue();
        expect(forceUnit.pendingFallCount()).toBe(0);
        expect(triggers[triggers.length - 1]).toEqual({ kind: 'pending-unit-check' });
        expect(forceUnit.turnState().getPendingUnitChecks()).toContain(jasmine.objectContaining({
            kind: 'seatbelt',
        }));
    });

    it('creates one seatbelt check per crew member with independent skills and unconscious failure', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 3,
        }));
        forceUnit.getCrewMember(0).setSkill('piloting', 5);
        forceUnit.getCrewMember(1).setSkill('piloting', 4);
        forceUnit.getCrewMember(1).setState('unconscious');
        forceUnit.getCrewMember(2).setSkill('piloting', 3);

        expect(forceUnit.queueFall('psr')).toBeTrue();
        expect(forceUnit.completePendingFall(forceUnit.getPendingFall()!.id)).toBeTrue();

        const seatbelts = forceUnit.turnState().getPendingUnitChecks()
            .filter(check => check.kind === 'seatbelt');
        expect(seatbelts).toEqual([
            jasmine.objectContaining({ crewId: 0, target: 5 }),
            jasmine.objectContaining({
                crewId: 1,
                result: { kind: 'automatic', outcome: 'failed' },
            }),
            jasmine.objectContaining({ crewId: 2, target: 3 }),
        ]);
        expect(seatbelts[1].target).toBeUndefined();
    });

    it('does not queue another fall or seatbelt for a PSR while already prone', () => {
        const forceUnit = createForceUnit();
        forceUnit.setCondition('prone', true);
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        expect(forceUnit.queueFall('psr')).toBeFalse();

        expect(triggers).toEqual([]);
        expect(forceUnit.pendingFallCount()).toBe(0);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
    });

    it('does not queue falling work when falling automation is no', () => {
        automationModes.fallingCheck = 'no';
        const forceUnit = createForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        expect(forceUnit.queueFall('psr')).toBeFalse();

        expect(triggers).toEqual([]);
        expect(forceUnit.pendingFallCount()).toBe(0);
    });

    it('does not create a fall or seatbelt check for 20-point damage while prone', () => {
        const forceUnit = createForceUnit();
        forceUnit.setCondition('prone', true);
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        forceUnit.turnState().addDmgReceived(19);
        forceUnit.turnState().addDmgReceived(1);
        forceUnit.turnState().addDmgReceived(5);

        expect(forceUnit.pendingFallCount()).toBe(0);
        expect(forceUnit.turnState().PSRRollsCount()).toBe(0);
        expect(triggers).toEqual([]);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
    });

    it('removes a standing 20-point fall PSR when stance is manually changed to prone', () => {
        const forceUnit = createForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        forceUnit.turnState().addDmgReceived(20);
        expect(forceUnit.turnState().PSRRollsCount()).toBe(1);

        forceUnit.setCondition('prone', true);

        expect(forceUnit.turnState().PSRRollsCount()).toBe(0);
        expect(forceUnit.pendingFallCount()).toBe(0);
        expect(triggers).toEqual([]);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
    });

    it('keeps standing 20-point damage on the normal fall-PSR path', () => {
        const forceUnit = createForceUnit();

        forceUnit.turnState().addDmgReceived(20);

        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
        expect(forceUnit.turnState().getPSRChecks()).toContain(jasmine.objectContaining({
            kind: PSR_CHECK_KIND.DAMAGE_THRESHOLD,
            failure: FALL_PSR_FAILURE,
            reason: jasmine.stringMatching(/20/),
        }));
    });

    it('keeps the manual prone state override separate from falling automation', () => {
        const forceUnit = createForceUnit();
        const triggers: CBTUnitAutomationTrigger[] = [];
        forceUnit.automationTriggers.subscribe(trigger => triggers.push(trigger));

        forceUnit.setCondition('prone', true);
        forceUnit.setCondition('prone', false);

        expect(triggers).toEqual([]);
        expect(forceUnit.pendingFallCount()).toBe(0);
        expect(forceUnit.turnState().getPendingUnitChecks()).toEqual([]);
    });

    it('clamps turn movement when committed inventory state reduces active run movement bonus', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new RunMovementBonusTestHandler());
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'RunMovementBonus_TEST-1',
            chassis: 'Run Movement Bonus',
            model: 'TEST-1',
            type: 'Mek',
            subtype: 'BattleMek',
            walk: 5,
            run: 8,
            run2: 8,
        }));
        const entry = new MountedEquipment({
            owner: forceUnit,
            id: 'run-movement-bonus-test@CT#0',
            name: 'Run Movement Bonus Test',
            equipment: new Equipment({ id: 'run-movement-bonus-test', name: 'Run Movement Bonus Test', type: 'misc', flags: ['F_TEST_ONLY'] }),
            locations: new Set(['CT']),
        });
        forceUnit.isLoaded.set(true);
        entry.setState('active', 'true');
        forceUnit.setInventory([entry], true);
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().setMoveDistance(10);

        entry.deleteState('active');
        forceUnit.setInventoryEntry(entry);

        expect(forceUnit.turnState().moveDistance()).toBe(8);
    });

    it('keeps ordinary equipment state persistence outside the phase lifecycle', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const entry = forceUnit.getInventory().find(item => item.equipment instanceof WeaponEquipment)!;

        entry.setState('test-mode', 'charged');
        forceUnit.setInventoryEntry(entry);

        expect(forceUnit.turnState().dirtyPhase()).toBeFalse();
        expect(forceUnit.turnState().serialize()?.equipmentStateChanged).toBeUndefined();
    });

    it('keeps ammo type changes in a critical slot outside the phase lifecycle', () => {
        const forceUnit = createForceUnit(createMekUnit());
        initialize(forceUnit);
        const ammo = equipment['Clan Ultra AC/20 Ammo'] as AmmoEquipment;
        forceUnit.setCritSlots([{
            id: `${ammo.internalName}@LT#0`,
            name: ammo.internalName,
            loc: 'LT',
            slot: 0,
            eq: ammo,
            totalAmmo: 5,
            consumed: 0,
        }], true);
        const ammoSlot = forceUnit.getCritSlot('LT', 0)!;

        expect(forceUnit.turnState().dirtyPhase()).toBeFalse();

        const precisionAmmo = equipment['Clan Ultra AC/20 Precision Ammo'] as AmmoEquipment;
        ammoSlot.originalName = ammoSlot.name;
        ammoSlot.name = precisionAmmo.internalName;
        ammoSlot.eq = precisionAmmo;
        ammoSlot.totalAmmo = 4;
        forceUnit.setCritSlot(ammoSlot);

        expect(forceUnit.getCritSlot('LT', 0)?.eq).toBe(precisionAmmo);
        expect(forceUnit.turnState().dirtyPhase()).toBeFalse();
    });

    it('splits direct inventory ammo into one entry per bin using q and q2', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));

        initialize(forceUnit);

        const ammoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        expect(ammoEntries.length).toBe(6);
        expect(ammoEntries.every(entry => entry instanceof MountedAmmo)).toBeTrue();
        expect(ammoEntries.map(entry => entry.id)).toEqual([
            'Clan Ultra AC/20 Ammo@BD#1.0',
            'Clan Ultra AC/20 Ammo@BD#1.1',
            'Clan Ultra AC/20 Ammo@BD#1.2',
            'Clan Ultra AC/20 Ammo@BD#1.3',
            'Clan Ultra AC/20 Ammo@BD#1.4',
            'Clan Ultra AC/20 Ammo@BD#1.5',
        ]);
        expect(ammoEntries.map(entry => entry.totalAmmo)).toEqual([5, 5, 5, 5, 5, 5]);
        expect(ammoEntries.map(entry => entry.consumed)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('creates and clones mounted equipment using the equipment subtype', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const ammo = MountedEquipment.from(new MountedEquipment({
            owner: forceUnit,
            id: 'ammo',
            name: 'Ammo',
            equipment: equipment['Clan Ultra AC/20 Ammo'],
        }));
        const weapon = MountedEquipment.from(new MountedEquipment({
            owner: forceUnit,
            id: 'weapon',
            name: 'Weapon',
            equipment: equipment['ISMediumLaser'],
        }));
        const misc = MountedEquipment.from(new MountedEquipment({
            owner: forceUnit,
            id: 'misc',
            name: 'Misc',
            equipment: equipment['ISLaserInsulator'],
        }));

        expect(ammo).toBeInstanceOf(MountedAmmo);
        expect(weapon).toBeInstanceOf(MountedWeapon);
        expect(misc).toBeInstanceOf(MountedMisc);
        expect(ammo.clone()).toBeInstanceOf(MountedAmmo);
        expect(weapon.clone()).toBeInstanceOf(MountedWeapon);
        expect(misc.clone()).toBeInstanceOf(MountedMisc);
        expect(ammo.clone({ equipment: equipment['ISMediumLaser'] })).toBeInstanceOf(MountedWeapon);
    });

    it('commits pending direct inventory hit and repair state at phase end', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;

        weaponEntry.setPendingDestroyed(true);
        forceUnit.setInventoryEntry(weaponEntry);

        expect(weaponEntry.committedDestroyed()).toBeFalse();
        expect(weaponEntry.pendingDestroyed()).toBeTrue();
        expect(forceUnit.turnState().dirtyPhase()).toBeTrue();
        expect(forceUnit.serialize().state.inventory).toEqual([{ id: weaponEntry.id, destroying: true }]);

        forceUnit.clearInventoryControlSelection();

        expect(weaponEntry.pendingDestroyed()).toBeTrue();

        const restoredHit = CBTForceUnit.deserialize(
            forceUnit.serialize(),
            new TestCBTForce('Restored Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector
        );

        expect(restoredHit.getInventory().find(entry => entry.id === weaponEntry.id)?.pendingDestroyed()).toBeTrue();
        expect(restoredHit.getInventory().find(entry => entry.id === weaponEntry.id)?.committedDestroyed()).toBeFalse();

        forceUnit.endPhase();

        expect(weaponEntry.committedDestroyed()).toBeTrue();
        expect(weaponEntry.pendingDestroyed()).toBeUndefined();

        weaponEntry.setPendingDestroyed(false);
        forceUnit.setInventoryEntry(weaponEntry);

        expect(weaponEntry.committedDestroyed()).toBeTrue();
        expect(weaponEntry.pendingDestroyed()).toBeFalse();
        expect(forceUnit.turnState().dirtyPhase()).toBeTrue();
        expect(forceUnit.serialize().state.inventory).toEqual([{ id: weaponEntry.id, destroyed: true, destroying: false }]);

        const restoredRepair = CBTForceUnit.deserialize(
            forceUnit.serialize(),
            new TestCBTForce('Restored Repair Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector
        );

        expect(restoredRepair.getInventory().find(entry => entry.id === weaponEntry.id)?.pendingDestroyed()).toBeFalse();
        expect(restoredRepair.getInventory().find(entry => entry.id === weaponEntry.id)?.committedDestroyed()).toBeTrue();

        forceUnit.endPhase();

        expect(weaponEntry.committedDestroyed()).toBeFalse();
        expect(weaponEntry.pendingDestroyed()).toBeUndefined();
    });

    function installChargedPpcPair(
        forceUnit: CBTForceUnit,
        criticalSlots = false,
    ): {
        weapon: MountedWeapon;
        capacitor: MountedMisc;
        weaponSlots: CriticalSlot[];
        capacitorSlots: CriticalSlot[];
        unrelatedSlot: CriticalSlot | null;
    } {
        const location = criticalSlots ? 'RA' : 'FR';
        const weaponId = `TestPPC@${location}#0`;
        const capacitorId = `TestPPCCapacitor@${location}#1`;
        const ppc = new WeaponEquipment({
            id: 'TestPPC',
            name: 'Test PPC',
            type: 'weapon',
            flags: ['F_PPC', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_PPC_CAPACITOR_COMPATIBLE'],
            weapon: { damage: 10, heat: 10, ranges: [6, 12, 18, 24] },
        });
        const capacitorEquipment = new MiscEquipment({
            id: 'TestPPCCapacitor',
            name: 'Test PPC Capacitor',
            type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR'],
        });
        const weaponSlots: CriticalSlot[] = criticalSlots ? [
            { id: weaponId, name: ppc.name, loc: location, slot: 0, eq: ppc },
            { id: weaponId, name: ppc.name, loc: location, slot: 1, eq: ppc },
        ] : [];
        const capacitorSlots: CriticalSlot[] = criticalSlots ? [
            { id: capacitorId, name: capacitorEquipment.name, loc: location, slot: 2, eq: capacitorEquipment },
            { id: capacitorId, name: capacitorEquipment.name, loc: location, slot: 3, eq: capacitorEquipment },
        ] : [];
        const unrelatedSlot: CriticalSlot | null = criticalSlots
            ? { id: 'Unrelated@LA#2', name: 'Unrelated', loc: 'LA', slot: 0 }
            : null;
        if (criticalSlots) {
            forceUnit.setCritSlots([
                ...weaponSlots,
                ...capacitorSlots,
                unrelatedSlot!,
            ], true);
        }

        const capacitor = new MountedMisc({
            owner: forceUnit,
            id: capacitorId,
            name: capacitorEquipment.name,
            equipment: capacitorEquipment,
            locations: new Set([location]),
            critSlots: capacitorSlots,
            states: new Map([[PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE]]),
        });
        const weapon = new MountedWeapon({
            owner: forceUnit,
            id: weaponId,
            name: ppc.name,
            equipment: ppc,
            locations: new Set([location]),
            critSlots: weaponSlots,
        });
        weapon.setLinkedEquipment([capacitor]);
        forceUnit.setInventory([weapon, capacitor], true);
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new PpcCapacitorHandler());
        return { weapon, capacitor, weaponSlots, capacitorSlots, unrelatedSlot };
    }

    it('keeps a declared PPC capacitor charge dirty through serialization until phase end', async () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const { weapon, capacitor } = installChargedPpcPair(forceUnit);
        capacitor.deleteState(PPC_CAPACITOR_STATE_KEY);
        forceUnit.setInventoryEntry(capacitor);
        expect(forceUnit.turnState().dirtyPhase()).toBeFalse();

        const registry = TestBed.inject(EquipmentInteractionRegistryService).getRegistry();
        const equipmentRegistry = dataService.getEquipmentRegistry();
        const choice = registry.getChoices(weapon, createHandlerQueryContext(equipmentRegistry))
            .find(candidate => candidate.value === PPC_CAPACITOR_CHARGING_STATE)!;
        await registry.handleSelection(weapon, choice, createHandlerCommandContext(
            equipmentRegistry,
            TestBed.inject(ToastService),
            TestBed.inject(DialogsService),
        ));

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGING_STATE);
        expect(forceUnit.turnState().dirtyPhase()).toBeTrue();
        expect(forceUnit.turnState().serialize()?.equipmentStateChanged).toBeTrue();

        const restored = CBTForceUnit.deserialize(
            forceUnit.serialize(),
            new TestCBTForce('Restored PPC Charge Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector,
        );
        expect(restored.turnState().dirtyPhase()).toBeTrue();
        expect(restored.getInventory().find(entry => entry.id === capacitor.id)?.states.get(PPC_CAPACITOR_STATE_KEY))
            .toBe(PPC_CAPACITOR_CHARGING_STATE);

        forceUnit.endPhase();

        expect(forceUnit.turnState().dirtyPhase()).toBeFalse();
        expect(forceUnit.turnState().serialize()?.equipmentStateChanged).toBeUndefined();
        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGING_STATE);
    });

    it('does not infer a charged PPC-capacitor explosion from manual inventory destruction', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const { weapon, capacitor } = installChargedPpcPair(forceUnit);
        expect(forceUnit.applyEquipmentDamage(weapon)).toBeTrue();

        forceUnit.endPhase();

        const committedWeapon = forceUnit.getInventory().find(entry => entry.id === weapon.id)!;
        const committedCapacitor = forceUnit.getInventory().find(entry => entry.id === capacitor.id)!;
        expect(committedWeapon.committedDestroyed()).toBeTrue();
        expect(committedCapacitor.committedDestroyed()).toBeFalse();
        expect(committedWeapon.pendingDestroyed()).toBeUndefined();
        expect(committedCapacitor.pendingDestroyed()).toBeUndefined();
        expect(committedCapacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
    });

    it('does not explode a charging PPC-capacitor from manual inventory destruction', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const { weapon, capacitor } = installChargedPpcPair(forceUnit);
        capacitor.setState(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGING_STATE);
        forceUnit.setInventoryEntry(capacitor);
        expect(forceUnit.applyEquipmentDamage(weapon)).toBeTrue();

        forceUnit.endTurn();

        const committedWeapon = forceUnit.getInventory().find(entry => entry.id === weapon.id)!;
        const committedCapacitor = forceUnit.getInventory().find(entry => entry.id === capacitor.id)!;
        expect(committedWeapon.committedDestroyed()).toBeTrue();
        expect(committedCapacitor.committedDestroyed()).toBeFalse();
        expect(committedCapacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
    });

    for (const consolidateImmediately of [false, true]) {
        it(`commits a charged PPC-capacitor explosion across every Mek slot${consolidateImmediately ? ' immediately' : ' at phase end'}`, () => {
            const forceUnit = createForceUnit(createMekUnit());
            const crew = forceUnit.getCrewMember(0);
            crew.setHits(DEAD_CREW_HIT_THRESHOLD - 1);
            const { weaponSlots, capacitorSlots, unrelatedSlot } = installChargedPpcPair(forceUnit, true);
            const triggerSlot = consolidateImmediately ? weaponSlots[0] : capacitorSlots[0];

            const result = applyMekCriticalRoll(
                forceUnit,
                'RA',
                [1, (triggerSlot.slot ?? 0) + 1],
                consolidateImmediately,
            );
            expect(result?.applied).toBeTrue();
            expect(crew.getHits()).toBe(consolidateImmediately ? DEAD_CREW_HIT_THRESHOLD : DEAD_CREW_HIT_THRESHOLD - 1);
            if (consolidateImmediately) {
                expect(crew.getState()).toBe('healthy');
            }

            forceUnit.endPhase();

            expect(crew.getHits()).toBe(DEAD_CREW_HIT_THRESHOLD);
            expect(crew.getState()).toBe('dead');

            const committedSlots = [...weaponSlots, ...capacitorSlots]
                .map(slot => forceUnit.findCurrentCriticalSlot(slot)!);
            const committedWeapon = forceUnit.getInventory().find(entry => entry.id === 'TestPPC@RA#0')!;
            const committedCapacitor = forceUnit.getInventory().find(entry => entry.id === 'TestPPCCapacitor@RA#1')!;
            expect(committedSlots.every(slot => !!slot.destroyed)).toBeTrue();
            expect(committedSlots.every(slot =>
                (slot.hits ?? 0) >= (slot.armored ? 2 : 1))).toBeTrue();
            expect(forceUnit.findCurrentCriticalSlot(unrelatedSlot!)?.destroyed).toBeUndefined();
            expect(forceUnit.findCurrentCriticalSlot(unrelatedSlot!)?.hits).toBeUndefined();
            expect(committedCapacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
            expect(committedWeapon.linkedWith).toContain(committedCapacitor);
            expect(committedCapacitor.parent).toBe(committedWeapon);
        });
    }

    for (const capacitorState of [PPC_CAPACITOR_CHARGED_STATE, PPC_CAPACITOR_CHARGING_STATE] as const) {
        it(`does not explode but clears a ${capacitorState} capacitor when its Mek location is destroyed`, () => {
            const forceUnit = createForceUnit(createMekUnit());
            forceUnit.locations = {
                armor: new Map(),
                internal: new Map([['RA', { loc: 'RA', points: 1 }]]),
            };
            forceUnit.setLocations({ RA: { internal: 0 } }, true);
            const { capacitor, weaponSlots, capacitorSlots } = installChargedPpcPair(forceUnit, true);
            forceUnit.isLoaded.set(true);
            capacitor.setState(PPC_CAPACITOR_STATE_KEY, capacitorState);
            forceUnit.setInventoryEntry(capacitor);

            forceUnit.addInternalHits('RA', 1);

            expect([...weaponSlots, ...capacitorSlots].every(slot => !!slot.destroying)).toBeTrue();
            expect([...weaponSlots, ...capacitorSlots].every(slot => (slot.hits ?? 0) === 0)).toBeTrue();

            forceUnit.endTurn();

            const committedSlots = [...weaponSlots, ...capacitorSlots]
                .map(slot => forceUnit.findCurrentCriticalSlot(slot)!);
            const committedCapacitor = forceUnit.getInventory().find(entry => entry.id === capacitor.id)!;
            expect(committedSlots.every(slot => !!slot.destroyed)).toBeTrue();
            expect(committedSlots.every(slot => (slot.hits ?? 0) === 0)).toBeTrue();
            expect(committedCapacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        });
    }

    function installChargingBombast(
        forceUnit: CBTForceUnit,
        criticalSlots = false,
    ): { weapon: MountedWeapon; currentSlots: CriticalSlot[] } {
        const location = criticalSlots ? 'RA' : 'FR';
        const weaponId = `TestBombastLaser@${location}#0`;
        const bombast = new WeaponEquipment({
            id: 'TestBombastLaser',
            name: 'Test Bombast Laser',
            type: 'weapon',
            flags: ['F_BOMBAST_LASER', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER'],
            weapon: { damage: 12, heat: 12, ranges: [5, 10, 15, 20] },
        });
        const currentSlots: CriticalSlot[] = criticalSlots ? [
            { id: weaponId, name: bombast.name, loc: location, slot: 0, eq: bombast },
            { id: weaponId, name: bombast.name, loc: location, slot: 1, eq: bombast },
        ] : [];
        if (criticalSlots) forceUnit.setCritSlots(currentSlots, true);

        const weapon = new MountedWeapon({
            owner: forceUnit,
            id: weaponId,
            name: bombast.name,
            equipment: bombast,
            locations: new Set([location]),
            critSlots: currentSlots.map(slot => ({ ...slot })),
            states: new Map([[BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGING_STATE]]),
        });
        forceUnit.setInventory([weapon], true);
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new BombastLaserHandler());
        return { weapon, currentSlots };
    }

    it('clears a charging direct-inventory Bombast Laser before end-turn destruction commits', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const { weapon } = installChargingBombast(forceUnit);
        expect(forceUnit.applyEquipmentDamage(weapon)).toBeTrue();

        forceUnit.endTurn();

        const committedWeapon = forceUnit.getInventory().find(entry => entry.id === weapon.id)!;
        expect(committedWeapon.committedDestroyed()).toBeTrue();
        expect(committedWeapon.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
    });

    it('clears a charging Mek Bombast Laser from its current pending critical slot at end turn', () => {
        const forceUnit = createForceUnit(createMekUnit());
        const { weapon, currentSlots } = installChargingBombast(forceUnit, true);
        forceUnit.applyHitToCritSlot(currentSlots[0]);

        forceUnit.endTurn();

        const committedWeapon = forceUnit.getInventory().find(entry => entry.id === weapon.id)!;
        expect(forceUnit.findCurrentCriticalSlot(currentSlots[0])?.destroyed).toBeTruthy();
        expect(committedWeapon.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
    });

    it('uses the lowest gunnery skill among crew members', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'BMTest_MEK-1',
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 3,
        }));
        forceUnit.getCrewMember(0).setSkill('gunnery', 6);
        forceUnit.getCrewMember(1).setSkill('gunnery', 5);
        forceUnit.getCrewMember(2).setSkill('gunnery', 3);

        expect(forceUnit.gunnerySkill()).toBe(3);
    });

    it('uses the lowest piloting skill among crew members', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'BMTest_MEK-1',
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 3,
        }));
        forceUnit.getCrewMember(0).setSkill('piloting', 6);
        forceUnit.getCrewMember(1).setSkill('piloting', 4);
        forceUnit.getCrewMember(2).setSkill('piloting', 5);

        expect(forceUnit.pilotingSkill()).toBe(4);
    });

    it('includes ASF skills when choosing the best Land-Air BattleMek crew skills', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'LAMTest_MEK-1',
            type: 'Mek',
            subtype: 'Land-Air BattleMek',
            crewSize: 2,
        }));
        forceUnit.getCrewMember(0).setSkill('gunnery', 6);
        forceUnit.getCrewMember(0).setSkill('piloting', 6);
        forceUnit.getCrewMember(1).setSkill('gunnery', 5);
        forceUnit.getCrewMember(1).setSkill('piloting', 5);
        forceUnit.getCrewMember(1).setSkill('gunnery', 2, true);
        forceUnit.getCrewMember(1).setSkill('piloting', 3, true);

        expect(forceUnit.gunnerySkill()).toBe(2);
        expect(forceUnit.pilotingSkill()).toBe(3);
    });

    it('filters available movement modes through unit rules', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);

        expect(forceUnit.getAvailableMotiveModes(forceUnit.turnState().airborne() ?? false).some(option => option.mode === 'run')).toBeTrue();

        forceUnit.writeCrits([{ id: 'flight_stabilizer_hit', destroyed: 1 } as CriticalSlot]);

        expect(forceUnit.getAvailableMotiveModes(forceUnit.turnState().airborne() ?? false).some(option => option.mode === 'run')).toBeFalse();
    });

    it('serializes and restores manual unit conditions', () => {
        const forceUnit = createForceUnit();

        forceUnit.setCondition('shutdown', true);
        forceUnit.setCondition('prone', true);
        forceUnit.setCondition('swarmed', true);
        forceUnit.setCondition('tagged', true);
        forceUnit.setCondition('skidding', true);

        const serialized = forceUnit.serialize();
        const serializedConditions = serialized.state as unknown as Record<string, unknown>;

        expect(serializedConditions['shutdown']).toBeUndefined();
        expect(serializedConditions['prone']).toBeUndefined();
        expect(serializedConditions['swarmed']).toBeUndefined();
        expect(serializedConditions['tagged']).toBeUndefined();
        expect(serializedConditions['skidding']).toBeUndefined();
        expect(serialized.state.conditions).toEqual(['prone', 'shutdown', 'skidding', 'swarmed', 'tagged']);

        const restored = CBTForceUnit.deserialize(
            serialized,
            new TestCBTForce('Restored Conditions Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector
        );

        expect(restored.getCondition('shutdown')).toBeTrue();
        expect(restored.getCondition('prone')).toBeTrue();
        expect(restored.getCondition('swarmed')).toBeTrue();
        expect(restored.getCondition('tagged')).toBeTrue();
        expect(restored.getCondition('skidding')).toBeTrue();

        restored.endTurn();

        expect(restored.getCondition('tagged')).toBeFalse();
        expect(restored.getCondition('skidding')).toBeFalse();
    });

    it('waits for the last dirty unit before clearing TAGGED from force-shared manual targets', () => {
        const forceUnit = createForceUnit();
        const force = forceUnit.force as TestCBTForce;
        const otherUnit = new CBTForceUnit(
            createMekUnit(), force, dataService, unitInitializer, injector,
        );
        force.setUnits([forceUnit, otherUnit]);
        forceUnit.turnState().moveMode.set('walk');
        otherUnit.turnState().moveMode.set('walk');
        force.inventoryControlTargets.replaceTargets([
            {
                id: 'A', letter: 'A', name: 'Manual target', color: '#000', source: 'manual',
                unitType: 'mek-biped', distance: 1, tnModifier: 0, tnCalculator: { tagged: true },
            },
            {
                id: 'opfor:enemy', letter: 'B', name: 'OPFOR target', color: '#f00', source: 'opfor',
                unitType: 'mek-biped', distance: 1, tnModifier: 0, tnCalculator: { tagged: true },
            },
        ]);

        forceUnit.endTurn();

        expect(force.getInventoryControlTarget('A')?.tnCalculator?.tagged).toBeTrue();

        otherUnit.endTurn();

        expect(force.getInventoryControlTarget('A')?.tnCalculator?.tagged).toBeFalse();
        expect(force.getInventoryControlTarget('opfor:enemy')?.tnCalculator?.tagged).toBeTrue();
    });

    it('serializes and restores turn state data', () => {
        const forceUnit = createForceUnit();
        forceUnit.turnState().airborne.set(true);
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().moveDistance.set(7);
        forceUnit.turnState().addDmgReceived(20);
        forceUnit.turnState().addFiredHeat(8);
        forceUnit.turnState().spotting.set(true);
        forceUnit.turnState().setPSRCheckState({
            legActuators: new Map([['LL', 1]]),
            hipsHit: new Set(['RL']),
        });

        const serialized = forceUnit.serialize();

        expect(serialized.state.turnState).toEqual({
            airborne: true,
            moveMode: 'run',
            moveDistance: 7,
            dmgReceived: 20,
            weaponsHeat: 8,
            psrChecks: {
                legActuators: { LL: 1 },
                hipsHit: ['RL'],
            },
            spotting: true,
        });

        const restored = CBTForceUnit.deserialize(
            serialized,
            new TestCBTForce('Restored Turn Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector
        );

        expect(restored.turnState().airborne()).toBeTrue();
        expect(restored.turnState().moveMode()).toBe('run');
        expect(restored.turnState().moveDistance()).toBe(7);
        expect(restored.turnState().dmgReceived()).toBe(20);
        expect(restored.turnState().weaponsHeat()).toBe(8);
        expect(restored.turnState().spotting()).toBeTrue();
        expect(restored.turnState().getTurnCounter()).toBe(forceUnit.turnState().getTurnCounter());
        expect(restored.turnState().getPSRCheckState().legActuators?.get('LL')).toBe(1);
        expect(restored.turnState().getPSRCheckState().hipsHit?.has('RL')).toBeTrue();
    });

    it('increments and persists the per-unit turn counter on endTurn', () => {
        const forceUnit = createForceUnit();

        expect(forceUnit.turnState().getTurnCounter()).toBe(0);

        forceUnit.endTurn();
        forceUnit.endTurn();

        expect(forceUnit.turnState().getTurnCounter()).toBe(2);

        const restored = CBTForceUnit.deserialize(
            forceUnit.serialize(),
            new TestCBTForce('Restored Turn Counter Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector,
        );

        expect(restored.turnState().getTurnCounter()).toBe(2);

        restored.endTurn();

        expect(restored.turnState().getTurnCounter()).toBe(3);
    });

    it('clears the resumable end-turn checkpoint only when the turn resets', () => {
        const forceUnit = createForceUnit();
        forceUnit.turnState().markEndTurnHeatStaged();

        expect(forceUnit.turnState().getEndTurnCheckpoint()).toBe('heat-staged');

        forceUnit.endTurn({ heatAndDissipationResolution: false, phaseAlreadyEnded: true });

        expect(forceUnit.turnState().getTurnCounter()).toBe(1);
        expect(forceUnit.turnState().getEndTurnCheckpoint()).toBeUndefined();
    });

    it('exposes spotting as a transient condition and clears it at end of turn', () => {
        const forceUnit = createForceUnit();

        forceUnit.turnState().spotting.set(true);

        expect(forceUnit.getCondition('spotting')).toBeTrue();
        expect(forceUnit.getConditions().has('spotting')).toBeTrue();

        forceUnit.endTurn();

        expect(forceUnit.getCondition('spotting')).toBeFalse();
        expect(forceUnit.getConditions().has('spotting')).toBeFalse();
    });

    it('marks the unit modified when turn state changes', () => {
        const forceUnit = createForceUnit();
        const force = forceUnit.force as TestCBTForce;
        force.emitCount = 0;

        forceUnit.turnState().moveMode.set('run');

        expect(forceUnit.modified).toBeTrue();
        expect(force.emitCount).toBe(1);

        forceUnit.turnState().moveMode.set('run');

        expect(force.emitCount).toBe(1);
    });

    it('does not mark the unit modified when hydrating turn state data', () => {
        const forceUnit = createForceUnit();
        const force = forceUnit.force as TestCBTForce;
        force.emitCount = 0;

        forceUnit.turnState().update({ moveMode: 'run', moveDistance: 4 });

        expect(forceUnit.modified).toBeFalse();
        expect(force.emitCount).toBe(0);
    });

    it('exposes computed conditions through getCondition without serializing them', () => {
        const forceUnit = createForceUnit();

        forceUnit.getCrewMember(0).setHits(DEAD_CREW_HIT_THRESHOLD);

        expect(forceUnit.getCondition('abandoned')).toBeFalse();

        forceUnit.endPhase();

        expect(forceUnit.getCondition('abandoned')).toBeTrue();
        expect(forceUnit.getConditions().has('abandoned')).toBeTrue();
        expect(forceUnit.conditions.has('abandoned')).toBeFalse();
        expect(forceUnit.serialize().state.conditions).toBeUndefined();
    });

    it('stores crew death at phase end and only clears it when hits are reduced', () => {
        const forceUnit = createForceUnit();
        const crewMember = forceUnit.getCrewMember(0);

        crewMember.setState('unconscious');
        crewMember.setHits(DEAD_CREW_HIT_THRESHOLD);

        expect(crewMember.getState()).toBe('unconscious');
        expect(crewMember.serialize().state).toBe(1);

        forceUnit.endPhase();

        expect(crewMember.getState()).toBe('dead');
        expect(crewMember.serialize().state).toBe(2);

        crewMember.setState('unconscious');
        crewMember.setState('ejected');

        expect(crewMember.getState()).toBe('dead');

        crewMember.setHits(DEAD_CREW_HIT_THRESHOLD - 1);

        expect(crewMember.getState()).toBe('healthy');
        expect(crewMember.serialize().state).toBe(0);
    });

    it('derives crew death from destroyed cockpit', () => {
        const forceUnit = createForceUnit();
        const crewMember = forceUnit.getCrewMember(0);

        forceUnit.writeCrits([{ id: 'cockpit', name: 'Cockpit', loc: 'HD', slot: 0, destroyed: 1 } as CriticalSlot]);

        expect(crewMember.getState()).toBe('dead');
    });

    it('derives ProtoMek crew death from hits', () => {
        const forceUnit = createForceUnit(createProtoMekUnit());
        const crewMember = forceUnit.getCrewMember(0);

        crewMember.setHits(DEAD_CREW_HIT_THRESHOLD);

        expect(crewMember.getState()).toBe('healthy');

        forceUnit.endPhase();

        expect(crewMember.getState()).toBe('dead');
    });

    it('serializes and updates direct inventory ammo custom type, count, and total per bin', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);

        const ammoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        ammoEntries[0].ammo = 'Clan Ultra AC/20 Precision Ammo';
        ammoEntries[0].totalAmmo = 4;
        ammoEntries[0].consumed = 2;
        forceUnit.setInventoryEntry(ammoEntries[0]);
        ammoEntries[5].consumed = 5;
        forceUnit.setInventoryEntry(ammoEntries[5]);

        const serializedInventory = forceUnit.serialize().state.inventory;

        expect(serializedInventory).toEqual([
            {
                id: 'Clan Ultra AC/20 Ammo@BD#1.0',
                consumed: 2,
                ammo: 'Clan Ultra AC/20 Precision Ammo',
                totalAmmo: 4,
            },
            {
                id: 'Clan Ultra AC/20 Ammo@BD#1.5',
                consumed: 5,
                totalAmmo: 5,
            },
        ]);

        const serializedUnit = {
            id: 'reloaded-unit',
            unit: forceUnit.getUnit().name,
            state: {
                crew: [],
                crits: [],
                heat: { current: 0, previous: 0 },
                locations: {},
                modified: false,
                destroyed: false,
                shutdown: false,
                inventory: serializedInventory,
            },
        } as CBTSerializedUnit;
        const reloadForce = new TestCBTForce('Reload Force', dataService, unitInitializer, injector);
        const reloadedUnit = CBTForceUnit.deserialize(serializedUnit, reloadForce, dataService, unitInitializer, injector);
        initialize(reloadedUnit);

        const reloadedAmmoEntries = reloadedUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        expect(reloadedAmmoEntries[0].ammo).toBe('Clan Ultra AC/20 Precision Ammo');
        expect(reloadedAmmoEntries[0].totalAmmo).toBe(4);
        expect(reloadedAmmoEntries[0].consumed).toBe(2);
        expect(reloadedAmmoEntries[5].ammo).toBeUndefined();
        expect(reloadedAmmoEntries[5].totalAmmo).toBe(5);
        expect(reloadedAmmoEntries[5].consumed).toBe(5);
        expect(reloadedAmmoEntries.every(entry => entry.pendingDestroyed() === undefined)).toBeTrue();
        expect(reloadedUnit.turnState().dirty()).toBeFalse();
        expect(reloadedUnit.turnState().dirtyPhase()).toBeFalse();
    });

    it('repairAll restores direct inventory ammo bins to original ammo and split quantities', () => {
        const vehicle = createVehicleUnit(equipment);
        vehicle.comp[1].q = 2;
        vehicle.comp[1].q2 = 25;
        const forceUnit = createForceUnit(vehicle);
        initialize(forceUnit);
        const ammoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        ammoEntries[0].ammo = 'Clan Ultra AC/20 Precision Ammo';
        ammoEntries[0].totalAmmo = 4;
        ammoEntries[0].consumed = 4;
        forceUnit.setInventoryEntry(ammoEntries[0]);
        ammoEntries[1].consumed = 5;
        forceUnit.setInventoryEntry(ammoEntries[1]);
        const weaponEntry = forceUnit.getInventory()
            .find(entry => entry.equipment instanceof WeaponEquipment)!;
        const precisionAmmo = equipment['Clan Ultra AC/20 Precision Ammo'] as AmmoEquipment;
        const precisionProfileId = getInventoryControlAmmoProfileId(precisionAmmo);
        const precisionOption = getInventoryControlAmmoSelectionOptions(
            weaponEntry,
            forceUnit.getEquipmentRegistry(),
            (weapon, ammo, mode) => forceUnit.matchesInventoryControlAmmo(weapon, ammo, mode),
        ).find(option => option.profileId === precisionProfileId);
        expect(precisionOption).toBeDefined();
        forceUnit.setInventoryControlEntryAmmoSelection(weaponEntry.id, {
            selectedProfileId: precisionProfileId,
            preferredSourceOptionId: precisionOption!.id,
        });

        expect(ammoEntries.map(entry => entry.originalTotalAmmo)).toEqual([13, 12]);
        forceUnit.getUnit().comp = [];

        forceUnit.repairAll();

        const repairedAmmoEntries = forceUnit.getInventory().filter(entry => entry.equipment instanceof AmmoEquipment);
        expect(repairedAmmoEntries.length).toBe(2);
        expect(repairedAmmoEntries.map(entry => entry.ammo)).toEqual([undefined, undefined]);
        expect(repairedAmmoEntries.map(entry => entry.totalAmmo)).toEqual([13, 12]);
        expect(repairedAmmoEntries.map(entry => entry.consumed)).toEqual([0, 0]);
        expect(forceUnit.getInventoryControlEntryAmmoSelection(weaponEntry.id)).toEqual({
            selectedProfileId: precisionProfileId,
            preferredSourceOptionId: null,
        });
        expect(forceUnit.getInventoryControlSelectedAmmo(weaponEntry)).toBe(precisionAmmo);
    });

    it('clears a preferred ammo source when pending destruction commits and does not restore it after repair', () => {
        const vehicle = createVehicleUnit(equipment);
        vehicle.comp[1].q = 1;
        vehicle.comp[1].q2 = 5;
        const forceUnit = createForceUnit(vehicle);
        initialize(forceUnit);
        const weapon = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const ammo = forceUnit.getInventory().find(entry => entry.equipment instanceof AmmoEquipment)!;
        const [source] = getInventoryControlAmmoSelectionOptions(
            weapon,
            forceUnit.getEquipmentRegistry(),
            (mountedWeapon, candidate, mode) => forceUnit.matchesInventoryControlAmmo(mountedWeapon, candidate, mode),
        );
        forceUnit.setInventoryControlEntryAmmoSelection(weapon.id, {
            selectedProfileId: source.profileId,
            preferredSourceOptionId: source.id,
        });

        expect(forceUnit.applyEquipmentDamage(ammo)).toBeTrue();
        expect(forceUnit.getInventoryControlEntryAmmoSelection(weapon.id)?.preferredSourceOptionId).toBe(source.id);

        forceUnit.endPhase();

        expect(ammo.committedDestroyed()).toBeTrue();
        expect(forceUnit.getInventoryControlEntryAmmoSelection(weapon.id)).toEqual({
            selectedProfileId: source.profileId,
            preferredSourceOptionId: null,
        });
        expect(getInventoryControlAmmoSelectionOptions(
            weapon,
            forceUnit.getEquipmentRegistry(),
        )[0].usable).toBeFalse();

        expect(forceUnit.repairEquipment(ammo)).toBeTrue();
        forceUnit.endPhase();

        expect(ammo.committedDestroyed()).toBeFalse();
        expect(forceUnit.getInventoryControlEntryAmmoSelection(weapon.id)).toEqual({
            selectedProfileId: source.profileId,
            preferredSourceOptionId: null,
        });
        expect(getInventoryControlAmmoSelectionOptions(
            weapon,
            forceUnit.getEquipmentRegistry(),
        )[0].usable).toBeTrue();
    });

    it('represents ammo in a flooded Mek location as disabled rather than destroyed', () => {
        const forceUnit = createForceUnit(createMekUnit());
        initialize(forceUnit, createMekDamageSvg());
        const weaponType = equipment['CLUltraAC20'] as WeaponEquipment;
        const ammoType = equipment['Clan Ultra AC/20 Ammo'] as AmmoEquipment;
        const ammoSlot: CriticalSlot = {
            id: `${ammoType.internalName}@LT#0`,
            name: ammoType.internalName,
            originalName: ammoType.internalName,
            loc: 'LT',
            slot: 0,
            eq: ammoType,
            totalAmmo: 5,
        };
        const weapon = new MountedWeapon({
            owner: forceUnit,
            id: `${weaponType.internalName}@LA#0`,
            name: weaponType.internalName,
            equipment: weaponType,
            locations: new Set(['LA']),
        });
        forceUnit.setCritSlots([ammoSlot], true);
        forceUnit.setInventory([weapon], true);

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.endPhase();

        const [option] = getInventoryControlModeAmmoSummary(
            weapon,
            forceUnit.getEquipmentRegistry(),
        ).options;
        expect(forceUnit.getEquipmentStatus(forceUnit.getCritSlot('LT', 0)!)).toBe('disabled');
        expect(option).toEqual(jasmine.objectContaining({
            remaining: 0,
            destroyed: false,
            disabled: true,
        }));
    });

    it('clears a preferred ammo source immediately when its Mek installation location is committed destroyed', () => {
        const forceUnit = createForceUnit(createMekUnit());
        initialize(forceUnit, createMekDamageSvg());
        const weaponType = equipment['CLUltraAC20'] as WeaponEquipment;
        const ammoType = equipment['Clan Ultra AC/20 Ammo'] as AmmoEquipment;
        const ammoSlot: CriticalSlot = {
            id: `${ammoType.internalName}@LT#0`,
            name: ammoType.internalName,
            originalName: ammoType.internalName,
            loc: 'LT',
            slot: 0,
            eq: ammoType,
            totalAmmo: 5,
        };
        const weapon = new MountedWeapon({
            owner: forceUnit,
            id: `${weaponType.internalName}@LA#0`,
            name: weaponType.internalName,
            equipment: weaponType,
            locations: new Set(['LA']),
        });
        forceUnit.setCritSlots([ammoSlot], true);
        forceUnit.setInventory([weapon], true);
        const [source] = getInventoryControlAmmoSelectionOptions(
            weapon,
            forceUnit.getEquipmentRegistry(),
        );
        forceUnit.setInventoryControlEntryAmmoSelection(weapon.id, {
            selectedProfileId: source.profileId,
            preferredSourceOptionId: source.id,
        });

        forceUnit.setInternalHits('LT', forceUnit.getInternalPoints('LT'));

        expect(forceUnit.getEquipmentStatus(forceUnit.getCritSlot('LT', 0)!)).toBe('destroyed');
        expect(forceUnit.getInventoryControlEntryAmmoSelection(weapon.id)).toEqual({
            selectedProfileId: source.profileId,
            preferredSourceOptionId: null,
        });
    });

    it('repairAll restores intrinsic ammo from its runtime mount baseline', () => {
        const forceUnit = createForceUnit();
        const weapon = new WeaponEquipment({
            id: 'RuntimeOneShot', name: 'Runtime One-Shot', type: 'weapon', flags: ['F_ONE_SHOT'],
            weapon: { ammoType: 'AC', rackSize: 2, damage: 2 },
        });
        const ammo = new AmmoEquipment({
            id: 'RuntimeOneShotAmmo', name: 'Runtime One-Shot Ammo', type: 'ammo',
            ammo: { type: 'AC', rackSize: 2, munitionType: ['M_STANDARD'] },
        });
        const weaponEntry = new MountedWeapon({
            owner: forceUnit, id: 'RuntimeOneShot@RA#0', name: weapon.internalName, equipment: weapon,
        });
        const ammoEntry = new MountedAmmo({
            owner: forceUnit,
            id: 'RuntimeOneShot@RA#0:intrinsic-one-shot-ammo',
            name: ammo.internalName,
            equipment: ammo,
            parent: weaponEntry,
            ammo: 'Alternate Runtime Ammo',
            originalTotalAmmo: 2,
            totalAmmo: 1,
            consumed: 1,
            intrinsicOneShotAmmo: true,
        });
        weaponEntry.setLinkedEquipment([ammoEntry]);
        forceUnit.setInventory([weaponEntry, ammoEntry], true);

        forceUnit.repairAll();

        expect(ammoEntry.ammo).toBeUndefined();
        expect(ammoEntry.totalAmmo).toBe(2);
        expect(ammoEntry.consumed).toBe(0);
        expect(ammoEntry.parent).toBe(weaponEntry);
        expect(weaponEntry.linkedWith).toContain(ammoEntry);
    });

    it('keeps inventory control targets transient and upgrades existing selections to the first target', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'medium');
        const target = forceUnit.createInventoryControlTarget();

        expect(target?.id).toBe('A');
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeTrue();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('A');
        expect(forceUnit.getInventoryControlEntryRange(weaponEntry.id)).toBeUndefined();

        const serialized = forceUnit.serialize();
        expect(JSON.stringify(serialized)).not.toContain('Target A');
        expect(serialized.state.inventory).toBeUndefined();
    });

    it('reuses deleted target letters and caps targets', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);

        expect(forceUnit.createInventoryControlTarget()?.id).toBe('A');
        expect(forceUnit.createInventoryControlTarget()?.id).toBe('B');
        expect(forceUnit.createInventoryControlTarget()?.id).toBe('C');

        forceUnit.deleteInventoryControlTarget('B');
        expect(forceUnit.createInventoryControlTarget()?.id).toBe('B');
        expect(forceUnit.getInventoryControlTargets().map(target => target.id)).toEqual(['A', 'B', 'C']);

        while (forceUnit.getInventoryControlTargets().length < INVENTORY_CONTROL_TARGET_MAX_COUNT) {
            expect(forceUnit.createInventoryControlTarget()).not.toBeNull();
        }
        expect(forceUnit.createInventoryControlTarget()).toBeNull();
        expect(forceUnit.getInventoryControlTargets().length).toBe(INVENTORY_CONTROL_TARGET_MAX_COUNT);
    });

    it('allocates manual targets without shifting existing linked target letters', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const force = forceUnit.force as CBTForce;
        force.replaceInventoryControlTargets([{
            id: 'opfor:enemy-1',
            letter: 'A',
            name: 'Enemy',
            color: '#fff',
            source: 'opfor',
            readOnly: true,
            distance: 1,
            tnModifier: 0
        }]);

        const manualTarget = forceUnit.createInventoryControlTarget();

        expect(manualTarget?.letter).toBe('B');
        expect(forceUnit.getInventoryControlTargets().map(target => [target.id, target.letter])).toEqual([
            ['opfor:enemy-1', 'A'],
            ['B', 'B']
        ]);
    });

    it('shares target identity and intrinsic state while isolating attacker-relative state', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const secondUnit = force.addUnit(createVehicleUnit(equipment));

        const target = firstUnit.createInventoryControlTarget()!;
        firstUnit.updateInventoryControlTarget(target!.id, {
            name: 'Locust',
            unitType: 'mek-biped',
            distance: 3,
            c3Distance: 2,
            useC3: true,
            tnModifier: 8,
            tnCalculator: {
                targetMovementBracket: '7-9',
                isAirborne: true,
                targetHexCover: 'light',
                partialCover: true,
                interveningWoods: 'light2',
                indirectFire: true,
                secondaryTarget: true,
                spotterMoveMode: 'jump',
                spotterDeclaredAttacks: true,
                customModifier: 2,
            }
        });

        const firstTarget = firstUnit.getInventoryControlTarget(target!.id)!;
        const secondTarget = secondUnit.getInventoryControlTarget(target!.id)!;
        expect(secondTarget.name).toBe('Locust');
        expect(secondTarget.unitType).toBe('mek-biped');
        expect(secondTarget.tnCalculator).toEqual(jasmine.objectContaining({
            targetMovementBracket: '7-9',
            isAirborne: true,
            targetHexCover: 'light'
        }));
        expect(secondTarget.distance).toBe(1);
        expect(secondTarget.c3Distance).toBeUndefined();
        expect(secondTarget.useC3).toBeUndefined();
        expect(secondTarget.tnCalculator?.partialCover).toBeUndefined();
        expect(secondTarget.tnCalculator?.interveningWoods).toBeUndefined();
        expect(secondTarget.tnCalculator?.indirectFire).toBeUndefined();
        expect(secondTarget.tnCalculator?.secondaryTarget).toBeUndefined();
        expect(secondTarget.tnCalculator?.spotterMoveMode).toBeUndefined();
        expect(secondTarget.tnCalculator?.spotterDeclaredAttacks).toBeUndefined();
        expect(secondTarget.tnCalculator?.customModifier).toBeUndefined();

        expect(firstTarget.distance).toBe(3);
        expect(firstTarget.c3Distance).toBe(2);
        expect(firstTarget.useC3).toBeTrue();
        expect(firstTarget.tnModifier).toBe(8);
        expect(firstTarget.tnCalculator).toEqual(jasmine.objectContaining({
            partialCover: true,
            interveningWoods: 'light2',
            indirectFire: true,
            secondaryTarget: true,
            spotterMoveMode: 'jump',
            spotterDeclaredAttacks: true,
            customModifier: 2,
        }));

        secondUnit.updateInventoryControlTarget(target!.id, {
            distance: 12,
            tnModifier: 2
        });

        expect(firstUnit.getInventoryControlTarget(target!.id)?.distance).toBe(3);
        expect(firstUnit.getInventoryControlTarget(target!.id)?.tnModifier).toBe(8);
        expect(secondUnit.getInventoryControlTarget(target!.id)?.distance).toBe(12);
        expect(secondUnit.getInventoryControlTarget(target!.id)?.tnModifier).toBe(2);
    });

    it('keeps custom target modifiers per attacking unit and clears them independently', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const secondUnit = force.addUnit(createVehicleUnit(equipment));
        const target = firstUnit.createInventoryControlTarget()!;

        firstUnit.updateInventoryControlTarget(target.id, { tnCalculator: { customModifier: 2 } });

        expect(firstUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(2);
        expect(firstUnit.getInventoryControlTarget(target.id)?.tnCalculator?.customModifier).toBe(2);
        expect(secondUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(0);
        expect(secondUnit.getInventoryControlTarget(target.id)?.tnCalculator?.customModifier).toBeUndefined();
        expect(force.getInventoryControlTarget(target.id)?.tnCalculator?.customModifier).toBeUndefined();

        firstUnit.updateInventoryControlTarget(target.id, { tnCalculator: { customModifier: undefined } });

        expect(firstUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(0);
        expect(firstUnit.getInventoryControlTarget(target.id)?.tnCalculator?.customModifier).toBeUndefined();
    });

    it('allocates target letters once for the entire force', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const secondUnit = force.addUnit(createVehicleUnit(equipment));

        expect(firstUnit.createInventoryControlTarget()?.letter).toBe('A');
        expect(secondUnit.createInventoryControlTarget()?.letter).toBe('B');
        expect(firstUnit.createInventoryControlTarget()?.letter).toBe('C');
        expect(secondUnit.getInventoryControlTargets().map(target => target.letter)).toEqual(['A', 'B', 'C']);
    });

    it('returns calculator state copies that cannot mutate runtime targets', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const target = forceUnit.createInventoryControlTarget()!;
        forceUnit.updateInventoryControlTarget(target.id, { tnCalculator: { prone: true, immobile: false } });

        const readTarget = forceUnit.getInventoryControlTarget(target.id)!;
        readTarget.tnCalculator!.immobile = true;

        expect(forceUnit.getInventoryControlTarget(target.id)?.tnCalculator?.immobile).toBeFalse();
    });

    it('merges partial shared calculator patches without deleting other shared fields', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const target = forceUnit.createInventoryControlTarget()!;
        forceUnit.updateInventoryControlTarget(target.id, {
            tnCalculator: {
                targetMovementBracket: '7-9',
                targetHexCover: 'heavy'
            }
        });

        forceUnit.updateInventoryControlTarget(target.id, { tnCalculator: { prone: true } });

        expect(forceUnit.getInventoryControlTarget(target.id)?.tnCalculator).toEqual(jasmine.objectContaining({
            targetMovementBracket: '7-9',
            targetHexCover: 'heavy',
            prone: true
        }));
    });

    it('clears explicitly undefined shared calculator fields', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const target = forceUnit.createInventoryControlTarget()!;
        forceUnit.updateInventoryControlTarget(target.id, {
            tnCalculator: {
                targetMovementBracket: '7-9',
                targetHexCover: 'none',
                buildingCover: 'building-2',
            },
        });

        forceUnit.updateInventoryControlTarget(target.id, {
            tnCalculator: {
                targetHexCover: 'heavy',
                waterDepth: undefined,
                buildingCover: undefined,
            },
        });

        expect(forceUnit.getInventoryControlTarget(target.id)?.tnCalculator).toEqual(jasmine.objectContaining({
            targetMovementBracket: '7-9',
            targetHexCover: 'heavy',
            waterDepth: undefined,
            buildingCover: undefined,
        }));
    });

    it('recalculates local TN when local calculator state changes without an explicit total', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const target = forceUnit.createInventoryControlTarget()!;
        forceUnit.updateInventoryControlTarget(target.id, { distance: 4 });

        forceUnit.updateInventoryControlTarget(target.id, { tnCalculator: { partialCover: true } });

        expect(forceUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(1);
    });

    it('recalculates range-sensitive local TN when distance changes', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const target = forceUnit.createInventoryControlTarget()!;
        forceUnit.updateInventoryControlTarget(target.id, { tnCalculator: { prone: true } });

        expect(forceUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(-2);

        forceUnit.updateInventoryControlTarget(target.id, { distance: 2 });

        expect(forceUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(1);
    });

    it('preserves a manual TN override when shared target state changes', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const secondUnit = force.addUnit(createVehicleUnit(equipment));
        const target = firstUnit.createInventoryControlTarget()!;
        firstUnit.overrideInventoryControlTargetModifier(target.id, 9);

        secondUnit.updateInventoryControlTarget(target.id, {
            unitType: 'battle-armor',
            tnCalculator: { targetMovementBracket: '7-9' }
        });

        expect(firstUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(9);
        expect(firstUnit.getInventoryControlTarget(target.id)?.manualTnModifier).toBe(9);
        expect(secondUnit.getInventoryControlTarget(target.id)?.tnModifier).toBe(4);
        expect(secondUnit.getInventoryControlTarget(target.id)?.manualTnModifier).toBeUndefined();
    });

    it('deletes a force target and its weapon assignments from every unit', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const secondUnit = force.addUnit(createVehicleUnit(equipment));
        initialize(firstUnit);
        initialize(secondUnit);
        const firstWeapon = firstUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const secondWeapon = secondUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const target = firstUnit.createInventoryControlTarget()!;
        firstUnit.setInventoryControlEntryTarget(firstWeapon, target.id);
        secondUnit.setInventoryControlEntryTarget(secondWeapon, target.id);

        secondUnit.deleteInventoryControlTarget(target.id);

        expect(firstUnit.getInventoryControlTarget(target.id)).toBeUndefined();
        expect(secondUnit.getInventoryControlTarget(target.id)).toBeUndefined();
        expect(firstUnit.isInventoryControlEntrySelected(firstWeapon.id)).toBeFalse();
        expect(secondUnit.isInventoryControlEntrySelected(secondWeapon.id)).toBeFalse();
    });

    it('exposes existing force targets to units created later', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const target = firstUnit.createInventoryControlTarget()!;
        firstUnit.updateInventoryControlTarget(target.id, { name: 'Atlas', distance: 18, tnModifier: 4 });

        const laterUnit = force.addUnit(createVehicleUnit(equipment));
        const laterTarget = laterUnit.getInventoryControlTarget(target.id);

        expect(laterTarget).toEqual(jasmine.objectContaining({
            id: target.id,
            name: 'Atlas',
            distance: 1
        }));
        expect(laterTarget?.tnModifier).not.toBe(4);
    });

    it('clears all force targets from every unit', () => {
        const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
        const firstUnit = force.addUnit(createVehicleUnit(equipment));
        const secondUnit = force.addUnit(createVehicleUnit(equipment));
        firstUnit.createInventoryControlTarget();
        secondUnit.createInventoryControlTarget();

        firstUnit.resetInventoryControlTargets();

        expect(firstUnit.getInventoryControlTargets()).toEqual([]);
        expect(secondUnit.getInventoryControlTargets()).toEqual([]);
    });

    it('deselects entries assigned to deleted targets and clears all target selections on reset', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;

        forceUnit.createInventoryControlTarget();
        forceUnit.createInventoryControlTarget();
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'B');
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeTrue();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('B');

        forceUnit.deleteInventoryControlTarget('B');
        expect(forceUnit.getInventoryControlTargets().map(target => target.id)).toEqual(['A']);
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();

        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        forceUnit.resetInventoryControlTargets();
        expect(forceUnit.getInventoryControlTargets()).toEqual([]);
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();
    });

    it('does not mutate hit modifier or render target TN text during runtime target selection sync', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const targetTnRect = weaponEntry.el!.querySelector(':scope > .targetTn-rect') as SVGRectElement;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 8, tnModifier: 1 });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');

        expect(hitModText.textContent).toBe('+0');
        expect(targetTnRect.getAttribute('display')).toBe('none');
        expect(targetTnText.getAttribute('display')).toBe('none');
        expect(targetTnText.textContent).toBe('');

        forceUnit.setInventoryControlEntryTarget(weaponEntry, null);

        expect(hitModText.textContent).toBe('+0');
        expect(targetTnRect.getAttribute('display')).toBe('none');
        expect(targetTnText.getAttribute('display')).toBe('none');
        expect(targetTnText.textContent).toBe('');
    });

    it('renders selected range damage on the SVG inventory entry', () => {
        const forceUnit = createForceUnit(createVariableDamageUnit(equipment));
        initialize(forceUnit, createVariableDamageSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const damageText = weaponEntry.el!.querySelector(':scope > .damage > text') as SVGTextElement;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'short');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('9 [V]');
        expect(hitModText.textContent).toBe('-4');

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'medium');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('7 [V]');
        expect(hitModText.textContent).toBe('-4');

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'long');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('5 [V]');
        expect(hitModText.textContent).toBe('-4');

        spyOn(forceUnit, 'hasLinkedC3Network').and.returnValue(true);
        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 8, c3Distance: 1, useC3: true });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('5 [V]');
        expect(hitModText.textContent).toBe('-4');

        forceUnit.setInventoryControlEntryRange(weaponEntry, null);
        svgService.refreshInventory();
        expect(damageText.textContent).toBe('9/7/5 [V]');
        expect(hitModText.textContent).toBe('-4');
    });

    it('calculates rear-mounted inventory names before appending the selected UAC firing mode', () => {
        const rotary = new WeaponEquipment({
            id: 'CLRotaryAC5',
            name: 'Rotary AC/5',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            modes: ['Single', '2-shot', '3-shot'],
            weapon: { ammoType: 'AC_ROTARY', heat: 1, damage: 5, ranges: [4, 8, 12, 16] },
        });
        equipment[rotary.internalName] = rotary;
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            comp: [{
                id: 'CLRotaryAC5',
                q: 1,
                q2: 0,
                n: 'Rotary AC/5',
                t: 'B',
                p: 1,
                l: 'LT',
                rear: true,
                r: '4/8/12',
                m: '0',
                d: '5/Sht',
                md: '30.0',
                c: '1',
                os: 0,
                eq: rotary,
            }],
        }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g class="inventoryEntry" id="CLRotaryAC5@LT#2" hitMod="0" rearMounted="1">
                    <g class="name"><text>Stale SVG Name</text></g>
                    <text class="heat">1</text>
                    <g class="damage"><text>5/Sht</text></g>
                    <text class="range_short">4</text>
                    <text class="range_medium">8</text>
                    <text class="range_long">12</text>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        initialize(forceUnit, svg);
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new UACFiringModeHandler());

        const entry = forceUnit.getInventory()[0];
        entry.setState(INVENTORY_CONTROL_MODE_STATE, '3-shot');
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshInventory();

        expect(entry.el?.querySelector(':scope > .name > text')?.textContent).toBe('Rotary AC/5 (R) (3-shot)');
        expect(entry.el?.querySelector(':scope > .heat')?.textContent).toBe('1/s');
        expect(entry.el?.querySelector(':scope > .damage > text')?.textContent).toBe('5/Sht [DB,R6,S]');

        svgService.refreshInventory();
        expect(entry.el?.querySelector(':scope > .name > text')?.textContent).toBe('Rotary AC/5 (R) (3-shot)');
    });

    it('reactively disables intact SVG equipment while shutdown without marking it damaged', () => {
        const unit = createMekUnit();
        unit.comp = [{
            id: 'VariableDamageLaser', q: 1, q2: 0, n: 'Variable Damage Laser', t: 'E', p: 1,
            l: 'RA', r: '2/5/9', m: '-4', d: '9/7/5', md: '9.0', c: '1', os: 0,
            eq: equipment['VariableDamageLaser']
        }];
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g class="unitLocation armor" loc="RA"></g>
                <g class="unitLocation structure" loc="RA"></g>
                <g class="inventoryEntry selected" id="VariableDamageLaser@RA#0" hitMod="-4">
                    <g class="name"><text>Variable Damage Laser</text></g>
                    <g class="damage"><text>9/7/5 [V]</text></g>
                    <text class="location">RA</text>
                    <text class="range_short">2</text>
                    <text class="range_medium">5</text>
                    <text class="range_long">9</text>
                    <rect class="hitMod-rect" display="block"></rect>
                    <text class="hitMod-text" display="block">-4</text>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        const forceUnit = createForceUnit(unit);
        initialize(forceUnit, svg);
        const entry = forceUnit.getInventory().find(candidate => candidate.id === 'VariableDamageLaser@RA#0')!;
        TestBed.runInInjectionContext(() => new ExposedUnitSvgMekService(forceUnit, unitInitializer));
        TestBed.tick();

        expect(entry.el!.classList.contains('disabledInventory')).toBeFalse();
        expect(entry.el!.classList.contains('damagedInventory')).toBeFalse();

        forceUnit.setCondition('shutdown', true);
        TestBed.tick();

        expect(forceUnit.isEquipmentOperational(entry)).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(entry, 'fire')).toBeFalse();
        expect(entry.el!.classList.contains('disabledInventory')).toBeTrue();
        expect(entry.el!.classList.contains('damagedInventory')).toBeFalse();
        expect(entry.el!.classList.contains('selected')).toBeFalse();

        forceUnit.setCondition('shutdown', false);
        TestBed.tick();

        expect(entry.el!.classList.contains('disabledInventory')).toBeFalse();
        expect(entry.el!.classList.contains('damagedInventory')).toBeFalse();
    });

    it('restricts movement-dependent intrinsic physical attacks by movement mode', () => {
        const forceUnit = createForceUnit();
        const intrinsicAttack = (name: string) => new MountedEquipment({
            owner: forceUnit,
            id: `physical:${name}`,
            name,
            intrinsicPhysicalAttack: true,
        });
        const charge = intrinsicAttack('Charge');
        const airMekRam = intrinsicAttack('AirMek Ram');
        const airMechRam = intrinsicAttack('AirMech Ram');
        const deathFromAbove = intrinsicAttack('Death From Above');
        const talonDfa = intrinsicAttack('DFA [Talons]');

        forceUnit.turnState().moveMode.set(null); // unknown case!
        expect(forceUnit.canPerformEquipmentAction(charge, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(airMekRam, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(airMechRam, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(deathFromAbove, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(talonDfa, 'physical-attack')).toBeTrue();

        forceUnit.turnState().moveMode.set('stationary');
        expect(forceUnit.canPerformEquipmentAction(charge, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(airMekRam, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(airMechRam, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(deathFromAbove, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(talonDfa, 'physical-attack')).toBeFalse();

        forceUnit.turnState().moveMode.set('run');
        expect(forceUnit.canPerformEquipmentAction(charge, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(airMekRam, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(airMechRam, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(deathFromAbove, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(talonDfa, 'physical-attack')).toBeFalse();

        forceUnit.turnState().moveMode.set('jump');
        expect(forceUnit.canPerformEquipmentAction(charge, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(airMekRam, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(airMechRam, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(deathFromAbove, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(talonDfa, 'physical-attack')).toBeTrue();
    });

    it('preserves action-unavailable SVG state when interactions synchronize modes', () => {
        const forceUnit = createForceUnit();
        const el = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g class="inventoryEntry" id="physical:charge"></g>
            </svg>
        `, 'image/svg+xml').documentElement.querySelector<SVGElement>('.inventoryEntry')!;
        const charge = new MountedEquipment({
            owner: forceUnit,
            id: 'physical:charge',
            name: 'Charge',
            intrinsicPhysicalAttack: true,
            el,
        });
        forceUnit.turnState().moveMode.set('stationary');

        syncSvgMode(charge, null);

        expect(forceUnit.isEquipmentOperational(charge)).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(charge, 'physical-attack')).toBeFalse();
        expect(el.classList.contains('disabledInventory')).toBeTrue();

        forceUnit.turnState().moveMode.set(null);
        syncSvgMode(charge, null);

        expect(forceUnit.canPerformEquipmentAction(charge, 'physical-attack')).toBeTrue();
        expect(el.classList.contains('disabledInventory')).toBeFalse();
    });

    it('makes every physical attack action-unavailable while prone without damaging it', () => {
        const forceUnit = createForceUnit();
        const intrinsicPunch = new MountedEquipment({
            owner: forceUnit,
            id: 'physical:punch',
            name: 'Punch',
            intrinsicPhysicalAttack: true,
        });
        const hatchet = new MountedEquipment({
            owner: forceUnit,
            id: 'hatchet@RA#0',
            name: 'Hatchet',
            locations: new Set(['RA']),
            equipment: new Equipment({ id: 'hatchet', name: 'Hatchet', type: 'misc', flags: ['F_CLUB'] }),
        });
        const rangedWeapon = new MountedEquipment({
            owner: forceUnit,
            id: 'VariableDamageLaser@RA#0',
            name: 'Variable Damage Laser',
            locations: new Set(['RA']),
            equipment: equipment['VariableDamageLaser'],
        });
        forceUnit.turnState().moveMode.set('walk');

        forceUnit.setCondition('prone', true);

        expect(intrinsicPunch.isPhysicalWeapon()).toBeTrue();
        expect(hatchet.isPhysicalWeapon()).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(intrinsicPunch, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(hatchet, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'fire')).toBeTrue();
        expect(forceUnit.isEquipmentOperational(intrinsicPunch)).toBeTrue();
        expect(forceUnit.isEquipmentOperational(hatchet)).toBeTrue();

        forceUnit.setCondition('prone', false);

        expect(forceUnit.canPerformEquipmentAction(intrinsicPunch, 'physical-attack')).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(hatchet, 'physical-attack')).toBeTrue();
    });

    it('prevents an unconscious crew from receiving movement or attack selections', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createMekUnit(),
            walk: 5,
            run: 8,
            run2: 8,
        }));
        forceUnit.isLoaded.set(true);
        const rangedWeapon = new MountedEquipment({
            owner: forceUnit,
            id: 'VariableDamageLaser@RA#0',
            name: 'Variable Damage Laser',
            equipment: equipment['VariableDamageLaser'],
        });
        const punch = new MountedEquipment({
            owner: forceUnit,
            id: 'physical:punch',
            name: 'Punch',
            intrinsicPhysicalAttack: true,
        });

        forceUnit.setCrewState(0, 'unconscious');

        expect(forceUnit.canTakeActiveActions()).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'fire')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(punch, 'physical-attack')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'activate')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'change-mode')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'configure-network')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'provide-passive-effect')).toBeTrue();
        expect(forceUnit.getAvailableMotiveModes(false).map(option => option.mode)).toEqual(['stationary']);

        forceUnit.setCrewState(0, 'healthy');

        expect(forceUnit.canTakeActiveActions()).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(rangedWeapon, 'fire')).toBeTrue();
        expect(forceUnit.getAvailableMotiveModes(false).some(option => option.mode !== 'stationary')).toBeTrue();
    });

    it('unions current critical and mount installation locations for whole-mount status', () => {
        const forceUnit = createForceUnit();
        forceUnit.locations = {
            armor: new Map([
                ['RA', { loc: 'RA', rear: false, points: 1 }],
                ['LL', { loc: 'LL', rear: false, points: 1 }],
            ]),
            internal: new Map([
                ['RA', { loc: 'RA', points: 1 }],
                ['LL', { loc: 'LL', points: 1 }],
            ]),
        };
        forceUnit.setLocations({ LL: { internal: 1 } }, true);
        const critical: CriticalSlot = {
            id: 'split-installation',
            name: 'Variable Damage Laser',
            loc: 'RA',
            slot: 0,
            eq: equipment['VariableDamageLaser'],
        };
        forceUnit.writeCrits([critical]);
        const entry = new MountedWeapon({
            owner: forceUnit,
            id: 'split-installation',
            name: 'Variable Damage Laser',
            equipment: equipment['VariableDamageLaser'] as WeaponEquipment,
            critSlots: [critical],
            locations: new Set(['LL']),
        });
        forceUnit.setInventory([entry], true);

        expect(forceUnit.getEquipmentStatusAtLocation(entry, 'RA')).toBe('available');
        expect(forceUnit.getEquipmentStatusAtLocation(entry, 'LL')).toBe('destroyed');
        expect(forceUnit.getEquipmentInstallationLocationStatus(entry)).toBe('destroyed');
        expect(forceUnit.getEquipmentStatus(entry)).toBe('destroyed');

        entry.setCommittedDestroyed(true);
        expect(forceUnit.canEditEquipmentState(entry, 'repair')).toBeFalse();
        expect(forceUnit.repairEquipment(entry)).toBeFalse();

        entry.setPendingDestroyed(false);
        expect(entry.isRepairing()).toBeTrue();
        expect(forceUnit.isEquipmentResolvedDestroyed(entry)).toBeTrue();
        expect(forceUnit.isEquipmentResolvedCommittedDestroyed(entry)).toBeTrue();

        forceUnit.endPhase();
        expect(entry.isRepairing()).toBeFalse();
        expect(entry.committedDestroyed()).toBeTrue();
        expect(entry.pendingDestroyed()).toBeUndefined();
    });

    it('cancels a pending repair when its installation location is destroyed before end-phase commit', () => {
        const forceUnit = createForceUnit();
        forceUnit.locations = {
            armor: new Map([['RA', { loc: 'RA', rear: false, points: 1 }]]),
            internal: new Map([['RA', { loc: 'RA', points: 1 }]]),
        };
        const entry = new MountedWeapon({
            owner: forceUnit,
            id: 'repairing-location-loss',
            name: 'Variable Damage Laser',
            equipment: equipment['VariableDamageLaser'] as WeaponEquipment,
            locations: new Set(['RA']),
            destroyed: true,
        });
        forceUnit.setInventory([entry], true);

        expect(forceUnit.getEquipmentInstallationLocationStatus(entry)).toBe('available');
        expect(forceUnit.repairEquipment(entry)).toBeTrue();
        expect(entry.isRepairing()).toBeTrue();

        forceUnit.addInternalHits('RA', 1);

        expect(forceUnit.getEquipmentInstallationLocationStatus(entry)).toBe('available');
        expect(forceUnit.isInternalLocStructurallyDestroyed('RA')).toBeTrue();

        forceUnit.endPhase();

        expect(forceUnit.getEquipmentInstallationLocationStatus(entry)).toBe('destroyed');
        expect(entry.isRepairing()).toBeFalse();
        expect(entry.committedDestroyed()).toBeTrue();
        expect(entry.pendingDestroyed()).toBeUndefined();
    });

    it('does not offer mount repair for destruction derived only from critical facts', () => {
        const forceUnit = createForceUnit();
        forceUnit.locations = {
            armor: new Map([['RA', { loc: 'RA', rear: false, points: 1 }]]),
            internal: new Map([['RA', { loc: 'RA', points: 1 }]]),
        };
        const critical: CriticalSlot = {
            id: 'critical-only-destruction',
            name: 'Variable Damage Laser',
            loc: 'RA',
            slot: 0,
            destroyed: 1,
            eq: equipment['VariableDamageLaser'],
        };
        forceUnit.writeCrits([critical]);
        const entry = new MountedWeapon({
            owner: forceUnit,
            id: critical.id!,
            name: critical.name!,
            equipment: equipment['VariableDamageLaser'] as WeaponEquipment,
            critSlots: [critical],
            locations: new Set(['RA']),
        });

        expect(forceUnit.getEquipmentStatus(entry)).toBe('destroyed');
        expect(entry.committedDestroyed()).toBeFalse();
        expect(forceUnit.canEditEquipmentState(entry, 'repair')).toBeFalse();
        expect(forceUnit.repairEquipment(entry)).toBeFalse();
        expect(entry.pendingDestroyed()).toBeUndefined();
    });

    it('restores the Kamisori A turret capacitor location from its direct-inventory ID', () => {
        const lightPpc = new WeaponEquipment({
            id: 'Light PPC',
            name: 'Light PPC',
            type: 'weapon',
            weapon: { ammoType: 'NA', damage: 5, ranges: [6, 12, 18, 24] },
        });
        const capacitorEquipment = new MiscEquipment({
            id: 'PPC Capacitor',
            name: 'PPC Capacitor',
            type: 'misc',
        });
        equipment[lightPpc.internalName] = lightPpc;
        equipment[capacitorEquipment.internalName] = capacitorEquipment;
        const unit = createEmptyUnit({
            name: 'CVKamisoriLightTank_A',
            chassis: 'Kamisori Light Tank',
            model: 'A',
            type: 'Tank',
            subtype: 'Combat Vehicle Omni',
            comp: [
                { id: 'Standard', q: 1, q2: 0, n: 'Standard Structure', t: 'S', p: -1, l: '', c: '1', os: 0 },
                { id: 'IS Heavy Ferro-Fibrous', q: 1, q2: 0, n: 'Heavy Ferro-Fibrous Armor', t: 'S', p: -1, l: '', c: '3', os: 0 },
                { id: lightPpc.internalName, q: 1, q2: 0, n: lightPpc.name, t: 'E', p: 5, l: 'TU', c: '1', os: 0, eq: lightPpc },
                { id: capacitorEquipment.internalName, q: 1, q2: 0, n: capacitorEquipment.name, t: 'C', p: 5, l: 'TU', c: '0', os: 0, eq: capacitorEquipment },
                { id: 'ISTargeting Computer', q: 1, q2: 0, n: 'Targeting Computer', t: 'C', p: 0, l: 'BD', c: '1', os: 0 },
            ],
        });
        const original = createForceUnit(unit);
        initialize(original, createKamisoriAInventorySvg());
        const originalCapacitor = original.getInventory().find(entry => entry.id === 'PPC Capacitor@TU#1')!;

        expect(originalCapacitor.parent?.id).toBe('Light PPC@TU#0');
        expect(original.getEquipmentInstallationLocationStatus(originalCapacitor)).toBe('available');
        original.setLocations({ TU: { internal: 1 } }, true);

        const restored = CBTForceUnit.deserialize(
            original.serialize(),
            new TestCBTForce('Restored Kamisori Force', dataService, unitInitializer, injector),
            dataService,
            unitInitializer,
            injector,
        );
        const warning = spyOn(console, 'warn');
        initialize(restored, createKamisoriAInventorySvg());
        TestBed.tick();
        const capacitor = restored.getInventory().find(entry => entry.id === originalCapacitor.id)!;

        expect(capacitor.committedDestroyed()).toBeFalse();
        expect(restored.getEquipmentLocationStatus('TU')).toBe('destroyed');
        expect(restored.getEquipmentInstallationLocationStatus(capacitor)).toBe('destroyed');
        expect(restored.getEquipmentStatus(capacitor)).toBe('destroyed');
        expect(restored.canEditEquipmentState(capacitor, 'repair')).toBeFalse();
        expect(restored.repairEquipment(capacitor)).toBeFalse();
        expect(warning.calls.allArgs().some(args => String(args[0]).includes(capacitor.id))).toBeFalse();
    });

    it('maps a direct-inventory Battle Armor squad-support weapon to T1', () => {
        const supportWeapon = new WeaponEquipment({
            id: 'ISBASquadSupportLaser',
            name: 'BA Squad Support Laser',
            type: 'weapon',
            flags: ['F_BA_WEAPON', 'F_ENERGY'],
            weapon: { ammoType: 'NA', damage: 1 },
        });
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'BA SSW Test',
            type: 'Infantry',
            subtype: 'Battle Armor',
            squadSize: 2,
            comp: [{
                id: supportWeapon.internalName,
                n: supportWeapon.name,
                t: 'E',
                q: 1,
                p: 0,
                l: 'SSW',
                eq: supportWeapon,
            }],
        }));
        forceUnit.locations = {
            armor: new Map([
                ['T1', { loc: 'T1', rear: false, points: 1 }],
                ['T2', { loc: 'T2', rear: false, points: 1 }],
            ]),
            internal: new Map([
                ['T1', { loc: 'T1', points: 1 }],
                ['T2', { loc: 'T2', points: 1 }],
            ]),
        };
        forceUnit.setLocations({ T1: { armor: 1 } }, true);
        const entry = new MountedWeapon({
            owner: forceUnit,
            id: `${supportWeapon.internalName}@SSW#0`,
            name: supportWeapon.name,
            equipment: supportWeapon,
            locations: new Set(),
        });

        expect(forceUnit.getEquipmentLocationStatus('SSW')).toBe('destroyed');
        expect(forceUnit.getEquipmentStatus(entry)).toBe('destroyed');
        expect(forceUnit.canPerformEquipmentAction(entry, 'fire')).toBeFalse();
    });

    it('preserves mount-global status and reports an unresolved direct-inventory installation once', () => {
        const unknownEquipment = new Equipment({ id: 'UnknownInstallation', name: 'Unknown Installation', type: 'misc' });
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'Unknown Installation Test',
            type: 'Tank',
            subtype: 'Combat Vehicle',
            comp: [{ id: unknownEquipment.internalName, n: unknownEquipment.name, t: 'X', q: 1, p: 0, l: '—', eq: unknownEquipment }],
        }));
        const entry = new MountedEquipment({
            owner: forceUnit,
            id: `${unknownEquipment.internalName}@Unknown#0`,
            name: unknownEquipment.name,
            equipment: unknownEquipment,
        });
        const warning = spyOn(console, 'warn');
        initialize(forceUnit);
        forceUnit.setInventory([entry], true);
        TestBed.tick();

        expect(warning).toHaveBeenCalledTimes(1);
        expect(warning).toHaveBeenCalledWith(jasmine.stringContaining(entry.id));
        warning.calls.reset();

        expect(forceUnit.getEquipmentStatus(entry)).toBe('available');
        expect(forceUnit.getEquipmentStatus(entry)).toBe('available');
        expect(warning).not.toHaveBeenCalled();

        entry.setCommittedDestroyed(true);
        expect(forceUnit.getEquipmentStatus(entry)).toBe('destroyed');
    });

    it('reports an unresolved loaded direct-inventory entry with a nonstandard ID once', () => {
        const unknownEquipment = new Equipment({ id: 'MalformedInstallation', name: 'Malformed Installation', type: 'misc' });
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'Malformed Installation Test',
            type: 'Tank',
            subtype: 'Combat Vehicle',
            comp: [{ id: unknownEquipment.internalName, n: unknownEquipment.name, t: 'X', q: 1, p: 0, l: '—', eq: unknownEquipment }],
        }));
        const entry = new MountedEquipment({
            owner: forceUnit,
            id: 'nonstandard-direct-inventory-id',
            name: unknownEquipment.name,
            equipment: unknownEquipment,
        });
        const warning = spyOn(console, 'warn');
        initialize(forceUnit);
        forceUnit.setInventory([entry], true);
        TestBed.tick();

        expect(warning).toHaveBeenCalledTimes(1);
        expect(warning).toHaveBeenCalledWith(jasmine.stringContaining(entry.id));
        expect(warning.calls.mostRecent().args[0]).not.toContain('(component');
        warning.calls.reset();

        expect(forceUnit.getEquipmentStatus(entry)).toBe('available');
        expect(forceUnit.getEquipmentStatus(entry)).toBe('available');
        expect(warning).not.toHaveBeenCalled();
    });

    it('applies damage through canonical resolved state and cancels a pending repair', () => {
        const forceUnit = createForceUnit();
        const entry = new MountedWeapon({
            owner: forceUnit,
            id: 'state-edit-laser',
            name: 'Variable Damage Laser',
            equipment: equipment['VariableDamageLaser'] as WeaponEquipment,
        });
        forceUnit.setInventory([entry], true);

        expect(forceUnit.applyEquipmentDamage(entry)).toBeTrue();
        expect(entry.isDestroying()).toBeTrue();
        expect(forceUnit.applyEquipmentDamage(entry)).toBeFalse();
        expect(forceUnit.repairEquipment(entry)).toBeTrue();
        expect(entry.hasPendingDestroyedChange()).toBeFalse();

        entry.setCommittedDestroyed(true);
        entry.setPendingDestroyed(false);
        expect(entry.isRepairing()).toBeTrue();
        expect(forceUnit.canEditEquipmentState(entry, 'apply-damage')).toBeTrue();

        expect(forceUnit.applyEquipmentDamage(entry)).toBeTrue();
        expect(entry.isRepairing()).toBeFalse();
        expect(entry.committedDestroyed()).toBeTrue();
        expect(entry.hasPendingDestroyedChange()).toBeFalse();
        expect(forceUnit.canEditEquipmentState(entry, 'apply-damage')).toBeFalse();
    });

    it('wraps inventory damage across available SVG rows and clears stale rows', () => {
        const forceUnit = createForceUnit(createVariableDamageUnit(equipment));
        initialize(forceUnit, createMultiRowVariableDamageSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const damageLines = Array.from(weaponEntry.el!.querySelectorAll(':scope > .damage > text')) as SVGTextElement[];
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshInventory();

        expect(damageLines.map(line => line.textContent)).toEqual(['9/7/5', '[V]']);

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'medium');
        svgService.refreshInventory();

        expect(damageLines.map(line => line.textContent)).toEqual(['7 [V]', '']);
    });

    it('keeps comma-separated damage-type tags together when rendering a multi-row SVG entry', () => {
        const forceUnit = createForceUnit(createVariableDamageUnit(equipment));
        initialize(forceUnit, createMultiRowVariableDamageSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const damageLines = Array.from(weaponEntry.el!.querySelectorAll(':scope > .damage > text')) as SVGTextElement[];
        const rangeMin = weaponEntry.el!.querySelector(':scope > .range_min') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));
        rangeMin.setAttribute('x', '142');

        svgService.renderDamage(damageLines[0], '1/Msl [C5,H,M,OS,S]');

        expect(damageLines.map(line => line.textContent)).toEqual(['1/Msl', '[C5,H,M,OS,S]']);

        svgService.renderDamage(damageLines[0], '1/Msl [C5,H,M,OS,S]');
        expect(damageLines.map(line => line.textContent)).toEqual(['1/Msl', '[C5,H,M,OS,S]']);
    });

    it('renders a CORE charge formula with the current spike bonus instead of the SVG default', () => {
        const forceUnit = createForceUnit();
        const entryEl = new DOMParser().parseFromString(`
            <g xmlns="http://www.w3.org/2000/svg" class="inventoryEntry">
                <g class="damage"><text>Wrong SVG value</text></g>
            </g>
        `, 'image/svg+xml').documentElement as unknown as SVGElement;
        const charge = new MountedEquipment({
            owner: forceUnit,
            id: 'Charge',
            name: 'charge',
            intrinsicPhysicalAttack: true,
            el: entryEl,
        });
        const damageText = entryEl.querySelector(':scope > .damage > text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.renderCharge(charge, {
            damage: 12,
            maxDamage: 42,
            bonusDamage: 2,
            maxBonusDamage: 2,
            displayFormula: '10×(TMM+1)+2',
        });

        expect(damageText.textContent).toBe('10×(TMM+1)+2');
        expect(damageText.classList.contains('damaged')).toBeFalse();

        svgService.renderCharge(charge, {
            damage: 10,
            maxDamage: 42,
            bonusDamage: 0,
            maxBonusDamage: 2,
            displayFormula: '10×(TMM+1)',
        });

        expect(damageText.textContent).toBe('10×(TMM+1)');
        expect(damageText.classList.contains('damaged')).toBeTrue();
    });

    it('renders vibroblade OFF and ON damage on the Mek SVG', () => {
        const vibroblade = new MiscEquipment({
            id: 'ISMediumVibroblade',
            name: 'Vibroblade (Medium)',
            type: 'misc',
            flags: ['F_CLUB', 'S_VIBRO_MEDIUM'],
        });
        equipment[vibroblade.internalName] = vibroblade;
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new VibrobladeHandler());
        const unit = createMekUnit();
        unit.tons = 40;
        unit.comp = [{
            id: vibroblade.internalName, q: 1, q2: 0, n: vibroblade.name, t: 'P', p: 1,
            l: 'RA', m: '-2', d: '10', md: '10', c: '2', os: 0, eq: vibroblade,
        }];
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g class="unitLocation armor" loc="RA"></g>
                <g class="unitLocation structure" loc="RA"></g>
                <g class="inventoryEntry" id="ISMediumVibroblade@RA#0" hitMod="-2">
                    <g class="name"><text>Vibroblade (Medium)</text></g>
                    <g class="heat"><text>5</text></g>
                    <g class="damage"><text>10</text></g>
                    <text class="location">RA</text>
                    <rect class="hitMod-rect" display="block"></rect>
                    <text class="hitMod-text" display="block">-2</text>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        const forceUnit = createForceUnit(unit);
        initialize(forceUnit, svg);
        const entry = forceUnit.getInventory().find(candidate => candidate.equipment === vibroblade)!;
        const heatText = entry.el!.querySelector(':scope > .heat > text') as SVGTextElement;
        const damageText = entry.el!.querySelector(':scope > .damage > text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgMekService(forceUnit, unitInitializer));

        svgService.refreshInventory();
        expect(heatText.textContent).toBe('[5]');
        expect(damageText.textContent).toBe('5 [10]');
        expect(damageText.classList.contains('damaged')).toBeFalse();
        expect(entry.el!.classList.contains('damagedInventory')).toBeFalse();

        entry.setState(VIBROBLADE_MODE_STATE, VIBROBLADE_ON_MODE);
        svgService.refreshInventory();
        expect(heatText.textContent).toBe('5');
        expect(damageText.textContent).toBe('10');
        expect(damageText.classList.contains('damaged')).toBeFalse();

        forceUnit.setInventoryControlEntrySelected(entry, true);
        expect(forceUnit.selectedInventoryWeaponHeat()).toEqual(jasmine.objectContaining({
            hasSelection: true,
            value: 5,
        }));
        expect(forceUnit.selectedInventoryWeaponHeat().entryIds).toContain(entry.id);
        expect(forceUnit.turnState().heatSources().some(source => source.id === `vibroblade:${entry.id}`)).toBeFalse();

        entry.deleteState(VIBROBLADE_MODE_STATE);
        svgService.refreshInventory();
        expect(heatText.textContent).toBe('[5]');
        expect(damageText.textContent).toBe('5 [10]');
        expect(damageText.classList.contains('damaged')).toBeFalse();
        expect(entry.el!.classList.contains('damagedInventory')).toBeFalse();
        expect(damageText.getAttribute('data-mekbay-physical-base-damage-text')).toBe('10');
    });

    it('renders Nova CEWS row heat while grouping its record-sheet summary as Equipment', () => {
        const nova = new MiscEquipment({
            id: 'NovaCEWS',
            name: 'Nova CEWS',
            type: 'misc',
            flags: ['F_NOVA', 'F_ECM', 'F_BAP'],
        });
        equipment[nova.internalName] = nova;
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new NovaCewsHandler());
        const unit = createEmptyUnit({
            ...createMekUnit(),
            heat: 20,
            comp: [{
                id: nova.internalName, q: 1, q2: 0, n: nova.name, t: 'E', p: 1,
                l: 'CT', c: '2', os: 0, eq: nova,
            }],
        });
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g class="unitLocation armor" loc="CT"></g>
                <g class="unitLocation structure" loc="CT"></g>
                <g class="inventoryEntry" id="${nova.internalName}@CT#0">
                    <g class="name"><text>Nova CEWS</text></g>
                    <text class="heat">—</text>
                    <text class="location">CT</text>
                </g>
                <text id="damagedEngineHeatText" x="10" y="100"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        const forceUnit = createForceUnit(unit);
        initialize(forceUnit, svg);
        const entry = forceUnit.getInventory().find(candidate => candidate.equipment === nova)!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshInventory();
        svgService.refreshTurnState();

        expect(entry.el!.querySelector(':scope > .heat')?.textContent).toBe('2');
        expect(forceUnit.turnState().heatSources()).toContain(jasmine.objectContaining({
            id: `nova-cews:${entry.id}`,
            label: 'Nova CEWS',
            value: 2,
            group: 'Equipment',
        }));
        expect(Array.from(svg.querySelectorAll<SVGTSpanElement>('#damagedEngineHeatText > tspan'))
            .map(line => line.textContent)).toContain('Equipment: +2');

        entry.setState(NOVA_CEWS_STATE_KEY, NOVA_CEWS_OFF_STATE);
        forceUnit.setInventoryEntry(entry);
        const offEntry = forceUnit.getInventory().find(candidate => candidate.id === entry.id)!;
        svgService.refreshInventory();
        svgService.refreshTurnState();

        expect(offEntry.el!.querySelector(':scope > .heat')?.textContent).toBe('—');
        expect(forceUnit.turnState().heatSources().some(source => source.id === `nova-cews:${offEntry.id}`)).toBeFalse();
        expect(svg.querySelector('#damagedEngineHeatText > tspan')).toBeNull();
    });

    it('renders effective weapon types on selected-range SVG damage', () => {
        const forceUnit = createForceUnit(createVariableDamageUnit(equipment));
        initialize(forceUnit, createVariableDamageSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const damageText = weaponEntry.el!.querySelector(':scope > .damage > text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));
        spyOn(forceUnit, 'getInventoryControlRules').and.returnValue({
            applyWeaponTypes: (_entry, types) => new Set([...types, 'AE'])
        });

        forceUnit.setInventoryControlEntryRange(weaponEntry, 'medium');
        svgService.refreshInventory();

        expect(damageText.textContent).toBe('7 [AE,V]');
    });

    it('resolves Laser Insulator heat from equipment instead of the SVG', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new LaserInsulatorHandler());
        const forceUnit = createForceUnit(createLaserInsulatorUnit(equipment));
        initialize(forceUnit, createLaserInsulatorSvg());
        const laser = forceUnit.getInventory().find(entry => entry.id === 'ISMediumLaser@FR#0')!;
        const insulator = laser.linkedWith![0];
        const heatText = laser.el!.querySelector(':scope > .heat') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshInventory();
        expect(heatText.textContent).toBe('2*');

        insulator.setCommittedDestroyed(true);
        svgService.refreshInventory();
        expect(heatText.textContent).toBe('3');
        expect(heatText.classList.contains('damaged')).toBeTrue();

        const row = getInventoryControlGroups(forceUnit, new EquipmentRegistry(equipment), forceUnit.getInventoryControlRules())
            .find(group => group.id === 'ranged')!.rows[0];
        expect(row.base.heat).toBe('3');
        expect(row.firingHeat).toBe(3);
        expect(row.display.heat).toBe('3');

        insulator.setCommittedDestroyed(false);
        svgService.refreshInventory();
        expect(heatText.textContent).toBe('2*');
        expect(heatText.classList.contains('damaged')).toBeFalse();

        const repairedRow = getInventoryControlGroups(forceUnit, new EquipmentRegistry(equipment), forceUnit.getInventoryControlRules())
            .find(group => group.id === 'ranged')!.rows[0];
        expect(repairedRow.firingHeat).toBe(2);
        expect(repairedRow.display.heat).toBe('2*');
    });

    it('renders RISC laser pulse split hit modifiers and linked row highlight on the SVG', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new RiscLaserPulseModuleHandler());
        const forceUnit = createForceUnit(createRiscLaserUnit(equipment));
        initialize(forceUnit, createRiscLaserSvg());
        const laser = forceUnit.getInventory().find(entry => entry.id === 'ISMediumLaser@FR#0')!;
        const module = laser.linkedWith![0];
        const laserHitText = laser.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const moduleHitText = module.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const toHitModifiers = new Map([
            [laser, []],
            [module, [{ label: 'RISC Laser Pulse Module', modifier: 1 }]],
        ]);
        spyOn(forceUnit.rules, 'getEquipmentToHitModifiers').and.callFake(entry => toHitModifiers.get(entry) ?? []);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        svgService.refreshInventory();
        expect(laserHitText.textContent).toBe('+0');
        expect(moduleHitText.textContent).toBe('-1');
        expect(laser.el!.classList.contains('selected')).toBeFalse();
        expect(module.el!.classList.contains('selected')).toBeFalse();

        laser.setState('inventory_control_mode', RISC_LASER_PULSE_MODE);
        forceUnit.setInventoryControlEntryRange(laser, 'short');
        svgService.refreshInventory();

        expect(laserHitText.textContent).toBe('-2');
        expect(moduleHitText.textContent).toBe('-1');
        expect(laser.el!.classList.contains('selected')).toBeTrue();
        expect(laser.el!.classList.contains('selected-range-short')).toBeTrue();
        expect(module.el!.classList.contains('selected')).toBeTrue();
    });

    it('renders linked locations detached when their parent torso is committed destroyed', () => {
        const forceUnit = createForceUnit();
        const svg = createMekDamageSvg();
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setInternalHits('LT', forceUnit.getInternalPoints('LT'));
        svgService.refreshArmor();

        const linkedEls = svg.querySelectorAll('[loc="LA"]');
        expect(forceUnit.isInternalLocCommittedDestroyed('LA')).toBeTrue();
        expect(Array.from(linkedEls).every(el => el.classList.contains('detached'))).toBeTrue();
    });

    it('renders blown-off crit groups detached without locationDestroyed', () => {
        const forceUnit = createForceUnit();
        const svg = createMekDamageSvg();
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setLocationCondition('LA', 'blown-off', true);
        svgService.refreshArmor();

        const critGroup = svg.querySelector('.critGroup[loc="LA"]')!;
        const structure = svg.querySelector('.unitLocation.structure[loc="LA"]')!;
        const armor = svg.querySelector('.unitLocation.armor[loc="LA"]')!;
        expect(critGroup.classList.contains('detached')).toBeTrue();
        expect(critGroup.classList.contains('locationDestroyed')).toBeFalse();
        expect(structure.classList.contains('damaged')).toBeFalse();
        expect(armor.classList.contains('damaged')).toBeFalse();
    });

    it('renders linked locations disabled but not detached when their parent torso is flooded', () => {
        const forceUnit = createForceUnit();
        const svg = createMekDamageSvg();
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.endPhase();
        svgService.refreshArmor();

        const linkedEls = Array.from(svg.querySelectorAll('[loc="LA"]'));
        const linkedCritGroup = svg.querySelector('.critGroup[loc="LA"]')!;
        const floodedCritGroup = svg.querySelector('.critGroup[loc="LT"]')!;
        expect(forceUnit.isInternalLocCommittedDestroyed('LA')).toBeTrue();
        expect(forceUnit.isInternalLocCommittedPhysicallyDestroyed('LA')).toBeFalse();
        expect(linkedEls.every(el => el.classList.contains('disabledLocation'))).toBeTrue();
        expect(linkedEls.some(el => el.classList.contains('detached'))).toBeFalse();
        expect(linkedCritGroup.classList.contains('locationDestroyed')).toBeFalse();
        expect(floodedCritGroup.classList.contains('locationDestroyed')).toBeFalse();
    });

    it('renders directly flooded linked locations as flooded instead of disabled', () => {
        const forceUnit = createForceUnit();
        const svg = createMekDamageSvg();
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.setLocationCondition('LA', 'flooded', true);
        forceUnit.endPhase();
        svgService.refreshArmor();

        const linkedEls = Array.from(svg.querySelectorAll('[loc="LA"]'));
        const linkedCritGroup = svg.querySelector('.critGroup[loc="LA"]')!;
        expect(linkedEls.every(el => el.classList.contains('flooded'))).toBeTrue();
        expect(linkedEls.some(el => el.classList.contains('disabledLocation'))).toBeFalse();
        expect(linkedCritGroup.classList.contains('flooded')).toBeTrue();
        expect(linkedCritGroup.classList.contains('disabledLocation')).toBeFalse();
    });

    it('hides crew state buttons at runtime when there are no crew state controls', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'AFTest_AERO-1',
            chassis: 'Test Aero',
            model: 'AERO-1',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            crewSize: 1,
        }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="crew_state_button_0_pilotName0" class="crewStateButton unitConditionButton" crewId="0"><rect></rect><text></text></g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        forceUnit.svg.set(svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        expect((svg.getElementById('crew_state_button_0_pilotName0') as SVGElement).style.display).toBe('none');
    });

    it('does not apply drone controller modifiers to aero skill displays', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'DroneAero_TEST-1',
            chassis: 'Drone Aero',
            model: 'TEST-1',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            crewSize: 1,
        }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="asfGunnerySkill"></text>
                <text id="asfPilotingSkill"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        initialize(forceUnit, svg);
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'ISDroneOperatingSystem@NOS#0',
            name: 'Drone (Remote) Operating System',
            equipment: equipment['ISDroneOperatingSystem'],
            locations: new Set(['NOS']),
        })]);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        expect(svg.getElementById('asfGunnerySkill')?.textContent).toBe('4');
        expect(svg.getElementById('asfPilotingSkill')?.textContent).toBe('5');
    });

    it('does not apply drone controller modifiers to vehicle skill displays', () => {
        const forceUnit = createForceUnit(createEmptyUnit({ type: 'Tank', crewSize: 1 }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="pilotingSkill0"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        initialize(forceUnit, svg);
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'ISDroneOperatingSystem@NOS#0',
            name: 'Drone (Remote) Operating System',
            equipment: equipment['ISDroneOperatingSystem'],
            locations: new Set(['NOS']),
        })]);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        expect(svg.getElementById('pilotingSkill0')?.textContent).toBe('5');
    });

    it('formats piloting modifiers as a labeled PSR suffix', () => {
        expect(formatPilotingDisplay(5, 2)).toBe('5 +2PSR');
        expect(formatPilotingDisplay(5, -1)).toBe('5 -1PSR');
        expect(formatPilotingDisplay(5, 2, 'DSR')).toBe('5 +2DSR');
    });

    it('keeps crew gunnery skill displays unchanged by attack modifiers', () => {
        const forceUnit = createForceUnit(createEmptyUnit({ crewSize: 1 }));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="gunnerySkill0"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        initialize(forceUnit, svg);
        forceUnit.turnState().moveMode.set('run');
        forceUnit.turnState().spotting.set(true); // This will not affect
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        expect(forceUnit.turnState().getAttackModifierBreakdown()).toEqual([
            { label: 'Run', modifier: 2, priority: -50 },
        ]);
        expect(svg.getElementById('gunnerySkill0')?.textContent).toBe('4');
    });

    it('keeps the crew gunnery skill unchanged while Prone modifies ranged weapons', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            crewSize: 1,
        }));
        const ranged = new MountedEquipment({
            owner: forceUnit,
            id: 'medium-laser',
            name: 'Medium Laser',
            equipment: new WeaponEquipment({
                id: 'medium-laser',
                name: 'Medium Laser',
                type: 'weapon',
                weapon: { ranges: [3, 6, 9, 12] },
            }),
        });
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <text id="gunnerySkill0"></text>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        initialize(forceUnit, svg);
        forceUnit.setCondition('prone', true);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        expect(forceUnit.turnState().getAttackModifierBreakdown()).not.toContain(jasmine.objectContaining({ label: 'Prone' }));
        expect(forceUnit.rules.getEquipmentToHitModifiers(ranged))
            .toContain(jasmine.objectContaining({ label: 'Prone', modifier: 2 }));
        expect(svg.getElementById('gunnerySkill0')?.textContent).toBe('4');
    });

    it('shows vehicle sensor damage on weapons but not gunnery skill', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const svg = createVehicleSvg();
        const gunnerySkill = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        gunnerySkill.id = 'gunnerySkill0';
        svg.appendChild(gunnerySkill);
        initialize(forceUnit, svg);
        forceUnit.setCritLoc({ id: 'sensor_hit_3', destroyed: 10, destroying: 10 });
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        svgService.refreshCrew();
        svgService.refreshInventory();

        expect(gunnerySkill.textContent).toBe('4');
        expect(svg.querySelector('.inventoryEntry > .hitMod-text')?.textContent).toBe('+3');
    });

    it('replaces crew damage groups with remote drone text at runtime for drone operating system units', () => {
        const forceUnit = createForceUnit(createDroneMekUnit(equipment));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="crewDamageContainer">
                    <g id="crewDamage0">
                        <g class="crewHit interactive" crewId="0" hit="1"></g>
                    </g>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        const crewDamage = svg.getElementById('crewDamage0') as SVGElement;
        const crewDamageContainer = svg.getElementById('crewDamageContainer') as SVGGElement;
        initialize(forceUnit, svg);
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'ISDroneOperatingSystem@HD#0',
            name: 'Drone (Remote) Operating System',
            equipment: equipment['ISDroneOperatingSystem'],
            locations: new Set(['HD']),
        })]);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        const remoteDroneLabel = svg.getElementById('remoteDroneCrewDamage0Label') as SVGTextElement;
        expect(forceUnit.rules.hasCrew()).toBeFalse();
        expect(crewDamage.getAttribute('display')).toBe('none');
        expect(crewDamage.style.display).toBe('none');
        expect(remoteDroneLabel.parentNode).toBe(crewDamageContainer);
        expect(remoteDroneLabel.textContent).toBe('REMOTE DRONE');
        svgService.refreshCrew();

        expect((svg.getElementById('remoteDroneCrewDamage0Label') as SVGTextElement).getAttribute('display')).toBeNull();
        expect((svg.getElementById('remoteDroneCrewDamage0Label') as SVGTextElement).style.display).toBe('');
        expect(svg.querySelectorAll('#remoteDroneCrewDamage0Reminder').length).toBe(1);

        forceUnit.setInventory([]);
        svgService.refreshCrew();

        expect(svg.getElementById('remoteDroneCrewDamage0Label')).toBeNull();
        expect(svg.getElementById('remoteDroneCrewDamage0Reminder')).toBeNull();
    });

    it('uses the blank crew name container for remote drone text when crew damage is missing', () => {
        const forceUnit = createForceUnit(createDroneMekUnit(equipment));
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g id="pilotNameContainer">
                    <text id="blankCrewName0"></text>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        const blankCrewName = svg.getElementById('blankCrewName0') as SVGTextElement;
        const container = svg.getElementById('pilotNameContainer') as SVGGElement;
        initialize(forceUnit, svg);
        forceUnit.setInventory([new MountedEquipment({
            owner: forceUnit,
            id: 'ISDroneOperatingSystem@HD#0',
            name: 'Drone (Remote) Operating System',
            equipment: equipment['ISDroneOperatingSystem'],
            locations: new Set(['HD']),
        })]);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshCrew();

        const remoteDroneLabel = svg.getElementById('remoteDroneCrewDamage0Label') as SVGTextElement;
        expect(blankCrewName.getAttribute('display')).toBeNull();
        expect(blankCrewName.style.display).toBe('');
        expect(remoteDroneLabel.parentNode).toBe(container);
        expect(remoteDroneLabel.textContent).toBe('REMOTE DRONE');
    });

    it('does not render directly physically destroyed linked locations as disabled', () => {
        const forceUnit = createForceUnit();
        const svg = createMekDamageSvg();
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        forceUnit.setLocationCondition('LT', 'flooded', true);
        forceUnit.endPhase();
        forceUnit.setInternalHits('LA', forceUnit.getInternalPoints('LA'));
        svgService.refreshArmor();

        const linkedEls = Array.from(svg.querySelectorAll('[loc="LA"]'));
        const linkedCritGroup = svg.querySelector('.critGroup[loc="LA"]')!;
        expect(forceUnit.isInternalLocPhysicallyDestroyed('LA')).toBeTrue();
        expect(linkedEls.some(el => el.classList.contains('disabledLocation'))).toBeFalse();
        expect(linkedCritGroup.classList.contains('disabledLocation')).toBeFalse();
        expect(linkedCritGroup.classList.contains('locationDestroyed')).toBeTrue();
    });

    it('keeps NARC active through pending location destruction and removes it when committed', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit, createMekDamageSvg());
        forceUnit.locations!.armor.set('LL', { loc: 'LL', rear: false, points: 1 });
        forceUnit.locations!.internal.set('LL', { loc: 'LL', points: 1 });
        forceUnit.setLocations({ ...forceUnit.getLocations(), LL: { armor: 0, internal: 0 } }, true);
        forceUnit.setLocationCondition('LA', 'narc', true);
        forceUnit.setLocationCondition('LL', 'narc', true);

        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: true, underwater: false });

        forceUnit.turnState().setCover('underwater-depth-1');
        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: true, underwater: true });

        forceUnit.setCondition('prone', true);
        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: false, underwater: true });

        forceUnit.setCondition('prone', false);
        forceUnit.addInternalHits('LL', forceUnit.getInternalPoints('LL'));
        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: true, underwater: true });

        forceUnit.endPhase();
        expect(forceUnit.getCondition('prone')).toBeTrue();
        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: false, underwater: true });

        forceUnit.setLocationCondition('LA', 'blown-off', true);
        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: false, underwater: true });

        forceUnit.endPhase();
        expect(forceUnit.getActiveNarcWaterLayers()).toEqual({ aboveWater: false, underwater: false });
    });

    it('classifies firing weapons by their water layer', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit, createMekDamageSvg());
        const weapon = new WeaponEquipment({
            id: 'TestNarcCapableLauncher',
            name: 'Test NARC-Capable Launcher',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 5, ranges: [7, 14, 21, 28] },
        });
        const legWeapon = new MountedWeapon({
            owner: forceUnit,
            id: `${weapon.internalName}@LL#0`,
            name: weapon.internalName,
            equipment: weapon,
            locations: new Set(['LL']),
        });
        const torsoWeapon = new MountedWeapon({
            owner: forceUnit,
            id: `${weapon.internalName}@LT#1`,
            name: weapon.internalName,
            equipment: weapon,
            locations: new Set(['LT']),
        });

        expect(forceUnit.isEquipmentSubmerged(legWeapon)).toBeFalse();
        expect(forceUnit.isEquipmentSubmerged(torsoWeapon)).toBeFalse();

        forceUnit.turnState().setCover('underwater-depth-1');
        expect(forceUnit.isEquipmentSubmerged(legWeapon)).toBeTrue();
        expect(forceUnit.isEquipmentSubmerged(torsoWeapon)).toBeFalse();

        forceUnit.setCondition('prone', true);
        expect(forceUnit.isEquipmentSubmerged(legWeapon)).toBeTrue();
        expect(forceUnit.isEquipmentSubmerged(torsoWeapon)).toBeTrue();

        forceUnit.setCondition('prone', false);
        forceUnit.turnState().setCover('underwater-depth-2');
        expect(forceUnit.isEquipmentSubmerged(legWeapon)).toBeTrue();
        expect(forceUnit.isEquipmentSubmerged(torsoWeapon)).toBeTrue();
    });

    it('allows energy weapons, converted torpedoes, and native SRT/LRT/NLRT ammunition underwater', () => {
        const forceUnit = createForceUnit();
        initialize(forceUnit, createMekDamageSvg());
        const ballistic = new WeaponEquipment({
            id: 'TestBallistic',
            name: 'Test Ballistic',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 5, ranges: [7, 14, 21, 28] },
        });
        const energy = new WeaponEquipment({
            id: 'TestEnergy',
            name: 'Test Energy',
            type: 'weapon',
            flags: ['F_ENERGY'],
            weapon: { ammoType: 'NA', ranges: [3, 6, 9, 12] },
        });
        const legBallistic = new MountedWeapon({ owner: forceUnit, id: 'TestBallistic@LL#0', name: ballistic.name, equipment: ballistic, locations: new Set(['LL']) });
        const legEnergy = new MountedWeapon({ owner: forceUnit, id: 'TestEnergy@LL#1', name: energy.name, equipment: energy, locations: new Set(['LL']) });
        const standardAmmo = new AmmoEquipment({
            id: 'StandardAmmo', name: 'Standard Ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 5, shots: 24 },
        });
        const torpedoAmmo = new AmmoEquipment({
            id: 'TorpedoAmmo', name: 'Torpedo Ammo', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 5, shots: 24, munitionType: ['M_TORPEDO'] },
        });
        const nativeTorpedoAmmo = (['SRM_TORPEDO', 'LRM_TORPEDO', 'NLRM_TORPEDO'] as const)
            .map(type => new AmmoEquipment({
                id: type, name: type, type: 'ammo',
                ammo: { type, rackSize: 5, shots: 24 },
            }));
        const comboAmmo = new AmmoEquipment({
            id: 'ComboAmmo', name: 'Combo Ammo', type: 'ammo',
            ammo: { type: 'LRM_TORPEDO_COMBO', rackSize: 5, shots: 24 },
        });
        forceUnit.setInventory([legBallistic, legEnergy]);
        forceUnit.turnState().setCover('underwater-depth-1');

        expect(forceUnit.isInventoryWeaponUsableInWater(legBallistic, standardAmmo)).toBeFalse();
        expect(forceUnit.isInventoryWeaponUsableInWater(legBallistic, torpedoAmmo)).toBeTrue();
        expect(nativeTorpedoAmmo.every(ammo => forceUnit.isInventoryWeaponUsableInWater(legBallistic, ammo))).toBeTrue();
        expect(forceUnit.isInventoryWeaponUsableInWater(legBallistic, comboAmmo)).toBeFalse();
        expect(forceUnit.isInventoryWeaponUsableInWater(legEnergy)).toBeTrue();
        expect(forceUnit.canPerformEquipmentAction(legBallistic, 'fire')).toBeFalse();
        expect(forceUnit.canPerformEquipmentAction(legEnergy, 'fire')).toBeTrue();
    });

    it('renders target range classes from the ammo-aware typed MML mode', () => {
        const forceUnit = createForceUnit(createMmlUnit(equipment));
        initialize(forceUnit, createMmlSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 7 });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        svgService.refreshInventory();

        expect(weaponEntry.el!.classList.contains('selected-alternative-mode')).toBeTrue();
        expect(weaponEntry.el!.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('LRM');
        expect(weaponEntry.el!.classList.contains('selected-range-short')).toBeTrue();
        expect(weaponEntry.el!.classList.contains('selected-range-medium')).toBeFalse();
        expect(weaponEntry.el!.classList.contains('selected-range-long')).toBeFalse();
        expect(weaponEntry.el!.classList.contains('selected-range-extreme')).toBeFalse();
    });

    it('renders mode-specific MML cluster tags on both SVG mode rows', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new MmlHandler());
        const forceUnit = createForceUnit(createMmlUnit(equipment));
        initialize(forceUnit, createMmlSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshInventory();

        expect(weaponEntry.el!.querySelector(':scope > .alternativeMode[mode="LRM"] > .damage > text')?.textContent)
            .toBe('7/Msl [C5,M,S]');
        expect(weaponEntry.el!.querySelector(':scope > .alternativeMode[mode="SRM"] > .damage > text')?.textContent)
            .toBe('8/Msl [C2,M,S]');
        expect(weaponEntry.el!.querySelector(':scope > .damage > text')?.textContent)
            .toBe('');

        svgService.refreshInventory();
        expect(weaponEntry.el!.querySelector(':scope > .alternativeMode[mode="SRM"] > .damage > text')?.textContent)
            .toBe('8/Msl [C2,M,S]');
    });

    it('renders ATM damage only on alternative rows and leaves the main SVG damage blank', () => {
        TestBed.inject(EquipmentInteractionRegistryService).getRegistry().register(new AtmHandler());
        const forceUnit = createForceUnit(createEmptyUnit({
            name: 'ATM Test Unit',
            chassis: 'ATM Test',
            model: 'T1',
            type: 'Tank',
            subtype: 'Hovercraft',
            heat: -1,
            dissipation: -1,
            comp: [
                { id: 'ISATM6', q: 1, q2: 0, n: 'ATM 6', t: 'M', p: 1, l: 'LT', r: '', m: '0', d: '[M,S,H]', md: '0.0', c: '1', os: 0, eq: equipment['ISATM6'] },
                { id: 'ISATM6ERAmmo', q: 1, q2: 10, n: 'ATM 6 ER Ammo', t: 'X', p: 0, l: 'BD', c: '0', os: 0, eq: equipment['ISATM6ERAmmo'] },
                { id: 'ISATM6HEAmmo', q: 1, q2: 10, n: 'ATM 6 HE Ammo', t: 'X', p: 0, l: 'BD', c: '0', os: 0, eq: equipment['ISATM6HEAmmo'] },
            ],
            sheets: ['vehicle/atm-test.svg'],
        }));
        initialize(forceUnit, createAtmSvg());
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));

        svgService.refreshInventory();

        expect(weaponEntry.el!.querySelector(':scope > .damage > text')?.textContent).toBe('');
        expect(weaponEntry.el!.querySelector(':scope > .alternativeMode[mode="Extended Range"] > .damage > text')?.textContent)
            .toContain('7/Msl');
        expect(weaponEntry.el!.querySelector(':scope > .alternativeMode[mode="High Explosive"] > .damage > text')?.textContent)
            .toContain('8/Msl');
    });

    it('uses catalog ammunition selected by the firing profile when incorporated ammo is unavailable', () => {
        const atmWeapon = new WeaponEquipment({
            id: 'ISATM6',
            name: 'ATM 6',
            type: 'weapon',
            flags: ['F_MISSILE'],
            weapon: { ammoType: 'ATM', rackSize: 6, heat: 4, damage: 'cluster', ranges: [0, 0, 0, 0] }
        });
        const iatmWeapon = new WeaponEquipment({
            id: 'ISIATM6',
            name: 'IATM 6',
            type: 'weapon',
            flags: ['F_MISSILE'],
            weapon: { ammoType: 'IATM', rackSize: 6, heat: 4, damage: 'cluster', ranges: [0, 0, 0, 0] }
        });
        const iatmStandardAmmo = new AmmoEquipment({
            id: 'IATMStandardAmmo', name: 'IATM Standard Ammo', type: 'ammo',
            ammo: { type: 'IATM', rackSize: 6, damagePerShot: 2, munitionType: ['M_STANDARD'] },
        });
        const equipmentMap = { ...equipment, [iatmStandardAmmo.id]: iatmStandardAmmo };
        const equipmentCatalog = new EquipmentRegistry(equipmentMap);

        expect(resolveWeaponDamage(atmWeapon, equipmentCatalog, { ammoProfile: ATM_EXTENDED_RANGE_PROFILE }))
            .toEqual({ values: [7], maximum: 42, unit: 'missile' });
        expect(resolveWeaponDamage(atmWeapon, equipmentCatalog, { ammoProfile: ATM_HIGH_EXPLOSIVE_PROFILE }))
            .toEqual({ values: [8], maximum: 48, unit: 'missile' });
        expect(resolveWeaponDamage(iatmWeapon, equipmentCatalog, { ammoProfile: ATM_STANDARD_PROFILE }))
            .toEqual({ values: [2], maximum: 12, unit: 'missile' });
    });

    it('renders vehicle stabilizer hit modifiers without using the range wildcard', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const hitModRect = weaponEntry.el!.querySelector(':scope > .hitMod-rect') as SVGRectElement;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        forceUnit.setCritLoc({ id: 'stabilizer_hit_front', destroyed: 10, destroying: 10 });
        svgService.refreshInventory();
        expect(hitModRect.getAttribute('display')).toBe('block');
        expect(hitModText.textContent).toBe('+0');
        expect(weaponEntry.el!.classList.contains('weakenedHitMod')).toBeTrue();

        forceUnit.turnState().moveMode.set('run');
        svgService.refreshInventory();
        expect(hitModText.textContent).toBe('+2');
    });

    it('renders Aero heat fire modifiers in the SVG hit modifier elements', () => {
        const unit = createEmptyUnit({
            name: 'Aero Hit Modifier Test',
            chassis: 'Aero Hit Modifier Test',
            model: 'A1',
            type: 'Aero',
            subtype: 'Aerospace Fighter',
            heat: 10,
            dissipation: 10,
            comp: [{
                id: 'ISMediumLaser', q: 1, q2: 0, n: 'Medium Laser', t: 'E', p: 1,
                l: 'NOS', r: '3/6/9', m: '0', d: '5', md: '5', c: '1', os: 0,
                eq: equipment['ISMediumLaser']
            }]
        });
        const svg = new DOMParser().parseFromString(`
            <svg xmlns="http://www.w3.org/2000/svg">
                <g class="inventoryEntry" id="ISMediumLaser@NOS#0" hitMod="0">
                    <g class="name"><text>Medium Laser</text></g>
                    <text class="location">NOS</text>
                    <rect class="hitMod-rect" display="none"></rect>
                    <text class="hitMod-text" display="none"></text>
                </g>
            </svg>
        `, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
        const forceUnit = createForceUnit(unit);
        initialize(forceUnit, svg);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const hitModRect = weaponEntry.el!.querySelector(':scope > .hitMod-rect') as SVGRectElement;
        const hitModText = weaponEntry.el!.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgAeroService(forceUnit, unitInitializer));

        forceUnit.setHeatData({ current: 7, previous: 7 });
        svgService.refreshInventory();
        expect(hitModRect.getAttribute('display')).toBe('none');
        expect(hitModText.getAttribute('display')).toBe('none');

        forceUnit.setHeatData({ current: 8, previous: 8 });
        svgService.refreshInventory();
        expect(hitModRect.getAttribute('display')).toBe('block');
        expect(hitModText.getAttribute('display')).toBe('block');
        expect(hitModText.textContent).toBe('+1');

        forceUnit.setHeatData({ current: 24, previous: 24 });
        svgService.refreshInventory();
        expect(hitModText.textContent).toBe('+4');
    });

    it('shows explicit zero hit modifiers only when changed from the equipment modifier', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgService(forceUnit, unitInitializer));
        const entryElement = forceUnit.svg()!.querySelector('.inventoryEntry') as SVGElement;
        const hitModRect = entryElement.querySelector(':scope > .hitMod-rect') as SVGRectElement;
        const hitModText = entryElement.querySelector(':scope > .hitMod-text') as SVGTextElement;
        const createEntry = (toHitModifier: number) => new MountedEquipment({
            owner: forceUnit,
            id: `weapon-${toHitModifier}`,
            name: 'Weapon',
            equipment: new WeaponEquipment({
                id: `Weapon${toHitModifier}`,
                name: 'Weapon',
                type: 'weapon',
                stats: { toHitModifier },
                weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] },
            }),
            el: entryElement,
            locations: new Set(['FR']),
        });

        svgService.renderHitModifier(createEntry(0), 0);
        expect(hitModRect.getAttribute('display')).toBe('none');

        svgService.renderHitModifier(createEntry(0), 0, true);
        expect(hitModRect.getAttribute('display')).toBe('block');
        expect(hitModText.textContent).toBe('+0');
        expect(entryElement.classList.contains('weakenedHitMod')).toBeTrue();

        svgService.renderHitModifier(createEntry(1), 0);
        expect(hitModRect.getAttribute('display')).toBe('block');
        expect(hitModText.textContent).toBe('+0');
        expect(entryElement.classList.contains('weakenedHitMod')).toBeFalse();

        svgService.renderHitModifier(createEntry(-1), 0);
        expect(hitModRect.getAttribute('display')).toBe('block');
        expect(hitModText.textContent).toBe('+0');
        expect(entryElement.classList.contains('weakenedHitMod')).toBeFalse();
    });

    it('renders VTOL rotor committed and pending hit counts separately', () => {
        const forceUnit = createForceUnit(createEmptyUnit({
            ...createVehicleUnit(equipment),
            type: 'VTOL',
        }));
        const svg = createVehicleSvg();
        const rotorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rotorGroup.setAttribute('id', 'rotor_hits_group');
        rotorGroup.setAttribute('class', 'screen-only critLoc counterGroup rotorHitsControl');
        rotorGroup.setAttribute('critId', 'rotor');
        rotorGroup.setAttribute('type', 'rotor');
        const counter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        counter.setAttribute('id', 'rotor_hits_counter');
        rotorGroup.appendChild(counter);
        svg.appendChild(rotorGroup);
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        forceUnit.setCritLoc({ id: 'rotor', hits: 2, pendingHits: 1, el: rotorGroup });
        svgService.refreshCritLocs();

        expect(counter.textContent).toBe('2+1');
        expect(counter.querySelector('.rotorHitsCommitted')?.textContent).toBe('2');
        expect(counter.querySelector('.rotorHitsPending.positive')?.textContent).toBe('+1');
        expect(rotorGroup.classList.contains('rotorHitsDamaged')).toBeTrue();
        expect(rotorGroup.classList.contains('rotorHitsPendingPositive')).toBeTrue();

        forceUnit.setCritLoc({ id: 'rotor', hits: 2, pendingHits: -1, el: rotorGroup });
        svgService.refreshCritLocs();

        expect(counter.textContent).toBe('2-1');
        expect(counter.querySelector('.rotorHitsPending.negative')?.textContent).toBe('-1');
        expect(rotorGroup.classList.contains('rotorHitsPendingPositive')).toBeFalse();
        expect(rotorGroup.classList.contains('rotorHitsPendingNegative')).toBeTrue();
    });

    it('renders repeatable motive hit pips for committed and pending hits', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        const svg = createVehicleSvg();
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const motiveHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        motiveHit.setAttribute('id', 'motive_system_hit_2');
        motiveHit.classList.add('critLoc');
        const pipsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        pipsGroup.setAttribute('id', 'motive_system_hit_2_pips');
        for (let index = 0; index < 9; index++) {
            const pip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            pip.classList.add('motiveHitPip', 'hidden');
            pipsGroup.appendChild(pip);
        }
        group.append(motiveHit, pipsGroup);
        svg.appendChild(group);
        initialize(forceUnit, svg);
        const svgService = TestBed.runInInjectionContext(() => new ExposedUnitSvgVehicleService(forceUnit, unitInitializer));

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 3, pendingHits: 2, hitTimestamps: [10, 20, 30], el: motiveHit }]);

        const pips = Array.from(pipsGroup.querySelectorAll<SVGCircleElement>('.motiveHitPip'));
        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(3);
        expect(pips.filter(pip => pip.classList.contains('willChange')).length).toBe(2);
        expect(pips.filter(pip => pip.classList.contains('hidden')).length).toBe(4);
        expect(motiveHit.classList.contains('damaged')).toBeTrue();
        expect(motiveHit.classList.contains('willChange')).toBeFalse();

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 3, pendingHits: -2, hitTimestamps: [10, 20, 30], el: motiveHit }]);

        expect(pips.filter(pip => pip.classList.contains('damaged')).length).toBe(3);
        expect(pips.filter(pip => pip.classList.contains('pendingRemoval')).length).toBe(2);
        expect(pips.filter(pip => pip.classList.contains('hidden')).length).toBe(6);
        expect(motiveHit.classList.contains('damaged')).toBeTrue();
        expect(motiveHit.classList.contains('willChange')).toBeFalse();

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 0, pendingHits: 1, el: motiveHit }]);

        expect(motiveHit.classList.contains('damaged')).toBeFalse();
        expect(motiveHit.classList.contains('willChange')).toBeTrue();

        svgService.refreshCritLocs([{ id: 'motive_system_hit_2', hits: 1, pendingHits: -1, hitTimestamps: [10], el: motiveHit }]);

        expect(motiveHit.classList.contains('damaged')).toBeTrue();
        expect(motiveHit.classList.contains('willChange')).toBeTrue();
    });

    it('keeps target selection state independent of SVG presentation rendering', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        const targetTnText = weaponEntry.el!.querySelector(':scope > .targetTn-text') as SVGTextElement;

        forceUnit.createInventoryControlTarget();
        forceUnit.updateInventoryControlTarget('A', { distance: 13 });
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('A');
        expect(targetTnText.textContent).toBe('');

        forceUnit.setInventoryControlEntryTarget(weaponEntry, null);

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();
        expect(targetTnText.textContent).toBe('');
    });

    it('preserves valid target assignments across updates and prunes stale entry assignments', () => {
        const forceUnit = createForceUnit(createVehicleUnit(equipment));
        initialize(forceUnit);
        const weaponEntry = forceUnit.getInventory().find(entry => entry.equipment instanceof WeaponEquipment)!;
        forceUnit.createInventoryControlTarget();
        forceUnit.setInventoryControlEntryTarget(weaponEntry, 'A');
        const [ammoOption] = getInventoryControlAmmoSelectionOptions(
            weaponEntry,
            forceUnit.getEquipmentRegistry(),
            (weapon, ammo, mode) => forceUnit.matchesInventoryControlAmmo(weapon, ammo, mode),
        );
        expect(ammoOption).toBeDefined();
        const ammoSelection = {
            selectedProfileId: ammoOption.profileId,
            preferredSourceOptionId: ammoOption.id,
        };
        forceUnit.setInventoryControlEntryAmmoSelection(weaponEntry.id, ammoSelection);

        forceUnit.update({
            id: forceUnit.id,
            unit: forceUnit.getUnit().name,
            state: {
                crew: forceUnit.getCrewMembers().map(crew => crew.serialize()),
                crits: [],
                heat: { current: 0, previous: 0 },
                locations: {},
                modified: false,
                destroyed: false,
                shutdown: false,
            },
        } as CBTSerializedUnit);

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBe('A');
        expect(forceUnit.getInventoryControlSnapshot().entryStates.get(weaponEntry.id)?.ammoSelection)
            .toEqual(ammoSelection);

        forceUnit.setInventory([]);
        forceUnit.update({
            id: forceUnit.id,
            unit: forceUnit.getUnit().name,
            state: {
                crew: forceUnit.getCrewMembers().map(crew => crew.serialize()),
                crits: [],
                heat: { current: 0, previous: 0 },
                locations: {},
                modified: false,
                destroyed: false,
                shutdown: false,
            },
        } as CBTSerializedUnit);

        expect(forceUnit.getInventoryControlEntryTargetId(weaponEntry.id)).toBeUndefined();
        expect(forceUnit.getInventoryControlSnapshot().entryStates.has(weaponEntry.id)).toBeFalse();
        expect(forceUnit.isInventoryControlEntrySelected(weaponEntry.id)).toBeFalse();
    });

});
