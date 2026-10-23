# 红色高跟鞋 · Claude 风格 MV

A single-page, canvas-drawn music video for 《红色高跟鞋》 in a Claude-style look:
paper-cream backgrounds, terracotta accents, serif type, hand-drawn line boil and
asterisk sparks.

Open `index.html` in a browser, then:

- **选择《红色高跟鞋》音频**: load your own copy of the song (mp3 / m4a / flac / wav).
  The page decodes the file in the browser, finds its kick-drum hits and the points
  where it gets louder or quieter, and moves the scene cuts there: the first chorus,
  the bridge, the final chorus and the outro land on their own scenes. The file is
  processed locally and never uploaded.
- **先用原创伴奏预览**: play an original 2:12 backing track that the page synthesizes
  with the Web Audio API (it is not the original song).
- **歌词（可选）**: load or paste an `.lrc` file to replace the original captions with
  synced lyrics. A second line with the same timestamp is shown as a smaller translation.

Shortcuts: `Space` play/pause, `←`/`→` seek 5 s, `F` fullscreen. Audio and `.lrc`
files can also be dropped onto the stage.

The recording and lyrics of 《红色高跟鞋》 (sung by 蔡健雅) belong to their rights
holders and are not included; the visuals, captions and preview track here are original.
