# Console fonts

These files are self-hosted for the Console's typography from SPEC §12:

- `Satoshi` is the body family. The variable WOFF2 was downloaded from the
  official Fontshare CSS endpoint on 2026-09-19:
  <https://api.fontshare.com/v2/css?f[]=satoshi@1&display=swap>
  The generated CSS declares the family, `font-weight: 300 900`, normal style,
  and the source URL under `cdn.fontshare.com`.
- `Fredoka` is the heading family. The static weights 300, 400, 500, 600, and
  700 were downloaded from the official Google Fonts CSS endpoint on
  2026-09-19:
  <https://fonts.googleapis.com/css2?family=Fredoka:wght@300..700&display=swap>
  The corresponding `fonts.gstatic.com` files are `fredoka-300.ttf` through
  `fredoka-700.ttf`.

## Licensing

Satoshi is distributed by Fontshare under the Indian Type Foundry Free Font
License (FFL). The complete downloaded source page is retained in
`ITF-FFL-Satoshi.html`; the official license URL is
<https://fontshare.com/licenses/itf-ffl>. The license grants free personal and
commercial use, including web and app embedding.

Fredoka is distributed by Google Fonts under the SIL Open Font License 1.1.
The complete license text is retained in `OFL-Fredoka.txt`; the official source
directory is <https://github.com/google/fonts/tree/main/ofl/fredoka>.

The font files are unchanged downloads. The app may reference these paths:

```css
@font-face {
  font-family: "Satoshi";
  src: url("/fonts/satoshi-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
}

@font-face {
  font-family: "Fredoka";
  src: url("/fonts/fredoka-400.ttf") format("truetype");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
```

For Fredoka, add one `@font-face` for each local file and set its matching
weight (300, 400, 500, 600, or 700). Use Satoshi's variable range for body
weights; use tabular numeral features for monetary values separately in CSS.
