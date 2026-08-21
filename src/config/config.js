import path from "node:path";

export const appConfig = {
    playwright: {
        headless: false
    },
    debug: {
        enabled: process.env.VT_DEBUG === "true" || process.env.VT_DEBUG === "1",
        dir: path.resolve(process.cwd(), "debug")
    },
    execution: {
        onlyMissingStatus: true,
        statusHeaders: [
            "STATUS VT",
            "STATUS BU",
            "STATUS BILHETE UNICO"
        ]
    }
};

export function enableDebugMode(enabled = true, dir = appConfig.debug.dir) {
    appConfig.debug.enabled = Boolean(enabled);
    if (dir) {
        appConfig.debug.dir = path.resolve(dir);
    }
    return appConfig.debug.enabled;
}

export function isDebugEnabled() {
    return appConfig.debug.enabled;
}

export function getDebugDir() {
    return appConfig.debug.dir;
}

export function shouldProcessOnlyMissingStatus() {
    return Boolean(appConfig.execution.onlyMissingStatus);
}

export function isMissingStatusValue(value) {
    const text = String(value ?? "").trim();

    if (!text) {
        return true;
    }

    const normalized = text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const blockedPatterns = [
        "situacao do bilhete unico nao encontrada",
        "bloqueado pela cloudflare",
        "bloqueio pela cloudflare",
        "attention required",
        "403",
        "forbidden",
        "erro na consulta",
        "status do bilhete unico nao encontrada"
    ];

    return blockedPatterns.some((pattern) => normalized.includes(pattern));
}

export function getStatusHeaderCandidates() {
    return [...appConfig.execution.statusHeaders];
}
