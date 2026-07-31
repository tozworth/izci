export interface HistoryState<T> {
  present: T;
  undo: T[];
  redo: T[];
}

export function createHistory<T>(present: T): HistoryState<T> {
  return { present, undo: [], redo: [] };
}

export function pushHistory<T>(history: HistoryState<T>, next: T, limit = 100): HistoryState<T> {
  if (Object.is(history.present, next)) return history;
  return {
    present: next,
    undo: [...history.undo, history.present].slice(-Math.max(1, limit)),
    redo: []
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const present = history.undo.at(-1);
  if (present === undefined) return history;
  return {
    present,
    undo: history.undo.slice(0, -1),
    redo: [history.present, ...history.redo]
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const present = history.redo[0];
  if (present === undefined) return history;
  return {
    present,
    undo: [...history.undo, history.present],
    redo: history.redo.slice(1)
  };
}
