# Reel background music

Drop royalty-free **instrumental** `.mp3` tracks in this folder. They get bundled into the
Docker image (committed to git), so mixing them into a reel costs **nothing per render** — no
API calls, no per-use fees.

## Requirements for any track added here
- **Instrumental only** (vocals fight the voiceover).
- **Commercial use allowed, no attribution required** (Pixabay Music, Mixkit, or YouTube Audio
  Library "no attribution" tracks are all safe).
- At least ~40–60 seconds long (comfortably covers a ~30s reel).
- MP3 format.

## How it's used
The worker mixes the track as a low-volume **bed** (~15–20%) under the voiceover (full volume),
so narration stays clearly audible and the music continues on its own after the narration ends.
If multiple tracks are present, one is chosen deterministically per property (same listing →
same track) for variety at no extra cost.

Keep a note of each track's name + license/source for records (this is commercial use).
