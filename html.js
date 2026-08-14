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

    return "Situação não identificada";
}