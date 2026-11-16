import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import createMultiKey from "../multikey.ts";

/** What a module can be asked to do, as Pi Pocket would call it. */
type Handlers = Record<string, (...args: unknown[]) => unknown>;

/**
 * A module on a folder of its own, with a host and a web part that keep what the module does. `signIns` are Pi's own
 * sign-ins, by provider, with the kind of sign-in: `api_key` or `oauth`.
 */
async function harness(options: { signIns?: Record<string, string> } = {}) {
    const root = await mkdtemp(join(tmpdir(), "multikey-"));
    const dataDir = join(root, "data");
    const agentDir = join(root, "agent");

    await mkdir(dataDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });

    if (options.signIns !== undefined) {
        const signIns = Object.fromEntries(
            Object.entries(options.signIns).map(([provider, type]) => [
                provider,
                { type, key: "sk-stored" },
            ]),
        );

        await writeFile(join(agentDir, "auth.json"), JSON.stringify(signIns), "utf8");
    }

    /** Every registration that Pi took, in order, and every one that the module gave back. */
    const registered: {
        provider: string;
        apiKey: string;
        headers?: Record<string, string>;
    }[] = [];
    const givenBack: string[] = [];
    const notices: { level: string; message: string }[] = [];
    const routes = new Map<string, (request: { body: Record<string, unknown> }) => unknown>();
    const settings = new Map<string, unknown>([
        ["notify", true],
        ["balance", "tokens"],
        ["cooldown", 10],
        ["recover", 0],
    ]);
    const disposers: (() => unknown)[] = [];

    const host = {
        dataDir,
        agentDir,
        registerModelProvider(
            provider: string,
            config: { apiKey: string; headers?: Record<string, string> },
        ) {
            registered.push(
                config.headers === undefined
                    ? { provider, apiKey: config.apiKey }
                    : { provider, apiKey: config.apiKey, headers: config.headers },
            );

            return () => {
                givenBack.push(config.apiKey);
            };
        },
        notice(level: string, message: string) {
            notices.push({ level, message });
        },
    };

    const web = {
        route(_method: string, path: string, handler: never) {
            routes.set(path, handler);
        },
        client() {},
        send() {},
        error(status: number, message: string) {
            return Object.assign(new Error(message), { status });
        },
        settings() {},
        setting(name: string) {
            return settings.get(name);
        },
        onSettings() {},
        onDispose(dispose: () => unknown) {
            disposers.push(dispose);
        },
    };

    const extension = (await createMultiKey(host as never, web as never)) as {
        hooks?: { handlers: Handlers }[];
    };
    const handlers = extension?.hooks?.[0]?.handlers ?? {};

    /** Pi's providers, as its model runtime lists them to a hook. A test sets these. */
    const catalog: { id: string; name: string; getModels(): unknown[] }[] = [];
    const models = { getProviders: () => catalog };

    /**
     * One request of a conversation, in the order that Pi makes it: the request, then the provider and its API, which
     * the model names.
     */
    const request = async (conversationId: number, provider: string, api?: string) => {
        await handlers["beforeRequest"]?.({ messages: [] }, { conversationId, models }, {});
        await handlers["beforeProviderRequest"]?.(
            { model: { provider, api } },
            { conversationId, models },
            {},
        );
    };

    /** The terminal answer of the model, as the generation task reports it. */
    const answer = async (conversationId: number, message: Record<string, unknown>) => {
        await handlers["afterResponse"]?.(message, { conversationId, models }, {});
    };

    /** A route of the module, as the page calls it. */
    const call = async (path: string, body: Record<string, unknown>) => {
        const handler = routes.get(path);

        assert.ok(handler !== undefined, `there is no route ${path}`);

        return (await handler({ body })) as {
            providers: {
                provider: string;
                mode: string;
                current: string | null;
                storedSignIn: boolean;
                keys: {
                    id: string;
                    label: string;
                    usedUpAt: number | null;
                    usage: { input: number };
                }[];
            }[];
            catalog: { id: string; name: string; models: number }[];
            signedIn: string[];
            known: string[];
        };
    };

    return {
        dataDir,
        agentDir,
        catalog,
        registered,
        givenBack,
        notices,
        handlers,
        request,
        answer,
        call,
        state: () => call("state", {}),
        file: join(dataDir, "multikey", "keys.json"),
        soak: () => new Promise((resolve) => setTimeout(resolve, 350)),
        start: () => createMultiKey(host as never, web as never),
        dispose: () => {
            for (const dispose of disposers) {
                dispose();
            }
        },
    };
}

test("a key that the owner adds goes into Pi, and into the file", async () => {
    const h = await harness();

    const view = await h.call("add", {
        provider: "anthropic",
        label: "Work",
        secret: "sk-ant-work-11111111",
    });

    assert.deepEqual(h.registered, [{ provider: "anthropic", apiKey: "sk-ant-work-11111111" }]);
    assert.equal(view.providers[0]?.provider, "anthropic");
    assert.equal(view.providers[0]?.current, "k1");
    assert.equal(view.providers[0]?.keys[0]?.label, "Work");

    const file = JSON.parse(await readFile(h.file, "utf8"));

    assert.equal(file.providers.anthropic.keys[0].secret, "sk-ant-work-11111111");
    assert.equal(file.providers.anthropic.mode, "sequential");
});

test("a pool with two keys keeps the first one until the provider says its quota is gone", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await h.call("add", { provider: "anthropic", label: "Two", secret: "sk-ant-two-22222222" });

    // The second key is added, but the first one is still the key in force.
    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-one-11111111" });

    await h.request(1, "anthropic");
    await h.answer(1, {
        provider: "anthropic",
        stopReason: "error",
        errorMessage: "400 Your credit balance is too low to access the Anthropic API",
        usage: { input: 900, output: 20, cost: { total: 0.01 } },
    });

    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-two-22222222" });
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0]?.message ?? "", /One.*credit.*Now using "Two"/u);

    const view = await h.state();

    assert.equal(view.providers[0]?.keys[0]?.usedUpAt !== null, true);
    assert.equal(view.providers[0]?.current, "k2");
});

test("a rate limit rests the key for a while instead of using it up", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await h.call("add", { provider: "anthropic", label: "Two", secret: "sk-ant-two-22222222" });
    await h.request(1, "anthropic");
    await h.answer(1, {
        provider: "anthropic",
        stopReason: "error",
        errorMessage: "429 rate_limit_error: too many requests",
    });

    const view = await h.state();
    const used = view.providers[0]?.keys[0] as unknown as { coolUntil: number | null };

    assert.equal(view.providers[0]?.keys[0]?.usedUpAt, null);
    assert.equal(typeof used.coolUntil, "number");
    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-two-22222222" });
});

test("balanced hands each new conversation the key that carried the least, and keeps it there", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await h.call("add", { provider: "anthropic", label: "Two", secret: "sk-ant-two-22222222" });
    await h.call("mode", { provider: "anthropic", mode: "balanced" });

    // Conversation 1 asks first, so it is the one that learns the provider; it gets the first key.
    await h.request(1, "anthropic");
    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-one-11111111" });

    // It carries a lot on that key, so the next conversation goes to the other one.
    await h.answer(1, {
        provider: "anthropic",
        stopReason: "stop",
        usage: { input: 50_000, output: 900 },
    });
    await h.request(2, "anthropic");
    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-two-22222222" });

    // Conversation 1 keeps its own key, though the other one is lighter now.
    await h.request(1, "anthropic");
    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-one-11111111" });
});

test("a key that the owner marks used up is skipped at once", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await h.call("add", { provider: "anthropic", label: "Two", secret: "sk-ant-two-22222222" });
    await h.call("used", { provider: "anthropic", id: "k1", used: true });

    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-two-22222222" });

    const view = await h.call("used", { provider: "anthropic", id: "k1", used: false });

    assert.equal(view.providers[0]?.keys[0]?.usedUpAt, null);
});

test("removing the last key gives the provider back to Pi's own sign-in", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await h.call("remove", { provider: "anthropic", id: "k1" });

    assert.deepEqual(h.givenBack, ["sk-ant-one-11111111"]);

    const view = await h.state();

    assert.equal(view.providers.length, 0);
});

test("a pool comes back after a restart, with the key that was in force", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await h.call("add", { provider: "anthropic", label: "Two", secret: "sk-ant-two-22222222" });
    await h.call("used", { provider: "anthropic", id: "k1", used: true });
    h.dispose();

    const again = { registered: h.registered.length };

    await h.start();

    assert.equal(h.registered.length, again.registered + 1);
    assert.deepEqual(h.registered.at(-1), { provider: "anthropic", apiKey: "sk-ant-two-22222222" });
});

test("Pi's own sign-in for a provider is reported, so the page can warn", async () => {
    const h = await harness({ signIns: { anthropic: "api_key" } });

    const view = await h.call("add", {
        provider: "anthropic",
        label: "One",
        secret: "sk-ant-one-11111111",
    });

    assert.equal(view.providers[0]?.storedSignIn, true);

    await h.call("add", { provider: "openai", label: "Two", secret: "sk-openai-two-2222" });

    const state = await h.state();

    assert.equal(state.providers.find((pool) => pool.provider === "openai")?.storedSignIn, false);
});

test("a key, a name, and a provider are checked before anything is stored", async () => {
    const h = await harness();

    await assert.rejects(
        h.call("add", { provider: "anthropic api", label: "One", secret: "sk-ant-one-11111111" }),
        /small letters/u,
    );
    await assert.rejects(
        h.call("add", { provider: "anthropic", label: "One", secret: "sk ant one" }),
        /no spaces/u,
    );
    await assert.rejects(
        h.call("add", { provider: "anthropic", label: "", secret: "sk-ant-one-11111111" }),
        /1 to 40/u,
    );
    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });
    await assert.rejects(
        h.call("add", { provider: "anthropic", label: "Again", secret: "sk-ant-one-11111111" }),
        /already/u,
    );

    assert.equal(h.registered.length, 1);

    // A provider is taken as it is typed, in any case: Pi knows it in small letters.
    const view = await h.call("add", {
        provider: " Anthropic ",
        label: "Upper",
        secret: "sk-ant-upper-33333333",
    });

    assert.equal(view.providers[0]?.provider, "anthropic");
});

test("the page lists the providers that Pi reports, with their models", async () => {
    const h = await harness();

    h.catalog.push(
        { id: "openrouter", name: "OpenRouter", getModels: () => [1] },
        { id: "anthropic", name: "Anthropic", getModels: () => [1, 2, 3] },
    );

    // The list comes from a hook: only a request can see Pi's model runtime.
    await h.request(1, "anthropic");

    const view = await h.state();

    assert.deepEqual(view.catalog, [
        { id: "anthropic", name: "Anthropic", models: 3 },
        { id: "openrouter", name: "OpenRouter", models: 1 },
    ]);
});

test("the list of providers is kept for the next start, before any request", async () => {
    const h = await harness();

    h.catalog.push({ id: "anthropic", name: "Anthropic", getModels: () => [1, 2] });
    await h.request(1, "anthropic");
    await h.soak();

    await h.start();

    const view = await h.state();

    assert.deepEqual(view.catalog, [{ id: "anthropic", name: "Anthropic", models: 2 }]);
});

test("a provider that Pi has a sign-in for is marked in the list", async () => {
    const h = await harness({ signIns: { anthropic: "api_key" } });

    h.catalog.push({ id: "anthropic", name: "Anthropic", getModels: () => [1] });
    await h.request(1, "anthropic");

    const view = await h.state();

    assert.deepEqual(view.signedIn, ["anthropic"]);
});

test("a pool's key goes out in place of Pi's own API key", async () => {
    const h = await harness({ signIns: { anthropic: "api_key" } });

    h.catalog.push({
        id: "anthropic",
        name: "Anthropic",
        getModels: () => [{ api: "anthropic-messages" }],
    });

    // A request teaches the module the API, and the API says which header carries a key.
    await h.request(1, "anthropic", "anthropic-messages");

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });

    assert.deepEqual(h.registered.at(-1), {
        provider: "anthropic",
        apiKey: "sk-ant-one-11111111",
        headers: { "x-api-key": "sk-ant-one-11111111" },
    });
});

test("a provider of the OpenAI API gets a bearer header", async () => {
    const h = await harness();

    await h.request(1, "openai", "openai-completions");
    await h.call("add", { provider: "openai", label: "One", secret: "sk-openai-one-1111" });

    assert.deepEqual(h.registered.at(-1), {
        provider: "openai",
        apiKey: "sk-openai-one-1111",
        headers: { Authorization: "Bearer sk-openai-one-1111" },
    });
});

test("a subscription sign-in is left alone, and the pool's key waits", async () => {
    const h = await harness({ signIns: { anthropic: "oauth" } });

    await h.request(1, "anthropic", "anthropic-messages");
    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });

    assert.deepEqual(h.registered.at(-1), {
        provider: "anthropic",
        apiKey: "sk-ant-one-11111111",
    });
});

test("a key registered before the API is known goes in without a header, and again with one", async () => {
    const h = await harness();

    await h.call("add", { provider: "anthropic", label: "One", secret: "sk-ant-one-11111111" });

    assert.deepEqual(h.registered.at(-1), {
        provider: "anthropic",
        apiKey: "sk-ant-one-11111111",
    });

    await h.request(1, "anthropic", "anthropic-messages");

    assert.deepEqual(h.registered.at(-1), {
        provider: "anthropic",
        apiKey: "sk-ant-one-11111111",
        headers: { "x-api-key": "sk-ant-one-11111111" },
    });
});
