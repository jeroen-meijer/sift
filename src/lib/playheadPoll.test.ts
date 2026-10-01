import { describe, expect, it } from "vitest";
import { initialPlayheadPoll, reducePlayheadPoll } from "./playheadPoll";

describe("reducePlayheadPoll", () => {
  it("keeps playingId during cold-start idle before the engine engages", () => {
    let poll = initialPlayheadPoll();
    poll = reducePlayheadPoll(poll, { playing: false, position_secs: 0 });
    expect(poll.clearPlayingId).toBe(false);
    expect(poll.seenPlaying).toBe(false);
    expect(poll.playing).toBe(false);

    poll = reducePlayheadPoll(poll, { playing: false, position_secs: 0 });
    expect(poll.clearPlayingId).toBe(false);
  });

  it("tracks the playhead once the engine reports playing", () => {
    let poll = initialPlayheadPoll();
    poll = reducePlayheadPoll(poll, { playing: false, position_secs: 0 });
    poll = reducePlayheadPoll(poll, { playing: true, position_secs: 0.12 });
    expect(poll.seenPlaying).toBe(true);
    expect(poll.clearPlayingId).toBe(false);
    expect(poll.playing).toBe(true);
    expect(poll.positionSecs).toBe(0.12);
  });

  it("clears playingId after playback stops back at the start", () => {
    let poll = initialPlayheadPoll();
    poll = reducePlayheadPoll(poll, { playing: true, position_secs: 0.5 });
    poll = reducePlayheadPoll(poll, { playing: false, position_secs: 0 });
    expect(poll.clearPlayingId).toBe(true);
    expect(poll.playing).toBe(false);
  });

  it("keeps playingId when a one-shot finishes past the start", () => {
    let poll = initialPlayheadPoll();
    poll = reducePlayheadPoll(poll, { playing: true, position_secs: 1.2 });
    poll = reducePlayheadPoll(poll, { playing: false, position_secs: 1.25 });
    expect(poll.clearPlayingId).toBe(false);
    expect(poll.playing).toBe(false);
  });

  it("does not clear while paused mid-file", () => {
    let poll = initialPlayheadPoll();
    poll = reducePlayheadPoll(poll, { playing: true, position_secs: 3.1 });
    poll = reducePlayheadPoll(poll, { playing: false, position_secs: 3.1 });
    expect(poll.clearPlayingId).toBe(false);
    expect(poll.seenPlaying).toBe(true);
  });
});
