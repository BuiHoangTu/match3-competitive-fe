# Agent Routing Rules

**Parallel dispatch** (A + B simultaneously):
- @frontend-engine handles all fe/src/engine/ work (A1–A7)
- @backend handles all be/ work (B1–B4)
- No file overlap — safe to run in parallel

**Sequential unlocks:**
- @renderer starts only after A7 (fe/src/engine/*.test.ts exist and pass)
- @integration starts D1 after B3 (be/src/server.ts exists), parallel to C
- @integration starts D2 only after C4 AND D1 are complete
- Bot track (E1→E2) starts after B4, via @integration agent

**Never parallelize:**
- Tasks that extend the same file (A4→A5→A6 all touch MatchEngine.ts)
- Any two agents touching fe/src/scenes/GameScene.ts simultaneously