export function createPlaybackQueue(store) {
  let current = null;
  let queue = [];
  let history = [];
  let lastDecision = null;

  function snapshot() {
    return {
      current,
      queue,
      historyCount: history.length,
      decision: lastDecision,
      generatedAt: new Date().toISOString()
    };
  }

  function recordPlay(track) {
    if (track) store.addPlay(track, lastDecision?.reason || "");
  }

  return {
    snapshot,
    enqueue(tracks, decision) {
      if (Array.isArray(tracks) && tracks.length) {
        queue = [...queue, ...tracks];
        if (!current) {
          current = queue.shift();
          store.addPlay(current, decision?.reason || "");
        }
      }
      if (decision) lastDecision = decision;
      return snapshot();
    },
    load(tracks, decision) {
      if (Array.isArray(tracks) && tracks.length) {
        if (current) history.push(current);
        current = tracks[0];
        queue = tracks.slice(1);
        if (decision) lastDecision = decision;
        recordPlay(current);
      } else if (decision) {
        lastDecision = decision;
      }
      return snapshot();
    },
    next() {
      if (queue.length) {
        if (current) history.push(current);
        current = queue.shift();
        recordPlay(current);
      }
      return snapshot();
    },
    previous() {
      if (history.length) {
        if (current) queue.unshift(current);
        current = history.pop();
        recordPlay(current);
      }
      return snapshot();
    },
    play(id) {
      const trackId = String(id || "");
      if (!trackId) return snapshot();
      if (current && String(current.id) === trackId) return snapshot();
      const index = queue.findIndex((track) => String(track.id) === trackId);
      if (index >= 0) {
        const [selected] = queue.splice(index, 1);
        if (current) history.push(current);
        current = selected;
        recordPlay(current);
      }
      return snapshot();
    },
    setDecision(decision) {
      lastDecision = decision;
      return snapshot();
    }
  };
}
