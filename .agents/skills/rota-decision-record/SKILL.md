---
name: rota-decision-record
description: Write a short architecture decision record in docs/decisions/ for a major Rota choice (data layer, email provider, Flutterwave provider check, shard hash, pool size, cache TTLs, FlashList exception). Use whenever a choice is made that someone could later ask "why?".
---

# Decision record

File: `docs/decisions/NNNN-short-title.md` (next free number). Keep it under one page.

```
# NNNN — <title>
Date: <YYYY-MM-DD>
Status: accepted | superseded by NNNN
Related: PRD §<x>, rule <ID>

## Problem
<what forced a choice>

## Options considered
1. <option> — <pro / con>
2. <option> — <pro / con>

## Decision
<what was chosen>

## Why
<the reasons, with evidence: docs read, measurements, constraints>

## Consequences
<what gets easier, what gets harder, what to revisit and when>
```

## Required records
- Data layer: Kysely or Drizzle.
- Transactional email provider.
- **Flutterwave provider check**: confirm test mode supports USD, saved-card recurring charges, signed webhooks, and a Node SDK or documented REST API. Record the exact doc pages used and the signature-verification method. If any item fails, status is **blocked**: stop and ask. Agreed fallback: charge in Flutterwave's test currency, keep USD cents in the ledger, add a display note.
- Shard hash function and `team_directory` format.
- Connection pool size and why.
- Cache TTLs and what is never cached.
- Any FlatList-instead-of-FlashList exception.

Never record a guess as a fact. If you did not read it in current documentation, say "unverified".
