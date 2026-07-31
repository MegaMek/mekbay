export interface EntityCostAmountStep {
  readonly type: string;
  readonly amount: number;
  readonly subtotal: number;
  readonly factor?: never;
}

export interface EntityCostFactorStep {
  readonly type: string;
  readonly factor: number;
  readonly subtotal: number;
  readonly amount?: never;
}

export type EntityCostStep = EntityCostAmountStep | EntityCostFactorStep;

export interface EntityCostReport {
  readonly steps: readonly EntityCostStep[];
  readonly total: number;
}

export type EntityCostEntry = Readonly<
  { type: string; amount: number; factor?: never }
  | { type: string; factor: number; amount?: never }
>;

/** Applies report entries in MegaMek order: amounts add and factors multiply. */
export function buildCostReport(
  entries: readonly EntityCostEntry[],
  roundTotal = false,
): EntityCostReport {
  let subtotal = 0;
  const steps = entries.map((entry): EntityCostStep => {
    if (entry.amount !== undefined) {
      subtotal += entry.amount;
      return { type: entry.type, amount: entry.amount, subtotal };
    }
    subtotal *= entry.factor;
    return { type: entry.type, factor: entry.factor, subtotal };
  });
  return { steps, total: roundTotal ? Math.round(subtotal) : subtotal };
}

export function amount(type: string, value: number): EntityCostEntry {
  return { type, amount: value };
}

export function multiplier(type: string, value: number, active = true): EntityCostEntry {
  return active ? { type, factor: value } : { type, amount: 0 };
}