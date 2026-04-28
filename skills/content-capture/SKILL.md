---
name: content-capture
description: Use when the user asks to capture screenshots, record a demo or video, create marketing assets, or document a feature visually from a running application.
version: 0.1.0
user-invocable: false
---

# Content Capture for Marketing

## What Spectra Does

Spectra connects to running applications and captures media — screenshots and video — from their live state. The output is production-ready visual content for blog posts, social media announcements, product documentation, and demo recordings. Spectra eliminates the manual loop of opening an app, navigating to the right state, cropping a screenshot, and repeating the process for every frame in a multi-step flow.

Spectra is not a testing tool. It does not assert correctness, validate behavior, or compare output to expected values. Those tasks belong to IBR. Spectra answers a different question: how do I show this to people?

## How It Differs from IBR

IBR and Spectra both connect to running applications and read the accessibility tree. The distinction is purpose and output:

- IBR captures the state of a UI to verify it is built correctly. The output is a test result — pass or fail.
- Spectra captures the state of a UI to show it to an audience. The output is a media file — screenshot or video.

Use Spectra after shipping a feature to capture visuals for the announcement. Use IBR during development to verify the feature works. Never substitute one for the other — the mental models diverge immediately once you consider the downstream consumer of the output.

A practical heuristic: if the result goes into a pull request or a CI log, use IBR. If the result goes into a Notion doc, a tweet, or a Figma handoff, use Spectra.

## MCP Tools

### spectra_connect

Opens a capture session against a target. The target can be:

- A URL (web via Chrome DevTools Protocol): `https://app.example.com/dashboard`
- A macOS app name: `Xcode`, `Figma`, `Linear`
- A simulator device: `sim:iPhone 16 Pro`, `sim:Apple Watch Series 10`

Returns a session ID used by all subsequent calls. Multiple sessions can be open simultaneously across different targets.

### spectra_snapshot

Reads the current accessibility tree of the active session. Returns a structured inventory of every visible element — labels, roles, positions, and identifiers. Use this to understand what is on screen before navigating or capturing, especially when the starting state of an app is unknown.

Snapshot is a read-only operation. It does not interact with the UI and does not produce any media output.

### spectra_act

Performs a direct action on a specific element identified by its accessibility ID from a previous snapshot. Use `spectra_act` when the exact element ID is known. It is deterministic — it targets the element directly rather than inferring intent.

Common use: click a button whose ID was retrieved from `spectra_snapshot`.

### spectra_step

Navigates through the UI by intent rather than by element ID. Accepts a plain-language description of what to do — "click the settings button", "open the export menu", "select the second item in the list" — and resolves the correct element automatically.

Use `spectra_step` for the majority of navigation in a capture session. It is faster than the snapshot-then-act pattern when the target is obvious and does not require precise disambiguation. Reserve `spectra_act` for cases where multiple elements share similar labels and a specific ID is needed to avoid ambiguity.

### spectra_capture

Takes a screenshot or records video of the current session state.

- Screenshot: captures the current frame immediately and returns a file path to the image.
- Video start: begins recording; all subsequent navigation and state changes are included.
- Video stop: finalizes the recording and returns a file path to the video file.

All output is written to the `artifacts/` directory at the project root. File names include a timestamp and an optional label passed at capture time.

This is the primary output-producing tool. Every meaningful state in a content capture workflow should end with a `spectra_capture` call.

### spectra_session

Lists, inspects, and closes sessions. Use at the start of a workflow to check for existing sessions that can be reused. Use at the end to close sessions cleanly and review what was captured.

Returns a list of open sessions with their target, duration, and any artifacts produced so far.

## Workflow

A standard content capture session follows four phases:

### 1. Connect

Call `spectra_connect` with the target. For web targets, ensure the page is loaded before connecting. For macOS targets, the app must be running. For simulators, the simulator must be booted.

```
spectra_connect({ target: "https://app.example.com/settings" })
```

The returned session ID should be passed to all subsequent tool calls for this session.

### 2. Navigate

Use `spectra_step` to move through the UI to the state that needs to be captured. Navigate one logical step at a time — each step should correspond to a distinct state transition.

If the starting state is unknown, call `spectra_snapshot` first to inventory the screen, then decide where to navigate.

```
spectra_step({ session: "<id>", intent: "click the Integrations tab" })
spectra_step({ session: "<id>", intent: "open the GitHub integration" })
```

### 3. Capture

Call `spectra_capture` at each state worth capturing. For a blog post covering a multi-step flow, capture each distinct step. For a social media card, one high-quality screenshot of the key feature is typically sufficient.

```
spectra_capture({ session: "<id>", type: "screenshot", label: "github-integration-empty-state" })
spectra_step({ session: "<id>", intent: "connect a repository" })
spectra_capture({ session: "<id>", type: "screenshot", label: "github-integration-connected" })
```

For video, wrap the entire navigated sequence:

```
spectra_capture({ session: "<id>", type: "video", action: "start", label: "onboarding-flow" })
// ... multiple spectra_step calls ...
spectra_capture({ session: "<id>", type: "video", action: "stop" })
```

### 4. Review and Close

Call `spectra_session` to list the artifacts produced. Confirm the files exist at the returned paths. Close the session when done.

```
spectra_session({ action: "list" })
spectra_session({ action: "close", session: "<id>" })
```

## Platform Support

### Web

Connects via Chrome DevTools Protocol. Target is any URL. The browser must be running with remote debugging enabled, or Spectra will launch a controlled instance. Best for SaaS products, dashboards, and web apps.

### macOS

Connects via the macOS accessibility bridge. Target is the application name exactly as it appears in the menu bar. The app must be running and must have granted accessibility access to the terminal or host process running Spectra.

### iOS and watchOS

Connects to simulators via the `sim:` prefix. Target format is `sim:` followed by the device name as it appears in the Simulator app — for example, `sim:iPhone 16 Pro` or `sim:Apple Watch Series 10`. The simulator must be booted before connecting.

Physical iOS device capture is not currently supported.

## Output

All captured media is written to `artifacts/` at the project root. The directory should be in `.gitignore` — it is a working directory, not source code. Media files are named with a timestamp prefix and the label passed at capture time. If no label is provided, a sequential index is used.

A `.spectra/` directory at the project root stores session metadata and intermediate state. This should also be in `.gitignore`.

## Common Patterns

### Feature announcement screenshot

Connect to the feature's URL or app, navigate to the new feature's primary state, take one screenshot with a descriptive label. Done in under ten seconds.

### Multi-step flow documentation

Connect, navigate through each step with `spectra_step`, capture a screenshot after each transition. The sequence of labeled screenshots maps directly to a documentation page with numbered steps.

### Demo video for a launch post

Connect, start video recording, navigate through the full feature flow at a natural pace, stop recording. Trim or use as-is.

### Cross-platform comparison

Open two sessions — one web, one iOS simulator. Capture the same feature state on both. Compare or composite the screenshots for platform comparison content.
