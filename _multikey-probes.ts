/**
 * What a key really has left, from its provider: the one place this module uses the network besides Pi's own requests.
 * Three providers answer a plain GET with the balance of the key itself. The rest have no such endpoint, and fall back
 * to what the module meters itself.
 */

/** A key's balance, as the provider states it: a number, and the unit that number is in. */
export type Reading = { remaining: number; unit: string };

/** One provider's way of telling a key's balance. */
export type Probe = {
    /** The provider as Pi names it. */
    provider: string;
    /** The address to ask. It carries no key of its own. */
    url: string;
    /** The header that carries the key. */
    headers(key: string): Record<string, string>;
    /** The balance in an answer, or undefined when the answer has no figure for one. */
    read(body: unknown): Reading | undefined;
};

/** A number from an answer: the services send them as numbers and as strings. */
function num(value: unknown): number | undefined {
    const number =
        typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

    return Number.isFinite(number) ? number : undefined;
}

/** An object from an answer, or undefined when it is anything else. */
function obj(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/** A list of objects from an answer. */
function objects(value: unknown): Record<string, unknown>[] {
    return (Array.isArray(value) ? value : [])
        .map(obj)
        .filter((each): each is Record<string, unknown> => each !== undefined);
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/** The providers that answer with a balance, by the id Pi uses for them. */
const PROBES: Record<string, Probe> = {
    // https://openrouter.ai/api/v1/key — the key's own limit, spend, and what is left of it, in credits (US dollars).
    openrouter: {
        provider: "openrouter",
        url: "https://openrouter.ai/api/v1/key",
        headers: bearer,
        read: (body) => {
            const data = obj(obj(body)?.["data"]);
            const remaining = num(data?.["limit_remaining"]);

            return remaining === undefined ? undefined : { remaining, unit: "credits" };
        },
    },
    // https://api-docs.deepseek.com/api/get-user-balance — a prepaid account, in CNY or USD.
    deepseek: {
        provider: "deepseek",
        url: "https://api.deepseek.com/user/balance",
        headers: bearer,
        read: (body) => {
            const infos = objects(obj(body)?.["balance_infos"]);
            const main = infos.find((each) => each["currency"] === "CNY") ?? infos[0];
            const remaining = num(main?.["total_balance"]);

            return remaining === undefined
                ? undefined
                : {
                      remaining,
                      unit: typeof main?.["currency"] === "string" ? String(main["currency"]) : "",
                  };
        },
    },
    // https://platform.moonshot.ai/docs/api/balance — the Moonshot (Kimi) account's available balance.
    moonshotai: {
        provider: "moonshotai",
        url: "https://api.moonshot.ai/v1/users/me/balance",
        headers: bearer,
        read: (body) => {
            const data = obj(obj(body)?.["data"]);
            const remaining = num(data?.["available_balance"]);

            return remaining === undefined ? undefined : { remaining, unit: "CNY" };
        },
    },
    "moonshotai-cn": {
        provider: "moonshotai-cn",
        url: "https://api.moonshot.cn/v1/users/me/balance",
        headers: bearer,
        read: (body) => {
            const data = obj(obj(body)?.["data"]);
            const remaining = num(data?.["available_balance"]);

            return remaining === undefined ? undefined : { remaining, unit: "CNY" };
        },
    },
};

/** The probe for a provider, when it is one that answers with a balance. */
export function probeFor(provider: string): Probe | undefined {
    return Object.hasOwn(PROBES, provider) ? PROBES[provider] : undefined;
}

/** Which providers this module can ask; the page says so beside the pool. */
export function probeProviders(): string[] {
    return Object.keys(PROBES);
}

/** Asks a provider what a key has left. It throws with the provider's own words when it refuses. */
export async function readBalance(
    probe: Probe,
    key: string,
    signal: AbortSignal,
    ask: typeof fetch = fetch,
): Promise<Reading> {
    const response = await ask(probe.url, {
        headers: probe.headers(key),
        redirect: "error",
        signal,
    });

    if (!response.ok) {
        throw new Error(`the provider answered ${response.status}`);
    }

    const reading = probe.read(await response.json());

    if (reading === undefined) {
        throw new Error("the answer had no balance in it");
    }

    return reading;
}
