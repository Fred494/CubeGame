# Conta Cubos (CubeGame)

A party game for up to 8 players. The main screen (your computer, projected) shows a rotating 3D diagram of stacked cubes; each player guesses how many cubes there are on their phone. Fastest correct answers win.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm test
```

- Host screen: `/host.html` (create a room, share the code / QR code)
- Players: `/play.html` (numeric keypad, plus a calculator and private notes tab; the diagram is never sent to phones)
- Preview / difficulty tuning: `/preview.html`, or `npm run stats` in the terminal

## Rules

- Choose 1 to 10 rounds in the lobby (default 5). Levels always rise, and every round uses a different mold.
- Columns are always full down to the floor (no hidden holes inside).
- Wrong answer: the phone is locked for 20 s, then you can try again (unlimited attempts).
- A round lasts at most 3 minutes, or ends when everybody is right. Unsolved players get 3:00 + 30 s, ordered by fewer attempts.
- Round ranking is by time; the final ranking is the sum of all round times (saved as `ranking` 1..N).

## How it works

- **Server-authoritative** (`src/cubes.js`): the answer, the 20 s lock, the 3 min limit and all timings live on the server and are measured from the reveal moment. Players recover their state (including a running lock) after reloading.
- **Diagrams** (`public/cubes/gen.js`): procedural height matrices, 96 molds over 5 levels, at least 16 per level (5x5 and 6x6 fully symmetric, 7x7 mirrored, 7x7 and 8x8 free). The answer is always the sum of the matrix. Fairness rules are validated before showing: pits at least 2x2 wide and at most 2 deep, and the top of every column visible in at least one of 12 rotation angles x 3 elevations (raycasting), retrying up to 60 times.
- **Hand-made diagrams**: load a JSON file in the lobby, e.g. `[[3,0,2],[1,4,4],[0,2,1]]` or a list of matrices. They go through the same validation and are used for the first rounds.
- **3D** (`public/cubes/view.js`): Three.js (vendored in `public/vendor/three`), orthographic camera, spin of 12 s per turn, elevation oscillating 28 to 56 degrees every 9 s.
- **Test mode** (lobby toggle): 1 player is enough, key `A` shows the answer on the host screen, key `N` skips the round.

## Config

`PORT` (default 3000), `DATA_DIR` (saved rooms, default `./data`), `CORS_ORIGIN`.

## Play from any Wi-Fi (Render)

The game is a normal web server, so once it is online everyone can join from their own phone and network.

1. On https://render.com choose **New + > Blueprint** and pick the `Fred494/CubeGame` repo (it reads `render.yaml`), or **New + > Web Service** with build `npm install` and start `npm start`.
2. When the deploy finishes you get a URL like `https://conta-cubos.onrender.com`.
3. Open `/host.html` on the computer shown to the room. The QR code and the join link already use that public address; players scan it or open `/play.html` and type the code.

Free instances sleep after ~15 min idle (the first load takes ~50 s: open the site a minute before the party) and their disk is wiped on restart, so a room is lost if the server restarts mid-game.
