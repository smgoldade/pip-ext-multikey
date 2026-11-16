import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Pi's own model runtime: the part that holds a provider's key and its models. This is what Pi Pocket hands
 * \`host.registerModelProvider\`, so these tests ask it what a pool can and cannot do. They need Pi Pocket's packages
 * beside this repository (the \`node_modules\` link that the README describes), and skip without them.
 */
async function runtime(signIns?: Record<string, unknown>) {
    let pi: typeof import("@earendil-works/pi-coding-agent");

    try {
        pi = await import("@earendil-works/pi-coding-agent");
    } catch {
        return undefined;
    }

    const root = await mkdtemp(join(tmpdir(), "multikey-runtime-"));
    const authPath = join(root, "auth.json");

    if (signIns !== undefined) {
        await writeFile(authPath, JSON.stringify(signIns), "utf8");
    }

    return await pi.ModelRuntime.create({
        authPath,
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
}

/** The key that Pi would send for a model, as the runtime resolves it. */
async function keyInForce(models: { getAuth(model: never): Promise<unknown> }, model: unknown) {
    const auth = (await models.getAuth(model as never)) as
        { auth?: { apiKey?: string } } | undefined;

    return auth?.auth?.apiKey;
}

test("a provider given only an API key keeps all of its models", async (t) => {
    const models = await runtime();

    if (models === undefined) {
        t.skip("Pi Pocket's packages are not here.");

        return;
    }

    const before = models.getModels("anthropic").length;

    models.registerProvider("anthropic", { apiKey: "sk-ant-pool-11111111" });

    assert.ok(before > 5, "a built-in provider has a catalog to begin with");
    assert.equal(models.getModels("anthropic").length, before);
    assert.equal(
        await keyInForce(models, models.getModels("anthropic")[0]),
        "sk-ant-pool-11111111",
    );
});

test("the newest registration is the key in force, and the one before changes nothing", async (t) => {
    const models = await runtime();

    if (models === undefined) {
        t.skip("Pi Pocket's packages are not here.");

        return;
    }

    const model = models.getModels("anthropic")[0];

    models.registerProvider("anthropic", { apiKey: "sk-ant-pool-11111111" });
    assert.equal(await keyInForce(models, model), "sk-ant-pool-11111111");

    // What a pool does when it switches: the new key's registration replaces the one in force.
    models.registerProvider("anthropic", { apiKey: "sk-ant-pool-22222222" });
    assert.equal(await keyInForce(models, model), "sk-ant-pool-22222222");

    // What it does when its last key goes: no registration, so Pi's own sign-in applies again.
    models.unregisterProvider("anthropic");
    assert.equal(await keyInForce(models, model), undefined);
});

test("a key stored as a sign-in beats the one that a pool registers, which the page warns about", async (t) => {
    const models = await runtime({
        anthropic: { type: "api_key", key: "sk-ant-stored-00000000" },
    });

    if (models === undefined) {
        t.skip("Pi Pocket's packages are not here.");

        return;
    }

    models.registerProvider("anthropic", { apiKey: "sk-ant-pool-11111111" });

    assert.equal(
        await keyInForce(models, models.getModels("anthropic")[0]),
        "sk-ant-stored-00000000",
    );
});

test("a key that a pool gives makes a provider usable without a sign-in", async (t) => {
    const models = await runtime();

    if (models === undefined) {
        t.skip("Pi Pocket's packages are not here.");

        return;
    }

    models.registerProvider("anthropic", { apiKey: "sk-ant-pool-11111111" });

    const check = await models.checkAuth("anthropic");

    assert.equal(check?.type, "api_key");
});
