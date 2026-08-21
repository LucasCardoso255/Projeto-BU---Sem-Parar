import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { processSpreadsheet, validateSpreadsheet } from "../services/spreadsheetService.js";

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const JOB_TTL_MS = 15 * 60 * 1000;
const jobs = new Map();

function sendJson(response, status, payload) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(payload));
}

function toPublicError(error) {
    console.error("[ERROR]", error?.message || error);
    return "Não foi possível concluir a solicitação. Tente novamente.";
}

async function readBody(request) {
    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) throw new Error("UPLOAD_TOO_LARGE");
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

function parseMultipartFile(body, contentType = "") {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
    if (!boundary) throw new Error("INVALID_MULTIPART");

    const marker = Buffer.from(`--${boundary}`);
    let start = body.indexOf(marker) + marker.length;

    while (start >= marker.length) {
        if (body[start] === 13 && body[start + 1] === 10) start += 2;
        const end = body.indexOf(marker, start);
        if (end < 0) break;

        const part = body.subarray(start, end - 2);
        const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd >= 0) {
            const headers = part.subarray(0, headerEnd).toString("utf8");
            const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
            if (filename) return { filename, buffer: part.subarray(headerEnd + 4) };
        }
        start = end + marker.length;
    }

    throw new Error("MISSING_FILE");
}

function emit(job, event) {
    job.events.push(event);
    for (const client of job.clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
}

function createJob(file) {
    const id = randomUUID();
    const job = { events: [], clients: new Set(), result: null, error: null, expiresAt: Date.now() + JOB_TTL_MS };
    jobs.set(id, job);

    void (async () => {
        try {
            job.result = await processSpreadsheet({ inputBuffer: file.buffer, onProgress: progress => emit(job, progress) });
            emit(job, { type: "complete", summary: job.result.summary });
        } catch (error) {
            job.error = toPublicError(error);
            emit(job, { type: "error", message: job.error });
        } finally {
            for (const client of job.clients) client.end();
            job.clients.clear();
        }
    })();

    return id;
}

function cleanExpiredJobs() {
    for (const [id, job] of jobs) if (job.expiresAt < Date.now()) jobs.delete(id);
}

async function serveAsset(response, pathname) {
    const assets = { "/": "index.html", "/app.js": "app.js", "/styles.css": "styles.css" };
    const filename = assets[pathname];
    if (!filename) return false;

    const file = await readFile(new URL(`../frontend/${filename}`, import.meta.url));
    const type = pathname === "/" ? "text/html" : pathname.endsWith(".css") ? "text/css" : "text/javascript";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(file);
    return true;
}

export function startServer() {
    setInterval(cleanExpiredJobs, 60_000).unref();

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        try {
            if (request.method === "GET" && await serveAsset(response, url.pathname)) return;

            if (request.method === "POST" && ["/api/validate", "/api/process"].includes(url.pathname)) {
                const file = parseMultipartFile(await readBody(request), request.headers["content-type"]);
                if (extname(file.filename).toLowerCase() !== ".xlsx") {
                    return sendJson(response, 400, { valid: false, errors: [{ code: "INVALID_FILE_TYPE", message: "Envie uma planilha no formato .xlsx." }] });
                }
                const validation = await validateSpreadsheet(file.buffer);
                if (url.pathname === "/api/validate") return sendJson(response, 200, validation);
                if (!validation.valid) return sendJson(response, 422, validation);
                return sendJson(response, 202, { processId: createJob(file) });
            }

            const progress = /^\/api\/process\/([^/]+)\/progress$/.exec(url.pathname);
            if (request.method === "GET" && progress) {
                const job = jobs.get(progress[1]);
                if (!job) return sendJson(response, 404, { message: "Processamento não encontrado ou expirado." });
                response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive" });
                job.clients.add(response);
                for (const event of job.events) response.write(`data: ${JSON.stringify(event)}\n\n`);
                request.on("close", () => job.clients.delete(response));
                return;
            }

            const download = /^\/api\/process\/([^/]+)\/download$/.exec(url.pathname);
            if (request.method === "GET" && download) {
                const job = jobs.get(download[1]);
                if (!job?.result) return sendJson(response, job?.error ? 500 : 409, { message: job?.error || "O processamento ainda não terminou." });
                response.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${job.result.filename}"`, "Content-Length": job.result.outputBuffer.length, "Cache-Control": "no-store" });
                return response.end(job.result.outputBuffer);
            }

            sendJson(response, 404, { message: "Rota não encontrada." });
        } catch (error) {
            if (error.message === "UPLOAD_TOO_LARGE") return sendJson(response, 413, { message: "A planilha excede o limite de 10 MB." });
            sendJson(response, 400, { message: toPublicError(error) });
        }
    });

    server.listen(PORT, () => console.log(`Aplicação disponível em http://localhost:${PORT}`));
    return server;
}
