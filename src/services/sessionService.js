import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SESSION_FILE = path.resolve(process.cwd(), ".vt_session.json");
const MAX_RETRIES = 2;
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const DEFAULT_ACCEPT_LANGUAGE = "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7";

async function readSessionFile() {
    try {
        const raw = await fs.readFile(SESSION_FILE, "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function writeSessionFile(sessionData) {
    await fs.writeFile(SESSION_FILE, JSON.stringify(sessionData, null, 2), "utf-8");
}

function hasValidSession(session) {
    if (!session) {
        return false;
    }

    if (!session.cookies || !Array.isArray(session.cookies) || session.cookies.length === 0) {
        return false;
    }

    if (!session.cookies.some((cookie) => cookie?.name === "JSESSIONID")) {
        return false;
    }

    if (!session.expiresAt || Date.now() > session.expiresAt) {
        return false;
    }

    const nowInSeconds = Date.now() / 1000;
    const criticalCookies = new Set(["JSESSIONID", "__cf_bm", "cf_clearance"]);
    const hasExpiredCriticalCookie = session.cookies.some((cookie) =>
        criticalCookies.has(cookie?.name) &&
        Number(cookie.expires) > 0 &&
        nowInSeconds >= Number(cookie.expires)
    );

    if (hasExpiredCriticalCookie) {
        return false;
    }

    return true;
}

function getActiveCookies(session) {
    const nowInSeconds = Date.now() / 1000;

    return (Array.isArray(session?.cookies) ? session.cookies : []).filter((cookie) =>
        cookie &&
        cookie.name &&
        (Number(cookie.expires) <= 0 || nowInSeconds < Number(cookie.expires))
    );
}

async function captureBrowserFingerprint(page) {
    try {
        return await page.evaluate(() => {
            const screen = window.screen || {};
            const nav = navigator || {};
            const locale = Intl.DateTimeFormat().resolvedOptions().locale || nav.language || "pt-BR";
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

            return {
                userAgent: nav.userAgent || DEFAULT_UA,
                platform: nav.platform || "Win32",
                language: nav.language || "pt-BR",
                languages: Array.isArray(nav.languages) ? nav.languages : [nav.language || "pt-BR"],
                acceptLanguage: nav.language ? `${nav.language},${nav.language.split("-")[0]};q=0.9` : DEFAULT_ACCEPT_LANGUAGE,
                locale,
                timezone,
                timezoneOffset: new Date().getTimezoneOffset(),
                viewport: {
                    width: window.innerWidth || 1280,
                    height: window.innerHeight || 900,
                    deviceScaleFactor: window.devicePixelRatio || 1
                },
                screen: {
                    width: screen.width || 1280,
                    height: screen.height || 900,
                    colorDepth: screen.colorDepth || 24,
                    pixelDepth: screen.pixelDepth || 24
                }
            };
        });
    } catch {
        return {
            userAgent: DEFAULT_UA,
            platform: "Win32",
            language: "pt-BR",
            languages: ["pt-BR", "en-US"],
            acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
            locale: "pt-BR",
            timezone: "America/Sao_Paulo",
            timezoneOffset: -180,
            viewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
            screen: { width: 1280, height: 900, colorDepth: 24, pixelDepth: 24 }
        };
    }
}

function buildRequestHeaders(session) {
    const cookies = getActiveCookies(session);
    const cookieHeader = cookies
        .filter((cookie) => cookie && cookie.name)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

    const fingerprint = session?.fingerprint || {};
    const userAgent = fingerprint.userAgent || DEFAULT_UA;
    const acceptLanguage = fingerprint.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE;
    const referer = session?.url || "https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do";

    return {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": acceptLanguage,
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        Cookie: cookieHeader,
        DNT: "1",
        Origin: "https://www.cartaoriocard.com.br",
        Referer: referer,
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": userAgent
    };
}

async function ensureBrowserContext() {
    const existingSession = await readSessionFile();

    if (hasValidSession(existingSession)) {
        return {
            reused: true,
            session: existingSession,
            browser: null,
            context: null,
            page: null
        };
    }

    const browser = await chromium.launch({
        headless: false
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: DEFAULT_UA,
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    return {
        reused: false,
        session: null,
        browser,
        context,
        page
    };
}

async function persistSession(browser, context, page) {
    const cookies = await context.cookies();
    const fingerprint = await captureBrowserFingerprint(page);
    const jsessionId = cookies.find((cookie) => cookie.name === "JSESSIONID")?.value || null;

    const sessionData = {
        cookies,
        jsessionId,
        fingerprint,
        requestHeaders: buildRequestHeaders({ cookies, fingerprint, url: page.url() }),
        browser: {
            name: "chromium",
            version: browser ? await browser.version() : null,
            userAgent: fingerprint.userAgent,
            platform: fingerprint.platform,
            viewport: fingerprint.viewport,
            timezone: fingerprint.timezone,
            locale: fingerprint.locale
        },
        expiresAt: Date.now() + 1000 * 60 * 60 * 6,
        createdAt: Date.now(),
        url: page.url(),
        title: await page.title().catch(() => "")
    };

    await writeSessionFile(sessionData);

    return sessionData;
}

async function restoreSession(session) {
    if (!hasValidSession(session)) {
        return null;
    }

    const browser = await chromium.launch({
        headless: false
    });

    const fingerprint = session.fingerprint || {};
    const context = await browser.newContext({
        viewport: fingerprint.viewport || { width: 1280, height: 900 },
        userAgent: fingerprint.userAgent || DEFAULT_UA,
        locale: fingerprint.locale || "pt-BR",
        timezoneId: fingerprint.timezone || "America/Sao_Paulo",
        ignoreHTTPSErrors: true
    });

    await context.addCookies(session.cookies);

    const page = await context.newPage();

    return { browser, context, page };
}

export async function openValidSession() {
    const session = await readSessionFile();

    if (hasValidSession(session)) {
        const restored = await restoreSession(session);
        return {
            ...restored,
            reused: true,
            session
        };
    }

    const temp = await ensureBrowserContext();
    return {
        ...temp,
        reused: false,
        session: null
    };
}

export async function ensureFreshSession() {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const existingSession = await readSessionFile();
            if (hasValidSession(existingSession)) {
                return {
                    session: existingSession,
                    reused: true,
                    browser: null,
                    context: null,
                    page: null
                };
            }

            const browser = await chromium.launch({
                headless: false
            });

            const context = await browser.newContext({
                viewport: { width: 1280, height: 900 },
                userAgent: DEFAULT_UA,
                locale: "pt-BR",
                timezoneId: "America/Sao_Paulo",
                ignoreHTTPSErrors: true
            });

            const page = await context.newPage();

            await page.goto("https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do", {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            const sessionData = await persistSession(browser, context, page);
            await closeSession({ browser, context, page });

            return {
                session: sessionData,
                reused: false,
                browser: null,
                context: null,
                page: null
            };
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    throw new Error(`Falha ao inicializar a sessão do site após ${MAX_RETRIES + 1} tentativas. ${lastError?.message ?? ""}`);
}

export async function closeSession({ browser, context, page }) {
    try {
        await page?.close().catch(() => {});
    } catch {}

    try {
        await context?.close().catch(() => {});
    } catch {}

    try {
        await browser?.close().catch(() => {});
    } catch {}
}

export async function getSessionPayload() {
    const session = await readSessionFile();
    if (!hasValidSession(session)) {
        return null;
    }

    return {
        ...session,
        requestHeaders: buildRequestHeaders(session)
    };
}

export async function saveSessionFromPage(page) {
    const context = page.context();
    const browser = context.browser();
    const session = await persistSession(browser, context, page);
    return session;
}

export function getRequestConfigForSession(session) {
    const payload = session || {};
    return {
        headers: buildRequestHeaders(payload),
        method: "GET",
        redirect: "manual",
        credentials: "include"
    };
}
