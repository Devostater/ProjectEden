# EDEN house rules (read before every Code update)

EDEN changes itself through Code updates. These rules keep it calm, consistent and safe as it grows.
They are given to the AI before every update to this codebase.

## Reuse before you add
- Before adding a new piece (folding section, reorder/drag, notification or count, card, button style,
  settings toggle, timer), search for one that already exists and reuse or extend it.
  - Styles: `src/ui.ts` (cards, buttons, fields, labels). Don't write new colours or sizes by hand.
  - Folding and reordering: `src/arrange.tsx` (Arrangeable) and the existing folding sections. Don't add a third way.
  - Picking parts of the screen: `src/picker.ts`.
  - Things that need the owner: the top-bar Notifications list. Don't add another count of the same items elsewhere.
- One home for each tool. If something moves, remove the old place in the same change.
- In your summary, say what you reused, what you replaced or removed, and anything that now exists twice.

## Saved data
- Never save while the owner is typing. Edits save on a Save button (or when the field loses focus), not on every key.
- A field must be clearable: deleting a value and typing a new one must give exactly what was typed.
- "Reset" or "Start again" must really reset: the numbers must not come back on the next page switch or reload.
- Never drop or overwrite data saved earlier (on the hub or on another device) without moving it over first.
- Wrap every `localStorage` / `sessionStorage` use in try/catch.

## React
- Call hooks at the top level, in the same order every time; no hooks after an early `return` or inside `if`.
- An effect must return nothing or a clean-up function. Use braces: `useEffect(() => { el.scrollIntoView(); }, [])`
  (scrollIntoView returns a Promise in this browser and crashes the app if returned).
- Clean up every interval, timeout and listener. Pause polling when the page is hidden.
- Data from the server can be missing fields (the hub may not be restarted yet): read it defensively.

## Server and safety
- New server routes that change anything must use the existing checks (isLocal, mayManage / fromOwnPage).
- Never build file paths or shell commands from request input without checking them.
- Anything that touches git, deletes files, stops processes or changes saved stores: say so at the top of your
  summary under "Needs a careful look", so the owner reviews it on its own.

## Screens
- Keep it calm: no new always-visible chips, banners or counters unless the owner asked for one.
- Every screen must work at half-screen width and on the tablet (no sideways scroll), in light and dark mode.
- Buttons need a visible label or an aria-label. Hover-only information also needs a tap or focus way on the tablet.
- Plain words for a non-technical owner.

## Summary format
1. What changed (plain words).
2. Files touched.
3. Reused / replaced / removed.
4. Needs a careful look: server, git, deleting, saved data (or "nothing").
5. What the owner should try (including the awkward cases: clear a field, reset, reload, tablet).
