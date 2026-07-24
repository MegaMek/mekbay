import { Equipment, EquipmentMap } from './equipment.model';

function normalizeEquipmentLookupKey(name: string): string {
    return name.trim().toLowerCase();
}

/** Canonical equipment collection with an inseparable internal-name and alias index. */
export class EquipmentRegistry {
    readonly equipment: EquipmentMap;
    readonly #internalNames = new Map<string, Equipment>();
    readonly #aliases = new Map<string, Equipment>();
    readonly #variants = new Map<string, Equipment[]>();

    constructor(equipment: EquipmentMap) {
        this.equipment = Object.freeze({ ...equipment });

        for (const [internalName, item] of Object.entries(this.equipment)) {
            const key = normalizeEquipmentLookupKey(internalName);
            if (!this.#internalNames.has(key)) this.#internalNames.set(key, item);
            this.addVariant(key, item);
        }

        for (const item of Object.values(this.equipment)) {
            for (const alias of item.aliases ?? []) {
                const key = normalizeEquipmentLookupKey(alias);
                this.#aliases.set(key, item);
                this.addVariant(key, item);
            }
        }
    }

    get size(): number {
        return Object.keys(this.equipment).length;
    }

    get lookupKeyCount(): number {
        return new Set([...this.#internalNames.keys(), ...this.#aliases.keys()]).size;
    }

    find(name: string): Equipment | null {
        if (!name) return null;
        const exact = this.equipment[name];
        if (exact) return exact;

        const key = normalizeEquipmentLookupKey(name);
        return this.#internalNames.get(key) ?? this.#aliases.get(key) ?? null;
    }

    findForTechBase(name: string, techBase: 'IS' | 'Clan'): Equipment | null {
        if (!name) return null;
        const exact = this.equipment[name];
        if (exact) return exact;
        const key = normalizeEquipmentLookupKey(name);
        const internalName = this.#internalNames.get(key);
        if (internalName) return internalName;
        const variants = this.#variants.get(key) ?? [];
        return variants.find(item => item.techBase === techBase)
            ?? variants.find(item => item.techBase === 'All')
            ?? this.find(name);
    }

    private addVariant(key: string, item: Equipment): void {
        const variants = this.#variants.get(key) ?? [];
        if (!variants.includes(item)) this.#variants.set(key, [...variants, item]);
    }
}

export const EMPTY_EQUIPMENT_REGISTRY = new EquipmentRegistry({});