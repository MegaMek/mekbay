/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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

        if (!this.isPlainObject(input)) {
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
                    result[key] = sanitizedValue;
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
        if (!this.isPlainObject(input)) return {};

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

    private static validateValue(value: unknown, rule: Rule, options: SanitizeOptions): any {
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
                return rule.values.includes(value as any) ? value : rule.default ?? rule.values[0];
            case 'date':
                const date = value instanceof Date ? value : new Date(value as any);
                return isNaN(date.getTime()) ? (rule.default ?? new Date()) : date;
            case 'any':
                return value;
            default:
                return (rule as any).default;
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

    private static isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    enum<K extends keyof T>(key: K, values: readonly any[], defaultValue?: any): this {
        this._rules[key] = { kind: 'enum', values, default: defaultValue } as Rule;
        return this;
    }

    date<K extends keyof T>(key: K, defaultValue?: Date): this {
        this._rules[key] = { kind: 'date', default: defaultValue } as Rule;
        return this;
    }

    any<K extends keyof T>(key: K, defaultValue?: any): this {
        this._rules[key] = { kind: 'any', default: defaultValue } as Rule;
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
        const result: any = {};
        for (const [key, rule] of Object.entries(this._rules) as Array<[keyof T, Rule]>) {
            if (rule.default !== undefined) {
                result[key] = rule.default;
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

type Rule = StringRule | NumberRule | BooleanRule | ObjectRule | ArrayRule | RecordRule | EnumRule | DateRule | AnyRule;

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
    schema?: Schema<any>;
    default?: any;
}

interface ArrayRule {
    kind: 'array';
    itemSchema?: Schema<any>;
    default?: any[];
    minLength?: number;
    maxLength?: number;
}

interface RecordRule {
    kind: 'record';
    valueSchema?: Schema<any>;
    default?: Record<string, any>;
}

interface EnumRule {
    kind: 'enum';
    values: readonly any[];
    default?: any;
}

interface DateRule {
    kind: 'date';
    default?: Date;
}

interface AnyRule {
    kind: 'any';
    default?: any;
}

export class SanitizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SanitizationError';
    }
}