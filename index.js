import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { identificarRespostaVT, obterSituacaoVT } from "./html.js";
import { appConfig, enableDebugMode, getDebugDir, isDebugEnabled, isMissingStatusValue, shouldProcessOnlyMissingStatus } from "./config.js";
import {
    ensureFreshSession,
    getRequestConfigForSession,
    getSessionPayload
} from "./session.js";
import {
    filePath,
    getWorksheet,
    isCellEmpty,
    validateCpfs,
    formatHeader,
    formatColumns
} from "./cpf.js";

async function saveHttpResponseDebug(cpf, responseText, extra = {}) {
    if (!isDebugEnabled()) {
        return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeCpf = String(cpf ?? "unknown").replace(/\D/g, "") || "unknown";
    const outputDir = path.resolve(getDebugDir());
    await fs.mkdir(outputDir, { recursive: true });

    const payload = [
        "<!DOCTYPE html>",
        "<html><head><meta charset=\"utf-8\" /><title>VT Debug Response</title></head><body>",
        `<pre style="white-space: pre-wrap; word-break: break-word;">`,
        JSON.stringify({
            cpf: safeCpf,
            timestamp,
            url: extra.url || "",
            status: extra.status ?? null,
            statusText: extra.statusText ?? "",
            headers: extra.headers || {},
            response: responseText
        }, null, 2),
        `</pre>`,
        "</body></html>"
    ].join("\n");

    const filePathDebug = path.join(outputDir, `vt-response-${safeCpf}-${timestamp}.html`);
    await fs.writeFile(filePathDebug, payload, "utf-8");
    console.log(`[DEBUG] Resposta HTTP salva em: ${filePathDebug}`);
    return filePathDebug;
}

function normalizeCpf(cpf) {
    return String(cpf ?? "").replace(/\D/g, "");
}

function getHeaderValue(cell) {
    if (cell === null || cell === undefined) {
        return "";
    }

    const value = cell.value;
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim().toLowerCase();
}

function findNextColumn(sheet, startColumn) {
    let column = startColumn;

    while (!isCellEmpty(sheet.getCell(1, column))) {
        column++;
    }

    return column;
}

function findOrCreateColumn(sheet, headerText, startColumn = 3) {
    for (let column = startColumn; column <= 200; column++) {
        if (getHeaderValue(sheet.getCell(1, column)) === headerText.toLowerCase()) {
            return column;
        }
    }

    const nextColumn = findNextColumn(sheet, startColumn);
    sheet.getCell(1, nextColumn).value = headerText;
    formatHeader(sheet, nextColumn);
    return nextColumn;
}

function formatDateTime(value = new Date()) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(date);
}

function formatRetryTime(seconds) {
    const retryAt = new Date(Date.now() + Math.max(0, Number(seconds) || 0) * 1000);
    return formatDateTime(retryAt);
}

function getCloudflareWarningMessage(message = "", metadata = {}) {
    const text = `${String(message || "")} ${metadata.statusText || ""} ${JSON.stringify(metadata.headers || {})}`.toLowerCase();

    if (/attention required|cloudflare|403|forbidden|429|too many requests|rate.?limit|challenge|cf-ray|cf-mitigated/.test(text)) {
        const retryAfterSeconds = Number(metadata.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
            return `Bloqueio ou limite de consultas pela Cloudflare detectado. Tente novamente após ${Math.ceil(retryAfterSeconds / 60)} minutos (a partir de ${formatRetryTime(retryAfterSeconds)}).`;
        }

        return "Bloqueio ou limite de consultas pela Cloudflare detectado. Aguarde alguns minutos e tente novamente.";
    }

    return "Erro na consulta. Aguarde alguns minutos e tente novamente.";
}

async function consultarSituacaoVT(cpf, sessionPayload = null) {
    const payload = sessionPayload ?? await getSessionPayload();

    if (!payload) {
        throw new Error("Sessão VT não encontrada. Gere a sessão do navegador antes das consultas por request.");
    }

    const endpoint = "https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do";
    const requestConfig = getRequestConfigForSession(payload);
    const formData = new URLSearchParams({ cpf });

    try {
        await fetch(endpoint, {
            method: "GET",
            headers: requestConfig.headers,
            redirect: "manual",
            credentials: "include"
        });

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                ...requestConfig.headers,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
            body: formData.toString(),
            redirect: "manual",
            credentials: "include"
        });

        const html = await response.text();

        if (isDebugEnabled()) {
            await saveHttpResponseDebug(cpf, html, {
                url: endpoint,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries())
            });
        }

        const responseMetadata = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
        };
        const resposta = identificarRespostaVT(html, responseMetadata);

        if (resposta.tipo === "challenge") {
            const warning = getCloudflareWarningMessage(resposta.mensagem, {
                ...responseMetadata,
                retryAfterSeconds: resposta.retryAfterSeconds
            });
            console.warn(
                "Resposta bloqueada por challenge/Cloudflare:",
                resposta.mensagem
            );
            return {
                status: "Bloqueado pela Cloudflare",
                warning,
                blocked: true
            };
        }

        const status = obterSituacaoVT(html);
        if (status === "Situação do Bilhete Único não encontrada") {
            const retryAfterSeconds = Number(resposta.retryAfterSeconds) || 10 * 60;
            return {
                status: "Resposta não reconhecida",
                warning: `Resposta do site não reconhecida; pode ser bloqueio ou limite de consultas. Tente novamente após ${Math.ceil(retryAfterSeconds / 60)} minutos (a partir de ${formatRetryTime(retryAfterSeconds)}). Consulte o arquivo de debug.`,
                blocked: true
            };
        }

        return {
            status,
            warning: "",
            blocked: false
        };
    } catch (error) {
        const warning = getCloudflareWarningMessage(error?.message || "");
        console.warn(`Consulta falhou para CPF ${cpf}:`, error.message);
        return {
            status: "Erro na consulta",
            warning,
            blocked: true
        };
    }
}

function getColumnByHeader(sheet, candidates = []) {
    for (let column = 1; column <= 200; column++) {
        const cellValue = sheet.getCell(1, column).value;
        const normalized = String(cellValue ?? "").trim().toLowerCase();
        if (candidates.some((candidate) => normalized === candidate.toLowerCase())) {
            return column;
        }
    }
    return null;
}

function getCpfRowsToProcess(sheet) {
    const values = sheet.getSheetValues();
    const rows = [];
    const statusColumn = getColumnByHeader(sheet, appConfig.execution.statusHeaders) ?? 3;

    for (let i = 2; i < values.length; i++) {
        const row = values[i];
        if (!row) {
            continue;
        }

        const cpfCell = sheet.getCell(i, 2);
        const cpfValue = cpfCell.value;
        const cpf = cpfValue === null || cpfValue === undefined ? "" : String(cpfValue).trim();

        if (!cpf) {
            continue;
        }

        const statusValue = sheet.getCell(i, statusColumn).value;
        const shouldSkip = !shouldProcessOnlyMissingStatus() || !isMissingStatusValue(statusValue);
        if (shouldSkip) {
            continue;
        }

        rows.push({ rowIndex: i, cpf });
    }

    return rows;
}

async function atualizarStatusNaPlanilha() {
    const { workbook, sheet } = await getWorksheet();
    const results = validateCpfs(sheet);
    const statusColumn = getColumnByHeader(sheet, appConfig.execution.statusHeaders) ?? findOrCreateColumn(sheet, "STATUS VT", 3);
    const dataColumn = findOrCreateColumn(sheet, "DATA CONSULTA BU", statusColumn + 1);
    const avisoColumn = findOrCreateColumn(sheet, "OBSERVAÇÕES", dataColumn + 1);
    const targetRows = shouldProcessOnlyMissingStatus()
        ? getCpfRowsToProcess(sheet)
        : results.filter((result) => result.valid);

    formatColumns(sheet);
    await workbook.xlsx.writeFile(filePath);

    const sessionPayload = await ensureFreshSession().then((info) => info.session ?? getSessionPayload());

    if (!sessionPayload) {
        throw new Error("Não foi possível carregar a sessão VT para as consultas por request.");
    }

    for (const result of targetRows) {
        const cpf = normalizeCpf(result.cpf);
        const agora = formatDateTime(new Date());
        const consulta = await consultarSituacaoVT(cpf, sessionPayload);
        const statusCell = sheet.getCell(result.rowIndex, statusColumn);
        const dataCell = sheet.getCell(result.rowIndex, dataColumn);
        const avisoCell = sheet.getCell(result.rowIndex, avisoColumn);

        statusCell.value = consulta.status;
        dataCell.value = agora;
        avisoCell.value = consulta.warning || "";
        formatColumns(sheet);
        await workbook.xlsx.writeFile(filePath);

        console.log(`${cpf} → ${consulta.status}`);
        if (consulta.warning) {
            console.warn(`CPF ${cpf}: ${consulta.warning}`);
        }
    }
}

enableDebugMode(false);
await atualizarStatusNaPlanilha();