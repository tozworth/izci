// Package persistence owns durable server state in SQLite: server identity,
// library reconciliation, shared queue/state, and pairing records.
//
// Music and rendered media remain ordinary files; only catalog facts, queue
// order, and small identity records live in SQLite. Transient clocks, peers,
// preparation barriers, and transfer buffers are never persisted.
//
// The store is safe for concurrent use via an internal mutex and SQLite
// transactions; scans reconcile atomically so readers never see a half-scan.
package persistence

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"github.com/tozworth/izci/izci-server/internal/library"
)

const schema = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  virtual_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  filesystem_path TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  subsong INTEGER,
  favorite INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_virtual_path ON tracks(virtual_path);
CREATE INDEX IF NOT EXISTS idx_tracks_file_key ON tracks(file_key);
CREATE TABLE IF NOT EXISTS queue (
  position INTEGER PRIMARY KEY,
  track_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairings (
  peer_identity TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  name TEXT NOT NULL,
  paired_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_freeplay (
  peer_identity TEXT PRIMARY KEY,
  freeplay_enabled INTEGER NOT NULL DEFAULT 0,
  freeplay_queue TEXT NOT NULL DEFAULT '[]',
  freeplay_shuffle INTEGER NOT NULL DEFAULT 0,
  freeplay_repeat TEXT NOT NULL DEFAULT 'off',
  FOREIGN KEY(peer_identity) REFERENCES pairings(peer_identity) ON DELETE CASCADE
);
`

// Store is the SQLite-backed durable state.
type Store struct {
	mu sync.Mutex
	db *sql.DB
}

// DedicatedRoomCredentials are the durable admission coordinates owned by
// the headless host. Keeping them in the server database lets a restart
// recreate the same room and preserve already-shared invitation links.
type DedicatedRoomCredentials struct {
	RoomID           string
	OwnerSecret      string
	InvitationSecret string
}

// DedicatedRoomCredentials loads the headless host's last room credentials.
func (s *Store) DedicatedRoomCredentials() (DedicatedRoomCredentials, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	credentials := DedicatedRoomCredentials{
		RoomID:           s.getKV("dedicated_room_id"),
		OwnerSecret:      s.getKV("dedicated_room_owner_secret"),
		InvitationSecret: s.getKV("dedicated_room_invitation_secret"),
	}
	return credentials, credentials.RoomID != "" && credentials.OwnerSecret != "" && credentials.InvitationSecret != ""
}

// SetDedicatedRoomCredentials atomically stores the headless host's room.
func (s *Store) SetDedicatedRoomCredentials(credentials DedicatedRoomCredentials) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	values := map[string]string{
		"dedicated_room_id":                credentials.RoomID,
		"dedicated_room_owner_secret":      credentials.OwnerSecret,
		"dedicated_room_invitation_secret": credentials.InvitationSecret,
	}
	for key, value := range values {
		if _, err := tx.Exec(`INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Open opens (creating parent schema) a SQLite store. An empty path uses a
// private in-memory database (useful for tests); otherwise path is a file.
// The caller owns Close.
func Open(path string) (*Store, error) {
	var dsn string
	if strings.TrimSpace(path) == "" {
		dsn = ":memory:"
	} else {
		// Busy timeout avoids transient lock errors under concurrency.
		dsn = fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", path)
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("persistence: open: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("persistence: schema: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the database.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Close()
}

func (s *Store) getKV(key string) string {
	var v string
	_ = s.db.QueryRow(`SELECT value FROM kv WHERE key=?`, key).Scan(&v)
	return v
}

func (s *Store) setKV(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// ServerID returns the persistent server identity, creating and storing one
// on first use. It is stable across restarts when the database is a file and
// never contains filesystem paths. Identity matches [A-Za-z0-9_-]{8,128}.
func (s *Store) ServerID() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v := s.getKV("server_id"); v != "" {
		return v, nil
	}
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(raw[:]) // 32 hex chars, valid identity
	if err := s.setKV("server_id", id); err != nil {
		return "", err
	}
	return id, nil
}

// CatalogRevision returns the persisted catalog revision.
func (s *Store) CatalogRevision() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	var v string
	_ = s.db.QueryRow(`SELECT value FROM kv WHERE key='catalog_revision'`).Scan(&v)
	var n int64
	_, _ = fmt.Sscan(v, &n)
	return n
}

// SetCatalogRevision persists the catalog revision.
func (s *Store) SetCatalogRevision(n int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.setKV("catalog_revision", fmt.Sprintf("%d", n))
}

// SharedState is the persisted shared playback collection state (queue
// membership, shuffle, repeat, current track). Clocks and barriers stay
// transient and are never stored here.
type SharedState struct {
	Queue       []string
	Initialized bool
	Shuffle     bool
	Repeat      string // "off"|"one"|"all"
	CurrentID   string
}

// GetSharedState loads queue order plus shuffle/repeat/current.
func (s *Store) GetSharedState() (SharedState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var st SharedState
	rows, err := s.db.Query(`SELECT track_id FROM queue ORDER BY position ASC`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return st, err
		}
		st.Queue = append(st.Queue, id)
	}
	if err := rows.Err(); err != nil {
		return st, err
	}
	var shuffle, repeat, current string
	_ = s.db.QueryRow(`SELECT value FROM kv WHERE key='shared_shuffle'`).Scan(&shuffle)
	st.Initialized = s.db.QueryRow(`SELECT value FROM kv WHERE key='shared_repeat'`).Scan(&repeat) == nil
	_ = s.db.QueryRow(`SELECT value FROM kv WHERE key='shared_current'`).Scan(&current)
	st.Shuffle = shuffle == "1"
	if repeat == "" {
		repeat = "off"
	}
	st.Repeat = repeat
	st.CurrentID = current
	return st, nil
}

// SetSharedState replaces queue order and shuffle/repeat/current atomically.
func (s *Store) SetSharedState(st SharedState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM queue`); err != nil {
		return err
	}
	for i, id := range st.Queue {
		if _, err := tx.Exec(`INSERT INTO queue(position,track_id) VALUES(?,?)`, i, id); err != nil {
			return err
		}
	}
	shuffle := "0"
	if st.Shuffle {
		shuffle = "1"
	}
	repeat := st.Repeat
	if repeat == "" {
		repeat = "off"
	}
	for k, v := range map[string]string{"shared_shuffle": shuffle, "shared_repeat": repeat, "shared_current": st.CurrentID} {
		if _, err := tx.Exec(`INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListTracks returns all persisted tracks ordered by virtual path.
func (s *Store) ListTracks() ([]*library.Track, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`SELECT id,virtual_path,name,extension,kind,size,mtime_ns,file_key,source_revision,filesystem_path,title,artist,album,subsong,favorite,play_count,last_played FROM tracks ORDER BY virtual_path ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*library.Track
	for rows.Next() {
		var t library.Track
		var subsong sql.NullInt64
		var lastPlayed sql.NullInt64
		var fav, plays int
		if err := rows.Scan(&t.ID, &t.VirtualPath, &t.Name, &t.Extension, &t.Kind, &t.Size, &t.MtimeNs, &t.FileKey, &t.SourceRevision, &t.FilesystemPath, &t.Title, &t.Artist, &t.Album, &subsong, &fav, &plays, &lastPlayed); err != nil {
			return nil, err
		}
		if subsong.Valid {
			v := int(subsong.Int64)
			t.Subsong = &v
		}
		t.Favorite = fav != 0
		t.PlayCount = plays
		if lastPlayed.Valid {
			v := lastPlayed.Int64
			t.LastPlayed = &v
		}
		out = append(out, &t)
	}
	return out, rows.Err()
}

// TrackByID fetches one track.
func (s *Store) TrackByID(id string) (*library.Track, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var t library.Track
	var subsong sql.NullInt64
	var lastPlayed sql.NullInt64
	var fav, plays int
	err := s.db.QueryRow(`SELECT id,virtual_path,name,extension,kind,size,mtime_ns,file_key,source_revision,filesystem_path,title,artist,album,subsong,favorite,play_count,last_played FROM tracks WHERE id=?`, id).
		Scan(&t.ID, &t.VirtualPath, &t.Name, &t.Extension, &t.Kind, &t.Size, &t.MtimeNs, &t.FileKey, &t.SourceRevision, &t.FilesystemPath, &t.Title, &t.Artist, &t.Album, &subsong, &fav, &plays, &lastPlayed)
	if err != nil {
		return nil, err
	}
	if subsong.Valid {
		v := int(subsong.Int64)
		t.Subsong = &v
	}
	t.Favorite = fav != 0
	t.PlayCount = plays
	if lastPlayed.Valid {
		v := lastPlayed.Int64
		t.LastPlayed = &v
	}
	return &t, nil
}

// Reconcile atomically swaps the scanned snapshot into the database,
// preserving stable IDs and server-owned fields (favorite, play counts)
// for unchanged files. Only tracks owned by scannedRoots (virtual-prefix
// match) are reconciled; other roots' tracks are untouched so per-folder
// rescans never delete siblings.
//
// Matching order per file: existing file_key (rename-stable), then existing
// virtual_path with compatible facts, else a fresh ID. Unchanged files keep
// their ID, favorite, play counts, and subsong selections.
func (s *Store) Reconcile(files []library.ScannedFile, scannedMounts []string, now time.Time) (added, updated, removed int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return 0, 0, 0, err
	}
	defer tx.Rollback()

	// Load existing tracks for the scanned mounts.
	existingByPath := map[string]*persistedTrack{}
	existingByKey := map[string]*persistedTrack{}
	rows, err := tx.Query(`SELECT id,virtual_path,file_key,size,mtime_ns,favorite,play_count,last_played,subsong FROM tracks`)
	if err != nil {
		return 0, 0, 0, err
	}
	for rows.Next() {
		var p persistedTrack
		var subsong sql.NullInt64
		var lastPlayed sql.NullInt64
		if err := rows.Scan(&p.ID, &p.VirtualPath, &p.FileKey, &p.Size, &p.MtimeNs, &p.Favorite, &p.PlayCount, &lastPlayed, &subsong); err != nil {
			rows.Close()
			return 0, 0, 0, err
		}
		_ = lastPlayed
		if lastPlayed.Valid {
			v := lastPlayed.Int64
			p.LastPlayed = &v
		}
		if subsong.Valid {
			v := int(subsong.Int64)
			p.Subsong = &v
		}
		cpy := p
		existingByPath[p.VirtualPath] = &cpy
		// file_key may collide across filesystems in theory; last wins is
		// acceptable because virtual-path match takes precedence below when
		// both match differently (we prefer file_key only when paths differ
		// but keys match, i.e. a rename).
		existingByKey[p.FileKey] = &cpy
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, 0, err
	}

	owned := func(vpath string) bool {
		if len(scannedMounts) == 0 {
			return true
		}
		for _, m := range scannedMounts {
			mount := "/" + strings.Trim(m, "/")
			if vpath == mount || strings.HasPrefix(vpath, mount+"/") {
				return true
			}
		}
		return false
	}

	seen := map[string]bool{}
	for _, f := range files {
		if !owned(f.VirtualPath) {
			continue
		}
		seen[f.VirtualPath] = true
		var id string
		var fav int
		var plays int
		var lastPlayed *int64
		var subsong *int
		renamed := false
		matched := existingByPath[f.VirtualPath]
		if matched != nil {
			id = matched.ID
			fav = matched.Favorite
			plays = matched.PlayCount
			lastPlayed = matched.LastPlayed
			subsong = matched.Subsong
		} else if byKey := existingByKey[f.FileKey]; byKey != nil && !seenPath(seen, byKey.VirtualPath) {
			// Rename: same inode, new virtual path. Preserve ID and
			// server-owned state, move the record.
			id = byKey.ID
			fav = byKey.Favorite
			plays = byKey.PlayCount
			lastPlayed = byKey.LastPlayed
			subsong = byKey.Subsong
			renamed = true
			// Remove the stale path entry so the delete pass below does
			// not remove the renamed record.
			delete(existingByPath, byKey.VirtualPath)
		} else {
			id = newTrackID()
			added++
		}
		if matched != nil && matched.Size == f.Size && matched.MtimeNs == f.MtimeNs && matched.FileKey == f.FileKey {
			// Unchanged: keep revision-stable fields; still refresh the
			// server-local path and title/artist inference cheaply.
		} else if matched != nil {
			updated++
		} else if renamed {
			// Rename counts as update, not add.
			updated++
		}
		subsongVal := sql.NullInt64{}
		if f.Kind == library.KindModule {
			// Phase 2 serves one track per file; subsong separation stays
			// unset (single default subsong) until native probing lands.
			subsongVal.Valid = false
		} else if subsong != nil {
			subsongVal.Int64 = int64(*subsong)
			subsongVal.Valid = true
		}
		rev := library.BuildSourceRevision(f.Size, f.MtimeNs, 0, f.QuickHash)
		var lp sql.NullInt64
		if lastPlayed != nil {
			lp.Int64 = *lastPlayed
			lp.Valid = true
		}
		if _, err := tx.Exec(`INSERT INTO tracks(id,virtual_path,name,extension,kind,size,mtime_ns,file_key,source_revision,filesystem_path,title,artist,album,subsong,favorite,play_count,last_played,updated_at)
		  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		  ON CONFLICT(id) DO UPDATE SET virtual_path=excluded.virtual_path,name=excluded.name,extension=excluded.extension,kind=excluded.kind,size=excluded.size,mtime_ns=excluded.mtime_ns,file_key=excluded.file_key,source_revision=excluded.source_revision,filesystem_path=excluded.filesystem_path,title=excluded.title,artist=excluded.artist,updated_at=excluded.updated_at`,
			id, f.VirtualPath, f.Name, f.Extension, f.Kind, f.Size, f.MtimeNs, f.FileKey, rev, f.AbsPath, f.Title, f.Artist, "", subsongVal, fav, plays, lp, now.UnixMilli()); err != nil {
			return 0, 0, 0, err
		}
		// Ensure the UNIQUE(virtual_path) does not collide with a stale
		// row of a different ID (rename onto an existing path): delete any
		// other row now shadowing this path.
		if _, err := tx.Exec(`DELETE FROM tracks WHERE virtual_path=? AND id!=?`, f.VirtualPath, id); err != nil {
			return 0, 0, 0, err
		}
	}

	// Delete owned tracks absent from the new snapshot.
	for vpath, p := range existingByPath {
		if !owned(vpath) {
			continue
		}
		if seen[vpath] {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM tracks WHERE id=?`, p.ID); err != nil {
			return 0, 0, 0, err
		}
		removed++
		// Drop queue references to removed tracks; queue order otherwise stays.
		if _, err := tx.Exec(`DELETE FROM queue WHERE track_id=?`, p.ID); err != nil {
			return 0, 0, 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, 0, err
	}
	return added, updated, removed, nil
}

type persistedTrack struct {
	ID          string
	VirtualPath string
	FileKey     string
	Size        int64
	MtimeNs     int64
	Favorite    int
	PlayCount   int
	LastPlayed  *int64
	Subsong     *int
}

func seenPath(seen map[string]bool, vpath string) bool { return seen[vpath] }

func newTrackID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("track-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw[:])
}

// PairingRecord is one remembered pairing (Phase 4 completes proof
// behavior; Phase 2 persists the records with clear ownership).
type PairingRecord struct {
	PeerIdentity    string
	Secret          string
	Name            string
	PairedAt        int64
	FreeplayEnabled bool
	FreeplayQueue   []string
	FreeplayShuffle bool
	FreeplayRepeat  string
}

// SavePairing upserts a pairing record.
func (s *Store) SavePairing(r PairingRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	queue, err := json.Marshal(r.FreeplayQueue)
	if err != nil {
		return err
	}
	repeat := r.FreeplayRepeat
	if repeat != "one" && repeat != "all" {
		repeat = "off"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO pairings(peer_identity,secret,name,paired_at) VALUES(?,?,?,?) ON CONFLICT(peer_identity) DO UPDATE SET secret=excluded.secret,name=excluded.name,paired_at=excluded.paired_at`, r.PeerIdentity, r.Secret, r.Name, r.PairedAt); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO pairing_freeplay(peer_identity,freeplay_enabled,freeplay_queue,freeplay_shuffle,freeplay_repeat) VALUES(?,?,?,?,?) ON CONFLICT(peer_identity) DO UPDATE SET freeplay_enabled=excluded.freeplay_enabled,freeplay_queue=excluded.freeplay_queue,freeplay_shuffle=excluded.freeplay_shuffle,freeplay_repeat=excluded.freeplay_repeat`, r.PeerIdentity, r.FreeplayEnabled, string(queue), r.FreeplayShuffle, repeat); err != nil {
		return err
	}
	return tx.Commit()
}

// Pairing returns one record without disclosing it outside the host package.
func (s *Store) Pairing(peerIdentity string) (PairingRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var r PairingRecord
	var enabled, shuffle int
	var queue string
	err := s.db.QueryRow(`SELECT p.peer_identity,p.secret,p.name,p.paired_at,COALESCE(f.freeplay_enabled,0),COALESCE(f.freeplay_queue,'[]'),COALESCE(f.freeplay_shuffle,0),COALESCE(f.freeplay_repeat,'off') FROM pairings p LEFT JOIN pairing_freeplay f ON f.peer_identity=p.peer_identity WHERE p.peer_identity=?`, peerIdentity).
		Scan(&r.PeerIdentity, &r.Secret, &r.Name, &r.PairedAt, &enabled, &queue, &shuffle, &r.FreeplayRepeat)
	if err == sql.ErrNoRows {
		return PairingRecord{}, false, nil
	}
	if err != nil {
		return PairingRecord{}, false, err
	}
	r.FreeplayEnabled = enabled != 0
	r.FreeplayShuffle = shuffle != 0
	if err := json.Unmarshal([]byte(queue), &r.FreeplayQueue); err != nil {
		r.FreeplayQueue = nil
	}
	return r, true, nil
}

// DeletePairing removes a pairing.
func (s *Store) DeletePairing(peerIdentity string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM pairing_freeplay WHERE peer_identity=?`, peerIdentity); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pairings WHERE peer_identity=?`, peerIdentity); err != nil {
		return err
	}
	return tx.Commit()
}

// ListPairings returns all pairings.
func (s *Store) ListPairings() ([]PairingRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`SELECT p.peer_identity,p.secret,p.name,p.paired_at,COALESCE(f.freeplay_enabled,0),COALESCE(f.freeplay_queue,'[]'),COALESCE(f.freeplay_shuffle,0),COALESCE(f.freeplay_repeat,'off') FROM pairings p LEFT JOIN pairing_freeplay f ON f.peer_identity=p.peer_identity ORDER BY p.paired_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PairingRecord
	for rows.Next() {
		var r PairingRecord
		var enabled, shuffle int
		var queue string
		if err := rows.Scan(&r.PeerIdentity, &r.Secret, &r.Name, &r.PairedAt, &enabled, &queue, &shuffle, &r.FreeplayRepeat); err != nil {
			return nil, err
		}
		r.FreeplayEnabled = enabled != 0
		r.FreeplayShuffle = shuffle != 0
		_ = json.Unmarshal([]byte(queue), &r.FreeplayQueue)
		out = append(out, r)
	}
	return out, rows.Err()
}
