# Walkthrough Success Policy

Host-routed walkthroughs use the same success semantics as the standalone
Spectra app's `WalkthroughSuccessPolicy.evaluate` helper.

## Pass

A walkthrough passes when:

- The latest snapshot matches the user's success predicate, or
- The host LLM can give an explicit `done` rationale grounded in the latest
  snapshot.

## Fail

A walkthrough does not pass when:

- Actions executed but the final state is unverified.
- The planner reports `done` but the requested predicate is false.
- An action fails twice after one re-snapshot plus replan retry.

## Retry

On executor failure:

1. Re-read the screen.
2. Replan once from the fresh snapshot.
3. Retry once.
4. If it still fails, stop with `partial` or `blocked`.
