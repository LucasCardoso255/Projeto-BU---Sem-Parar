import ExcelJS from "exceljs";
import { isMissingStatusValue } from "../config/config.js";
import { consultarSituacaoVT } from "./vtService.js";

export const REQUIRED_SHEET_NAME = "QUE NÃO TEM";
const CPF_HEADERS = ["CPF", "CPF DO TITULAR", "CPF BENEFICIÁRIO"];

const text = value => String(value?.text ?? value?.result ?? value ?? "").trim();
const digits = value => text(value).replace(/\D/g, "");
const normalizeHeader = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

function getCpfDigits(cell) {
    const rawValue = cell.value?.result ?? cell.value;
    const cpf = digits(rawValue);
    const zeroPlaceholders = String(cell.numFmt ?? "").replace(/[^0]/g, "").length;
    const isNumericValue = typeof rawValue === "number" && Number.isInteger(rawValue);

    if (isNumericValue && zeroPlaceholders === 11 && cpf.length < 11) {
        return cpf.padStart(11, "0");
    }

    return cpf;
}

const isValidCpfCell = cell => /^\d{11}$/.test(getCpfDigits(cell));

function findColumnByHeader(sheet, headers) {
    for (let column = 1; column <= Math.max(sheet.columnCount, 1); column++) {
        if (headers.includes(normalizeHeader(sheet.getCell(1, column).value))) return column;
    }
    return null;
}

function findOrCreateColumn(sheet, header, startColumn = 1) {
    const existing = findColumnByHeader(sheet, [header]);
    if (existing) return existing;

    let column = startColumn;
    while (text(sheet.getCell(1, column).value)) column++;
    const cell = sheet.getCell(1, column);
    cell.value = header;
    cell.font = { bold: true };
    sheet.getColumn(column).width = header === "OBSERVAÇÕES" ? 55 : 24;
    return column;
}

function rowHasData(sheet, row) {
    return Array.from({ length: sheet.columnCount }, (_, index) => text(sheet.getCell(row, index + 1).value)).some(Boolean);
}

function formatDateTime() {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date());
}

export async function loadWorkbook(inputBuffer) {
    if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) throw new Error("INVALID_WORKBOOK");
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(inputBuffer);
    } catch {
        throw new Error("INVALID_WORKBOOK");
    }
    return workbook;
}

export async function validateSpreadsheet(inputBuffer) {
    try {
        const workbook = await loadWorkbook(inputBuffer);
        const sheet = workbook.getWorksheet(REQUIRED_SHEET_NAME);
        if (!sheet) return { valid: false, errors: [{ code: "MISSING_SHEET", message: `A planilha não possui a aba necessária: "${REQUIRED_SHEET_NAME}".` }], warnings: [], metadata: {} };

        const cpfColumn = findColumnByHeader(sheet, CPF_HEADERS);
        if (!cpfColumn) return { valid: false, errors: [{ code: "MISSING_CPF_COLUMN", message: "Não encontramos a coluna de CPF na planilha. Verifique se ela está identificada corretamente." }], warnings: [], metadata: {} };

        const rows = [];
        for (let row = 2; row <= sheet.rowCount; row++) {
            if (rowHasData(sheet, row)) rows.push({ row, cell: sheet.getCell(row, cpfColumn) });
        }
        if (!rows.length) return { valid: false, errors: [{ code: "NO_DATA", message: "A aba necessária não possui linhas de dados." }], warnings: [], metadata: {} };

        const warnings = rows
            .filter(({ cell }) => !isValidCpfCell(cell))
            .map(({ row, cell }) => ({
                code: "INVALID_CPF",
                row,
                message: `Linha ${row}: ${text(cell.value) ? "CPF não possui 11 dígitos" : "CPF ausente"}`
            }));
        return { valid: true, errors: [], warnings, metadata: { totalRows: rows.length, validCpfRows: rows.length - warnings.length, invalidCpfRows: warnings.length, processableRows: rows.length - warnings.length } };
    } catch {
        return { valid: false, errors: [{ code: "INVALID_WORKBOOK", message: "O arquivo enviado não parece ser uma planilha Excel válida." }], warnings: [], metadata: {} };
    }
}

export async function processSpreadsheet({ inputBuffer, onProgress = () => {}, signal }) {
    const validation = await validateSpreadsheet(inputBuffer);
    if (!validation.valid) throw new Error(validation.errors[0].message);

    const workbook = await loadWorkbook(inputBuffer);
    const sheet = workbook.getWorksheet(REQUIRED_SHEET_NAME);
    const cpfColumn = findColumnByHeader(sheet, CPF_HEADERS);
    const statusColumn = findOrCreateColumn(sheet, "STATUS VT");
    const dateColumn = findOrCreateColumn(sheet, "DATA CONSULTA BU", statusColumn + 1);
    const notesColumn = findOrCreateColumn(sheet, "OBSERVAÇÕES", dateColumn + 1);
    const targets = [];

    for (let row = 2; row <= sheet.rowCount; row++) {
        const cpfCell = sheet.getCell(row, cpfColumn);
        const cpf = getCpfDigits(cpfCell);
        if (!rowHasData(sheet, row)) continue;
        if (!isValidCpfCell(cpfCell)) {
            sheet.getCell(row, notesColumn).value = text(cpfCell.value) ? "CPF inválido: informe 11 dígitos." : "CPF ausente.";
        } else if (isMissingStatusValue(sheet.getCell(row, statusColumn).value)) {
            targets.push({ row, cpf });
        }
    }

    onProgress({ type: "progress", current: 0, total: targets.length, percent: 0, message: "Preparando consultas..." });
    let errors = validation.metadata.invalidCpfRows;

    for (let index = 0; index < targets.length; index++) {
        if (signal?.aborted) throw new Error("PROCESS_ABORTED");
        const target = targets[index];
        const result = await consultarSituacaoVT(target.cpf);
        sheet.getCell(target.row, statusColumn).value = result.status;
        sheet.getCell(target.row, dateColumn).value = formatDateTime();
        sheet.getCell(target.row, notesColumn).value = result.warning || "";
        if (result.warning) errors++;
        onProgress({ type: "progress", current: index + 1, total: targets.length, percent: targets.length ? Math.round((index + 1) / targets.length * 100) : 100, message: `Consultando registro ${index + 1} de ${targets.length}` });
    }

    const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    return { success: true, outputBuffer, filename: `planilha_processada_${timestamp}.xlsx`, summary: { totalRows: validation.metadata.totalRows, processedRows: targets.length, errors } };
}
