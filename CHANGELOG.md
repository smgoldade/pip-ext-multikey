# Changelog

## 1.8.0

**Balanced mode follows the real balance where a provider states one.**

- Three providers answer a plain GET with what a key has left, and the module asks them: OpenRouter (the key's own
  limit), DeepSeek (the account balance), and Moonshot/Kimi (available balance). The pool then balances on
  `what is left per share`, not on its own meters.
- A key that its provider says is empty is skipped for new work **without a mark**: topping the account up brings it
  back by itself, with no "bring back" click.
- Each key shows its balance and when it was read, with a **Refresh balance** button per pool. **Menu → Extensions**
  sets how often the provider is asked (15 minutes by default; 0 asks only when you press Refresh).
- A failed reading keeps the last one and says so; a provider with no endpoint (Anthropic, OpenAI, and the rest) is
  never asked, and balances on the window and shares as before.
- The balance is stored with the pool (`multikey/keys.json`), and the README now states exactly which addresses are
  called.

## 1.7.0

Balanced mode, rebuilt around what a quota really is: a window (month/day/never) instead of a lifetime, a share per
key, a margin before a switch, quiet switching (never while another request is in flight), usage booked to the key
that carried the request, and cost as the default metric.

## 1.6.0

- **The pools open as a popup everywhere**: the rail button, the menu row, and the launcher all open the same wide
  sheet that Menu → Providers opens. No full page.

## 1.5.0

- **Pi's own keys show in the pool panel**, with a hint and **Take it into the pool**: the key becomes a pool key, and
  the provider signs out of Pi's own store through Pi's own call.
- **A description for the Extensions sheet**, and an author: **Steven Goldade**.

## 1.4.0

- **The page uses Menu → Providers' own layout**: the same search box, group headings, bordered rows, and a panel under
  each row with **Add key** or **Keys** on the right. The Subagent models column is not there.

## 1.3.0

- **A pool's key goes out in place of Pi's own API key**, by carrying the header that the provider's API reads its key
  from. A subscription sign-in is left alone.
- **Rows open in place**, as in Menu → Providers.

## 1.2.0

- **The page lists Pi's providers**, with the groups "Your pools", "Signed in in Pi", and "Other providers". Pi's
  provider list is read from the model runtime in a hook and kept in `multikey/providers.json`.

## 1.1.0

- **Menu → API key pools**: the pools open as a sheet from the menu, right under Pi's own Providers row.

## 1.0.0

- Key pools for one provider: several API keys, used one at a time.
- Sequential mode: a key stays in force until the provider says its quota or credit is gone.
- Balanced mode: each new session or subagent takes the key that carried the least, and keeps it.
- A key is retired when the provider refuses it or its quota is gone, and rests after a rate limit.
- Usage per key: requests, tokens, cost. Resettable.
- An **API keys** page on the rail, with add, use now, used up, bring back, reset, remove, and remove the pool.
- Four settings: notices, balance metric, cooldown, and recovery.
