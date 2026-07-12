import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { AtmHandler } from './atm.handler';

function owner() {
    return { setInventoryEntry: jasmine.createSpy('setInventoryEntry'), rules: { computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 }) } } as never;
}

function weapon(): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: 'atm', name: 'ATM 6', equipment: new WeaponEquipment({ id: 'ATM6', name: 'ATM 6', type: 'weapon', weapon: { ammoType: 'ATM', rackSize: 6 } }) });
}

function svgEntry(html: string): SVGElement {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as SVGElement;
}

function weaponWithSvgMode(mode: string): MountedEquipment {
    const entry = weapon();
    entry.el = svgEntry(`
        <g class="inventoryEntry">
            <g class="alternativeMode${mode === 'Standard' ? ' selected' : ''}" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g></g>
            <g class="alternativeMode${mode === 'High Explosive' ? ' selected' : ''}" mode="High Explosive"><g class="name"><text>High Explosive</text></g><g class="damage"><text>3/Msl</text></g></g>
            <g class="alternativeMode${mode === 'Extended Range' ? ' selected' : ''}" mode="Extended Range"><g class="name"><text>Extended Range</text></g><g class="damage"><text>1/Msl</text></g></g>
        </g>
    `);
    entry.states.set('inventory_control_mode', mode);
    return entry;
}

function ammo(id: string, munitionType: string): AmmoEquipment {
    return new AmmoEquipment({ id, name: id, shortName: id, type: 'ammo', ammo: { type: 'ATM', rackSize: 6, shots: 10, munitionType: [munitionType] } });
}

describe('AtmHandler', () => {
    const handler = new AtmHandler();
    const context = {} as HandlerContext;

    it('does not duplicate SVG-owned mode picker choices', () => {
        expect(handler.getChoices(weapon(), context)).toEqual([]);
    });

    it('filters ATM ammo by selected mode munition type', () => {
        const atm = weapon();

        expect(handler.matchesInventoryAmmo(atm, ammo('std', 'M_STANDARD'), 'Standard', context)).toBeTrue();
        expect(handler.matchesInventoryAmmo(atm, ammo('he', 'M_HIGH_EXPLOSIVE'), 'Standard', context)).toBeFalse();
        expect(handler.matchesInventoryAmmo(atm, ammo('er', 'M_EXTENDED_RANGE'), 'Extended Range', context)).toBeTrue();
    });

    it('uses the selected SVG mode when no mode is supplied', () => {
        const atm = weaponWithSvgMode('High Explosive');

        expect(handler.matchesInventoryAmmo(atm, ammo('he', 'M_HIGH_EXPLOSIVE'), null, context)).toBeTrue();
        expect(handler.matchesInventoryAmmo(atm, ammo('std', 'M_STANDARD'), null, context)).toBeFalse();
    });
});