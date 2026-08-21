import { identificarRespostaVT, obterSituacaoVT } from "../parsers/htmlParser.js";
import { ensureFreshSession, getRequestConfigForSession, getSessionPayload } from "./sessionService.js";

function warningFor(message = "") {
    return /attention required|cloudflare|403|forbidden/i.test(message)
        ? "O serviço de consulta bloqueou temporariamente novas solicitações. Aguarde alguns minutos antes de tentar novamente."
        : "Não foi possível consultar este registro. Tente novamente mais tarde.";
}

export async function consultarSituacaoVT(cpf) {
    try {
        const info = await ensureFreshSession();
        const session = info.session ?? await getSessionPayload();
        if (!session) throw new Error("SESSION_UNAVAILABLE");

        const endpoint = "https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do";
        const request = getRequestConfigForSession(session);
        await fetch(endpoint, { method: "GET", headers: request.headers, redirect: "manual" });
        const response = await fetch(endpoint, { method: "POST", headers: { ...request.headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: new URLSearchParams({ cpf }).toString(), redirect: "manual" });
        const html = await response.text();
        const parsed = identificarRespostaVT(html);

        if (parsed.tipo === "challenge") return { status: "Bloqueado pela Cloudflare", warning: warningFor(parsed.mensagem) };
        return { status: obterSituacaoVT(html), warning: "" };
    } catch (error) {
        console.error("[ERROR] Falha na consulta VT", error?.message);
        return { status: "Erro na consulta", warning: warningFor(error?.message) };
    }
}
