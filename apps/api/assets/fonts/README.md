# PDF fonts

Bundled so quotes, invoices and credit notes can print the rupee sign (₹) and Tamil. The built-in PDF fonts can do neither.

- `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`: English, digits, ₹
- `NotoSansTamil-Regular.ttf`, `NotoSansTamil-Bold.ttf`: Tamil (it has no English letters; `src/common/pdf/pdf-fonts.ts` draws mixed text in runs)

Noto fonts are copyright The Noto Project Authors, licensed under the SIL Open Font License 1.1 (`OFL.txt`).
Source: https://github.com/notofonts/notofonts.github.io (fonts/NotoSans, fonts/NotoSansTamil, hinted TTF).
