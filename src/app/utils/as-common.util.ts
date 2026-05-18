export function formatMovement(inches: number, suffix: string = '', useHex: boolean): string {
    if (useHex) {
        return Math.floor(inches) / 2 + '<span class="hex-symbol">⬢</span>' + suffix;
    }
    return inches + '″' + suffix;
}

export function formatMovementWithAlternate(
    inches: number,
    alternateInches: number,
    suffix: string = '',
    useHex: boolean,
): string {
    if (useHex) {
        const baseHexes = Math.floor(inches) / 2;
        const alternateHexes = Math.floor(alternateInches) / 2;
        return `${baseHexes}(${alternateHexes})<span class="hex-symbol">⬢</span>${suffix}`;
    }
    return `${inches}(${alternateInches})″${suffix}`;
}

export function isAerospace(type: string, movementModes: { [mode: string]: number }): boolean {
    return type === 'AF' || type === 'CF' || type === 'DA' || type === 'DS' 
    || type === 'SC' || type === 'WS' || type === 'SS' || type === 'JS' 
    || (type === 'SV' && hasAerospaceMovementMode(movementModes));
}

export function hasAerospaceMovementMode(movementModes: { [mode: string]: number }): boolean {
    return movementModes['a'] !== undefined || movementModes['p'] !== undefined || movementModes['k'] !== undefined;
}

export function isAerospaceMovementMode(mode: string): boolean {
    return mode === 'a' || mode === 'p' || mode === 'k';
}

export function isGroundMovementMode(mode: string): boolean {
    return !isAerospaceMovementMode(mode) && mode !== 'j';
}