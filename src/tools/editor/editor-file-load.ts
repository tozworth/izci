export interface EditorFileLoadSession {
  signal: AbortSignal;
  isCurrent(): boolean;
  finish(): void;
}

export interface EditorFileLoadCoordinator {
  begin(): EditorFileLoadSession;
  cancel(): void;
}

export function createEditorFileLoadCoordinator(): EditorFileLoadCoordinator {
  let current: { id: number; controller: AbortController } | null = null;
  let nextId = 0;

  return {
    begin() {
      current?.controller.abort();
      const entry = { id: ++nextId, controller: new AbortController() };
      current = entry;

      return {
        signal: entry.controller.signal,
        isCurrent: () => current?.id === entry.id,
        finish: () => {
          if (current?.id === entry.id) current = null;
        }
      };
    },
    cancel() {
      current?.controller.abort();
      current = null;
    }
  };
}
