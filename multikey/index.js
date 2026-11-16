// API key pools' browser module: the "API keys" button on the rail, the sheet in the menu, and the page. It lists
// Pi's providers the way Menu → Providers does, and each provider holds its own pool of keys with its own mode.
// The page never shows a key: the server sends a hint.

/** The version of `pocket` this module was written for. */
export const pocketApi = 1;

/** A count of tokens, short enough for a phone. */
function tokens(count) {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }

    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
    }

    return String(count);
}

/** An amount of money, short enough for a phone. */
function money(amount) {
    if (amount >= 1) {
        return `${amount.toFixed(2)}`;
    }

    return amount > 0 ? "<0.01" : "0";
}

/** How long ago, or how long until, in a few words. */
function when(at, now) {
    const seconds = Math.round((at - now) / 1000);
    const ahead = seconds > 0;
    const left = Math.abs(seconds);
    const words =
        left < 60
            ? `${left}s`
            : left < 3600
              ? `${Math.round(left / 60)}m`
              : left < 86_400
                ? `${Math.round(left / 3600)}h`
                : `${Math.round(left / 86_400)}d`;

    return ahead ? `in ${words}` : `${words} ago`;
}

/** The models of a provider, as its row says them. */
function modelCount(models) {
    if (typeof models !== "number" || models <= 0) {
        return "";
    }

    return `${models} model${models === 1 ? "" : "s"}`;
}

export default function setup(pocket) {
    const { html, useEffect, useState, Loader } = pocket;

    // The page's own styles, in the app's cascade layer (docs/extensions/browser-modules.md).
    pocket.style("style.css");

    function ApiKeys() {
        const [view, setView] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(null);
        const [query, setQuery] = useState("");
        // The provider whose pool shows, or `"new"` for the form that types a provider by hand.
        const [open, setOpen] = useState(null);
        const [name, setName] = useState("");
        const [secret, setSecret] = useState("");

        const show = (next) => {
            if (next !== undefined && next !== null) {
                setView(next);
            }
        };

        /** Runs one change: the control says it waits, and an error shows above the list. */
        const act = async (id, run) => {
            setBusy(id);

            try {
                show(await run());
                setError(null);
            } catch (failure) {
                setError(failure.message);
            } finally {
                setBusy(null);
            }
        };

        useEffect(() => {
            let live = true;
            const read = () =>
                pocket.api("state").then(
                    (next) => live && show(next),
                    (failure) => live && setError(failure.message),
                );

            void read();

            // Another tab, or a switch that this page made: read the pools again.
            const stop = pocket.on("changed", () => {
                pocket.api("state").then(
                    (next) => live && show(next),
                    () => {},
                );
            });

            return () => {
                live = false;
                stop();
            };
        }, []);

        if (error !== null && view === null) {
            return html`<div class="error-box">${error}</div>
                <button class="button" onClick=${() => act("reload", () => pocket.api("state"))}>
                    Try again
                </button>`;
        }

        if (view === null) {
            return html`<${Loader} label="Reading the key pools" />`;
        }

        const now = Date.now();
        const pools = new Map(view.providers.map((pool) => [pool.provider, pool]));
        const signed = new Set(view.signedIn ?? []);

        // Every provider that Pi lists, the ones it knows another way, and the ones with a pool already.
        const listed = new Map();

        for (const provider of view.catalog ?? []) {
            listed.set(provider.id, {
                id: provider.id,
                name: provider.name,
                models: provider.models,
            });
        }

        for (const id of view.known ?? []) {
            if (!listed.has(id)) {
                listed.set(id, { id, name: id, models: null });
            }
        }

        for (const pool of view.providers) {
            if (!listed.has(pool.provider)) {
                listed.set(pool.provider, { id: pool.provider, name: pool.provider, models: null });
            }
        }

        const needle = query.trim().toLowerCase();
        const match = (provider) =>
            needle === "" || `${provider.id} ${provider.name}`.toLowerCase().includes(needle);

        const all = [...listed.values()].sort((left, right) => left.name.localeCompare(right.name));
        const groups = [
            ["Your pools", all.filter((provider) => pools.has(provider.id) && match(provider))],
            [
                "Signed in in Pi",
                all.filter(
                    (provider) =>
                        !pools.has(provider.id) && signed.has(provider.id) && match(provider),
                ),
            ],
            [
                "Other providers",
                all.filter(
                    (provider) =>
                        !pools.has(provider.id) && !signed.has(provider.id) && match(provider),
                ),
            ],
        ].filter(([, each]) => each.length > 0);

        const addKey = (provider) => async (event) => {
            event.preventDefault();

            await act(`add ${provider}`, async () => {
                const next = await pocket.api("add", { provider, label: name, secret });

                setSecret("");

                return next;
            });
        };

        const addOther = async (event) => {
            event.preventDefault();

            const provider = open.id.trim().toLowerCase();

            await act("add-other", async () => {
                const next = await pocket.api("add", { provider, label: name, secret });

                setName("");
                setSecret("");
                setOpen({ provider, id: provider });

                return next;
            });
        };

        const keyRow = (
            pool,
            key,
        ) => html`<div class="mk-row ${key.id === pool.current ? "on" : ""}">
            <div class="mk-line">
                <span class="mk-name">
                    ${key.label}
                    ${key.id === pool.current ? html`<span class="mk-tag on">in use</span>` : null}
                    ${key.usedUpAt !== null ? html`<span class="mk-tag bad">used up</span>` : null}
                    ${
                        key.coolUntil !== null
                            ? html`<span class="mk-tag warn">
                              rests ${when(key.coolUntil, now)}
                          </span>`
                            : null
                    }
                </span>
                <span class="mono small muted">${key.hint}</span>
            </div>
            <div class="muted small">
                ${key.usage.requests} requests ·
                ${tokens(
                    key.usage.input + key.usage.output + key.usage.cacheRead + key.usage.cacheWrite,
                )} tokens · $${money(key.usage.cost)}
                ${key.usedUpAt !== null ? html`· <span>${key.usedUpReason}</span>` : null}
            </div>
            <div class="mk-actions">
                <button
                    class="button small"
                    disabled=${busy === "use" + key.id || key.id === pool.current}
                    onClick=${() =>
                        act("use" + key.id, () =>
                            pocket.api("use", { provider: pool.provider, id: key.id }),
                        )}
                >
                    Use now
                </button>
                <button
                    class="button small"
                    disabled=${busy === "used" + key.id}
                    onClick=${() =>
                        act("used" + key.id, () =>
                            pocket.api("used", {
                                provider: pool.provider,
                                id: key.id,
                                used: key.usedUpAt === null,
                            }),
                        )}
                >
                    ${key.usedUpAt === null ? "Used up" : "Bring back"}
                </button>
                <button
                    class="button small"
                    disabled=${busy === "reset" + key.id}
                    onClick=${() =>
                        act("reset" + key.id, () =>
                            pocket.api("reset", { provider: pool.provider, id: key.id }),
                        )}
                >
                    Reset usage
                </button>
                <button
                    class="button small"
                    disabled=${busy === "remove" + key.id}
                    onClick=${() =>
                        act("remove" + key.id, () =>
                            pocket.api("remove", { provider: pool.provider, id: key.id }),
                        )}
                >
                    Remove
                </button>
            </div>
        </div>`;

        const form = (provider, submit, label) => html`<form class="mk-form" onSubmit=${submit}>
            <div class="mk-head">${label}</div>
            <label class="mk-field">
                <span class="small muted">Name for it</span>
                <input
                    class="mk-input"
                    placeholder="Work"
                    maxlength="40"
                    value=${name}
                    onInput=${(event) => setName(event.currentTarget.value)}
                />
            </label>
            <label class="mk-field">
                <span class="small muted">API key</span>
                <input
                    class="mk-input mono"
                    type="password"
                    autocomplete="off"
                    placeholder="sk-…"
                    value=${secret}
                    onInput=${(event) => setSecret(event.currentTarget.value)}
                />
            </label>
            <button
                class="button primary"
                type="submit"
                disabled=${busy !== null || name === "" || secret === "" || provider === ""}
            >
                Add key
            </button>
        </form>`;

        const detail = () => {
            const pool = pools.get(open.provider);
            const entry = listed.get(open.provider);
            const title = entry?.name ?? open.provider;

            return html`<div class="mk-page">
                <button class="button small ghost mk-back" onClick=${() => setOpen(null)}>
                    ‹ All providers
                </button>

                <div class="mk-title">
                    <span class="mk-title-name">${title}</span>
                    <span class="mono small muted">${open.provider}</span>
                </div>
                <div class="muted small">
                    ${modelCount(entry?.models)}
                    ${modelCount(entry?.models) !== "" ? " · " : ""}
                    ${signed.has(open.provider) ? "signed in in Pi" : "no sign-in in Pi"}
                </div>

                ${error !== null ? html`<div class="error-box">${error}</div>` : null}

                ${
                    signed.has(open.provider)
                        ? html`<div class="error-box">
                          Pi sends its own key for this provider before any key of the pool. Sign out of
                          it in Menu → Providers to use these keys.
                      </div>`
                        : null
                }

                ${
                    pool !== undefined && pool.inForce
                        ? html`<p class="muted small">
                          Menu → Providers lists this provider as signed in while a pool key is in
                          force, and its Log out leaves the pool key in place: the keys are here.
                      </p>`
                        : null
                }

                <div class="mk-head">
                    <span>Keys</span>
                    <span class="mk-modes">
                        ${["sequential", "balanced"].map(
                            (mode) =>
                                html`<button
                                class="button mk-mode ${pool?.mode === mode ? "on" : ""}"
                                disabled=${busy === "mode" + mode || pool === undefined}
                                onClick=${() =>
                                    act("mode" + mode, () =>
                                        pocket.api("mode", { provider: open.provider, mode }),
                                    )}
                            >
                                ${mode}
                            </button>`,
                        )}
                    </span>
                </div>
                <p class="muted small">
                    ${
                        pool === undefined
                            ? "A pool needs a key first. Then choose how its keys take turns."
                            : pool.mode === "balanced"
                              ? `Each new session or subagent takes the key that carried the least (${
                                    view.settings.balance
                                }), and keeps it while it works.`
                              : "A key stays in use until the provider says its quota is gone, then the next key takes over."
                    }
                </p>

                ${(pool?.keys ?? []).map((key) => keyRow(pool, key))}

                ${form(open.provider, addKey(open.provider), pool === undefined ? "Add the first key" : "Add another key")}

                ${
                    pool !== undefined
                        ? html`<button
                          class="button small"
                          disabled=${busy === "drop"}
                          onClick=${() =>
                              act("drop", () => pocket.api("drop", { provider: open.provider }))}
                      >
                          Remove the pool
                      </button>`
                        : null
                }
            </div>`;
        };

        if (open !== null) {
            if (open.provider === "") {
                return html`<div class="mk-page">
                    <button class="button small ghost mk-back" onClick=${() => setOpen(null)}>
                        ‹ All providers
                    </button>
                    <div class="mk-title">
                        <span class="mk-title-name">Another provider</span>
                    </div>
                    <p class="muted small">
                        The id Pi uses for it, in small letters: <span class="mono">anthropic</span>, <span class="mono">openrouter</span>, the id of
                        an endpoint of your own.
                    </p>
                    <label class="mk-field">
                        <span class="small muted">Provider</span>
                        <input
                            class="mk-input mono"
                            placeholder="anthropic"
                            value=${open.id}
                            onInput=${(event) => setOpen({ provider: "", id: event.currentTarget.value })}
                        />
                    </label>
                    ${error !== null ? html`<div class="error-box">${error}</div>` : null}
                    ${form(open.id.trim().toLowerCase(), addOther, "Add a key")}
                </div>`;
            }

            return detail();
        }

        return html`<div class="mk-page">
            <p class="muted small">
                Pi uses one key at a time for each provider, and each provider here has its own pool and
                its own mode. The keys stay on this server, never in the browser.
            </p>

            ${error !== null ? html`<div class="error-box">${error}</div>` : null}

            <input
                class="mk-input mk-search"
                type="search"
                placeholder="Search providers"
                value=${query}
                onInput=${(event) => setQuery(event.currentTarget.value)}
            />

            ${
                groups.length === 0
                    ? html`<p class="muted small">
                          ${
                              query.trim() === ""
                                  ? "Pi's list of providers has not arrived yet: it comes with Pi's next request. Use Another provider below."
                                  : `No provider matches “${query}”.`
                          }
                      </p>`
                    : groups.map(
                          ([title, rows]) => html`<div class="mk-group">
                          <div class="mk-group-title">${title}</div>
                          ${rows.map((provider) => {
                              const pool = pools.get(provider.id);

                              return html`<button
                                  class="mk-item"
                                  onClick=${() => {
                                      setName("");
                                      setSecret("");
                                      setOpen({ provider: provider.id, id: provider.id });
                                  }}
                              >
                                  <span class="mk-item-info">
                                      <span class="mk-item-name">
                                          ${provider.name}
                                          ${
                                              signed.has(provider.id)
                                                  ? html`<span class="mk-tag">signed in</span>`
                                                  : null
                                          }
                                      </span>
                                      <span class="muted small">
                                          ${modelCount(provider.models)}
                                          ${modelCount(provider.models) !== "" ? " · " : ""}
                                          <span class="mono">${provider.id}</span>
                                      </span>
                                  </span>
                                  <span class="mk-item-side">
                                      ${
                                          pool !== undefined
                                              ? html`<span class="mk-tag on">
                                                ${pool.keys.length} key${pool.keys.length === 1 ? "" : "s"}
                                            </span>
                                            <span class="muted small">${pool.mode}</span>`
                                              : html`<span class="muted small">add keys</span>`
                                      }
                                  </span>
                              </button>`;
                          })}
                      </div>`,
                      )
            }

            <button
                class="button small"
                onClick=${() => {
                    setName("");
                    setSecret("");
                    setOpen({ provider: "", id: "" });
                }}
            >
                Another provider
            </button>

            <p class="muted small">
                Timing and the balance metric are under Menu → Extensions. The keys are in
                <span class="mono">multikey/keys.json</span> in Pi Pocket's data folder.
                ${
                    (view.catalog ?? []).length === 0
                        ? " Pi's provider list arrives with its next request."
                        : ""
                }
            </p>
        </div>`;
    }

    pocket.page({ id: "keys", title: "API keys", component: ApiKeys });

    // A sheet on the menu, under Pi's own "Providers" row: the pools are one tap from the menu, in the place that
    // Providers takes. Pi does not let a module put rows inside that sheet.
    pocket.sheet({ id: "pools", title: "API key pools", component: ApiKeys, wide: true });
    pocket.menu({
        id: "pools",
        label: "API key pools",
        hint: "several keys per provider",
        sheet: "pools",
    });

    pocket.rail({ id: "keys", title: "API keys", icon: "key", page: "keys" });
    pocket.launcher({
        id: "keys",
        label: "API keys",
        detail: "key pools for one provider",
        icon: "key",
        page: "keys",
    });
}
