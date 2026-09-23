package host

// Shared queue edits go through the catalog and session together. Freeplay
// keeps its separate per-peer queue path.
func isSharedQueueCommand(typ string) bool {
	switch typ {
	case "queue.add", "queue.replace", "queue.remove", "queue.randomize", "queue.play-next":
		return true
	}
	return false
}

func (h *Host) applySharedQueueCommand(peerID, typ string, itemIDs []string) bool {
	if !h.sessions.permissions.CanControlShared(peerID) {
		return false
	}
	h.queueCommandMu.Lock()
	defer h.queueCommandMu.Unlock()

	shared := h.sessions.Shared()
	queue := h.catalog.QueueIDs()
	selected := uniqueQueueIDs(itemIDs)
	switch typ {
	case "queue.add":
		if len(queue)+len(selected) > 50000 {
			return false
		}
		for _, id := range selected {
			copyID, ok := h.catalog.CopyForQueue(id)
			if !ok {
				return false
			}
			queue = append(queue, copyID)
		}
	case "queue.replace":
		queue = selected
	case "queue.remove":
		removed := make(map[string]bool, len(selected))
		for _, id := range selected {
			removed[id] = true
		}
		retained := make([]string, 0, len(queue))
		for _, id := range queue {
			if !removed[id] {
				retained = append(retained, id)
			}
		}
		queue = retained
	case "queue.randomize":
		queue = shared.RandomizeQueue()
	case "queue.play-next":
		present := make(map[string]bool, len(queue))
		for _, id := range queue {
			present[id] = true
		}
		for _, id := range selected {
			if !present[id] {
				queue = append(queue, id)
				present[id] = true
			}
		}
		if len(queue) > 50000 {
			return false
		}
		shared.SetQueue(queue)
		shared.MoveNext(selected)
		queue = shared.Queue()
	default:
		return false
	}
	if len(queue) > 50000 {
		return false
	}
	if typ != "queue.play-next" && typ != "queue.randomize" {
		shared.SetQueue(queue)
	}
	h.catalog.SetQueue(queue)
	revision := h.catalogRevision.Add(1)
	h.catalog.SetRevision(revision)
	h.persistSharedState()
	h.broadcastShared()
	return true
}

func uniqueQueueIDs(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	unique := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			unique = append(unique, id)
			seen[id] = true
		}
	}
	return unique
}
