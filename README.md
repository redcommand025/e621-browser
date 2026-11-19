# e621 Browser

An unofficial, client-side image and video browser for the public [e621](https://e621.net) API. It is hosted on GitHub Pages and runs entirely in your browser.

**You must be 18 or older to use this site.** After the confirmation screen, all e621 ratings are shown by default. This project is not affiliated with e621.

## Features

- 18+ confirmation before any API request
- Tag search with debounced autocomplete and post counts
- Rating filter (defaults to all ratings) and sorting (`order:` metatags)
- Responsive, lazy-loaded thumbnail grid
- Viewer for stills and webm/mp4 videos, with sample/original and alternate video versions
- Favorites: look up public favorites with an e621 username (`fav:username`). Optional sign-in with a username and API key for private favorites. Keys stay in memory unless you opt in to remember them on this device
- Pools: search pools, then open one to browse its posts in pool order
- Popular: today, this week, or this month, with a date to move back and forward
- Optional personal tag blacklist
- Works when `localStorage` is blocked (confirmation, blacklist, and remembered keys then last only for the tab)

## Always-on exclusions

Posts tagged `young`, `loli`, `shota`, or `cub` are always hidden, including in favorites, pools, popular, and pool covers. The site adds `-young` (and the other blocked tags, within e621's 40-tag search limit) to every tag query and also filters returned tag lists in the browser. Pools whose names include those terms are not listed. There is no setting or URL parameter to turn this off.

## Storage and backups

If your browser cannot persist storage, the 18+ screen will appear again the next time you open the site, and a blacklist will not be saved after the tab closes.

## Development

```bash
npm test
npm install
npm run test:browser
```

Browser tests use safe (`rating:s`) queries only.
