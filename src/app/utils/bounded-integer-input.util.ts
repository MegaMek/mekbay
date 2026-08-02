export interface BoundedIntegerOptions {
    readonly min: number;
    readonly max: number;
    readonly fallback?: number;
}

/** Converts a number-like value to an integer and clamps it to inclusive bounds. */
export function normalizeBoundedInteger(
    value: number | string | null | undefined,
    options: BoundedIntegerOptions,
): number {
    if (!Number.isFinite(options.min) || !Number.isFinite(options.max)) {
        throw new RangeError('Integer bounds must be finite');
    }

    const min = Math.ceil(options.min);
    const max = Math.floor(options.max);
    if (min > max) {
        throw new RangeError(`Invalid integer bounds: ${min} exceeds ${max}`);
    }

    const normalizedString = typeof value === 'string'
        ? value.replaceAll(',', '').trim()
        : null;
    const parsedValue = normalizedString !== null
        ? normalizedString.length > 0 ? Number(normalizedString) : Number.NaN
        : Number(value);
    const fallback = Number.isFinite(options.fallback)
        ? Number(options.fallback)
        : min;
    const resolvedValue = Number.isFinite(parsedValue) ? parsedValue : fallback;

    return Math.min(max, Math.max(min, Math.floor(resolvedValue)));
}

/** Clamps an input's value and immediately rewrites its visible text. */
export function normalizeBoundedIntegerInput(
    event: Event,
    options: BoundedIntegerOptions & { readonly emptyWhenZero?: boolean },
): number {
    const input = event.target as HTMLInputElement | null;
    const value = normalizeBoundedInteger(input?.value, options);
    if (input) {
        input.value = value === 0 && options.emptyWhenZero ? '' : `${value}`;
    }
    return value;
}
