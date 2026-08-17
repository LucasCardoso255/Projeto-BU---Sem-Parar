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
        return {
            tipo: "vazia",
            mensagem: "Resposta vazia"
        };
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
        return {
            tipo: "status",
            mensagem: "HTML com status do Bilhete Único",
            raw
        };
    }

    return {
        tipo: "desconhecida",
        mensagem: "Resposta não reconhecida",
        raw
    };
}

export function obterSituacaoVT(html) {
    if (!html) {
        return "Resposta vazia";
    }

    const resposta = identificarRespostaVT(html);

    if (resposta.tipo === "challenge") {
        return resposta.mensagem;
    }

    if (resposta.tipo === "vazia") {
        return resposta.mensagem;
    }

    const texto = normalizar(html);

    const padroes = [
        /situacao(?:\s+atual)?(?:\s+do)?\s+bilhete\s+unico(?:\s+intermunicipal)?\s*[:\-]?\s*([^<]+)/i,
        /(?:situacao|status)(?:\s+atual)?(?:\s+do|\s+de)?\s+bilhete\s+unico(?:\s+intermunicipal)?\s*[:\-]?\s*([^<]+)/i,
        /bilhete\s+unico(?:\s+intermunicipal)?(?:\s+do|\s+de)?\s*(?:situacao|status)\s*[:\-]?\s*([^<]+)/i
    ];

    let match = null;

    for (const padrao of padroes) {
        match = texto.match(padrao);
        if (match) break;
    }

    if (!match) {
        const fallback = texto.match(/(?:ativado|desativado|habilitado|desabilitado|ativacao solicitada|solicitada|invalido)/i);
        if (fallback) {
            match = [fallback[0], fallback[0]];
        }
    }

    if (!match) {
        return "Situação do Bilhete Único não encontrada";
    }

    const situacaoOriginal = (match[1] || match[0]).trim();
    const situacao = normalizarSituacao(situacaoOriginal);

    if (situacao.includes("desativado") || situacao.includes("desabilitado")) {
        return "Desativado";
    }

    if (/ativ.*solicitada/.test(situacao) || situacao.includes("solicitada")) {
        return "Ativação solicitada";
    }

    if (/\bativado\b/.test(situacao) || situacao.includes("habilitado")) {
        return "Ativado";
    }

    if (situacao.includes("invalido")) {
        return "Inválido";
    }

    if (situacao.includes("sem") && situacao.includes("registro")) {
        return "Sem registro";
    }

    return situacao || "Situação não identificada";
}