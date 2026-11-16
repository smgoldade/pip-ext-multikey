/**
 * The rules of a key pool: which key is in force, which one comes next, when a key is used up, and what is kept on
 * disk. This file uses nothing of Pi's: `multikey.ts` calls it, and so do the tests.
 */

/** How a pool chooses its key. */
export type Mode = "sequential" | "balanced";

/** What a pool balances when its mode is `balanced`. */
export type BalanceMetric = "tokens" | "requests" | "cost";

/** The modes, in the order the page shows them. */
export const MODES: readonly Mode[] = ["sequential", "balanced"];

/** What Pi reported about the requests that one key made. */
export type KeyUsage = {
    requests: number;
    errors: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    /** When the key last carried a request, in milliseconds since 1970. */
    lastAt: number;
};

/** One API key of a pool. */
export type PoolKey = {
    /** Stable id of this key in its pool: `k1`, `k2`, … A key id is never used twice. */
    id: string;
    /** The owner's name for the key. */
    label: string;
    /** The key itself. It stays on the server, and no route returns it. */
    secret: string;
    addedAt: number;
    /** Set when the key cannot be used again until the owner brings it back. */
    usedUpAt?: number;
    /** Why it is used up, in a few words. */
    usedUpReason?: string;
    /** Set when the provider said "not now": the key rests until then. */
    coolUntil?: number;
    usage: KeyUsage;
};

/** The key that one conversation uses, for `balanced`. */
export type KeyPick = { id: string; at: number };

/** All the keys of one provider, and how they take turns. */
export type Pool = {
    mode: Mode;
    keys: PoolKey[];
    /** The id of the key that this module put in force in Pi, or that it wants there. */
    current?: string;
    /** Conversation id, as text, to the key that conversation uses. */
    picks: Record<string, KeyPick>;
};

/** What the module keeps in its file. Stored data: never rename a field, and never change what one means. */
export type State = {
    version: 1;
    /** How many keys were added in all: the source of the next key id. */
    counter: number;
    providers: Record<string, Pool>;
};

/** A fresh usage record. */
export function emptyUsage(): KeyUsage {
    return {
        requests: 0,
        errors: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        lastAt: 0,
    };
}

/** A fresh pool. */
export function emptyPool(mode: Mode = "sequential"): Pool {
    return { mode, keys: [], picks: {} };
}

/** A fresh state. */
export function emptyState(): State {
    return { version: 1, counter: 0, providers: {} };
}

/**
 * The provider says the key has no credit or quota left. It does not work again by itself, so only the owner brings
 * it back, or the pool's recovery time.
 */
const USED_UP: readonly RegExp[] = [
    /insufficient[_ ]quota/,
    /exceeded your current quota/,
    /quota (exceeded|has been exceeded|is exceeded|exhausted)/,
    /credit balance (is )?too low/,
    /(out of|no|not enough) credits?/,
    /credits? (exhausted|remaining)/,
    /billing (hard )?limit/,
    /payment required/,
    /spend(ing)? limit/,
    /monthly (usage )?limit/,
    /usage limit (reached|exceeded)/,
    /limit (reached|exceeded) for (this|your) (plan|account)/,
];

/** The provider refuses the key itself: a wrong, revoked, or expired key. */
const REJECTED: readonly RegExp[] = [
    /invalid (x-)?api[- ]?key/,
    /incorrect api key/,
    /api[- ]?key (is )?(invalid|revoked|disabled|expired|not valid)/,
    /unauthori[sz]ed/,
    /authentication (failed|error)/,
    /permission denied/,
    /(key|account) (is )?(disabled|revoked|deactivated)/,
    /too many (authentication|invalid) (failures|requests)/,
];

/** The provider asks to slow down: the key works again later. */
const COOLING: readonly RegExp[] = [
    /rate[_ ]limit/,
    /too many requests/,
    /overloaded/,
    /at capacity/,
    /temporarily unavailable/,
    /try again (in|after|later)/,
    /slow down/,
];

/** A status code, when the words alone do not say what happened. */
const STATUS = /\b(?:status|code|http)[^0-9]{0,4}(401|402|403|429|503)\b/;

/** Why a key cannot carry a request, as this module tells the two cases apart. */
export type Failure = {
    /** `used-up`: no credit or quota. `rejected`: Pi's provider refused the key. `cooling`: wait, then try again. */
    kind: "used-up" | "rejected" | "cooling";
    /** What to tell the owner, in a few words. */
    why: string;
};

/**
 * Reads what a provider said about a failed request. Undefined means the failure says nothing about the key: context
 * length, a bad request, a network drop, a server fault.
 */
export function classifyFailure(text: string | undefined): Failure | undefined {
    const words = (text ?? "").toLowerCase();

    if (words.trim() === "") {
        return undefined;
    }

    const status = STATUS.exec(words)?.[1];
    const says = (patterns: readonly RegExp[]) => patterns.some((pattern) => pattern.test(words));

    if (says(REJECTED) || status === "401" || status === "403") {
        return { kind: "rejected", why: "the provider refused this key" };
    }

    if (says(USED_UP) || status === "402") {
        return { kind: "used-up", why: "no credit or quota left" };
    }

    if (says(COOLING) || status === "429" || status === "503") {
        return { kind: "cooling", why: "the provider asked to slow down" };
    }

    return undefined;
}

/** Whether a key can carry a request now. */
export function usable(key: PoolKey, now: number): boolean {
    if (typeof key.usedUpAt === "number") {
        return false;
    }

    return !(typeof key.coolUntil === "number" && key.coolUntil > now);
}

/** What a key carried so far, as the pool's balance metric counts it. */
export function weight(key: PoolKey, metric: BalanceMetric): number {
    const usage = key.usage;

    switch (metric) {
        case "requests":
            return usage.requests;
        case "cost":
            return usage.cost;
        default:
            return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    }
}

/** The keys that can carry a request now, in the pool's order. */
export function usableKeys(pool: Pool, now: number): PoolKey[] {
    return pool.keys.filter((key) => usable(key, now));
}

/** The pool's key with this id. */
export function keyOf(pool: Pool, id: string | undefined): PoolKey | undefined {
    return id === undefined ? undefined : pool.keys.find((key) => key.id === id);
}

/**
 * Sequential: the key in force stays until it is used up or resting. Then the next key in the pool's order, wrapping
 * at the end. When every key rests, the one that rests until soonest.
 */
export function pickSequential(pool: Pool, now: number): PoolKey | undefined {
    const current = keyOf(pool, pool.current);

    if (current !== undefined && usable(current, now)) {
        return current;
    }

    const start = current === undefined ? 0 : pool.keys.indexOf(current) + 1;

    for (let step = 0; step < pool.keys.length; step += 1) {
        const key = pool.keys[(start + step) % pool.keys.length];

        if (key !== undefined && usable(key, now)) {
            return key;
        }
    }

    return soonestResting(pool, now);
}

/** The key that rests until soonest: what a pool uses when every key is resting for a while. */
export function soonestResting(pool: Pool, now: number): PoolKey | undefined {
    const resting = pool.keys.filter(
        (key) => typeof key.usedUpAt !== "number" && (key.coolUntil ?? 0) > now,
    );

    return resting.sort((left, right) => (left.coolUntil ?? 0) - (right.coolUntil ?? 0))[0];
}

/**
 * Balanced: the key that carried the least, by the metric. A tie goes to the key that was idle longest, then to the
 * one added first. When every key is resting, the one that rests until soonest.
 */
export function pickBalanced(pool: Pool, now: number, metric: BalanceMetric): PoolKey | undefined {
    const ranked = usableKeys(pool, now).sort(
        (left, right) =>
            weight(left, metric) - weight(right, metric) ||
            left.usage.lastAt - right.usage.lastAt ||
            left.addedAt - right.addedAt,
    );

    return ranked[0] ?? soonestResting(pool, now);
}

/**
 * The key for one conversation. A conversation keeps the key it was given while that key works: a swap in the middle
 * of a session throws away the provider's prompt cache. Undefined when no key can be used.
 */
export function pickFor(
    pool: Pool,
    conversationId: string,
    now: number,
    metric: BalanceMetric,
): PoolKey | undefined {
    const pick = pool.picks[conversationId];
    const kept = keyOf(pool, pick?.id);

    if (kept !== undefined && usable(kept, now)) {
        return kept;
    }

    return pool.mode === "balanced" ? pickBalanced(pool, now, metric) : pickSequential(pool, now);
}

/** The next key to try after one failed: sequential order, then balance, then what is left. */
export function pickAfter(
    pool: Pool,
    failed: string | undefined,
    now: number,
    metric: BalanceMetric,
): PoolKey | undefined {
    const others = usableKeys(pool, now).filter((key) => key.id !== failed);

    if (others.length === 0) {
        return soonestResting(pool, now);
    }

    if (pool.mode === "balanced") {
        return others.sort(
            (left, right) =>
                weight(left, metric) - weight(right, metric) ||
                left.usage.lastAt - right.usage.lastAt ||
                left.addedAt - right.addedAt,
        )[0];
    }

    const failedIndex = pool.keys.findIndex((key) => key.id === failed);

    for (let step = 1; step <= pool.keys.length; step += 1) {
        const key = pool.keys[(failedIndex + step + pool.keys.length) % pool.keys.length];

        if (key !== undefined && others.some((other) => other.id === key.id)) {
            return key;
        }
    }

    return others[0];
}

/** A key as the page shows it: the first few characters, then the last four. */
export function maskSecret(secret: string): string {
    if (secret.length <= 8) {
        return "…";
    }

    const prefix = /^[A-Za-z]{2,4}(?:-[A-Za-z]{2,4})?-/.exec(secret)?.[0] ?? "";

    return `${prefix}…${secret.slice(-4)}`;
}

/** Adds one key to a pool, at the end, with the next id of the state. */
export function addKey(
    state: State,
    pool: Pool,
    fields: { label: string; secret: string },
    now: number,
): PoolKey {
    state.counter += 1;

    const key: PoolKey = {
        id: `k${state.counter}`,
        label: fields.label,
        secret: fields.secret,
        addedAt: now,
        usage: emptyUsage(),
    };

    pool.keys.push(key);

    if (pool.current === undefined) {
        pool.current = key.id;
    }

    return key;
}

/** Counts one request of a key, and what Pi reported about it. */
export function addUsage(
    key: PoolKey,
    reported:
        | {
              input?: number;
              output?: number;
              cacheRead?: number;
              cacheWrite?: number;
              cost?: number;
              error?: boolean;
          }
        | undefined,
    now: number,
): void {
    key.usage.requests += 1;
    key.usage.lastAt = now;

    if (reported === undefined) {
        return;
    }

    key.usage.input += Math.max(0, reported.input ?? 0);
    key.usage.output += Math.max(0, reported.output ?? 0);
    key.usage.cacheRead += Math.max(0, reported.cacheRead ?? 0);
    key.usage.cacheWrite += Math.max(0, reported.cacheWrite ?? 0);
    key.usage.cost += Math.max(0, reported.cost ?? 0);

    if (reported.error === true) {
        key.usage.errors += 1;
    }
}

/** How many conversations a pool remembers. Older ones are forgotten first. */
export const KEEP_PICKS = 300;

/** Forgets the conversations that a pool no longer needs: the oldest beyond `keep`, and any older than a month. */
export function prunePicks(pool: Pool, now: number, keep = KEEP_PICKS): void {
    const month = 30 * 24 * 60 * 60 * 1000;
    const entries = Object.entries(pool.picks).filter(([, pick]) => now - pick.at < month);

    entries.sort((left, right) => right[1].at - left[1].at);
    pool.picks = Object.fromEntries(entries.slice(0, keep));
}

/** A number that the state file can hold, or the fallback. */
function count(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A text that the state file can hold, or the fallback. */
function text(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

/** One key from the file, or undefined when it cannot be one. */
function keyFrom(value: unknown): PoolKey | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const raw = value as Record<string, unknown>;
    const id = text(raw.id);
    const secret = text(raw.secret);

    if (id === "" || secret === "") {
        return undefined;
    }

    const usage = (typeof raw.usage === "object" && raw.usage !== null ? raw.usage : {}) as Record<
        string,
        unknown
    >;

    return {
        id,
        label: text(raw.label, "key"),
        secret,
        addedAt: count(raw.addedAt),
        usedUpAt: typeof raw.usedUpAt === "number" ? count(raw.usedUpAt) : undefined,
        usedUpReason: typeof raw.usedUpReason === "string" ? raw.usedUpReason : undefined,
        coolUntil: typeof raw.coolUntil === "number" ? count(raw.coolUntil) : undefined,
        usage: {
            requests: count(usage.requests),
            errors: count(usage.errors),
            input: count(usage.input),
            output: count(usage.output),
            cacheRead: count(usage.cacheRead),
            cacheWrite: count(usage.cacheWrite),
            cost: count(usage.cost),
            lastAt: count(usage.lastAt),
        },
    };
}

/** One pool from the file, or undefined when it has no key that can be one. */
function poolFrom(value: unknown): Pool | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const raw = value as Record<string, unknown>;
    const keys = Array.isArray(raw.keys)
        ? raw.keys.map(keyFrom).filter((key): key is PoolKey => key !== undefined)
        : [];

    if (keys.length === 0) {
        return undefined;
    }

    const picks: Record<string, KeyPick> = {};

    if (typeof raw.picks === "object" && raw.picks !== null) {
        for (const [conversation, pick] of Object.entries(raw.picks as Record<string, unknown>)) {
            if (typeof pick !== "object" || pick === null) {
                continue;
            }

            const id = text((pick as Record<string, unknown>).id);

            if (keys.some((key) => key.id === id)) {
                picks[conversation] = {
                    id,
                    at: count((pick as Record<string, unknown>).at),
                };
            }
        }
    }

    const current = text(raw.current);

    return {
        mode: raw.mode === "balanced" ? "balanced" : "sequential",
        keys,
        current: keys.some((key) => key.id === current) ? current : keys[0]?.id,
        picks,
    };
}

/**
 * The state that a file holds, checked: anything that is not a key pool is left out, and every number is a number.
 * A file from a newer version of the module keeps what this version knows.
 */
export function normalizeState(raw: unknown): State {
    const state = emptyState();

    if (typeof raw !== "object" || raw === null) {
        return state;
    }

    const file = raw as Record<string, unknown>;
    state.counter = count(file.counter);

    if (typeof file.providers !== "object" || file.providers === null) {
        return state;
    }

    for (const [provider, value] of Object.entries(file.providers as Record<string, unknown>)) {
        const pool = poolFrom(value);

        if (pool !== undefined && provider !== "") {
            state.providers[provider] = pool;
        }
    }

    // A key that the file forgot the id of still has one: ids stay above everything that the file holds.
    for (const pool of Object.values(state.providers)) {
        for (const key of pool.keys) {
            const number = /^k(\d+)$/.exec(key.id)?.[1];

            if (number !== undefined) {
                state.counter = Math.max(state.counter, Number(number));
            }
        }
    }

    return state;
}
