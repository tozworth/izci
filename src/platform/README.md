# Platform boundary

Vite selects one `$platform` implementation: `pwa/platform.ts`,
`../desktop/platform.ts`, or `../android/platform.ts`. PWA is an explicit target
that owns service-worker updates, installation, file-handler launches, local
font access, and Window Controls Overlay. Android shares browser-runtime
primitives, without importing the PWA target or its lifecycle.
The platform delivers associated-file launches; the shared file-launch service
matches those Files to remembered library roots before handing them to playback.
PWA integration must not import a store or service that depends back on `$platform`.

Shared application code consumes `$platform.filesystem` for pickers, folder
enumeration, permissions, reference validation, identity, and editing access.
`PlatformFilesystem` is defined in `../lib/services/platform-files-types.ts`.
`../lib/services/file-access.ts` coordinates track materialization, media URLs,
tool imports, and exports. Drag/drop extraction is a shared browser-runtime
primitive in `web-file-handles.ts`; components and tools do not implement their
own filesystem traversal.

The PWA persists genuine File System Access handles. Windows persists native
path references and uses disk-backed Chromium Files. Android persists SAF
content URIs and streams through ranged ContentResolver reads. The native
drivers remain private to their targets; `native-filesystem.ts` shares their
reference and capability plumbing. Windows can also consume genuine browser
handles supplied by drag/drop and use browser save dialogs.

Editing uses transient `MediaFileAccess` / `MediaDirectoryAccess` capabilities.
Their method names accommodate existing browser writers, but native editing
objects are never stored or passed off as FSA handles. Imported Files carry
transient source information in `file-sources.ts`; track records retain their
existing reference fields and canonical `path`. Queue/library, reusable folder
grants, settings, and artwork keep their separate persistence boundaries.

When adding a target or capability, update `contract.ts` and provide its own
implementation. Shared consumers should ask for capabilities or call the
provider, without testing platform identity to choose file-access code.
`boundaries.test.ts` checks source ownership and runtime import graphs for every
target; `filesystem.test.ts` exercises the three actual filesystem adapters.
Type checking validates all three platform surfaces, regardless of the active
TypeScript alias. Built-asset verification remains a separate build-time check.
