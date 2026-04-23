# pi-powerline-footer-wessel

A slimmed-down powerline-style footer extension for [pi](https://github.com/badlogic/pi-mono).

This version is based on `pi-powerline-footer-original`, but intentionally keeps only the parts I wanted:

- powerline footer and segments
- startup welcome overlay/header
- working vibes
- last-prompt reminder

And removes the rest:

- bash mode
- shell completions / ghost suggestions
- editor stash
- stash history
- copy/cut editor shortcuts
- related commands, widgets, and persistence

## Features

### Powerline footer

- Powerline-style status bar rendered above the editor
- Responsive layout with overflow moving into a secondary row
- Presets for different densities and styles
- Git integration
- Model / auth profile / thinking / context / tokens / cost / time / host / session segments
- Extension status passthrough
- Theme-aware colors with optional local overrides

### Welcome UI

On startup, the extension can show:

- a centered welcome overlay, or
- a quieter persistent header

The welcome UI includes:

- current model/provider
- keyboard tips
- loaded context/extensions/skills/template counts
- recent sessions

### Working Vibes

Replace the default loading text with short themed messages.

Examples:

- `/vibe star trek`
- `/vibe pirate`
- `/vibe zen`
- `/vibe noir`

Supports:

- AI-generated mode
- file-based mode using pre-generated vibe text files
- custom model selection
- configurable refresh interval and prompt template

### Last-prompt reminder

Shows a subtle reminder of your most recent prompt below the editor.

## Commands

### `/footer-wessel`

- `/footer-wessel` — toggle the extension on/off
- `/footer-wessel <preset>` — switch preset

Available presets:

- `default`
- `minimal`
- `compact`
- `full`
- `nerd`
- `ascii`
- `custom`

### `/vibe`

- `/vibe` — show current vibe status
- `/vibe <theme>` — set theme
- `/vibe off` — disable vibes
- `/vibe mode` — show current mode
- `/vibe mode generate` — enable on-demand generation
- `/vibe mode file` — use pre-generated vibe files
- `/vibe model` — show current vibe model
- `/vibe model <provider/model>` — set vibe model
- `/vibe generate <theme> [count]` — generate vibe file for file mode

## Settings

Settings are read from:

- `~/.pi/agent/settings.json`

### Footer preset

```json
{
  "footerWessel": "default"
}
```

### Quiet startup header

Use a persistent header instead of the centered overlay:

```json
{
  "quietStartup": true
}
```

### Last prompt visibility

```json
{
  "showLastPrompt": true
}
```

Set to `false` to hide it.

### Working vibes

```json
{
  "workingVibe": "star trek",
  "workingVibeMode": "generate",
  "workingVibeModel": "openai-codex/gpt-5.4-mini",
  "workingVibeFallback": "Working",
  "workingVibeRefreshInterval": 30,
  "workingVibePrompt": "Generate a {theme} loading message for: {task}",
  "workingVibeMaxLength": 65
}
```

## Theme overrides

You can override semantic colors with a local `theme.json` next to the extension.

Example:

```json
{
  "colors": {
    "pi": "accent",
    "model": "#d787af",
    "authProfile": "accent",
    "path": "#00afaf",
    "gitClean": "success",
    "gitDirty": "warning",
    "thinking": "muted",
    "context": "dim",
    "contextWarn": "warning",
    "contextError": "error",
    "cost": "text",
    "tokens": "muted",
    "separator": "dim",
    "border": "borderMuted"
  }
}
```

See `theme.example.json` for the current set of supported keys.

## Installation / usage

### As a local project extension

If you want to use this repo directly as a project-local extension, point pi at `index.ts` or place it in a discovered extensions location.

### As a packaged pi extension

`package.json` is set up as a pi extension package with:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

## Development

Run tests:

```bash
npm test
```

Current test coverage focuses on `working-vibes`.

## Notes

This repo is intentionally **not** a feature-complete clone of the original extension. It is a reduced variant meant to be easier to customize further.
