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

export function identificarRespostaVT(html) {
    if (!html || !String(html).trim()) {
        return { tipo: "vazia", mensagem: "Resposta vazia" };
    }

    const raw = String(html);
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
        "checking your browser"
    ];

    const challengeMatch = challengePatterns.find((pattern) => texto.includes(pattern));
    if (challengeMatch) {
        return {
            tipo: "challenge",
            mensagem: `Bloqueado pelo site (${challengeMatch})`,
            raw
        };
    }

    const hasStatus = /situacao.*bilhete.*unico|bilhete.*unico.*situacao|ativado|desativado|habilitado|desabilitado|solicitada/i.test(texto);
    if (hasStatus) {
        return { tipo: "status", mensagem: "HTML com status do Bilhete Unico", raw };
    }

    return { tipo: "desconhecida", mensagem: "Resposta nao reconhecida", raw };
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

        return "Suspenso SETRANS";
    }

    if (situacao.includes("sem") && situacao.includes("registro")) {
        return "Sem registro";
    }

    return formatarSituacao(situacao) || "Situação não identificada";
}
