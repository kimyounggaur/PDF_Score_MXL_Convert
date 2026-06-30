# MusicXML XSD

Place the MusicXML 4.0 `musicxml.xsd` and local `xml.xsd` files here before enabling strict XSD validation.

`validateMusicXml()` uses:

```bash
xmllint --noout --nonet --schema worker/xsd/musicxml.xsd corrected/score.musicxml
```

The pipeline downgrades to the Audiveris baseline if XSD or musical sanity checks fail.
