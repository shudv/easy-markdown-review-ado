---
title: Widget Platform Config
status: Published
version: 2.0.0
owner: Platform Team
reviewers: 2
maintainers:
  - Ada Lovelace
  - Alan Turing
tags: [widgets, config, platform, onboarding]
---

# Widget Platform Config

This document captures the platform configuration metadata for the widget
service. The YAML frontmatter block above is the single source of truth that
release automation reads.

## Overview

Keep the metadata accurate — the release pipeline fails the build if `status`
is still `Draft` at tag time. Everything below the frontmatter is ordinary
prose and stays unchanged in the review so the metadata diff is easy to see.

## Notes

Frontmatter changes are reviewed like any other content change: each edited
key highlights on its own row, added keys show green, and removed keys appear
as a struck-through deletion marker.
