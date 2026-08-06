# Reel background music (organised by region)

Tracks live in **region subfolders** — `assets/music/{region}/*.mp3` — so each territory gets
its own sound (Caribbean/Soca for Guyana, Latin for the DR, Afrobeats for Africa, etc.). They're
bundled into the Docker image, so mixing them into a reel costs **nothing per render**.

Current regions:
- `caribbean/` — used for Guyana (and the Caribbean territories).

The worker picks a track from **`assets/music/{MUSIC_REGION}/`** (default `caribbean`). A property
only ever draws from its own region, so adding another region's tracks can't leak into Guyana's
reels. When the reel job starts carrying a country/region, set `MUSIC_REGION` per-job from it.

## Requirements for any track added
- **Instrumental only** (vocals fight the voiceover).
- **Commercial use allowed, no attribution required** (Pixabay Music, Mixkit, or YouTube Audio
  Library "no attribution" tracks are all safe).
- ~40–60 seconds+ (comfortably covers a ~30s reel). MP3.

## How it's used
Mixed as a low-volume **bed** (~18%) under the full-volume voiceover; narration stays clearly
audible and the music continues on its own after the narration ends. Multiple tracks in a region
→ one chosen deterministically per property (same listing → same track) for variety at no cost.

Keep a note of each track's name + license/source for records (this is commercial use).
