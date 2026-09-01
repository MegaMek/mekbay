// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { isRecord } from './json-value.util';

/**
 * Type-safe sanitizer with automatic type inference from interfaces
 */
export class Sanitizer {
    /**
     * Create a schema builder for type-safe sanitization
     */
    static schema<T extends object>(): SchemaBuilder<T> {
        return new SchemaBuilder<T>();
    }

    /**
     * Sanitize a single object against a schema
     */
    static sanitize<T extends object>(
        input: unknown,
        schema: Schema<T>,
        options: SanitizeOptions = {}
    ): T {
        const { strict = false, removeNulls = true } = options;

        if (!isRecord(input)) {
            if (strict) {
                throw new SanitizationError('Input must be a plain object');
            }
            return schema._createDefault();
        }

        const result: Partial<T> = {};

        for (const [key, rule] of Object.entries(schema._rules) as Array<[keyof T, Rule]>) {
            const rawValue = (input as Record<string, unknown>)[key as string];

            try {
                const sanitizedValue = this.validateValue(rawValue, rule, options);
                
                if (removeNulls && (sanitizedValue === null || sanitizedValue === undefined)) {
                    continue;
                }

                if (sanitizedValue !== undefined) {
                    // The schema owns the key/value pairing; iteration erases that
                    // correlation while interpreting heterogeneous rules.
                    result[key] = sanitizedValue as T[keyof T];
                }
            } catch (error) {
                if (strict) {
                    throw new SanitizationError(
                        `Failed to sanitize property '${String(key)}': ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
                if (rule.default !== undefined) {
                    result[key] = rule.default as T[keyof T];
                }
            }
        }

        return result as T;
    }

    /**
     * Sanitize an array of objects
     */
    static sanitizeArray<T extends object>(
        input: unknown,
        schema: Schema<T>,
        options: SanitizeOptions = {}
    ): T[] {
        if (!Array.isArray(input)) return [];
        
        return input
            .map((item, index) => {
                try {
                    return this.sanitize(item, schema, options);
                } catch (error) {
                    if (options.strict) {
                        throw new SanitizationError(
                            `Failed to sanitize array item at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`
                        );
                    }
                    return null;
                }
            })
            .filter((item): item is T => item !== null && Object.keys(item).length > 0);
    }

    /**
     * Sanitize a record/dictionary object
     */
    static sanitizeRecord<T extends object>(
        input: unknown,
        valueSchema: Schema<T>,
        options: SanitizeOptions = {}
    ): Record<string, T> {
        if (!isRecord(input)) return {};

        const result: Record<string, T> = {};

        for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
            try {
                const sanitized = this.sanitize(value, valueSchema, options);
                if (Object.keys(sanitized).length > 0) {
                    result[key] = sanitized;
                }
            } catch (error) {
                if (options.strict) {
                    throw new SanitizationError(
                        `Failed to sanitize record value at key '${key}': ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        }

        return result;
    }

    private static validateValue(value: unknown, rule: Rule, options: SanitizeOptions): unknown {
        if (value === undefined || value === null) {
            return rule.default;
        }

        switch (rule.kind) {
            case 'string':
                return this.validateString(value, rule, options);
            case 'number':
                return this.validateNumber(value, rule, options);
            case 'boolean':
                return this.validateBoolean(value, rule);
            case 'object':
                return rule.schema ? this.sanitize(value, rule.schema, options) : (rule.default ?? {});
            case 'array':
                return rule.itemSchema ? this.sanitizeArray(value, rule.itemSchema, options) : (Array.isArray(value) ? value : []);
            case 'record':
                return rule.valueSchema ? this.sanitizeRecord(value, rule.valueSchema, options) : (rule.default ?? {});
            case 'enum':
                return rule.values.some(candidate => Object.is(candidate, value))
                    ? value
                    : rule.default ?? rule.values[0];
            case 'date':
                if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
                    return rule.default ?? new Date();
                }
                const date = value instanceof Date ? value : new Date(value);
                return isNaN(date.getTime()) ? (rule.default ?? new Date()) : date;
            case 'custom':
                try {
                    return rule.validate(value, options);
                } catch (e) {
                    return rule.default;
                }
            case 'any':
                return value;
        }
    }

    private static validateString(value: unknown, rule: StringRule, options: SanitizeOptions): string {
        if (typeof value !== 'string') {
            if (options.strict) throw new SanitizationError(`Expected string, got ${typeof value}`);
            return rule.default ?? '';
        }

        let result = value;
        if (rule.trim) result = result.trim();
        if (rule.lowercase) result = result.toLowerCase();
        if (rule.uppercase) result = result.toUpperCase();
        
        if (rule.minLength !== undefined && result.length < rule.minLength) {
            if (options.strict) throw new SanitizationError(`String length ${result.length} is less than minimum ${rule.minLength}`);
            return rule.default ?? '';
        }
        
        if (rule.maxLength !== undefined && result.length > rule.maxLength) {
            if (options.strict) throw new SanitizationError(`String length ${result.length} exceeds maximum ${rule.maxLength}`);
            result = result.substring(0, rule.maxLength);
        }
        
        if (rule.pattern && !rule.pattern.test(result)) {
            if (options.strict) throw new SanitizationError(`String does not match pattern`);
            return rule.default ?? '';
        }

        return result;
    }

    private static validateNumber(value: unknown, rule: NumberRule, options: SanitizeOptions): number {
        const num = typeof value === 'number' ? value : Number(value);
        
        if (!Number.isFinite(num)) {
            if (options.strict) throw new SanitizationError(`Expected finite number, got ${value}`);
            return rule.default ?? 0;
        }

        if (rule.min !== undefined && num < rule.min) {
            if (options.strict) throw new SanitizationError(`Number ${num} is less than minimum ${rule.min}`);
            return rule.min;
        }

        if (rule.max !== undefined && num > rule.max) {
            if (options.strict) throw new SanitizationError(`Number ${num} exceeds maximum ${rule.max}`);
            return rule.max;
        }

        if (rule.integer && !Number.isInteger(num)) {
            if (options.strict) throw new SanitizationError(`Expected integer, got ${num}`);
            return Math.round(num);
        }

        return num;
    }

    private static validateBoolean(value: unknown, rule: BooleanRule): boolean {
        return typeof value === 'boolean' ? value : (rule.default ?? false);
    }

}

// Schema Builder for fluent API
export class SchemaBuilder<T extends object> {
    _rules: Partial<Record<keyof T, Rule>> = {};

    string<K extends keyof T>(key: K, opts?: Partial<StringRule>): this {
        this._rules[key] = { kind: 'string', ...opts } as Rule;
        return this;
    }

    number<K extends keyof T>(key: K, opts?: Partial<NumberRule>): this {
        this._rules[key] = { kind: 'number', ...opts } as Rule;
        return this;
    }

    boolean<K extends keyof T>(key: K, opts?: Partial<BooleanRule>): this {
        this._rules[key] = { kind: 'boolean', ...opts } as Rule;
        return this;
    }

    object<K extends keyof T, U extends object>(key: K, schema?: Schema<U>, defaultValue?: U): this {
        this._rules[key] = { kind: 'object', schema, default: defaultValue } as Rule;
        return this;
    }

    array<K extends keyof T, U extends object>(key: K, itemSchema?: Schema<U>, opts?: Partial<ArrayRule>): this {
        this._rules[key] = { kind: 'array', itemSchema, ...opts } as Rule;
        return this;
    }

    record<K extends keyof T, U extends object>(key: K, valueSchema?: Schema<U>, defaultValue?: Record<string, U>): this {
        this._rules[key] = { kind: 'record', valueSchema, default: defaultValue } as Rule;
        return this;
    }

    enum<K extends keyof T>(key: K, values: readonly T[K][], defaultValue?: T[K]): this {
        this._rules[key] = { kind: 'enum', values, default: defaultValue } as Rule;
        return this;
    }

    date<K extends keyof T>(key: K, defaultValue?: Date): this {
        this._rules[key] = { kind: 'date', default: defaultValue } as Rule;
        return this;
    }

    any<K extends keyof T>(key: K, defaultValue?: T[K]): this {
        this._rules[key] = { kind: 'any', default: defaultValue } as Rule;
        return this;
    }

    custom<K extends keyof T>(key: K, validator: (value: unknown, options: SanitizeOptions) => T[K], opts?: { default?: T[K] }): this {
        this._rules[key] = { kind: 'custom', validate: validator, default: opts?.default } as Rule;
        return this;
    }

    build(): Schema<T> {
        return new Schema(this._rules as Record<keyof T, Rule>);
    }
}

export class Schema<T extends object> {
    _rules: Record<keyof T, Rule>;

    constructor(rules: Record<keyof T, Rule>) {
        this._rules = rules;
    }

    _createDefault(): T {
        const result: Partial<T> = {};
        for (const [key, rule] of Object.entries(this._rules) as Array<[keyof T, Rule]>) {
            if (rule.default !== undefined) {
                result[key] = rule.default as T[keyof T];
            }
        }
        return result as T;
    }
}

// Type definitions
export interface SanitizeOptions {
    strict?: boolean;
    removeNulls?: boolean;
}

type Rule = StringRule | NumberRule | BooleanRule | ObjectRule | ArrayRule | RecordRule | EnumRule | DateRule | AnyRule | CustomRule;

interface StringRule {
    kind: 'string';
    default?: string;
    trim?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
}

interface NumberRule {
    kind: 'number';
    default?: number;
    min?: number;
    max?: number;
    integer?: boolean;
}

interface BooleanRule {
    kind: 'boolean';
    default?: boolean;
}

interface ObjectRule {
    kind: 'object';
    schema?: Schema<object>;
    default?: unknown;
}

interface ArrayRule {
    kind: 'array';
    itemSchema?: Schema<object>;
    default?: unknown[];
    minLength?: number;
    maxLength?: number;
}

interface RecordRule {
    kind: 'record';
    valueSchema?: Schema<object>;
    default?: Record<string, unknown>;
}

interface EnumRule {
    kind: 'enum';
    values: readonly unknown[];
    default?: unknown;
}

interface DateRule {
    kind: 'date';
    default?: Date;
}

interface AnyRule {
    kind: 'any';
    default?: unknown;
}

interface CustomRule {
    kind: 'custom';
    validate: (value: unknown, options: SanitizeOptions) => unknown;
    default?: unknown;
}

export class SanitizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SanitizationError';
    }
}
