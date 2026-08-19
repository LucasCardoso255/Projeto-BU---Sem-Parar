function decodeHTMLEntities(texto) {
    const entidades = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        aacute: "á",
        Aacute: "Á",
        eacute: "é",
        Eacute: "É",
        iacute: "í",
        Iacute: "Í",
        oacute: "ó",
        Oacute: "Ó",
        uacute: "ú",
        Uacute: "Ú",
        atilde: "ã",
        Atilde: "Ã",
        ccedil: "ç",
        Ccedil: "Ç",
        acirc: "â",
        ocirc: "ô",
        otilde: "õ",
        nbsp: " "
    };

    return texto.replace(/&(#x[0-9A-Fa-f]+|#\d+|[a-zA-Z]+);/g, (match, entidade) => {
        if (entidade[0] === "#") {
            const codigo = entidade[1] === "x"
                ? parseInt(entidade.slice(2), 16)
                : parseInt(entidade.slice(1), 10);
            return String.fromCharCode(codigo);
        }
        return entidades[entidade] || match;
    });
}

function normalizar(texto) {
    return decodeHTMLEntities(texto)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function normalizarSituacao(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\uFFFD/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function getRetryAfterSeconds(html, metadata, responseStatus) {
    const headers = metadata.headers || {};
    const retryAfter = headers["retry-after"] ?? headers["Retry-After"];

    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return seconds;
        }

        const retryDate = Date.parse(retryAfter);
        if (Number.isFinite(retryDate)) {
            return Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
        }
    }

    const refreshMatch = String(html).match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?(\d+)/i)
        || String(html).match(/<meta[^>]+content=["']?(\d+)[^"']*["']?[^>]+http-equiv=["']?refresh/i);
    if (refreshMatch) {
        return Number(refreshMatch[1]);
    }

    if (responseStatus === 429 || responseStatus === 503) {
        return 15 * 60;
    }

    return 10 * 60;
}

export function identificarRespostaVT(html, metadata = {}) {
    if (!html || !String(html).trim()) {
        return { tipo: "vazia", mensagem: "Resposta vazia" };
    }

    const raw = String(html);
    const responseStatus = Number(metadata.status);
    const responseHeaders = Object.entries(metadata.headers || {})
        .map(([name, value]) => `${name}: ${value}`)
        .join(" ");
    const texto = normalizar(raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
    );

    const challengePatterns = [
        "attention required",
        "cloudflare",
        "please enable cookies",
        "verify you are human",
        "cf-challenge",
        "captcha",
        "recaptcha",
        "challenge",
        "jschallenge",
        "checking your browser",
        "just a moment",
        "enable javascript and cookies",
        "challenge-platform",
        "too many requests",
        "rate limit",
        "rate_limit",
        "cf-mitigated"
    ];

    const challengeMatch = challengePatterns.find((pattern) =>
        texto.includes(pattern) || normalizar(responseHeaders).includes(pattern)
    );
    const isRateLimited = responseStatus === 429 || responseStatus === 503;
    const isCloudflareResponse = /cloudflare|cf-ray|cf-mitigated/i.test(responseHeaders);

    if (isRateLimited || isCloudflareResponse || challengeMatch) {
        const reason = isRateLimited
            ? `HTTP ${responseStatus}`
            : challengeMatch || "Cloudflare";

        return {
            tipo: "challenge",
            mensagem: `Bloqueio ou limite de consultas detectado (${reason})`,
            retryAfterSeconds: getRetryAfterSeconds(raw, metadata, responseStatus),
            raw
        };
    }

    const hasStatus = /situacao.*bilhete.*unico|bilhete.*unico.*situacao|ativado|desativado|habilitado|desabilitado|solicitada/i.test(texto);
    if (hasStatus) {
        return { tipo: "status", mensagem: "HTML com status do Bilhete Unico", raw };
    }

    return {
        tipo: "desconhecida",
        mensagem: "Resposta nao reconhecida",
        retryAfterSeconds: getRetryAfterSeconds(raw, metadata, responseStatus),
        raw
    };
}

export function obterSituacaoVT(html) {
    const texto = normalizar(html);

    const match = texto.match(
        /situacao(?:\s+atual)?(?:\s+do)?\s+bilhete\s+unico(?:\s+intermunicipal)?\s*:\s*([^<]+)/
    );

    if (!match) {
        return "Situação do Bilhete Único não encontrada";
    }

    const situacaoOriginal = match[1].trim();
    const situacao = normalizarSituacao(situacaoOriginal);

    if (situacao.includes("desativado")) {
        return "Desativado";
    }

    if (/ativ.*solicitada/.test(situacao) || situacao.includes("solicitada")) {
        return "Ativação solicitada";
    }

    if (/\bativado\b/.test(situacao)) {
        return "Ativado";
    }

    if (situacao.includes("invalido")) {
        return "Inválido";
    }

    if (
        (situacao.includes("no") && situacao.includes("possui") && situacao.includes("bu")) ||
        situacao.includes("nao possui bu")
    ) {
        return "Não possui BU";
    }

    if (situacao.includes("suspenso setrans motivo")) {
        const matchMotivo = situacao.match(/suspenso\s+setrans\s+motivo\s+(\d+)/);

        if (matchMotivo) {
            return `Suspenso SETRANS Motivo ${matchMotivo[1]}`;
        }

        return `Suspenso SETRANS ${matchMotivo[1]}`;
    }

    if (situacao.includes("sem") && situacao.includes("registro")) {
        return "Sem registro";
    }

    return formatarSituacao(situacao) || "Situação não identificada";
}