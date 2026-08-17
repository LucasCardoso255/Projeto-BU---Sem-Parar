import ExcelJS from "exceljs";
import { identificarRespostaVT, obterSituacaoVT } from "./html.js";
import { ensureFreshSession, closeSession } from "./session.js";
import {
    filePath,
    getWorksheet,
    isCellEmpty,
    validateCpfs,
    formatHeader
} from "./cpf.js";

function normalizeCpf(cpf) {
    return String(cpf ?? "").replace(/\D/g, "");
}

function findNextColumn(sheet, startColumn) {
    let column = startColumn;

    while (!isCellEmpty(sheet.getCell(1, column))) {
        column++;
    }

    return column;
}


async function consultarSituacaoVT(cpf) {
    let sessionContext = null;

    try {
        sessionContext = await ensureFreshSession();

        const { page } = sessionContext;

        await page.goto("https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do", {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.fill('input[name="cpf"]', cpf);
        await page.click('input[name="Enviar"]');

        await page.waitForLoadState("networkidle", { timeout: 60000 });

        const html = await page.content();
        const resposta = identificarRespostaVT(html);

        if (resposta.tipo === "challenge") {
            console.warn(
                "Resposta bloqueada por challenge/Cloudflare:",
                resposta.mensagem
            );
            return resposta.mensagem;
        }

        return obterSituacaoVT(html);
    } catch (error) {
        console.warn(`Consulta falhou para CPF ${cpf}:`, error.message);
        return `Erro na consulta (${error.message})`;
    } finally {
        if (sessionContext) {
            await closeSession(sessionContext);
        }
    }
}

async function atualizarStatusNaPlanilha() {
    const { workbook, sheet } = await getWorksheet();
    const results = validateCpfs(sheet);
    const validCpfs = results.filter((result) => result.valid);

    const statusColumn = findNextColumn(sheet, 3);
    sheet.getCell(1, statusColumn).value = "STATUS VT";
    formatHeader(sheet, statusColumn);

    for (const result of validCpfs) {
        const cpf = normalizeCpf(result.cpf);
        const situacao = await consultarSituacaoVT(cpf);
        const cell = sheet.getCell(result.rowIndex, statusColumn);

        cell.value = situacao;
        console.log(`${cpf} → ${situacao}`);
    }

    await workbook.xlsx.writeFile(filePath);
    console.log("Planilha atualizada com os status do Bilhete Único.");
}

await atualizarStatusNaPlanilha();