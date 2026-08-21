const fileInput = document.querySelector("#file"),
  choose = document.querySelector("#choose"),
  zone = document.querySelector("#dropzone"),
  processButton = document.querySelector("#process"),
  selected = document.querySelector("#selected"),
  feedback = document.querySelector("#feedback");
let file;
const show = (html, kind = "") =>
  (feedback.innerHTML = `<div class="${kind}">${html}</div>`);
function setFile(next) {
  file = next;
  processButton.disabled = !file;
  selected.textContent = file ? `Arquivo selecionado: ${file.name}` : "";
  feedback.innerHTML = "";
}
choose.onclick = () => fileInput.click();
fileInput.onchange = () => setFile(fileInput.files[0]);
["dragenter", "dragover"].forEach((event) =>
  zone.addEventListener(event, (e) => {
    e.preventDefault();
    zone.classList.add("over");
  }),
);
["dragleave", "drop"].forEach((event) =>
  zone.addEventListener(event, (e) => {
    e.preventDefault();
    zone.classList.remove("over");
  }),
);
zone.ondrop = (e) => setFile(e.dataTransfer.files[0]);
async function post(route) {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(route, { method: "POST", body: data }),
    json = await response.json();
  if (!response.ok) throw json;
  return json;
}
function errors(items) {
  return `<h2>Não foi possível processar sua planilha</h2><ul>${items.map((e) => `<li>${e.message}</li>`).join("")}</ul><p>Verifique o arquivo e tente novamente.</p>`;
}
processButton.onclick = async () => {
  try {
    processButton.disabled = true;
    show("Validando a planilha...");
    const validation = await post("/api/validate");
    if (!validation.valid) return show(errors(validation.errors), "error");
    if (validation.warnings.length)
      show(
        `<h2>Planilha validada</h2><p>Encontramos ${validation.warnings.length} CPF(s) inválido(s). Eles receberão uma observação, e os demais serão processados.</p>`,
      );
    const { processId } = await post("/api/process"),
      stream = new EventSource(`/api/process/${processId}/progress`);
    stream.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.type === "progress")
        show(
          `<h2>Processando planilha...</h2><p>${event.message}</p><progress value="${event.percent}" max="100"></progress><p>${event.percent}% — não feche esta página.</p>`,
        );
      if (event.type === "complete") {
        stream.close();
        const s = event.summary;
        show(
          `<h2>Processamento concluído.</h2><p>Registros encontrados: ${s.totalRows}<br>Registros processados: ${s.processedRows}<br>Registros com erro: ${s.errors}</p><a class="download" href="/api/process/${processId}/download">Baixar planilha processada</a>`,
          "success",
        );
      }
      if (event.type === "error") {
        stream.close();
        show(
          `<h2>Não foi possível concluir</h2><p>${event.message}</p>`,
          "error",
        );
      }
    };
  } catch (error) {
    show(
      errors(
        error.errors || [
          { message: error.message || "Não foi possível enviar a planilha." },
        ],
      ),
      "error",
    );
  } finally {
    processButton.disabled = !file;
  }
};
