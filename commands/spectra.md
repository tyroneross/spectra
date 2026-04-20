---
name: spectra
description: Main spectra entry. Dispatches to a subcommand based on your request, or lists options if unclear. Use `spectra:<subcommand>` to target a specific action directly.
argument-hint: "[what you want to do]"
---

# /spectra — Router

Route this request to the appropriate spectra subcommand or skill based on the user's intent.

**Raw user input**: $ARGUMENTS

## Routing logic

1. If `$ARGUMENTS` is empty or only whitespace: list the available subcommands below and ask the user what they want to do.
2. Otherwise: match the user's natural-language request against the subcommand intents below and invoke the best match.
3. If the request clearly doesn't fit any subcommand but matches a `spectra` skill (listed in your available skills), load the skill and follow its guidance instead.
4. If nothing fits, say so and list the subcommands. Do NOT guess.

## Available subcommands

- **`/spectra:capture`** — Quick screenshot or video of current session
- **`/spectra:connect`** — Start a Spectra automation session
- **`/spectra:sessions`** — List and manage Spectra sessions
- **`/spectra:walk`** — Walk through a UI flow with natural language steps


## Examples

- User types `/spectra` alone → list subcommands, ask for direction
- User types `/spectra <free-form request>` → match intent, invoke subcommand
- User types `/spectra:<specific>` → bypass this router entirely (direct invocation)

## Rules

- Prefer the most specific subcommand match. If two could fit, ask which.
- Never invent a new subcommand. Only route to ones listed above.
- If the user is describing a workflow that spans multiple subcommands, outline the sequence and ask whether to proceed.
