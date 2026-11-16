# Changelog

## 1.2.0

- **The page lists Pi's providers**, in the shape of Menu → Providers: a search field, and the groups "Your pools",
  "Signed in in Pi", and "Other providers", with each provider's name, model count, sign-in state, key count, and
  mode. A provider is picked from that list; typing an id by hand is now only the "Another provider" row at the end.
- Each provider opens its own page: its keys, its actions, the form that adds the next key, and **its own mode**
  (sequential or balanced) at the top.
- Pi's provider list is read from the model runtime in a hook, and kept in `multikey/providers.json` for the next start.

## 1.1.0

- **Menu → API key pools**: the pools open as a sheet from the menu, right under Pi's own Providers row. The rail
  button and the page are still there, with the same list.
- Pi Pocket does not let a module add rows inside the Providers sheet itself; the README says what it allows instead.

## 1.0.0

- Key pools for one provider: several API keys, used one at a time.
- Sequential mode: a key stays in force until the provider says its quota or credit is gone.
- Balanced mode: each new session or subagent takes the key that carried the least, and keeps it.
- A key is retired when the provider refuses it or its quota is gone, and rests after a rate limit.
- Usage per key: requests, tokens, cost. Resettable.
- An **API keys** page on the rail, with add, use now, used up, bring back, reset, remove, and remove the pool.
- Four settings: notices, balance metric, cooldown, and recovery.
- Keys are hidden from Pi and from the transcript, and no route returns one.
