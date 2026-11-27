// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** A Map-shaped read contract whose mutable storage never escapes. */
export class ImmutableIndex<K, V> implements ReadonlyMap<K, V> {
    readonly #values: Map<K, V>;

    public constructor(entries: Iterable<readonly [K, V]>) {
        this.#values = new Map(entries);
        Object.freeze(this);
    }

    public get size(): number { return this.#values.size; }
    public get(key: K): V | undefined { return this.#values.get(key); }
    public has(key: K): boolean { return this.#values.has(key); }
    public entries(): MapIterator<[K, V]> { return this.#values.entries(); }
    public keys(): MapIterator<K> { return this.#values.keys(); }
    public values(): MapIterator<V> { return this.#values.values(); }
    public forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
        for (const [key, value] of this.#values) callbackfn.call(thisArg, value, key, this);
    }
    public [Symbol.iterator](): MapIterator<[K, V]> { return this.#values[Symbol.iterator](); }
    public get [Symbol.toStringTag](): string { return 'ImmutableIndex'; }
}

/** A Set-shaped read contract whose mutable storage never escapes. */
export class ImmutableSet<T> implements ReadonlySet<T> {
    readonly #values: Set<T>;

    public constructor(values: Iterable<T>) {
        this.#values = new Set(values);
        Object.freeze(this);
    }

    public get size(): number { return this.#values.size; }
    public has(value: T): boolean { return this.#values.has(value); }
    public entries(): SetIterator<[T, T]> { return this.#values.entries(); }
    public keys(): SetIterator<T> { return this.#values.keys(); }
    public values(): SetIterator<T> { return this.#values.values(); }
    public forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
        for (const value of this.#values) callbackfn.call(thisArg, value, value, this);
    }
    public [Symbol.iterator](): SetIterator<T> { return this.#values[Symbol.iterator](); }
    public get [Symbol.toStringTag](): string { return 'ImmutableSet'; }
}
