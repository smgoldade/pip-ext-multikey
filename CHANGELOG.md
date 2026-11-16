# Changelog

## 1.7.0

Balanced mode, rebuilt around what a quota really is.

- **A window, not a lifetime.** A pool evens out what each key carried this month (or day, or its whole life): a
  monthly quota that comes back is no longer weighed down by everything a key ever did.
- **A share per key.** Weight = the window's spend ÷ the key's share, so a key with share 2 takes twice the work of
  share 1. The panel shows the share beside what the key carried in the window, and changes it with one field.
- **A margin.** The lightest key takes over only when it is lighter by the margin (25% by default), because a switch
  costs the provider's prompt cache.
- **Quiet switching.** The key in force never changes while another conversation of the same provider has a request in
  flight, which removes the case where Pi sent a request with another session's key.
- **Correct booking.** Usage is booked to the key that really carried the request, not to whatever key was in force
  when the answer arrived.
- **Cost first.** The metric is cost from Pi's own prices, and falls back to tokens for a model with no price.
- Two settings more: the window, and the margin. A spinning key that is resting after a rate limit is skipped for new
  conversations, not only for the run that hit it.

## 1.6.0

- **The pools open as a popup everywhere**: the rail button, the menu row, and the launcher all open the same wide
  sheet that Menu → Providers opens. No full page.

## 1.5.0

- **Pi's own keys show in the pool panel**, with a hint and **Take it into the pool**: the key becomes a pool key, and
  the provider signs out of Pi's own store through Pi's own call.
- **A description for the Extensions sheet**, and an author: **Steven Goldade**.

## 1.4.0

- **The page uses Menu → Providers' own layout**: the same search box, group headings, bordered rows, and a panel under
  each row with **Add key** or **Keys** on the right.
- The Subagent models column is not there.

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
