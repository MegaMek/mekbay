export function formatMovement(inches: number, suffix: string = '', useHex: boolean): string {
    if (useHex) {
        return Math.floor(inches / 2) + '<span class="hex-symbol">⬢</span>' + suffix;
    }
    return inches + '″' + suffix;
}