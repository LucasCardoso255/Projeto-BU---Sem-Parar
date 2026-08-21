import { obterSituacaoVT } from "../parsers/htmlParser.js";

export function debugarSituacaoVT(html) {
    const plainText = String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log("========== DEBUG SITUAÇÃO VT ==========");
    console.log("Prévia da resposta:", plainText.slice(0, 300));
    console.log("Situação identificada:", obterSituacaoVT(html));
    console.log("=======================================");
}
