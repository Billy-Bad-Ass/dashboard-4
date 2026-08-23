# Third-party notices

## Font Awesome Free

The icons in `lib/icons.generated.ts` are extracted from
[Font Awesome Free](https://github.com/FortAwesome/Font-Awesome).

- **Icons** — CC BY 4.0 License (https://creativecommons.org/licenses/by/4.0/)
- Copyright Fonticons, Inc. (https://fontawesome.com)

Only the ~60 icon paths this dashboard renders are vendored, rather than the npm
package or a CDN link: it removes a third-party request from every page load and
avoids shipping two thousand unused glyphs. The attribution above is a licence
obligation of CC BY 4.0, not a courtesy — do not remove it.

Regenerate with:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/FortAwesome/Font-Awesome.git
cd Font-Awesome && git sparse-checkout set svgs/solid svgs/regular svgs/brands && cd ..
npm run icons:build -- ./Font-Awesome
```

## Brand assets

The BBA Network marks in `public/brand/` are the property of BBA Network and are
not covered by any open-source licence in this repository.
