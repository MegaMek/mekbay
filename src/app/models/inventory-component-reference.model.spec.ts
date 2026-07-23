import { parseInventoryComponentReference } from './inventory-component-reference.model';

describe('parseInventoryComponentReference', () => {
    it('parses component and optional bin indexes', () => {
        expect(parseInventoryComponentReference('Ammo@RT#3')).toEqual({ componentIndex: 3, binIndex: null });
        expect(parseInventoryComponentReference('Ammo@RT#3.2')).toEqual({ componentIndex: 3, binIndex: 2 });
    });

    it('rejects malformed and negative component references', () => {
        expect(parseInventoryComponentReference('Ammo@RT')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@RT#-1.0')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@RT#3.-1')).toBeNull();
        expect(parseInventoryComponentReference('Ammo@RT#three.0')).toBeNull();
    });
});