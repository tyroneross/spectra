---
name: connect
description: Start a Spectra automation session
arguments:
  - name: target
    description: URL, app name, or sim:device
    required: true
---

Start a Spectra automation session with the given target.

**Usage:**
- `/spectra:connect http://localhost:3000` — web automation
- `/spectra:connect Safari` — macOS app automation
- `/spectra:connect sim:iPhone 16` — iOS simulator

Use the `spectra_connect` tool with the target provided above. If no name was given, generate a descriptive name from the target. After connecting, show the initial AX tree snapshot.
