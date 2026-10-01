import type { PlaybackState } from "./ipc";

/**
 * Frontend playhead poll state.
 *
 * `play()` sets `playingId` before the engine finishes decode / stream start.
 * Idle at zero before the engine has reported playing is that cold-start window.
 * Clearing `playingId` there would stop the transport while audio still comes up.
 */
export interface PlayheadPoll {
  /** Engine has reported `playing: true` at least once for this `playingId`. */
  seenPlaying: boolean;
  /** Clear FE `playingId` and stop polling. */
  clearPlayingId: boolean;
  playing: boolean;
  positionSecs: number;
}

export function initialPlayheadPoll(): PlayheadPoll {
  return {
    seenPlaying: false,
    clearPlayingId: false,
    playing: false,
    positionSecs: 0,
  };
}

/** Apply one `playback_state` sample. */
export function reducePlayheadPoll(prev: PlayheadPoll, state: PlaybackState): PlayheadPoll {
  const seenPlaying = prev.seenPlaying || state.playing;
  const idleAtStart = !state.playing && state.position_secs <= 0;
  return {
    seenPlaying,
    clearPlayingId: idleAtStart && seenPlaying,
    playing: state.playing,
    positionSecs: state.position_secs,
  };
}
