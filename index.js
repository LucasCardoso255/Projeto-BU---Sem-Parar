import { debugarSituacaoVT } from "./debug.js";
import { obterSituacaoVT } from "./html.js";

const cpfs = ["14457417769", "19784729784", "16581874744",]

async function funcaoFoda() {

    for (const cpf of cpfs) {

        const response = await fetch(
            "https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do",
            {
                headers: {
                    "content-type": "application/x-www-form-urlencoded"
                },
                referrer:
                    "https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do",
                body: `cpf=${cpf}&Enviar=Consultar&desafioRecaptcha=&txtRespostaRecaptcha=`,
                method: "POST",
                credentials: "include"
            }
        );

        const resultado = await response.text();

        // debugarSituacaoVT(resultado);

        const situacao = obterSituacaoVT(resultado);

        console.log(`${cpf} → ${situacao}`);
    }
}

await funcaoFoda();