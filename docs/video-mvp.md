# Video playback MVP

## Scope

Add local video playback as a third playback path alongside streams and tracker modules. The MVP uses Chromium's native media element and decoding APIs; it does not add a decoder, demuxer, or transcoding dependency.

Initially recognize common Chromium-friendly local formats such as `mp4`, `m4v`, `mov`, `webm`, and `mkv`. Actual codec support remains whatever the installed Chromium build can decode, with normal playback errors for unsupported files.

## Playback

- Add a `video` track kind and a focused video backend owned by the player controller.
- Keep one persistent native `<video>` element and use its events as the playback clock and snapshot source.
- Route its audio through the shared audio bus so master volume, mute, and the analyser continue to work.
- Force-bypass Raf auto-amp for video. Do not mutate the user's Raf settings; this is a per-source routing decision.
- Preserve the existing stream/Howler and module/Chiptune3 paths unchanged.

## Presentation

- While a video is current, cover the center workspace panel with a transient video stage.
- Do not move, close, or rewrite the center panel's tabs. Its prior contents and persisted layout return unchanged when the stage is removed.
- Leave the left and right panels available; users can close them manually when they want more room.
- Skip Now Playing integration for the MVP. Video playback stays in the normal workspace, and Now Playing is suppressed while a video is current.
- Hide the artwork box in the player bar and Track Details for video tracks rather than showing a placeholder or video thumbnail.

## Import and persistence

- Accept the initial video extensions through drag/drop, the open-file flow, folder scans, and reusable File System Access handles.
- Materialize video files with object URLs and revoke them through the same lifecycle discipline as streamed audio.
- Persist video entries in playlist/library records using the existing file-handle boundary.
- Do not add video MIME types or extensions to the PWA manifest's file-handler associations, install messaging, or other advertised capability lists yet.

## MVP completion criteria

- A supported local video can be imported, played, paused, sought, resumed, restored, and navigated in mixed audio/video collections.
- Switching among stream, module, and video tracks tears down the previous backend cleanly.
- Video audio obeys master volume and mute without Raf auto-amp or obvious A/V desynchronization.
- Starting and stopping video leaves the user's workspace tab placement and panel state unchanged.
- Unsupported codecs fail cleanly without affecting subsequent playback.

Out of scope: broad codec compatibility, metadata parsing libraries, thumbnails/posters, subtitles, chapters, Picture-in-Picture, Now Playing, and PWA file associations.
