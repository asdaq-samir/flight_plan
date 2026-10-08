---
name: reuse-before-build
description: Use when starting new software work that may duplicate an existing open-source, commercial, internal, official API, library, framework, tool, service, integration, component, or workflow.
---

# Reuse Before Build

## Principle

Before building custom software, check whether a mature existing solution already satisfies the need.

Do not reinvent the wheel unless the existing options are unsuitable, too risky, too expensive, or incompatible with the project constraints.

## When to Use

Use this before creating a new:

- Feature or product capability
- Library, framework, SDK, CLI, or script
- Service, integration, workflow, or automation
- UI component, data pipeline, storage layer, auth flow, payment flow, or deployment system

Skip the check only when the task is trivial, explicitly constrained to custom implementation, or the user directly asks to avoid external solutions.

## Workflow

1. **Define the need** in one sentence (what input, what output, what scale, what constraints).
2. **Check internal options**: grep the current repo, look at the team's existing tools and services, ask the relevant team if unsure.
3. **Check external options**: search npm / PyPI / crates.io / Maven / GitHub Topics; for each candidate look at README, last commit date, open issues, license, downloads or stars, and known security advisories.
4. **Compare** the top 2-3 candidates on: fit, maturity, maintenance activity, security, license, cost, integration effort, lock-in, and long-term complexity.
5. **Choose one path**: reuse, adapt, buy, or build. Custom build requires explicit justification.

## Required Output Before Building

Before starting custom implementation, state:

- Existing options checked
- Recommendation (reuse / adapt / buy / build)
- Reason
- Main risks or tradeoffs

## Example: A Quick Walk-Through

Need: "Extract text from PDFs in a Node backend, around 1k files per month, digital PDFs only."

1. Need defined: text extraction, Node, modest scale, no scanned-image OCR required.
2. Internal: no existing PDF utility in the repo.
3. External candidates: `pdf-parse`, `pdf.js`, `unpdf`.
4. Compare: `pdf-parse` (MIT, simple API, actively used), `pdf.js` (Mozilla, heavier, browser-oriented), `unpdf` (newer, smaller user base).
5. Decision: reuse `pdf-parse`. Risk: scanned PDFs would need a separate OCR path; flag this for later.

Total time before writing any code: ~20 minutes. Total custom code avoided: weeks.

## Red Flags - STOP and Check First

If you catch yourself thinking any of these, stop and go back to step 2 of the workflow:

| Rationalization | Reality |
|------|------|
| "This need is too specific, nothing exists for it" | Almost every common need has a mature solution. Search for 20-30 minutes before concluding it doesn't. |
| "Writing it myself is faster than integrating" | Integration is hours; custom code is days to write plus months to maintain, debug, and secure. |
| "The existing options aren't perfect" | Perfect is not the bar. "Good enough and mature" is. |
| "The user didn't ask me to look for an existing solution" | Reuse-before-build is the default, not an opt-in. |
| "I'll just write a quick version and replace it later" | "Later" rarely arrives. The quick version becomes the long-term version. |

Any of these → stop, return to step 2.

## Decision Rule

Prefer the simplest sufficient mature solution. Build custom code only when it is clearly justified by requirements, constraints, or risk.
