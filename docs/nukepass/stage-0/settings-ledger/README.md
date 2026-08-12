# Field-level setting ledger

This directory is the authoritative Goldilocks ledger. Every row represents one
semantic persisted field or one independently observable user control. The
shorter parent document records cross-cutting defects but does not replace these
rows.

Columns have the runbook meanings:

- **Presentation** records the category and exact Svelte/i18n source for label,
  hint, conditions, and desktop/mobile exposure.
- **State** records default and choices/range; the cited normalizer is canonical.
- **Persistence** records storage, channel, and reset behavior.
- **Runtime** records the exact consumer and apply boundary.
- **Evidence** names existing coverage and the Stage 1 CDP scenario, or says
  `gap` explicitly.
- **Disposition** is preserve, repair, redesign, or remove only by a separate
  product decision.

Files:

- [Main Options](main-options.md)
- [Raf](raf.md)
- [Experimental / Multiplayer](experimental.md)
- [Tool settings](tools.md)
- [Other user-controlled persisted state](other-state.md)
- [Library and workspace field expansion](library-workspace.md)
- [Action/control inventory](actions.md)

Common synchronized stores use `createPersistentStore`: localStorage plus their
listed BroadcastChannel, whole-object last-writer-wins, reset-by-writing-default,
and duplicate suppression by JSON equality. Unless overridden in a row, the
store has no dispose, write-failure recovery, causal revision, or removal-event
handling; `persistent-store.test.ts` covers equality only and Stage 1
`settings-cross-window` is required.
