# Tile Football 3D

A local Habbo-inspired football prototype built with `TypeScript`, `Vite`, and `three.js`.

The current project focus is:
- 2-player local testing
- click-to-move player pathfinding
- same-tile contest and swap blocking
- Habbo-style pushable ball animation
- football interaction iteration before networking

## Current Features

- Two local players in the same room
- `Tab` switches the active player
- Click-to-move pathfinding for the active player
- Player collision rules:
  - committed tile blocking
  - reserved `nextTile` blocking
  - swap prevention
  - deterministic same-tile contest resolution
- Ball interaction rules:
  - click kick
  - trap
  - shoot
  - drop
  - auto-push/dribble on contact
- Ball motion layer:
  - Habbo-style slide updates
  - segment interpolation
  - pushable-state timing
  - late-flight catch window

## Controls

- `Tab`: switch active player
- `Left click`: move active player or interact with ball

## Movement Model

### Players

- `currentTile` = committed tile
- `nextTile` = tile being entered
- `targetTile` = clicked destination
- `path` = remaining route

Players move one tile at a time and share the same local collision logic that is intended to become the multiplayer movement model later.

### Ball

- `tile` = committed ball tile
- `moveTargetTile` = active slide target
- `path` = queued remaining ball travel
- `pushableState` and `animationTimeMs` drive slide timing

The ball is now closer to Habbo client pushable-furniture behavior than to a custom physics object.

## Current Football Rules

- Free ball can be kicked by clicking it
- Free ball can be trapped from a valid line
- Trapped ball can be shot or dropped
- Auto-push dribbles the ball one tile when a player steps into it
- Moving ball is intentionally hard to catch early
- Moving ball becomes catchable later in flight

## Project Status

This is still a prototype.

The ball animation pipeline is now much closer to Habbo client logic, but the actual football rules are still local approximations because the original Habbo server-side football authority is not available in this repo.

## Roadmap

### Near Term

- Tune pathfinding still some bugs currently
- Tune ball travel timing until it matches Habbo by feel
- Tune moving-ball catch windows and dribble behavior
- Add clearer debug info for ball phase, travel timing, and catchability
- Clean up football rule separation between click actions and movement-contact actions

### Mid Term

- Add proper move-then-interact behavior
- Add local replay/debug tools for football actions
- Improve pathfinding consistency and repath behavior around the ball
- Make player and ball logic easier to test without rendering

### Multiplayer Prep

- Separate authoritative game state from visual interpolation state
- Replace local assumptions with message/update-driven state transitions
- Reuse the same player collision and contest rules in multiplayer
- Convert ball updates into explicit network-friendly slide messages

### Later

- Add real multiplayer sync
- Add server-authoritative football rules
- Match Habbo football behavior more closely where packet traces or server logic make that possible

## Notes

- The repo currently favors fast iteration over perfect architecture.
- Some football timing and catchability behaviors are inferred from Habbo client behavior and tuned locally.
- Exact Habbo football gameplay cannot be reproduced 1:1 from the available client XML alone because the original server-side rules are missing.
