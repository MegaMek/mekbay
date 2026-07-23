/** Java emits zero when calculated construction mass is unavailable. */
export function isCalculableLoadoutTons(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function getOracleFieldName(calculatedField: string): string {
  return calculatedField === 'effectiveTonnage' ? 'loadoutTons' : calculatedField;
}