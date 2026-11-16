import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What a key pool must be able to do, asked of Pi's own runtime: a provider that Pi is signed in to with an API key
 * sends the pool's key when the registration carries it in a header. The tests talk to a server of their own, and skip
 * without Pi Pocket's packages.
 */
async function pi() {
    let module: typeof import("@earendil-works/pi-coding-agent");

    try {
        module = await import("@earendil-works/pi-coding-agent");
    } catch {
        return undefined;
    }

    return module;
}

/** A server that keeps the headers of each request, and answers a stream with one word. */
function mock() {
    const seen: Record<string, string>[] = [];
    const server = createServer((request, response) => {
        const headers: Record<string, string> = {};

        for (const [name, value] of Object.entries(request.headers)) {
            headers[name] = Array.isArray(value) ? value.join(",") : String(value ?? "");
        }

        seen.push(headers);
        request.resume();
        response.writeHead(200, { "content-type": "text/event-stream" });

        const chat = String(request.url ?? "").includes("chat/completions");
        const lines = chat
            ? [
                  'data: {"id":"x","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}',
                  'data: {"id":"x","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
                  "data: [DONE]",
              ]
            : [
                  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"claude-sonnet-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
                  'event: message_stop\ndata: {"type":"message_stop"}',
              ];

        for (const line of [...lines, ""]) {
            response.write(line + "\n");
        }

        response.end();
    });

    return { seen, server };
}

const context = {
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
} as never;

test("a stored sign-in wins over a registered key, and a header wins over both", async (t) => {
    const module = await pi();

    if (module === undefined) {
        t.skip("Pi Pocket's packages are not here.");

        return;
    }

    const { seen, server } = mock();

    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));

    const baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
    const root = await mkdtemp(join(tmpdir(), "multikey-priority-"));
    const authPath = join(root, "auth.json");

    await writeFile(
        authPath,
        JSON.stringify({
            anthropic: { type: "api_key", key: "sk-stored-anthropic" },
            openai: { type: "api_key", key: "sk-stored-openai" },
        }),
        "utf8",
    );

    const models = await module.ModelRuntime.create({
        authPath,
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });

    /** Registers a provider, sends one request, and gives the headers that the server saw. */
    const send = async (provider: string, config: Record<string, unknown>) => {
        models.registerProvider(provider, config as never);

        const model = models.getModels(provider)[0] as never;

        try {
            for await (const _event of models.streamSimple(model, context)) {
                // The mock's stream is not the point: its headers are.
            }
        } catch {
            // A stream that the mock does not end cleanly still sent its request.
        }

        return seen.at(-1) ?? {};
    };

    try {
        const onlyKey = await send("anthropic", { baseUrl, apiKey: "sk-pool" });

        assert.equal(onlyKey["x-api-key"], "sk-stored-anthropic");

        const withHeader = await send("anthropic", {
            baseUrl,
            apiKey: "sk-pool",
            headers: { "x-api-key": "sk-pool-header" },
        });

        assert.equal(withHeader["x-api-key"], "sk-pool-header");

        const bearer = await send("openai", {
            baseUrl,
            apiKey: "sk-pool",
            headers: { Authorization: "Bearer sk-pool-header" },
        });

        assert.equal(bearer["authorization"], "Bearer sk-pool-header");
    } finally {
        server.close();
    }
});
