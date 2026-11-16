/**
 * API key pools: several API keys for one provider, used one at a time. In the sequential mode a key stays in force
 * until the provider says its quota is gone; in the balanced mode each new session or subagent gets the key that has
 * carried the least so far. Keys are added, marked used up, and balanced on the "API keys" page on the rail.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExtension, GenerationTask, hook } from "@earendil-works/pi-durable";
import {
    addKey,
    addUsage,
    classifyFailure,
    emptyPool,
    emptyState,
    keyOf,
    maskSecret,
    normalizeState,
    pickAfter,
    pickFor,
    pickSequential,
    prunePicks,
    usable,
    type BalanceMetric,
    type Failure,
    type Mode,
    type Pool,
    type PoolKey,
    type State,
} from "./_multikey-policy.ts";

/** The folder in Pi Pocket's data folder that holds the pools. */
const FOLDER = "multikey";
/** The file in that folder. It holds the keys themselves, so it stays on the server. */
const FILE = "keys.json";

const MAX_PROVIDERS = 20;
const MAX_KEYS = 20;
const MAX_LABEL = 40;
const MIN_SECRET = 8;
const MAX_SECRET = 512;
/** A provider id, as Pi names them: anthropic, opencode-go, openrouter. */
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Characters that must not go into a key or a label: a newline would split a header. */
const UNSAFE = /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u;
/** How long a notice about one pool waits before it may repeat. */
const TELL_MINUTES = 10;

type NoticeLevel = "info" | "warning" | "error";

/** What this module uses of Pi Pocket's host (docs/extensions/reference/host.md). */
type Host = {
    readonly dataDir: string;
    readonly agentDir: string;
    registerModelProvider(provider: string, config: { apiKey: string }): () => void;
    notice(level: NoticeLevel, message: string, conversationId?: number): void;
    hide?(value: { value: string; label: string }): () => void;
};

/** One field of the module's settings sheet. */
type SettingField =
    | { name: string; label: string; description?: string; type: "boolean"; default?: boolean }
    | {
          name: string;
          label: string;
          description?: string;
          type: "number";
          default?: number;
          min?: number;
          max?: number;
      }
    | {
          name: string;
          label: string;
          description?: string;
          type: "choice";
          default?: string;
          choices: { value: string; label: string }[];
      };

/** What this module uses of Pi Pocket's web part (docs/extensions/reference/web.md). */
type Web = {
    route(
        method: "GET" | "POST",
        path: string,
        handler: (request: { body: Record<string, unknown> }) => unknown,
        options?: { access?: "owner" },
    ): void;
    client(entry: string, options?: { access?: "owner" }): void;
    send(event: string, data?: unknown): void;
    error(status: number, message: string): Error;
    settings(fields: readonly SettingField[]): void;
    setting(name: string): string | number | boolean | undefined;
    onSettings(listener: () => void): void;
    onDispose(dispose: () => unknown): void;
};

/** What a hook is told about one terminal answer of the model, as far as a key pool reads it. */
type ProviderMessage = {
    readonly provider?: string;
    readonly stopReason?: string;
    readonly errorMessage?: string;
    readonly usage?: {
        readonly input?: number;
        readonly output?: number;
        readonly cacheRead?: number;
        readonly cacheWrite?: number;
        readonly cost?: { readonly total?: number };
    };
};

/** One provider that Pi lists, as the page shows it: its name, and how many models it has. No key is here. */
type CatalogEntry = { name: string; models: number };

/** The settings of the module, under Menu → Extensions. */
const SETTINGS: readonly SettingField[] = [
    {
        name: "notify",
        label: "Tell me when a key is used up, or when a pool switches",
        type: "boolean",
        default: true,
    },
    {
        name: "balance",
        label: "What the balanced mode evens out",
        type: "choice",
        default: "tokens",
        choices: [
            { value: "tokens", label: "Tokens" },
            { value: "requests", label: "Requests" },
            { value: "cost", label: "Cost" },
        ],
    },
    {
        name: "cooldown",
        label: "Minutes a key rests after the provider asks to slow down",
        description: "0 puts a key straight back to work, which may hit the same limit again.",
        type: "number",
        default: 10,
        min: 0,
        max: 1440,
    },
    {
        name: "recover",
        label: "Hours until a used-up key is tried again",
        description: "0 keeps a key used up until you bring it back on the page.",
        type: "number",
        default: 0,
        min: 0,
        max: 8760,
    },
];

/** An error's words, for a notice. */
function tell(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The pools, and what they do to Pi: the key in force for each provider, the key each conversation uses, and the
 * counts that the page shows. The state is a file, because this module needs it before Pi Pocket has a request or a
 * hook to give it: a document cannot be read while the module loads.
 */
class Engine {
    readonly #host: Host;
    readonly #web: Web;
    readonly #file: string;
    readonly #catalogFile: string;
    #state: State = emptyState();
    /** The providers Pi last listed, learned while requests run: a hook is the only place that can see them. */
    #catalog: Record<string, CatalogEntry> = {};
    /** When Pi's list was last read: a hook can run often, and the list changes rarely. */
    #catalogAt = 0;
    /** Provider → the registration in force, and the id of the key in it. */
    readonly #inForce = new Map<string, { id: string; dispose: () => void }>();
    /** Conversation id → its provider, learned from the requests it made. */
    readonly #providers = new Map<number, string>();
    /** The provider that a request last came from, for a conversation that has none yet. */
    #last?: string;
    /** Secret → how to stop hiding it again. */
    readonly #hidden = new Map<string, () => void>();
    /** Pi's own sign-ins by provider name, read at most a few seconds apart. */
    #stored?: { at: number; providers: Set<string> };
    /** Notices already sent, and when. */
    readonly #told = new Map<string, number>();
    #timer?: ReturnType<typeof setTimeout>;
    #writing: Promise<void> = Promise.resolve();
    #closed = false;

    constructor(host: Host, web: Web) {
        this.#host = host;
        this.#web = web;
        this.#file = join(host.dataDir, FOLDER, FILE);
        this.#catalogFile = join(host.dataDir, FOLDER, "providers.json");
    }

    /** The pools on disk, and the key in force for each of them. */
    async load(): Promise<void> {
        await mkdir(join(this.#host.dataDir, FOLDER), { recursive: true });

        try {
            const text = await readFile(this.#file, "utf8");
            this.#state = normalizeState(JSON.parse(text));
        } catch (error) {
            if ((error as { code?: string }).code !== "ENOENT") {
                this.#host.notice(
                    "warning",
                    `API key pools: could not read ${this.#file}: ${tell(error)}. Starting with no keys.`,
                );
            }
        }

        try {
            const raw: unknown = JSON.parse(await readFile(this.#catalogFile, "utf8"));

            if (typeof raw === "object" && raw !== null) {
                this.#catalog = raw as Record<string, CatalogEntry>;
            }
        } catch {
            // No list yet: it arrives with Pi's first request.
        }

        // A list from a version that kept a name of its own still sorts under the id it was made for.
        for (const [id, entry] of Object.entries(this.#catalog)) {
            if (typeof entry?.name !== "string" || typeof entry?.models !== "number") {
                delete this.#catalog[id];
            }
        }

        for (const [provider, pool] of Object.entries(this.#state.providers)) {
            for (const key of pool.keys) {
                this.#hide(key);
            }

            this.#ensure(provider);
        }
    }

    /**
     * Takes Pi's list of providers from a hook: the model runtime is the only part of Pi Pocket that can list them,
     * and it is given to hooks alone. Read at most once a minute.
     */
    learnCatalog(models: unknown): void {
        const now = Date.now();

        if (now - this.#catalogAt < 60_000) {
            return;
        }

        this.#catalogAt = now;

        if (typeof models !== "object" || models === null) {
            return;
        }

        const api = models as {
            getProviders?: () => readonly {
                id?: unknown;
                name?: unknown;
                getModels?: () => readonly unknown[];
                getAllModels?: () => readonly unknown[];
            }[];
        };
        const providers = api.getProviders?.();

        if (!Array.isArray(providers)) {
            return;
        }

        const next: Record<string, CatalogEntry> = {};

        for (const provider of providers) {
            const id = typeof provider?.id === "string" ? provider.id : "";

            if (!PROVIDER.test(id)) {
                continue;
            }

            let models = 0;

            try {
                models = (provider.getAllModels?.() ?? provider.getModels?.() ?? []).length;
            } catch {
                models = 0;
            }

            next[id] = { name: typeof provider.name === "string" ? provider.name : id, models };
        }

        if (Object.keys(next).length === 0) {
            return;
        }

        this.#catalog = next;
        void this.#writeCatalog();
    }

    /** Writes Pi's list to its own file: a cache next to the pools, read at the next start. */
    async #writeCatalog(): Promise<void> {
        const file = this.#catalogFile;
        const temp = `${file}.tmp`;

        try {
            await writeFile(temp, JSON.stringify(this.#catalog, undefined, 2), "utf8");
            await rename(temp, file);
        } catch {
            // A list that cannot be written costs one request at the next start, and nothing else.
        }
    }

    /** Stops the timers, and puts Pi's own sign-ins back in force for every provider that this module changed. */
    dispose(): void {
        this.#closed = true;
        clearTimeout(this.#timer);

        for (const [provider, registration] of this.#inForce) {
            registration.dispose();
            this.#inForce.delete(provider);
        }

        for (const stop of this.#hidden.values()) {
            stop();
        }

        this.#hidden.clear();

        // A last write, not awaited: a reload may start the next version before this one is done.
        void this.flush();
    }

    /** Writes what changed, a moment later: a run makes several changes in a row. */
    #save(): void {
        if (this.#closed) {
            return;
        }

        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.flush(), 250);
        this.#timer.unref?.();
    }

    /** Writes the pools to the file now, one write at a time. */
    async flush(): Promise<void> {
        const text = JSON.stringify(this.#state, undefined, 2);
        const file = this.#file;
        const temp = `${file}.tmp`;

        this.#writing = this.#writing
            .then(async () => {
                await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
                await rename(temp, file);
                await chmod(file, 0o600).catch(() => undefined);
            })
            .catch((error: unknown) => {
                this.#host.notice(
                    "warning",
                    `API key pools: could not write ${file}: ${tell(error)}`,
                );
            });

        return this.#writing;
    }

    // ── The keys in force ────────────────────────────────────────────────────

    /** Hides a key from what Pi and people read, so it cannot reach a transcript. */
    #hide(key: PoolKey): void {
        const stop = this.#host.hide?.({ value: key.secret, label: `key ${key.id}` });

        if (stop !== undefined) {
            this.#hidden.set(key.secret, stop);
        }
    }

    /** Pi's own sign-ins, by provider name only: the page warns that Pi sends those keys before a pool's. */
    async #storedSignIns(): Promise<Set<string>> {
        if (this.#stored !== undefined && Date.now() - this.#stored.at < 5000) {
            return this.#stored.providers;
        }

        const providers = new Set<string>();

        try {
            const raw: unknown = JSON.parse(
                await readFile(join(this.#host.agentDir, "auth.json"), "utf8"),
            );

            if (typeof raw === "object" && raw !== null) {
                for (const name of Object.keys(raw)) {
                    providers.add(name);
                }
            }
        } catch {
            // No file, or no key in it: nothing to warn about.
        }

        this.#stored = { at: Date.now(), providers };

        return providers;
    }

    /** Provider names to suggest in the page: the pools, the providers seen in requests, Pi's sign-ins, its catalogs. */
    async #known(): Promise<string[]> {
        const known = new Set<string>([
            ...Object.keys(this.#state.providers),
            ...this.#providers.values(),
            ...(await this.#storedSignIns()),
        ]);

        if (this.#last !== undefined) {
            known.add(this.#last);
        }

        for (const file of ["models-store.json", "models.json"]) {
            try {
                const raw: unknown = JSON.parse(
                    await readFile(join(this.#host.agentDir, file), "utf8"),
                );

                if (file === "models.json") {
                    const providers =
                        (raw as { providers?: Record<string, unknown> }).providers ?? {};

                    for (const name of Object.keys(providers)) {
                        known.add(name);
                    }
                } else if (typeof raw === "object" && raw !== null) {
                    for (const name of Object.keys(raw)) {
                        known.add(name);
                    }
                }
            } catch {
                // Pi has no such file: nothing to suggest.
            }
        }

        return [...known].filter((name) => PROVIDER.test(name)).sort();
    }

    /** A setting's number, or its default. */
    #count(name: string, fallback: number): number {
        const value = this.#web.setting(name);

        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    }

    /** A setting's boolean, or its default. */
    #flag(name: string, fallback: boolean): boolean {
        const value = this.#web.setting(name);

        return typeof value === "boolean" ? value : fallback;
    }

    /** What the balanced mode evens out. */
    #metric(): BalanceMetric {
        const value = this.#web.setting("balance");

        return value === "requests" || value === "cost" ? value : "tokens";
    }

    /** Brings back the keys whose rest is over, and says whether it did. */
    #recover(pool: Pool, now: number): boolean {
        const hours = this.#count("recover", 0);

        if (hours <= 0) {
            return false;
        }

        let changed = false;

        for (const key of pool.keys) {
            if (typeof key.usedUpAt === "number" && now - key.usedUpAt >= hours * 3_600_000) {
                delete key.usedUpAt;
                delete key.usedUpReason;
                changed = true;
            }
        }

        return changed;
    }

    /** The key this pool should have in force: the one it chose, or the next one that can carry a request. */
    #wanted(pool: Pool, now: number): PoolKey | undefined {
        const current = keyOf(pool, pool.current);

        if (current !== undefined && usable(current, now)) {
            return current;
        }

        return pickSequential(pool, now) ?? current;
    }

    /**
     * Puts the key that this pool wants into Pi. A pool with no key left gives Pi's own sign-in back, and the next
     * request uses it as it did before this module was on.
     */
    #ensure(provider: string): void {
        const pool = this.#state.providers[provider];
        const existing = this.#inForce.get(provider);
        const wanted =
            pool === undefined || pool.keys.length === 0
                ? undefined
                : this.#wanted(pool, Date.now());

        if (wanted === undefined) {
            if (existing !== undefined) {
                existing.dispose();
                this.#inForce.delete(provider);
            }

            return;
        }

        if (existing?.id === wanted.id) {
            return;
        }

        try {
            // Newest first: Pi then has this key, and removing the one before changes nothing.
            const dispose = this.#host.registerModelProvider(provider, { apiKey: wanted.secret });

            existing?.dispose();
            this.#inForce.set(provider, { id: wanted.id, dispose });

            if (pool.current !== wanted.id) {
                pool.current = wanted.id;
            }
        } catch (error) {
            this.#host.notice(
                "warning",
                `API key pools: Pi refused the key "${wanted.label}" for ${provider}: ${tell(error)}`,
            );
        }
    }

    /** Notes which provider a conversation talks to, from the request that it just made. */
    learn(conversationId: number, provider: string | undefined): void {
        if (typeof provider !== "string" || !PROVIDER.test(provider)) {
            return;
        }

        this.#providers.set(conversationId, provider);
        this.#last = provider;

        if (this.#providers.size > 2000) {
            // Only a hint, so the oldest entry can go.
            const oldest = this.#providers.keys().next();

            if (!oldest.done) {
                this.#providers.delete(oldest.value);
            }
        }
    }

    /**
     * Before each request: the key of the conversation that asks. A balanced pool hands a new conversation the key
     * that carried the least, and keeps it there while the conversation works, so the provider's prompt cache lasts.
     *
     * `exact` is the provider of a request that Pi has built already: then this also pins the conversation to the key
     * that the request went out with, which is the one in force, rather than choosing another one now.
     */
    turn(conversationId: number, exact?: string): void {
        const provider = exact ?? this.#providers.get(conversationId) ?? this.#last;

        if (provider === undefined) {
            return;
        }

        const pool = this.#state.providers[provider];

        if (pool === undefined || pool.keys.length === 0) {
            return;
        }

        const now = Date.now();
        let changed = this.#recover(pool, now);
        let key: PoolKey | undefined;

        if (pool.mode === "balanced") {
            const conversation = String(conversationId);
            const current = keyOf(pool, pool.current);

            if (
                exact !== undefined &&
                pool.picks[conversation] === undefined &&
                current !== undefined
            ) {
                // The request is built: the key that it went out with is the one that this conversation uses.
                pool.picks[conversation] = { id: current.id, at: now };
                prunePicks(pool, now);
                changed = true;
            } else {
                key = pickFor(pool, conversation, now, this.#metric());

                if (key !== undefined && pool.picks[conversation]?.id !== key.id) {
                    pool.picks[conversation] = { id: key.id, at: now };
                    prunePicks(pool, now);
                    changed = true;
                }
            }
        } else {
            key = pickSequential(pool, now);
        }

        if (key !== undefined && pool.current !== key.id) {
            pool.current = key.id;
            changed = true;
        }

        if (changed) {
            this.#save();
        }

        this.#ensure(provider);
    }

    /** After each answer: what the key in force carried, and whether the provider turned it down. */
    observe(conversationId: number, message: ProviderMessage): void {
        const provider = message.provider;

        this.learn(conversationId, provider);

        if (provider === undefined) {
            return;
        }

        const pool = this.#state.providers[provider];

        if (pool === undefined || pool.keys.length === 0) {
            return;
        }

        const now = Date.now();
        const key = keyOf(pool, pool.current);
        const failed = message.stopReason === "error";

        if (key === undefined) {
            return;
        }

        addUsage(
            key,
            {
                input: message.usage?.input,
                output: message.usage?.output,
                cacheRead: message.usage?.cacheRead,
                cacheWrite: message.usage?.cacheWrite,
                cost: message.usage?.cost?.total,
                error: failed,
            },
            now,
        );
        this.#save();

        if (!failed) {
            return;
        }

        const failure = classifyFailure(message.errorMessage);

        if (failure !== undefined) {
            this.#retire(provider, pool, key, failure, now);
        }
    }

    /** Takes the key that failed out of the pool's rotation, and moves to the next key that can work. */
    #retire(provider: string, pool: Pool, key: PoolKey, failure: Failure, now: number): void {
        if (failure.kind === "cooling") {
            const until = now + this.#count("cooldown", 10) * 60_000;

            if ((key.coolUntil ?? 0) < until) {
                key.coolUntil = until;
            }
        } else if (key.usedUpAt === undefined) {
            key.usedUpAt = now;
            key.usedUpReason = failure.why;
            delete key.coolUntil;
        }

        const next = pickAfter(pool, key.id, now, this.#metric());

        if (next !== undefined && next.id !== key.id) {
            pool.current = next.id;
            this.#ensure(provider);
            this.#tell(
                `${provider}:${key.id}:${failure.kind}`,
                "info",
                `API key pools: "${key.label}" for ${provider} ${failure.why}. Now using "${next.label}".`,
            );

            return;
        }

        const rest = failure.kind === "cooling" ? "right now" : "until you add one";

        this.#tell(
            `${provider}:${failure.kind}:none`,
            "warning",
            `API key pools: "${key.label}" for ${provider} ${failure.why}, and no other key can work ${rest}.`,
        );
    }

    /** Reports something about a pool, at most once in a while, so a retry loop cannot flood the app. */
    #tell(id: string, level: NoticeLevel, message: string): void {
        if (!this.#flag("notify", true)) {
            return;
        }

        const now = Date.now();

        if (now - (this.#told.get(id) ?? 0) < TELL_MINUTES * 60_000) {
            return;
        }

        this.#told.set(id, now);
        this.#host.notice(level, message);
    }

    // ── The page ─────────────────────────────────────────────────────────────

    /** What the page shows: the pools, and never a key itself. */
    async view(): Promise<unknown> {
        const now = Date.now();
        const stored = await this.#storedSignIns();

        return {
            providers: Object.entries(this.#state.providers).map(([provider, pool]) => ({
                provider,
                mode: pool.mode,
                current: pool.current ?? null,
                inForce: this.#inForce.has(provider),
                storedSignIn: stored.has(provider),
                keys: pool.keys.map((key) => ({
                    id: key.id,
                    label: key.label,
                    hint: maskSecret(key.secret),
                    usable: usable(key, now),
                    usedUpAt: key.usedUpAt ?? null,
                    usedUpReason: key.usedUpReason ?? null,
                    coolUntil:
                        typeof key.coolUntil === "number" && key.coolUntil > now
                            ? key.coolUntil
                            : null,
                    usage: key.usage,
                })),
            })),
            known: await this.#known(),
            catalog: Object.entries(this.#catalog)
                .map(([id, entry]) => ({ id, name: entry.name, models: entry.models }))
                .sort((left, right) => left.name.localeCompare(right.name)),
            signedIn: [...stored].sort(),
            settings: {
                balance: this.#metric(),
                cooldown: this.#count("cooldown", 10),
                recover: this.#count("recover", 0),
                notify: this.#flag("notify", true),
            },
            at: now,
        };
    }

    /** Adds one key to a pool, which is also made when it is new. */
    async add(provider: string, label: string, secret: string): Promise<void> {
        let pool = this.#state.providers[provider];

        if (pool === undefined) {
            if (Object.keys(this.#state.providers).length >= MAX_PROVIDERS) {
                throw this.#web.error(
                    409,
                    `There are ${MAX_PROVIDERS} pools already. Remove one first.`,
                );
            }

            pool = emptyPool();
            this.#state.providers[provider] = pool;
        }

        if (pool.keys.length >= MAX_KEYS) {
            throw this.#web.error(409, `A pool holds ${MAX_KEYS} keys at most. Remove one first.`);
        }

        if (pool.keys.some((key) => key.secret === secret)) {
            throw this.#web.error(409, `That key is in the ${provider} pool already.`);
        }

        const key = addKey(this.#state, pool, { label, secret }, Date.now());

        this.#hide(key);
        this.#ensure(provider);
        await this.flush();
        this.#web.send("changed");
    }

    /** Removes one key. The pool goes with its last key, and Pi's own sign-in comes back. */
    async remove(provider: string, id: string): Promise<void> {
        const pool = this.#pool(provider);
        const index = pool.keys.findIndex((key) => key.id === id);

        if (index < 0) {
            throw this.#web.error(404, "That key is not in the pool anymore.");
        }

        const [gone] = pool.keys.splice(index, 1);
        const secret = gone?.secret ?? "";

        this.#hidden.get(secret)?.();
        this.#hidden.delete(secret);

        for (const [conversation, pick] of Object.entries(pool.picks)) {
            if (pick.id === id) {
                delete pool.picks[conversation];
            }
        }

        if (pool.keys.length === 0) {
            delete this.#state.providers[provider];
        } else if (pool.current === id) {
            pool.current = pickSequential(pool, Date.now())?.id ?? pool.keys[0]?.id;
        }

        this.#ensure(provider);
        await this.flush();
        this.#web.send("changed");
    }

    /** Changes how a pool takes turns. */
    async mode(provider: string, mode: Mode): Promise<void> {
        this.#pool(provider).mode = mode;
        await this.flush();
        this.#web.send("changed");
    }

    /** Puts one key in force now, whatever the mode would choose. */
    async use(provider: string, id: string): Promise<void> {
        const pool = this.#pool(provider);
        const key = keyOf(pool, id);

        if (key === undefined) {
            throw this.#web.error(404, "That key is not in the pool anymore.");
        }

        delete key.usedUpAt;
        delete key.usedUpReason;
        delete key.coolUntil;
        pool.current = key.id;
        this.#ensure(provider);
        await this.flush();
        this.#web.send("changed");
    }

    /** Marks a key used up, or brings it back, by hand. */
    async used(provider: string, id: string, used: boolean): Promise<void> {
        const pool = this.#pool(provider);
        const key = keyOf(pool, id);

        if (key === undefined) {
            throw this.#web.error(404, "That key is not in the pool anymore.");
        }

        if (used) {
            key.usedUpAt = Date.now();
            key.usedUpReason = "set used up by hand";
            delete key.coolUntil;
        } else {
            delete key.usedUpAt;
            delete key.usedUpReason;
            delete key.coolUntil;
        }

        this.#ensure(provider);
        await this.flush();
        this.#web.send("changed");
    }

    /** Forgets what a key carried, and gives it another chance. */
    async reset(provider: string, id: string): Promise<void> {
        const pool = this.#pool(provider);
        const key = keyOf(pool, id);

        if (key === undefined) {
            throw this.#web.error(404, "That key is not in the pool anymore.");
        }

        key.usage = {
            requests: 0,
            errors: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            lastAt: 0,
        };
        delete key.usedUpAt;
        delete key.usedUpReason;
        delete key.coolUntil;
        this.#ensure(provider);
        await this.flush();
        this.#web.send("changed");
    }

    /** Removes a whole pool. */
    async drop(provider: string): Promise<void> {
        const pool = this.#pool(provider);

        for (const key of pool.keys) {
            this.#hidden.get(key.secret)?.();
            this.#hidden.delete(key.secret);
        }

        delete this.#state.providers[provider];
        this.#ensure(provider);
        await this.flush();
        this.#web.send("changed");
    }

    /** A pool, or an error for a page that asked about one that is not there. */
    #pool(provider: string): Pool {
        const pool = this.#state.providers[provider];

        if (pool === undefined) {
            throw this.#web.error(404, `There is no pool for ${provider}.`);
        }

        return pool;
    }
}

/** A provider id from a request, checked. */
function checkProvider(web: Web, value: unknown): string {
    const provider = typeof value === "string" ? value.trim().toLowerCase() : "";

    if (!PROVIDER.test(provider)) {
        throw web.error(
            400,
            "A provider is the id Pi knows, such as anthropic or openrouter: small letters, digits, dots, and dashes.",
        );
    }

    return provider;
}

/** A label from a request, checked. */
function checkLabel(web: Web, value: unknown): string {
    const label = typeof value === "string" ? value.trim() : "";

    if (label === "" || [...label].length > MAX_LABEL || UNSAFE.test(label)) {
        throw web.error(400, `A name for the key is 1 to ${MAX_LABEL} characters, on one line.`);
    }

    return label;
}

/** A key from a request, checked. */
function checkSecret(web: Web, value: unknown): string {
    const secret = typeof value === "string" ? value.trim() : "";

    if (
        [...secret].length < MIN_SECRET ||
        secret.length > MAX_SECRET ||
        /\s/.test(secret) ||
        UNSAFE.test(secret)
    ) {
        throw web.error(
            400,
            `A key is ${MIN_SECRET} to ${MAX_SECRET} characters with no spaces in it, as the provider gave it.`,
        );
    }

    return secret;
}

/** A key id from a request, checked. */
function checkId(web: Web, value: unknown): string {
    const id = typeof value === "string" ? value : "";

    if (!/^k\d+$/.test(id)) {
        throw web.error(400, "A key id looks like k1.");
    }

    return id;
}

export default async function createMultiKey(host: Host, web?: Web) {
    if (web === undefined) {
        // A server from before the web part of modules has no page and no route for the pools.
        return;
    }

    const engine = new Engine(host, web);

    await engine.load();

    web.onDispose(() => engine.dispose());
    web.settings(SETTINGS);
    web.onSettings(() => void engine.flush());
    web.client("multikey", { access: "owner" });

    web.route("GET", "state", () => engine.view());

    web.route("POST", "add", async (request) => {
        await engine.add(
            checkProvider(web, request.body.provider),
            checkLabel(web, request.body.label),
            checkSecret(web, request.body.secret),
        );

        return engine.view();
    });

    web.route("POST", "remove", async (request) => {
        await engine.remove(
            checkProvider(web, request.body.provider),
            checkId(web, request.body.id),
        );

        return engine.view();
    });

    web.route("POST", "mode", async (request) => {
        const mode = request.body.mode;

        if (mode !== "sequential" && mode !== "balanced") {
            throw web.error(400, "A mode is sequential or balanced.");
        }

        await engine.mode(checkProvider(web, request.body.provider), mode);

        return engine.view();
    });

    web.route("POST", "use", async (request) => {
        await engine.use(checkProvider(web, request.body.provider), checkId(web, request.body.id));

        return engine.view();
    });

    web.route("POST", "used", async (request) => {
        const used = request.body.used;

        if (typeof used !== "boolean") {
            throw web.error(400, "used is true or false.");
        }

        await engine.used(
            checkProvider(web, request.body.provider),
            checkId(web, request.body.id),
            used,
        );

        return engine.view();
    });

    web.route("POST", "reset", async (request) => {
        await engine.reset(
            checkProvider(web, request.body.provider),
            checkId(web, request.body.id),
        );

        return engine.view();
    });

    web.route("POST", "drop", async (request) => {
        await engine.drop(checkProvider(web, request.body.provider));

        return engine.view();
    });

    return defineExtension({
        name: "multikey",
        hooks: [
            hook(GenerationTask, {
                // Before the request is built, so the key it switches to is the one that request uses.
                beforeRequest: (_request, api) => {
                    engine.turn(api.conversationId);

                    return undefined;
                },
                // Which provider a conversation talks to: the request itself says so.
                beforeProviderRequest: (request, api) => {
                    const provider = request.model?.provider;

                    engine.learn(api.conversationId, provider);
                    engine.learnCatalog(api.models);

                    if (provider !== undefined) {
                        engine.turn(api.conversationId, provider);
                    }

                    return undefined;
                },
                afterResponse: (message, api) => {
                    engine.learnCatalog(api.models);
                    engine.observe(api.conversationId, message as ProviderMessage);
                },
            }),
        ],
    });
}
