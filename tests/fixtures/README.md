These tiny H.264 MP4s are original color swatches generated locally for show playback tests. They contain no audio or external media. `timeline-warm.mp4` is one second of red followed by one second of yellow; `timeline-blue.mp4` is two seconds of blue; `timeline-green.mp4` is one second of bright green. All clips use 64 × 64 pixels, 10 fps, YUV420p, and the OpenH264 encoder. The tests require no encoder or network access.

To regenerate with FFmpeg and OpenH264:

```sh
ffmpeg -y -f lavfi -i 'color=red:s=64x64:r=10:d=1' -f lavfi -i 'color=yellow:s=64x64:r=10:d=1' -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0' -c:v libopenh264 -b:v 128k -g 10 -pix_fmt yuv420p -movflags +faststart tests/fixtures/timeline-warm.mp4
ffmpeg -y -f lavfi -i 'color=blue:s=64x64:r=10:d=2' -c:v libopenh264 -b:v 128k -g 10 -pix_fmt yuv420p -movflags +faststart tests/fixtures/timeline-blue.mp4
ffmpeg -y -f lavfi -i 'color=0x00ff00:s=64x64:r=10:d=1' -c:v libopenh264 -b:v 128k -g 10 -pix_fmt yuv420p -movflags +faststart tests/fixtures/timeline-green.mp4
```
