# AgentOS Installer Test Results

Date: 2026-06-16
Platform: Windows 11 Pro 10.0.26200 (PowerShell 5.1, Node v22, Python 3.12)

## Results: 8/8 PASS

| Test | Name | Result |
|------|------|--------|
| 1 | tools.js structure | PASS (8/8 assertions) |
| 2 | validate-env runs | PASS (--base-only exit 0; --tool=git exit 0) |
| 3 | install-tool help | PASS (help + unknown-tool both handled) |
| 4 | register graceful fail | PASS (3 retries then clean exit 1) |
| 5 | syntax checks | PASS (6/6 scripts) |
| 6 | bootstrap.ps1 structure | PASS (6/6 greps + PowerShell parser: 0 errors) |
| 7 | REMOVE_CAPABILITY | PASS (blender removed, base + unity kept) |
| 8 | auto-detect capabilities | PASS (detected: base, blender) |

## Tools detected on this machine (validate-env.js --base-only)

```
=== AgentOS Environment Validation ===
Platform: win32 | OS bucket: windows
PowerShell version: 5

  [OK]    git              v2.47
  [OK]    node             v22
  [OK]    python           v3.12
  [OK]    pm2              v6.0
  [OK]    claude-code      v2.1

Results: 5 passed, 0 warned, 0 failed out of 5

[OK] Environment ready
```

## Files created/modified
- installer/tools.js (new) — Windows-first tool catalog (5 base + 5 extended).
- scripts/bootstrap.ps1 (rewritten, primary Windows installer) — 13 steps, ASCII-only for PowerShell 5.1 compatibility.
- scripts/bootstrap.sh (rewritten, secondary) — Git Bash on Windows delegates to bootstrap.ps1; native Linux/Mac path.
- scripts/validate-env.js (rewritten, Windows-first) — per-platform check cmds, path_hint fallback, version compare.
- scripts/install-tool.js (new) — single-tool installer via winget/apt/brew with PATH refresh + verify.
- scripts/uninstall-tool.js (new) — sends REMOVE_CAPABILITY to the orchestrator (does not uninstall software).
- scripts/register-agent.js (rewritten) — auto-detects capabilities from installed extended tools; 3-attempt retry.
- server/index.js (REMOVE_CAPABILITY handler added to WS router).
- server/registry.js (getAgent already present; added updateCapabilities + export).

## Fix applied during testing
- **bootstrap.ps1 PowerShell parse error:** the original used Unicode box-drawing
  characters (`═`, `─`) in headers/section comments. PowerShell 5.1 reading the
  UTF-8 (no-BOM) file misdecoded those multibyte sequences, desynced string/quote
  tokenization, and reported `Unexpected token '\Scripts"'` plus missing-brace
  errors. Rewrote the script using ASCII separators (`=` and `# ---`). It now
  parses with 0 errors (verified via `[System.Management.Automation.Language.Parser]::ParseFile`).
  Functionality and all required tokens (param block, winget, Refresh-Path,
  pm2-startup, ANTHROPIC_API_KEY check) are unchanged.

## Usage on a new Windows machine
1. Install PowerShell 5.1+ (already on Windows 10/11)
2. Open PowerShell as Administrator
3. `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
4. `cd agent-os`
5. `.\scripts\bootstrap.ps1 -AgentId agent-2 -Role dev -OrchestratorUrl ws://192.168.1.100:3000/ws`

(From Git Bash you can instead run: `bash scripts/bootstrap.sh --agent-id=agent-2 --orchestrator=ws://192.168.1.100:3000/ws`, which delegates to the PS1 script.)
