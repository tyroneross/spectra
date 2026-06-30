---
id: SPEC-PIPELINE-kwcy6g6ra0189
schema_version: 1
title: Use Block-4 audio capture in a scripted demo (podcast-voice clip)
status: done
priority: P2
type: feature
area: pipeline
entities: []
gated: none
provenance:
  source: marketing-video-arc
  ref: next-2
evidence: [native/swift/SingleWindowRecording.swift]
supersedes: null
superseded_by: null
created: 2026-06-30
updated: 2026-06-30
review_by: 2026-07-30
owner: claude
---

## Context
Native captureAudio (SCStreamConfiguration.capturesAudio + AAC mux) is built + tested but unused in the visual demos. Wire it into a beat/clip that plays Atomize's podcast with synced audio.

## Acceptance
- <verifiable condition 1>

## Notes
<additional detail>

## Resolution (2026-06-30)
Substantially covered: audio passthrough (409238f) + voiceover track (8ed92b6) let a scripted demo carry synced audio. A specific podcast-voice clip is now a content task, not code.
