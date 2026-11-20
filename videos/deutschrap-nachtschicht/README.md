# NACHTSCHICHT — Deutschrap-Visualizer ohne Rapper

Ein 60-Sekunden-Rap-Video, das nur aus Design besteht: kein Rapper, keine Stimme.
17 fotorealistische Szenen (Block, Benz, Kette, Bargeld, U-Bahn, Shisha, Studio ...),
geschnitten auf einen eigenen 140-BPM-Drill-Beat in F-Moll. Die Typo steht per
Tiefenkarte _hinter_ den Motiven.

## Rendern

```bash
npm run render          # renders/nachtschicht.mp4, 1920x1080, 30 fps
npm run dev             # Vorschau im HyperFrames Studio
```

## Anpassen

| Was                          | Wo                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Titel, Wörter, Schnittfolge  | Shot-Liste in `film.js` (`shot(...)`, `word(...)`, `marquee`)                             |
| Kamerafahrt, Nebel, Regen    | pro Szene in `film.js`, Standard pro Motiv in `PLATES`                                    |
| HUD-Texte, Endkarte          | `index.html`                                                                              |
| Beat (Tempo, Melodie, Drums) | `scripts/make_beat.py`, danach `npm run beat`                                             |
| Neue Bilder                  | nach `assets/raw/` legen, `python3 scripts/prep_stills.py <depth_anything_v2_small.onnx>` |

Die Zeile „Fehlt nur noch deine Stimme." auf der Endkarte ist `#end-line` in `index.html`.

## Woher die Bausteine kommen

- **Bilder:** KI-generiert (Canva und Figma), keine echten Personen; Logos und Schriftzüge waren im Prompt ausgeschlossen.
- **Tiefenkarten:** Depth Anything V2 Small (`onnx-community/depth-anything-v2-small`).
- **Beat:** komplett synthetisiert in `scripts/make_beat.py`, keine Samples.
- **Schriften:** Anton und JetBrains Mono (SIL Open Font License).
