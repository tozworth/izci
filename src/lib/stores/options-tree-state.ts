import { createPersistentStore } from './persistent-store';

export const expandedOptionsCategories = createPersistentStore<string[]>({
  storageKey: 'izci.options-tree-expanded-categories',
  channelName: 'izci.options-tree-expanded-categories',
  defaultValue: [],
  normalize: (value) => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : []
});

export function toggleOptionsCategory(id: string): void {
  expandedOptionsCategories.update((categories) => categories.includes(id)
    ? categories.filter((category) => category !== id)
    : [...categories, id]);
}
