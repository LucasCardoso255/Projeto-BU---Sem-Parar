export function debugarSituacaoVT(html) {
    const texto = normalizar(html);

    console.log("========== DEBUG SITUAÇÃO VT ==========");

    const match = texto.match(
        /situacao(?:\s+atual)?(?:\s+do)?\s+bilhete\s+unico(?:\s+intermunicipal)?\s*:\s*([^<]+)/
    );

    if (!match) {
        console.log("Não foi possível encontrar o campo de situação do Bilhete Único.");
        console.log("============================================");
        return;
    }

    const trechoSituacao = texto.substring(texto.indexOf(match[0]));

    console.log("Índice 'situação do Bilhete Único':", texto.indexOf(match[0]));

    const situacaoEncontrada = match[1].trim();
    const situacaoNormalizada = normalizarSituacao(situacaoEncontrada);

    console.log("\n========== CAMPO DE SITUAÇÃO ==========");
    console.log("Valor encontrado dentro do <strong>:");
    console.log(`"${situacaoEncontrada}"`);
    console.log("Valor normalizado para comparação:");
    console.log(`"${situacaoNormalizada}"`);

    console.log("\n========== CONDIÇÕES ==========");

    console.log(
        "ativacao solicitada:",
        situacaoEncontrada === "ativacao solicitada"
    );

    console.log(
        "desativado:",
        situacaoEncontrada === "desativado"
    );

    console.log(
        "ativado:",
        situacaoEncontrada === "ativado"
    );

    console.log("\n========== RESULTADO ==========");

    console.log(
        "Situação real encontrada:",
        situacaoEncontrada
    );

    console.log(
        "Função retornaria:",
        obterSituacaoVT(html)
    );

    console.log("============================================");
}