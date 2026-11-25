# e621-red

An unofficial, client-side image and video browser for the public [e621](https://e621.net) API. It is hosted on GitHub Pages and runs entirely in your browser. The repository name remains `e621-browser`.

**You must be 18 or older to use this site.** After the confirmation screen, all e621 ratings are shown by default. This project is not affiliated with e621.

## Features

- 18+ confirmation before any API request
- Dark theme with a black canvas, red edge glow, and a deep crimson hexagon pattern
- Posts (the default) loads recent posts and puts tag search with autocomplete in the top bar
- Full e621 search syntax is sent as typed: `~or` tags, `-negation`, wildcards (`african_*`, one per search), groups (`( ~fox ~wolf )`), and all metatags (`order:`, `type:`, `score:>=100`, `favcount:`, `date:`, `user:`, `fav:`, `pool:`, `id:`, `width:`, `filesize:`, `duration:`, `status:`, `source:`, `description:"…"`, `parent:`, `ischild:`, `randseed:` and more). Autocomplete suggests metatag names and their values (for example `order:` → `order:score`), also after `-` or `~`. The Rating and Sort menus are only added when your search has no `rating:` or `order:` of its own. `limit:` is ignored because the app sets the page size, and e621 allows up to 40 tags per search
- The `?` button next to Search opens a search cheat sheet with every metatag; tap one to add it to the search
- Searching for exactly one tag (with or without `rating:`/`order:`) shows the first lines of its wiki above the thumbnails, with Show more to open the full wiki in the app
- Posts sub-bar: Hot, Popular, Favorites, Blacklist, Saved, and Related tags. Related tags lists tags often used with the current search (with post counts); tap one to add it to the search
- Hot puts `order:hot` in the search bar and runs it
- Popular: today's popular posts, with a 3×3 control grid (`«prev` / Day, Week, or Month / `next»`) to change the scale and move the date
- Once signed in, the button becomes an account dropdown (a black box with a deep red glow) with your e621 profile picture and name (opens an in-app profile page with your level, join date, stats, About, and your uploads, favorites, and up/down votes), Favorites, and Log out. It closes on an outside tap or Esc
- Sign in sits on the right of the Posts and Pools bar. It checks your e621 username and API key, then shows your name on that button. Tapping it again opens Sign out. While signed in, every API request includes your key so private favorites and other authenticated features work. A Remember my account checkbox saves the username and key on this device when storage works
- Pools: search pools, then open one to browse its posts in pool order
- Blacklist: add and remove your own tags or e621-style lines (`canine rating:e` hides only posts with both). There is no built-in always-hidden tag list; use the blacklist to hide what you don't want to see. While signed in, it syncs both ways with your e621 account blacklist (adds and removes go to your account; changes made on e621 come in on sign-in or with Sync now)
- Saved searches: store a query such as `canid order:score`, run it later, or delete it
- Display options (the four-squares button next to Search): thumbnail size (Large, Normal, Small), shape (Full or Cropped squares), sort order, rating checkboxes (Safe, Questionable, Explicit in any combination; all checked by default), and Prefer sample. Saved on this device
- Responsive, lazy-loaded thumbnail grid
- Viewer for stills and webm/mp4 videos, with sample/original and alternate video versions. If a post belongs to a family, a Parent thumbnail is shown on the left and Child or Sibling thumbnails on the right
- Under the favorite/vote bar: Download (saves the original as `artist - ID - tags.ext`; when e621's file server blocks that from another site, the file opens in a new tab to save) and Fullscreen (pinch zoom and notes still work)
- Under the image or video: Favorite/Unfavorite, Upvote, and Downvote with the current score and favorite count. They need you to be signed in (otherwise they open Sign in). Voting the same way twice removes the vote
- Translation notes over images, with a Hide/Show notes toggle. The notes move with pinch zoom and panning; tap a note to read it
- Comments oldest to newest, with an Add comment button at the bottom (DText preview; needs Sign in)
- Comments (loaded when you scroll to them) above the tags, post counts next to every tag, and a Details section under the tags (artist, uploader, upload date, file type, dimensions, size, sources, rating, post ID, MD5, and description)
- Tags everywhere (viewer, Related tags, wiki pages, Details artists, autocomplete) are colored by e621 category (artist, copyright, character, species, general, meta, lore, contributor, invalid) and have `+` (add to search), `−` (exclude), and `?` (open the tag's wiki)
- Long-press a tag (about half a second on touch, or right-click / long click with a mouse) for a menu: Copy tag name, Add to/Remove from blacklist, Add as "or" (`~tag`), Open wiki, and Search only this tag. A normal tap still does what it did before
- In-app wiki: the full DText wiki page, its active aliases ("Aliased from") and implications ("Implies" / "Implied by"), every tag the page mentions, and a link to the page on e621
- Hide comments / Show comments toggle in the viewer, remembered on this device (comments are not downloaded while hidden)
- Comments, notes, wiki pages, and descriptions are rendered from DText as plain text with basic formatting; raw HTML is never inserted
- Works when `localStorage` is blocked (confirmation, blacklist, saved searches, and remembered accounts then last only for the tab)


## Storage and backups

If your browser cannot persist storage, the 18+ screen will appear again the next time you open the site, and the blacklist, saved searches, and remembered account will not be saved after the tab closes. Remembering an API key stores that key on this device only when storage actually persists.

## Development

```bash
npm test
npm install
npm run test:browser
npm run test:viewer
```

`npm run test:viewer` checks the viewer extras (notes alignment under real touch pinch/pan, comments and the Hide comments toggle, details, tag counts and colors, related tags, the tag long-press menu, the wiki preview and wiki page with aliases/implications, metatag autocomplete, favorite/vote requests, the display menu, the account dropdown and profile page, two-way blacklist sync, comment order and Add comment, and Download/Fullscreen) against mocked API responses, so it never writes to a real account.

Browser tests use safe (`rating:s`) queries only.
