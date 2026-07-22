import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { MmlHandler } from './mml.handler';

function owner() {
    return { setInventoryEntry: jasmine.createSpy('setInventoryEntry'), rules: { computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 }) } } as never;
}

function weapon(): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: 'mml', name: 'MML 9', equipment: new WeaponEquipment({ id: 'MML9', name: 'MML 9', type: 'weapon', weapon: { ammoType: 'MML', rackSize: 9 } }) });
}

function svgEntry(html: string): SVGElement {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as SVGElement;
}

function weaponWithSvgMode(mode: string, persist = false): MountedEquipment {
    const entry = weapon();
    entry.el = svgEntry(`
        <g class="inventoryEntry">
            <g class="alternativeMode${mode === 'LRM' ? ' selected' : ''}" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g></g>
            <g class="alternativeMode${mode === 'SRM' ? ' selected' : ''}" mode="SRM"><g class="name"><text>SRM</text></g><g class="damage"><text>2/Msl</text></g></g>
        </g>
    `);
    if (persist) {
        entry.states.set('inventory_control_mode', mode);
    }
    return entry;
}

function ammo(id: string, name: string, flags: string[] = []): AmmoEquipment {
    return new AmmoEquipment({ id, name, shortName: name, type: 'ammo', flags, ammo: { type: 'MML', rackSize: 9, shots: 10 } });
}

describe('MmlHandler', () => {
    const handler = new MmlHandler();
    const context = {} as HandlerContext;

    it('does not duplicate SVG-owned mode picker choices', () => {
        expect(handler.getChoices(weapon(), context)).toEqual([]);
    });

    it('filters MML ammo by selected mode', () => {
        const mml = weapon();

        expect(handler.matchesInventoryAmmo(mml, ammo('lrm', 'MML 9 LRM Ammo'), 'LRM', context)).toBeTrue();
        expect(handler.matchesInventoryAmmo(mml, ammo('srm', 'MML 9 SRM Ammo'), 'LRM', context)).toBeFalse();
        expect(handler.matchesInventoryAmmo(mml, ammo('srm', 'MML 9 SRM Ammo'), 'SRM', context)).toBeTrue();
    });

    it('defaults to SRM and ignores the selected SVG mode', () => {
        const mml = weaponWithSvgMode('LRM');

        expect(handler.matchesInventoryAmmo(mml, ammo('srm', 'MML 9 SRM Ammo'), null, context)).toBeTrue();
        expect(handler.matchesInventoryAmmo(mml, ammo('lrm', 'MML 9 LRM Ammo'), null, context)).toBeFalse();
    });

    it('uses a valid persisted mode when no mode is supplied', () => {
        const mml = weaponWithSvgMode('LRM', true);

        expect(handler.matchesInventoryAmmo(mml, ammo('lrm', 'MML 9 LRM Ammo'), null, context)).toBeTrue();
        expect(handler.matchesInventoryAmmo(mml, ammo('srm', 'MML 9 SRM Ammo'), null, context)).toBeFalse();
    });

    it('uses explicit ammunition flags before misleading names', () => {
        const mml = weapon();

        expect(handler.matchesInventoryAmmo(mml, ammo('lrm', 'MML 9 SRM Ammo', ['F_MML_LRM']), 'LRM', context)).toBeTrue();
        expect(handler.matchesInventoryAmmo(mml, ammo('srm', 'MML 9 LRM Ammo', ['F_MML_SRM']), 'LRM', context)).toBeFalse();
    });

    it('rejects unclassified and rack-mismatched MML ammunition', () => {
        const mml = weapon();
        const wrongRack = new AmmoEquipment({
            id: 'wrong-rack',
            name: 'MML 5 LRM Ammo',
            type: 'ammo',
            flags: ['F_MML_LRM'],
            ammo: { type: 'MML', rackSize: 5, shots: 10 }
        });

        expect(handler.matchesInventoryAmmo(mml, ammo('unknown', 'MML 9 Ammo'), 'LRM', context)).toBeFalse();
        expect(handler.matchesInventoryAmmo(mml, wrongRack, 'LRM', context)).toBeFalse();
    });
});