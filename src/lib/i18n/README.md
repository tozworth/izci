# Localization workflow

`en.json` is the source catalog and `tr.json` is the Turkish translation catalog. Both use nested, standard JSON and ICU MessageFormat strings.

1. Run `npm run i18n:sync` after adding or changing interface copy. This extracts English defaults from Svelte components and adds missing keys to `tr.json` without replacing existing Turkish translations.
2. Upload `locales/en.json` to Crowdin as the source file.
3. Download the completed Turkish JSON and replace `locales/tr.json` with it.
4. Run `npm run i18n:validate`, then the normal checks and build.

Keep interpolation placeholders such as `{name}` and ICU plural selectors unchanged in translated messages.
