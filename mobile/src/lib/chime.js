// Walk-in chime — a short two-note tone when a new walk-in joins the waitlist
// (mirrors the web QueueKiosk). expo-audio is a NATIVE module (needs a
// rebuild), so we require it lazily inside try/catch: before the rebuild, or
// if playback fails for any reason, the chime is simply silent — never a crash.
//
// A fresh player is created per call so it always plays from the start, then
// released shortly after it finishes.

export function playChime() {
  try {
    const { createAudioPlayer } = require('expo-audio');
    const player = createAudioPlayer(require('../../assets/chime.wav'));
    player.play();
    setTimeout(() => { try { player.remove(); } catch (_) {} }, 1500);
  } catch (_) {
    // expo-audio not in this build yet, or playback unavailable — stay silent.
  }
}
