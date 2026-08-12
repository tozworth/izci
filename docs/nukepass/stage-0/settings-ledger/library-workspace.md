# Library and workspace field expansion

This appendix expands the repeated identities summarized in `other-state.md`.
Library presentation is the desktop `PlaylistPanel.svelte` table/header/column
menu and grouped navigation; mobile flat Library intentionally does not expose
columns. State uses `izci.library-view-settings.v6` /
`izci-library-view-settings-v6`, normalization in `library-view-settings.ts`, no
Options reset, immediate runtime projection, `library-view-settings.test.ts`,
and Stage 1 `library-state-contract`. Every identity preserves current behavior;
the backup v5/v6 omission remains a repair defect.

## Library top-level and per-view identities

| Identity | Default / normalization | Presentation |
| --- | --- | --- |
| `activeView` | songs; favorites/ratings/songs/artists/albums/genres/years/formats/folders | Library navigation |
| `searchQuery` | empty string | Library search |
| `views.favorites.order` | all nine column IDs in canonical order | column reorder |
| `views.ratings.order` | rating,title,artist,format,duration,album,discAndTrack,folder,plays | column reorder |
| `views.songs.order` | canonical order | column reorder |
| `views.artists.order` | canonical order | column reorder |
| `views.albums.order` | canonical order | column reorder |
| `views.genres.order` | canonical order | column reorder |
| `views.years.order` | canonical order | column reorder |
| `views.formats.order` | canonical order | column reorder |
| `views.folders.order` | canonical order | column reorder |
| `views.favorites.sort.{columnId,direction}` | title, asc | header sort |
| `views.ratings.sort.{columnId,direction}` | rating, desc | header sort |
| `views.songs.sort.{columnId,direction}` | title, asc | header sort |
| `views.artists.sort.{columnId,direction}` | title, asc | header sort |
| `views.albums.sort.{columnId,direction}` | title, asc | header sort |
| `views.genres.sort.{columnId,direction}` | title, asc | header sort |
| `views.years.sort.{columnId,direction}` | title, asc | header sort |
| `views.formats.sort.{columnId,direction}` | title, asc | header sort |
| `views.folders.sort.{columnId,direction}` | title, asc | header sort |
| `pinnedGroupKeys.artists` | empty unique string array | Artists group pin controls |
| `pinnedGroupKeys.albums` | empty unique string array | Albums group pin controls |
| `pinnedGroupKeys.genres` | empty unique string array | Genres group pin controls |
| `pinnedGroupKeys.years` | empty unique string array | Years group pin controls |
| `pinnedGroupKeys.formats` | empty unique string array | Formats group pin controls |
| `pinnedGroupKeys.folders` | empty unique string array | Folders group pin controls |

Canonical column order is title, artist, album, discAndTrack, folder, format,
duration, rating, plays. Each view has all 18 exact column child identities:
`views.<view>.columns.<column>.width` and `.visible`. Width defaults/minima are
the same across views and every normalized width is an integer at least its
minimum:

| Column | Default width | Minimum width |
| --- | --- | --- |
| title | 300 | 72 |
| artist | 220 | 72 |
| album | 220 | 72 |
| discAndTrack | 112 | 48 |
| folder | 220 | 72 |
| format | 96 | 48 |
| duration | 104 | 48 |
| rating | 104 | 44 |
| plays | 88 | 48 |

Default `.visible` values (every named cell is the exact identity
`views.<row>.columns.<column>.visible`):

| View | title | artist | album | discAndTrack | folder | format | duration | rating | plays |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| favorites | true | true | false | false | false | false | true | false | false |
| ratings | true | true | false | false | false | true | true | true | false |
| songs | true | true | false | false | false | false | true | false | false |
| artists | true | false | true | false | false | false | true | false | false |
| albums | true | true | false | false | false | false | true | false | false |
| genres | true | true | true | false | false | false | true | false | false |
| years | true | true | true | false | false | false | true | false | false |
| formats | true | true | true | false | false | false | true | false | false |
| folders | true | true | true | false | false | false | true | false | false |

Normalization restores Title visibility if all nine become false. Ratings UI is
also gated by `trackSettings.enableRatings` without deleting these values.

## Workspace panel state

All rows use `izci.workspace-panel-state.v2` /
`izci-workspace-panel-state`, `workspace-panel-state.ts`, docking/tab/View menu
presentation, immediate `workspace-shell.ts` consumption, no Options reset,
focused workspace tests and Stage 1 `workspace-state-contract`.

| Identity | Default / valid values |
| --- | --- |
| `activeWorkspaceTab` | playlist; requested valid tab, replaced by the first open fallback when one exists; may remain playlist when every panel is empty |
| `activeCollection` | playlist; playlist/library |
| `panels.left` | `[playlist]`; unique workspace-tab array |
| `panels.center` | `[library]`; unique workspace-tab array |
| `panels.right` | `[]`; unique workspace-tab array |
| `openPanels` | `[left,center]`; normalized panel IDs and every nonempty panel forced open |
| `activeTabsByPanel.left` | playlist; tab in left or null |
| `activeTabsByPanel.center` | library; tab in center or null |
| `activeTabsByPanel.right` | null; tab in right or null |
| `lastPanelByTab.playlist` | left; left/center/right |
| `lastPanelByTab.library` | center; left/center/right |
| `lastPanelByTab.details` | right; left/center/right |
| `lastPanelByTab.lyrics` | right; left/center/right |
| `lastPanelByTab.patterns` | center; left/center/right |
| `lastPanelByTab.video` | center; left/center/right |
| `tabbedTabOrder` | `[playlist,library]`; every currently open tab exactly once |

## Workspace layout

All rows use `izci.workspace-panel-layout.v2` /
`izci-workspace-panel-layout`, resize-handle presentation, immediate workspace
layout consumption, no Options reset, and Stage 1 `workspace-layout-contract`.
Each raw fraction clamps to .1–.8, then all three are divided by their total.

| Identity | Default |
| --- | --- |
| `leftFraction` | .28 |
| `centerFraction` | .42 |
| `rightFraction` | .30 |
