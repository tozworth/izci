package media

import "sort"

// Render scheduling: picks the next cluster indices to send for one
// listener, in the priority order of the buffered Opus contract:
//
//  1. The newest seek target and its startup window.
//  2. The current authoritative playhead and its protection window.
//  3. Missing clusters from that point toward the end of the track.
//  4. Any earlier holes, then speculative work.
//
// A direct port of src/lib/services/multiplayer-render-scheduler.ts so
// server planning matches browser-host behavior cluster for cluster.

// SchedulerBudget caps clusters per plan; the sender additionally gates
// on channel backpressure.
const SchedulerBudget = 512

// PlanInput describes one peer's download state for one render.
type PlanInput struct {
	ClusterTimeMs []float64
	TargetTimeMs  float64
	AheadMs       float64
	PlayheadMs    float64
	ProtectionMs  float64
	// Received holds inclusive cluster-index ranges the client reports.
	Received [][2]int
	// Sent holds cluster indices already enqueued for this epoch.
	Sent map[int]bool
}

// PlanRenderClusters returns the next cluster indices to enqueue.
func PlanRenderClusters(in PlanInput) []int {
	count := len(in.ClusterTimeMs)
	if count == 0 {
		return nil
	}
	// Membership mirrors createRangeMembership: ranges sorted, then the
	// first range starting past the index ends the search.
	ranges := append([][2]int(nil), in.Received...)
	sort.Slice(ranges, func(i, j int) bool { return ranges[i][0] < ranges[j][0] })
	received := func(index int) bool {
		for _, r := range ranges {
			if index < r[0] {
				return false
			}
			if index <= r[1] {
				return true
			}
		}
		return false
	}
	var result []int
	pushed := map[int]bool{}
	push := func(index int) {
		if index < 0 || index >= count || pushed[index] || in.Sent[index] || received(index) {
			return
		}
		pushed[index] = true
		result = append(result, index)
	}
	targetIndex := indexForTime(in.ClusterTimeMs, maxFloat(0, in.TargetTimeMs))
	playheadIndex := indexForTime(in.ClusterTimeMs, maxFloat(0, in.PlayheadMs))
	startupEnd := advanceToCoverage(in.ClusterTimeMs, targetIndex, in.AheadMs)
	for i := targetIndex; i < startupEnd; i++ {
		push(i)
	}
	protectionEnd := advanceToCoverage(in.ClusterTimeMs, playheadIndex, in.ProtectionMs)
	for i := playheadIndex; i < protectionEnd; i++ {
		push(i)
	}
	forwardStart := startupEnd
	if protectionEnd > forwardStart {
		forwardStart = protectionEnd
	}
	for i := forwardStart; i < count; i++ {
		push(i)
	}
	holeLimit := targetIndex
	if playheadIndex < holeLimit {
		holeLimit = playheadIndex
	}
	for i := 0; i < holeLimit; i++ {
		push(i)
	}
	if len(result) > SchedulerBudget {
		result = result[:SchedulerBudget]
	}
	return result
}

func indexForTime(times []float64, t float64) int {
	// The cluster containing a time is the last one whose start is <= time.
	low, high := 0, len(times)
	for low < high {
		middle := (low + high) >> 1
		if times[middle] <= t {
			low = middle + 1
		} else {
			high = middle
		}
	}
	if low-1 < 0 {
		return 0
	}
	return low - 1
}

func advanceToCoverage(times []float64, start int, coverageMs float64) int {
	if coverageMs <= 0 {
		return start + 1
	}
	startTime := times[start]
	index := start
	for index+1 < len(times) && times[index+1]-startTime < coverageMs {
		index++
	}
	return index + 1
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
