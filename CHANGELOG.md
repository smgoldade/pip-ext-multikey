# Changelog

## 1.5.0

- **Pi's own keys show in the pool panel.** A provider that Menu → Providers signed in with an API key now shows a
  \`Pi key sk-ant-…4f2c\` pill on its row, and the panel shows the key with a hint, plus **Take it into the pool**.
- **Take it into the pool** copies Pi's key into the pool as \`From Pi\` and signs that provider out of Pi's own store
  through Pi's own sign-out call, so one panel holds every key. A subscription sign-in is explained instead: it is not
  a key, and the pool stays idle for it.
- **A description that reads well in the Extensions sheet**: the module's first sentence is now "Keeps several API
  keys for one provider, so a key that is spent, refused, or rate-limited never stops the work.", and the rest of the
  first paragraph is a gallery description that says what it reads and writes. Author: **Steven Goldade**.

## 1.4.0

- **The page now uses Menu → Providers' own layout**: the same search box, the same group headings with their counts,
  and the same bordered list of rows. Each row is a provider with its name and pills, its model count and id, and a
  button on the right (**Add key**, or **Keys**), like the **API key** button there.
- A row's panel opens under it with the same tint and slide as a provider's sign-in in Providers, and holds the mode,
  the keys, the form for the next key, and Remove the pool. The Subagent models column is not there, as asked.
- The page draws with Pi Pocket's classes for those parts (search, provider-group, sheet-list, provider,
  provider-panel), so it follows the theme and the phone layout of the real sheet.

## 1.3.0

- **A pool's key now goes out in place of Pi's own API key.** Pi resolves a stored sign-in before a registration, so
  the registration carries the header that the provider's API reads its key from (measured against Pi's own runtime).
  Pi's stored key stays where it is; Menu → Providers still shows the provider as signed in.
- **A subscription sign-in is left alone.** A token for a plan is not an API key, so a pool stays idle for that
  provider, and the page says why.
- **Rows open in place, as in Menu → Providers**: no second page.

## 1.2.0

- **The page lists Pi's providers**, in the shape of Menu → Providers: a search field, and the groups "Your pools",
  "Signed in in Pi", and "Other providers". Pi's provider list is read from the model runtime in a hook, and kept in
  `multikey/providers.json` for the next start.

## 1.1.0

- **Menu → API key pools**: the pools open as a sheet from the menu, right under Pi's own Providers row. The rail
  button and the page are still there, with the same list.

## 1.0.0

- Key pools for one provider: several API keys, used one at a time.
- Sequential mode: a key stays in force until the provider says its quota or credit is gone.
- Balanced mode: each new session or subagent takes the key that carried the least, and keeps it.
- A key is retired when the provider refuses it or its quota is gone, and rests after a rate limit.
- Usage per key: requests, tokens, cost. Resettable.
- An **API keys** page on the rail, with add, use now, used up, bring back, reset, remove, and remove the pool.
- Four settings: notices, balance metric, cooldown, and recovery.
- Keys are hidden from Pi and from the transcript, and no route returns one.
