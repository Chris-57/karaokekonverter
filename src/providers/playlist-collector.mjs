// Count and order checks adapted from the locally validated playlist probe.
export function createCollector(expectedCount = null, maxTracks = 20) {
  const MAX_TRACKS = maxTracks;
  const tracks = new Map();
  const seenCounts = new Set();
  const issues = new Set();
  let title = '';
  let gridFound = false;
  let blocked = false;
  let loginRequired = false;
  let oversized = false;
  let rounds = 0;
  const signature = track => JSON.stringify([track.url, track.title, track.artists]);
  return {
    add(snapshot) {
      rounds++;
      if (snapshot.title) {
        if (title && title !== snapshot.title) issues.add('Playlist title changed during collection.');
        title = snapshot.title;
      }
      gridFound ||= snapshot.gridFound;
      blocked ||= snapshot.blocked;
      loginRequired ||= snapshot.loginRequired;
      if (snapshot.ambiguousCount) issues.add('The page exposed conflicting track counts.');
      if (Number.isSafeInteger(snapshot.declaredCount) && snapshot.declaredCount >= 0) {
        seenCounts.add(snapshot.declaredCount);
        oversized ||= snapshot.declaredCount > MAX_TRACKS;
      }
      for (const track of snapshot.tracks) {
        if (!Number.isSafeInteger(track.position) || track.position < 1) {
          issues.add('A song row did not expose a reliable playlist position.');
          continue;
        }
        if (track.position > MAX_TRACKS) { oversized = true; continue; }
        const previous = tracks.get(track.position);
        if (previous && signature(previous) !== signature(track)) {
          // Permit an initially blank artist/title to finish rendering; never hide a changed track.
          const enriched = previous.url === track.url && (!previous.title || previous.title === track.title)
            && (!previous.artists.length || JSON.stringify(previous.artists) === JSON.stringify(track.artists));
          if (!enriched) { issues.add(`The track at position ${track.position} changed during collection.`); continue; }
        }
        tracks.set(track.position, track);
      }
      return this.result();
    },
    result() {
      const ordered = [...tracks.values()].sort((a, b) => a.position - b.position);
      const declaredCount = seenCounts.size === 1 ? [...seenCounts][0] : null;
      const expected = declaredCount ?? expectedCount;
      const problems = new Set(issues);
      if (seenCounts.size > 1) problems.add('The displayed playlist count changed during collection.');
      if (declaredCount !== null && expectedCount !== null && declaredCount !== expectedCount) {
        problems.add('The displayed track count differs from the count you supplied.');
      }
      const missingTitles = ordered.filter(track => !track.title).map(track => track.position);
      const missingArtists = ordered.filter(track => !track.artists.length).map(track => track.position);
      const gaps = expected !== null && expected <= MAX_TRACKS
        ? Array.from({ length: expected }, (_, i) => i + 1).filter(position => !tracks.has(position)) : [];
      const contiguous = ordered.every((track, index) => track.position === index + 1);
      let status;
      if (blocked) status = 'VERIFICATION_REQUIRED';
      else if (loginRequired) status = 'LOGIN_REQUIRED';
      else if (oversized) status = 'LIMIT_EXCEEDED';
      else if (problems.size) status = 'INCONSISTENT_METADATA';
      else if (!ordered.length) status = 'NO_TRACKS';
      else if (missingTitles.length || missingArtists.length || !contiguous || (expected !== null && ordered.length !== expected)) status = 'PARTIAL';
      else if (expected === null) status = 'COMPLETENESS_UNVERIFIED';
      else if (declaredCount === null) status = 'MATCHES_SUPPLIED_COUNT';
      else status = 'COMPLETE_METADATA';
      return {
        status, title, collectedCount: ordered.length, displayedCount: declaredCount,
        suppliedCount: expectedCount, countEvidence: declaredCount !== null ? 'page label' : expectedCount !== null ? 'user supplied' : 'unknown',
        contiguousPositions: contiguous, missingPositions: gaps, missingTitles, missingArtists,
        gridFound, rounds, issues: [...problems], tracks: ordered
      };
    }
  };
}

