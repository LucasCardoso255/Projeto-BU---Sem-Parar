# Consulta de Status — Bilhete Único

Aplicação local para validar uma planilha `.xlsx`, consultar os CPFs elegíveis e devolver uma cópia preenchida.

## Estrutura

```text
index.js                 ponto de entrada
src/server/app.js        servidor HTTP e rotas
src/services/            processamento Excel, consulta VT e sessão
src/parsers/             interpretação das respostas HTML
src/config/              configurações da aplicação
src/utils/               utilitários reutilizáveis
src/frontend/            página, estilos e comportamento do navegador
```

## Executar

```bash
npm install
npm start
```

Abra `http://localhost:3000`, selecione a planilha e aguarde a conclusão.

## Privacidade

A planilha recebida e o resultado são mantidos somente em memória. O resultado permanece disponível para download por até 15 minutos e é então descartado. Nenhuma planilha é gravada no servidor.

O processo reutiliza a sessão do site de consulta já adotada pelo projeto. Caso ela esteja expirada, um navegador Playwright poderá abrir para renová-la.

## Regras da planilha

- Aba obrigatória: `QUE NÃO TEM`; (Nome temporário, só utilizei o titulo da planilha de exemplo que recebi)
- Coluna obrigatória: `CPF`;
- As colunas `STATUS VT`, `DATA CONSULTA BU` e `OBSERVAÇÕES` são criadas quando ausentes;
- CPFs inválidos não impedem o lote: recebem uma observação e os CPFs válidos seguem para consulta.

O upload é limitado a 10 MB. A aplicação aceita apenas arquivos `.xlsx` e também valida o conteúdo do arquivo.
