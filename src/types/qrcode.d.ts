declare module 'qrcode' {
    export interface QRCodeToStringOptions {
        errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' | 'low' | 'medium' | 'quartile' | 'high';
        margin?: number;
        type?: 'utf8' | 'svg' | 'terminal';
        width?: number;
    }

    export function toString(
        text: string,
        options: QRCodeToStringOptions,
    ): Promise<string>;
}