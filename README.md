# e621-red

An unofficial, client-side image and video browser for the public [e621](https://e621.net) API. It is hosted on GitHub Pages and runs entirely in your browser. The repository name remains `e621-browser`.

**You must be 18 or older to use this site.** After the confirmation screen, all e621 ratings are shown by default. This project is not affiliated with e621.

## Features

- 18+ confirmation before any API request
- Dark theme with a black canvas, red edge glow, and a deep crimson hexagon pattern
- Posts (the default) loads recent posts and puts tag search with autocomplete in the top bar
- Posts sub-bar: Hot, Popular, Favorites, Blacklist, and Saved
- Hot puts `order:hot` in the search bar and runs it
- Popular: today's popular posts, with a 3×3 control grid (`«prev` / Day, Week, or Month / `next»`) to change the scale and move the date
- Sign in sits on the right of the Posts and Pools bar. It checks your e621 username and API key, then shows your name on that button. Tapping it again opens Sign out. While signed in, every API request includes your key so private favorites and other authenticated features work. A Remember my account checkbox saves the username and key on this device when storage works
- Pools: search pools, then open one to browse its posts in pool order
- Blacklist: add and remove your own tags. Hard-exclusion tags are always applied and are not listed as removable
- Saved searches: store a query such as `canid order:score`, run it later, or delete it
- Rating filter (defaults to all ratings) and sorting (`order:` metatags)
- Responsive, lazy-loaded thumbnail grid
- Viewer for stills and webm/mp4 videos, with sample/original and alternate video versions. If a post belongs to a family, a Parent thumbnail is shown on the left and Child or Sibling thumbnails on the right
- Works when `localStorage` is blocked (confirmation, blacklist, saved searches, and remembered accounts then last only for the tab)


## Storage and backups

If your browser cannot persist storage, the 18+ screen will appear again the next time you open the site, and the blacklist, saved searches, and remembered account will not be saved after the tab closes. Remembering an API key stores that key on this device only when storage actually persists.

## Development

```bash
npm test
npm install
npm run test:browser
```

Browser tests use safe (`rating:s`) queries only.
