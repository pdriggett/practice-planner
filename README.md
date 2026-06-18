# Weekly Music Practice Planner

An [Obsidian](https://obsidian.md) community plugin for planning and tracking weekly music practice.

Each week is a single markdown note in your vault containing:

- **Goals** for the week
- A **skills × days** tracking table
- **Daily notes** sections, one per day — each seeded with a practice **Session**
  carrying [Dataview](https://github.com/blacksmithgu/obsidian-dataview) inline
  fields: `skill::`, `minutes::`, and `notes::`. Duplicate the Session
  bullet to log multiple sessions in a day. The day's date is in its heading
  (`### Monday — 2026-06-15`), so a future Dataview query or heat-map can read each
  session's date, skill, and minutes without any hidden metadata.

  Example day:

  ```
  ### Monday — 2026-06-15

  - **Session 1**
      - skill::
      - minutes::
      - notes::
  ```

## Settings

- **Folder** — where weekly notes are stored (default: `Practice`).
- **Week starts on** — first day of the practice week. Weeks that cross into a new year are stored under the year they started.
- **Default skills** — rows used in each new week's skill table. Each skill is an editable row: rename it inline, remove it with the trash button, **Add skill** to append a new one, or **Reset to default** to restore the built-in set (Scales, Technique, Repertoire, Sight Reading).

## Commands

Available via the Command Palette (`⌘P` / `Ctrl+P`):

- **Open this week's practice plan**
- **Open next week's practice plan**
- **Open previous week's practice plan**

Each command opens the matching week's note, creating it from the template if it doesn't yet exist.

## File layout

Notes are written as:

```
<Folder>/<YYYY>/<YYYY>-Www.md
```

Where `YYYY` is the year of the week's **start** date and `ww` is the week number counted from the first start-day of that year.

## Development

```bash
npm install
npm run dev      # watch + rebuild main.js
npm run build    # type-check + production build
```

To test in Obsidian, copy or symlink this folder into `<vault>/.obsidian/plugins/practice-planner/`. Obsidian needs `main.js`, `manifest.json`, and `styles.css` at runtime.
