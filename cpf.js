import ExcelJS from "exceljs";

export const filePath = "BUI_salarios_abaixo_3205.xlsx";
export const sheetName = "QUE NÃO TEM";

export async function getWorksheet() {
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.getWorksheet(sheetName);

    if (!sheet) {
        throw new Error(`Aba "${sheetName}" não encontrada.`);
    }

    return { workbook, sheet };
}

export function isValidCpf(cpf) {
    const rawCpf = cpf === null || cpf === undefined ? "" : String(cpf).trim();
    const normalizedCpf = rawCpf.replace(/\D/g, "");

    return /^\d{11}$/.test(normalizedCpf);
}

export function validateCpfs(sheet) {
    const values = sheet.getSheetValues();
    const results = [];

    for (let i = 2; i < values.length; i++) {
        const row = values[i];

        if (!row) {
            continue;
        }

        const cpfCell = sheet.getCell(i, 2);
        const cpfValue = cpfCell.value;
        const cpf = cpfValue === null || cpfValue === undefined
            ? ""
            : String(cpfValue).trim();

        results.push({
            rowIndex: i,
            cpf,
            valid: isValidCpf(cpf)
        });
    }

    console.log(`Identificado ${results.length} registros de CPF.`);

    return results;
}

export function isCellEmpty(cell) {
    return cell.value === null ||
           cell.value === undefined ||
           cell.value === "";
}

export function addCpfValidColumn(sheet, results) {
    const headerRow = 1;
    const cpfColumn = 2;

    let cpfValidColumn = cpfColumn + 1;

    while (!isCellEmpty(sheet.getCell(headerRow, cpfValidColumn))) {
        cpfValidColumn++;
    }

    sheet.getCell(headerRow, cpfValidColumn).value = "CPF VALIDO";

    for (const result of results) {
        const cell = sheet.getCell(result.rowIndex, cpfValidColumn);

        if (isCellEmpty(cell)) {
            cell.value = result.valid ? "SIM" : "NÃO";
        }
    }

    return cpfValidColumn;
}

export function formatHeader(sheet, column) {
    const cell = sheet.getCell(1, column);

    cell.font = {
        bold: true
    };

    sheet.getColumn(column).width = String(cell.value).length + 2;
}

export function formatColumns(sheet) {
    for (let columnNumber = 1; columnNumber <= sheet.columnCount; columnNumber++) {
        const column = sheet.getColumn(columnNumber);
        let maxLength = 0;

        for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
            const value = sheet.getCell(rowNumber, columnNumber).value;
            const text = value === null || value === undefined ? "" : String(value);
            maxLength = Math.max(maxLength, ...text.split(/\r?\n/).map((line) => line.length));
        }

        const header = String(sheet.getCell(1, columnNumber).value ?? "").toLowerCase();
        const maxWidth = header.includes("observ") ? 70 : 45;
        column.width = Math.min(Math.max(maxLength + 2, 12), maxWidth);

        if (header.includes("observ")) {
            column.alignment = { wrapText: true, vertical: "top" };
        }
    }
}

await getWorksheet()