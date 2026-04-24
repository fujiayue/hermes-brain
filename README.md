# 🧠 Hermes Brain

A persistent, self-improving AI second brain built on your local Obsidian vault.

Hermes reads and writes your Markdown notes directly — no plugins, no sync, no cloud. Every conversation can be distilled into permanent knowledge that compounds over time.

![UI Preview](https://raw.githubusercontent.com/placeholder/hermes-brain/main/preview.png)

---

## How it works

```
Browser (React + Vite)
    ↕  /api/*
Node.js Backend (Express)
    ↕  Tool Use loop
Codex Desktop CLI  ←→  Obsidian Vault (.md files)
```

Hermes runs a multi-round planner loop. Each round it can call vault tools:

| Tool | Description |
|------|-------------|
| `list_vault` | Browse all markdown files |
| `read_file` | Read a specific note |
| `write_file` | Create or overwrite a note |
| `append_file` | Add to an existing note |
| `search_vault` | Full-text search across the vault |

---

## Features

- **Three-panel UI** — Sessions sidebar · Chat · Vault browser / Rules / Self-iteration
- **Vault browser** — Browse and preview any note in real time
- **Sediment** — One-click to distill a reply into `_hermes/sessions/` or `_hermes/skills/`
- **Rules layer** — Edit Hermes's SOUL, memory schema, and skill definitions in-app
- **Desktop app** — Ships as a single `hermes.exe` (double-click to launch, browser opens automatically)

---

## Prerequisites

- **[Codex Desktop](https://codex.openai.com/)** — installed and signed in (provides the AI backend)
- **Node.js 20+**
- An **Obsidian vault** (any local folder of `.md` files works)

---

## Quick start (dev mode)

```bash
git clone https://github.com/YOUR_USERNAME/hermes-brain.git
cd hermes-brain
npm install

# Configure
cp .env.example .env
# Edit .env — set VAULT_PATH to your vault's absolute path

# Run (backend :8790 + frontend :5173, opened automatically)
npm run dev
```

---

## Build desktop app

```bash
npm run build-app
```

Produces `hermes.exe` in the project root. Copy it (and `.env`) to any folder and double-click to launch.

---

## Configuration (`.env`)

| Key | Description | Default |
|-----|-------------|---------|
| `VAULT_PATH` | Absolute path to your Obsidian vault | _(required)_ |
| `MODEL` | Codex model to use | `gpt-5.4` |
| `PORT` | Backend port | `8790` |

---

## Project structure

```
hermes-brain/
├── server.js          # Express backend — Codex CLI planner loop + vault tools
├── src/
│   ├── main.jsx
│   └── App.jsx        # React UI — three-panel layout
├── scripts/
│   ├── make-icon.mjs  # Generates icon.ico (pure JS, no deps)
│   ├── make-stub.mjs  # Prepares caxa launcher stub
│   └── apply-icon.mjs # Embeds icon into exe via rcedit
├── index.html
├── vite.config.js
├── .env.example
└── package.json
```

---

## Security

- Your vault path stays in `.env` (never committed, never sent anywhere)
- File operations are sandboxed to `VAULT_PATH` (path traversal blocked)
- Codex auth is read from the local Codex Desktop installation — no tokens in this repo

---

## Roadmap

- [ ] Real cron-driven self-iteration tasks
- [ ] Multi-vault support
- [ ] Plugin system for custom tools
- [ ] Windows tray icon

---

## License

MIT
