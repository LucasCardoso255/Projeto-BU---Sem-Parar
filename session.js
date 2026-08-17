import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SESSION_FILE = path.resolve(process.cwd(), ".vt_session.json");
const MAX_RETRIES = 2;

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

    if (!session.expiresAt || Date.now() > session.expiresAt) {
        return false;
    }

    return true;
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
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
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
    const sessionData = {
        cookies,
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

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
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
            const sessionInfo = await openValidSession();
            const { browser, context, page } = sessionInfo;

            if (!sessionInfo.reused) {
                await page.goto("https://www.cartaoriocard.com.br/vt2/visitante/consultas/ConsultaCpf.do", {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                });

                const sessionData = await persistSession(browser, context, page);
                return {
                    browser,
                    context,
                    page,
                    session: sessionData,
                    reused: false
                };
            }

            return {
                browser: sessionInfo.browser,
                context: sessionInfo.context,
                page: sessionInfo.page,
                session: sessionInfo.session,
                reused: true
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

    return session;
}

export async function saveSessionFromPage(page) {
    const context = page.context();
    const browser = context.browser();
    const session = await persistSession(browser, context, page);
    return session;
}
