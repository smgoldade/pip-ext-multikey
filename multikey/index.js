// API key pools' browser module: the "API keys" button on the rail, and the page where the owner adds keys, switches
// a pool between sequential and balanced, and marks a key used up. The page never shows a key: the server sends a hint.

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

export default function setup(pocket) {
    const { html, useEffect, useState, Loader } = pocket;

    // The page's own styles, in the app's cascade layer (docs/extensions/browser-modules.md).
    pocket.style("style.css");

    function ApiKeys() {
        const [view, setView] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(null);
        const [provider, setProvider] = useState("");
        const [name, setName] = useState("");
        const [secret, setSecret] = useState("");

        const show = (next) => {
            if (next !== undefined && next !== null) {
                setView(next);
            }
        };

        /** Runs one change: the control says it waits, and an error shows above the pools. */
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

        const add = (event) => {
            event.preventDefault();

            void act("add", async () => {
                const next = await pocket.api("add", { provider, label: name, secret });

                setSecret("");

                return next;
            });
        };

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

        return html`<div class="mk-page">
            <p class="muted small">
                Pi uses one key at a time for each provider. A pool keeps the keys on this server, never in the
                browser.
            </p>

            ${error !== null ? html`<div class="error-box">${error}</div>` : null}

            <form class="mk-form" onSubmit=${add}>
                <div class="mk-head">Add a key</div>
                <label class="mk-field">
                    <span class="small muted">Provider</span>
                    <input
                        class="mk-input mono"
                        list="mk-providers"
                        placeholder="anthropic"
                        value=${provider}
                        onInput=${(event) => setProvider(event.currentTarget.value.trim().toLowerCase())}
                    />
                </label>
                <datalist id="mk-providers">
                    ${view.known.map((known) => html`<option value=${known} />`)}
                </datalist>
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
                    disabled=${busy === "add" || provider === "" || name === "" || secret === ""}
                >
                    Add key
                </button>
            </form>

            ${
                view.providers.length === 0
                    ? html`<p class="muted small">
                      No pool yet. Add the first key above: the provider is the id Pi knows, such as
                      <span class="mono">anthropic</span>, <span class="mono">openai</span>, or
                      <span class="mono">openrouter</span>.
                  </p>`
                    : view.providers.map(
                          (pool) =>
                              html`<div class="mk-card">
                          <div class="mk-head">
                              <span class="mono">${pool.provider}</span>
                              <span class="mk-modes">
                                  ${["sequential", "balanced"].map(
                                      (mode) =>
                                          html`<button
                                          class="button mk-mode ${pool.mode === mode ? "on" : ""}"
                                          disabled=${busy === pool.provider + mode}
                                          onClick=${() =>
                                              act(pool.provider + mode, () =>
                                                  pocket.api("mode", {
                                                      provider: pool.provider,
                                                      mode,
                                                  }),
                                              )}
                                      >
                                          ${mode}
                                      </button>`,
                                  )}
                              </span>
                          </div>

                          ${
                              pool.mode === "balanced"
                                  ? html`<p class="muted small">
                                    Each new session or subagent takes the key that carried the least
                                    (${view.settings.balance}), and keeps it while it works.
                                </p>`
                                  : html`<p class="muted small">
                                    A key stays in use until the provider says its quota is gone, then the
                                    next key takes over.
                                </p>`
                          }

                          ${
                              pool.storedSignIn
                                  ? html`<div class="error-box">
                                    Pi has a sign-in for <span class="mono">${pool.provider}</span> of its
                                    own, and sends that key before this pool. Sign out of it in Menu →
                                    Providers to use the pool.
                                </div>`
                                  : null
                          }

                          ${pool.keys.map(
                              (key) =>
                                  html`<div class="mk-row ${key.id === pool.current ? "on" : ""}">
                                  <div class="mk-line">
                                      <span class="mk-name">
                                          ${key.label}
                                          ${
                                              key.id === pool.current
                                                  ? html`<span class="mk-chip">in use</span>`
                                                  : null
                                          }
                                          ${
                                              key.usedUpAt !== null
                                                  ? html`<span class="mk-chip bad">used up</span>`
                                                  : null
                                          }
                                          ${
                                              key.coolUntil !== null
                                                  ? html`<span class="mk-chip warn">
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
                                          key.usage.input +
                                              key.usage.output +
                                              key.usage.cacheRead +
                                              key.usage.cacheWrite,
                                      )} tokens ·
                                      $${money(key.usage.cost)}
                                      ${
                                          key.usedUpAt !== null
                                              ? html`· <span>${key.usedUpReason}</span>`
                                              : null
                                      }
                                  </div>
                                  <div class="mk-actions">
                                      <button
                                          class="button small"
                                          disabled=${busy === "use" + key.id || key.id === pool.current}
                                          onClick=${() =>
                                              act("use" + key.id, () =>
                                                  pocket.api("use", {
                                                      provider: pool.provider,
                                                      id: key.id,
                                                  }),
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
                                                  pocket.api("reset", {
                                                      provider: pool.provider,
                                                      id: key.id,
                                                  }),
                                              )}
                                      >
                                          Reset usage
                                      </button>
                                      <button
                                          class="button small"
                                          disabled=${busy === "remove" + key.id}
                                          onClick=${() =>
                                              act("remove" + key.id, () =>
                                                  pocket.api("remove", {
                                                      provider: pool.provider,
                                                      id: key.id,
                                                  }),
                                              )}
                                      >
                                          Remove
                                      </button>
                                  </div>
                              </div>`,
                          )}

                          <button
                              class="button small"
                              disabled=${busy === "drop" + pool.provider}
                              onClick=${() =>
                                  act("drop" + pool.provider, () =>
                                      pocket.api("drop", { provider: pool.provider }),
                                  )}
                          >
                              Remove the pool
                          </button>
                      </div>`,
                      )
            }

            <p class="muted small">
                Timing and the balance metric are under Menu → Extensions. The keys are in
                <span class="mono">multikey/keys.json</span> in Pi Pocket's data folder.
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
