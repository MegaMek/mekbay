export function getContentTimestamp(content: string | Buffer, encoding?: BufferEncoding): Date;

export function normalizeTreeContentTimestamps(rootPath: string): number;

export function setFileContentTimestamp(filePath: string): Date;

export function writeFileWithContentTimestamp(
    filePath: string,
    content: string | Buffer,
    options?: BufferEncoding | { encoding?: BufferEncoding },
): Date;