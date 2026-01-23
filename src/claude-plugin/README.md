# Ralph Plugin for Claude Code

This plugin provides the `/ralph` skill for converting markdown PRDs into structured JSON format for the Ralph autonomous agent system.

## What it does

The `/ralph` skill:
- Converts Product Requirements Documents (PRDs) from markdown to JSON
- Structures features into appropriately-sized user stories
- Orders stories by dependency (database → backend → UI)
- Ensures acceptance criteria are verifiable
- Generates branch names in kebab-case format

## Installation

This plugin is automatically installed when you install the `ralph blaster` npm package:

```bash
npm install -g ralphblaster
```

The plugin will be installed to: `~/.claude/plugins/local/ralph/`

## Usage

Use the `/ralph` skill in Claude Code:

```bash
claude /ralph < your-prd.md
```

Or pipe PRD content directly:

```bash
cat prd.md | claude /ralph
```

The skill will generate a `prd.json` file in the current directory.

## License

MIT
