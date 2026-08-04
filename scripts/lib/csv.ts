export interface CsvRow {
    readonly cells: string[];
    readonly rowNumber: number;
}

/** Parses RFC-4180-style CSV while preserving physical source row numbers. */
export function parseCsv(content: string): CsvRow[] {
    const input = content.replace(/^\uFEFF/u, '');
    const rows: CsvRow[] = [];
    let cells: string[] = [];
    let cell = '';
    let inQuotes = false;
    let quotedCellClosed = false;
    let rowNumber = 1;
    let rowStart = 1;

    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];

        if (inQuotes) {
            if (character === '"') {
                if (input[index + 1] === '"') {
                    cell += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                    quotedCellClosed = true;
                }
            } else {
                cell += character;
                if (character === '\n') {
                    rowNumber += 1;
                }
            }
            continue;
        }

        if (quotedCellClosed && character !== ',' && character !== '\r' && character !== '\n') {
            throw new Error(`CSV row ${rowNumber} contains '${character}' after a closing quote.`);
        }

        if (character === '"') {
            if (cell.length > 0) {
                throw new Error(`CSV row ${rowNumber} contains a quote inside an unquoted value.`);
            }
            inQuotes = true;
            quotedCellClosed = false;
        } else if (character === ',') {
            cells.push(cell);
            cell = '';
            quotedCellClosed = false;
        } else if (character === '\r' || character === '\n') {
            if (character === '\r' && input[index + 1] === '\n') {
                index += 1;
            }
            cells.push(cell);
            rows.push({ cells, rowNumber: rowStart });
            cells = [];
            cell = '';
            quotedCellClosed = false;
            rowNumber += 1;
            rowStart = rowNumber;
        } else {
            cell += character;
        }
    }

    if (inQuotes) {
        throw new Error(`CSV ended inside a quoted value beginning on row ${rowStart}.`);
    }
    if (cell.length > 0 || cells.length > 0) {
        cells.push(cell);
        rows.push({ cells, rowNumber: rowStart });
    }

    return rows;
}

export function parseCsvRows(content: string): string[][] {
    return parseCsv(content)
        .map(({ cells }) => cells)
        .filter((cells) => cells.some((value) => value.trim().length > 0));
}

export function requireCsvHeader(actual: readonly string[], expected: readonly string[], filePath: string): void {
    if (actual.length !== expected.length || actual.some((value, index) => value.trim() !== expected[index])) {
        throw new Error(`${filePath}:1 has an unexpected CSV header. Expected: ${expected.join(',')}`);
    }
}

export function requireCsvColumnCount(row: CsvRow, expected: number, filePath: string): void {
    if (row.cells.length !== expected) {
        throw new Error(`${filePath}:${row.rowNumber} has ${row.cells.length} columns; expected ${expected}.`);
    }
}