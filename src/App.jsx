import { useState, useEffect, useRef, useCallback } from "react";

// ── Design tokens — Claude-style warm light theme ─────────────────────────
const C = {
  // Backgrounds
  bg:       "#FAF9F7",   // warm white (page bg)
  surface:  "#F3F0EA",   // sidebars / panels
  card:     "#FFFFFF",   // content cards
  hover:    "#EDE9E1",   // hover state
  active:   "#E4DED3",   // active / pressed

  // Borders
  border:   "#E2DDD5",
  borderHover: "#C8C2B8",
  borderFocus: "#A09688",

  // Text
  muted:  "#B5AFA7",
  dim:    "#857F77",
  text:   "#5C5650",
  label:  "#2E2B27",
  bright: "#1A1714",

  // Claude orange (primary accent)
  o:    "#C8541A",
  oL:   "#E06A2C",
  oD:   "#A04010",
  oBg:  "rgba(200,84,26,.07)",
  oBd:  "rgba(200,84,26,.18)",

  // Supporting colors
  blue:   "#2563EB", blueBg: "rgba(37,99,235,.06)",   blueBd: "rgba(37,99,235,.15)",
  green:  "#16A34A", greenBg: "rgba(22,163,74,.07)",  greenBd: "rgba(22,163,74,.18)",
  amber:  "#B45309", amberBg: "rgba(180,83,9,.07)",   amberBd: "rgba(180,83,9,.18)",
  rose:   "#DC2626", roseBg:  "rgba(220,38,38,.07)",  roseBd:  "rgba(220,38,38,.18)",
  purple: "#7C3AED", purpleBg:"rgba(124,58,237,.07)", purpleBd:"rgba(124,58,237,.18)",
  cyan:   "#0891B2", cyanBg:  "rgba(8,145,178,.07)",  cyanBd:  "rgba(8,145,178,.18)",
};

const mono = "'JetBrains Mono','Cascadia Code','Fira Code',monospace";
const sans = "'Noto Sans SC','Inter','Helvetica Neue',system-ui,sans-serif";

// ── Backend API ───────────────────────────────────────────────────────────
const api = {
  async config() {
    const r = await fetch("/api/config");
    if (!r.ok) throw new Error("后端未连接");
    return r.json();
  },
  async tree() {
    const r = await fetch("/api/vault/tree");
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    return r.json();
  },
  async readFile(path) {
    const r = await fetch(`/api/vault/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    return r.json();
  },
  async writeFile(path, content) {
    const r = await fetch("/api/vault/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    return r.json();
  },
  async chat(messages, system) {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },
};

const DEFAULT_SYSTEM = `你是 Hermes，一个持久化的自我改进 AI 代理，扎根于用户 Tree 的 Obsidian vault。

职责：
- 用 list_vault / search_vault / read_file 了解 vault 现有知识
- 用 write_file / append_file 把有价值的产物沉淀为笔记
- 在 _hermes/sessions/ 记录对话重点，在 Skills/ 抽象可复用方法
- 发现交叉引用时，用 Obsidian [[wiki-link]] 语法

准则：清晰直接，不冗余，数据分析遵循「模糊正确优于精确错误」。`;

// ── Tree builder ──────────────────────────────────────────────────────────
function buildTree(files) {
  const root = [];
  const dirs = {};
  const getDir = (parts) => {
    const key = parts.join("/");
    if (!dirs[key]) {
      const node = { name: parts[parts.length - 1], type: "dir", children: [], open: parts.length <= 1 };
      dirs[key] = node;
      if (parts.length === 1) root.push(node);
      else (dirs[parts.slice(0, -1).join("/")] || getDir(parts.slice(0, -1))).children.push(node);
    }
    return dirs[key];
  };
  for (const f of [...files].sort()) {
    const parts = f.split("/").filter(Boolean);
    if (parts.length === 1) {
      root.push({ name: parts[0], type: "file", path: f });
    } else {
      const dir = getDir(parts.slice(0, -1));
      dir.children.push({ name: parts[parts.length - 1], type: "file", path: f });
    }
  }
  return root;
}

// ── Toast ─────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, push };
}
function Toasts({ toasts }) {
  const col = { info: C.blue, success: C.green, error: C.rose, warn: C.amber };
  const ico = { info: "ℹ", success: "✓", error: "✗", warn: "!" };
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ padding: "10px 16px", borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.label, fontSize: 13, fontFamily: sans, maxWidth: 360, animation: "slideUp .2s ease", boxShadow: "0 4px 16px rgba(0,0,0,0.09), 0 1px 3px rgba(0,0,0,0.06)" }}>
          <span style={{ color: col[t.type], marginRight: 8, fontWeight: 700, fontSize: 11 }}>{ico[t.type]}</span>{t.msg}
        </div>
      ))}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────
function Btn({ children, variant = "ghost", onClick, style = {}, disabled = false, size = "sm", title }) {
  const v = {
    ghost:   { bg: "transparent",  bd: C.border,    tx: C.text   },
    primary: { bg: C.o,            bd: C.o,         tx: "#fff"   },
    outline: { bg: C.oBg,          bd: C.oBd,       tx: C.o      },
    blue:    { bg: C.blueBg,       bd: C.blueBd,    tx: C.blue   },
    danger:  { bg: C.roseBg,       bd: C.roseBd,    tx: C.rose   },
    subtle:  { bg: C.hover,        bd: C.border,    tx: C.label  },
  }[variant] || { bg: "transparent", bd: C.border, tx: C.text };
  const sz = {
    xs: { fontSize: 11, padding: "2px 9px",  borderRadius: 6  },
    sm: { fontSize: 12, padding: "5px 12px", borderRadius: 7  },
    lg: { fontSize: 14, padding: "9px 20px", borderRadius: 9  },
  }[size];
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ ...sz, background: v.bg, color: v.tx, border: `1px solid ${v.bd}`, cursor: disabled ? "not-allowed" : "pointer", transition: "all 0.12s", fontFamily: sans, fontWeight: 500, opacity: disabled ? 0.45 : 1, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", ...style }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = v.bg === "transparent" ? C.hover : v.bg; e.currentTarget.style.filter = "brightness(0.95)"; } }}
      onMouseLeave={e => { e.currentTarget.style.background = v.bg; e.currentTarget.style.filter = "none"; }}>
      {children}
    </button>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────
const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{ width: 32, height: 18, borderRadius: 9, background: on ? C.o : C.border, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
    <div style={{ width: 14, height: 14, borderRadius: 7, background: "#fff", position: "absolute", top: 2, left: on ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
  </div>
);

// ── Context bar ───────────────────────────────────────────────────────────
function ContextBar({ used, total }) {
  const pct = Math.min(used / total, 1);
  const color = pct > 0.8 ? C.rose : pct > 0.5 ? C.amber : C.green;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ width: 64, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 10.5, color: C.muted, fontFamily: mono }}>{(used / 1000).toFixed(1)}k</span>
    </div>
  );
}

// ── Tool events ───────────────────────────────────────────────────────────
const TOOL_META = {
  list_vault:   { icon: "⊞", color: C.blue,   label: "列出文件"  },
  read_file:    { icon: "↗", color: C.cyan,   label: "读取"      },
  write_file:   { icon: "↙", color: C.green,  label: "写入"      },
  append_file:  { icon: "⊕", color: C.amber,  label: "追加"      },
  search_vault: { icon: "⌕", color: C.purple, label: "搜索"      },
};

function ToolEvents({ events }) {
  if (!events?.length) return null;
  const visible = events.filter(e => e.type !== "tool_call");
  if (!visible.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
      {visible.map((ev, i) => {
        const m = TOOL_META[ev.name] || { icon: "·", color: C.muted, label: ev.name };
        const isErr = ev.type === "tool_error";
        const color = isErr ? C.rose : m.color;
        const detail = ev.summary || ev.error || "";
        return (
          <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 6, background: `${color}0D`, border: `1px solid ${color}22`, fontSize: 11.5, fontFamily: mono }}>
            <span style={{ color, fontWeight: 700 }}>{isErr ? "✗" : m.icon}</span>
            <span style={{ color: C.dim }}>{m.label}</span>
            <span style={{ color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>{detail}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Vault Node ────────────────────────────────────────────────────────────
function VaultNode({ item, toast, depth = 0 }) {
  const [open, setOpen] = useState(item.open ?? false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const isDir = item.type === "dir";

  const handleClick = async () => {
    if (isDir) { setOpen(o => !o); return; }
    if (preview !== null) { setPreview(null); return; }
    setLoading(true);
    try { const d = await api.readFile(item.path); setPreview(d.content); }
    catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div onClick={handleClick}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", paddingLeft: 10 + depth * 14, cursor: "pointer", borderRadius: 5, transition: "background 0.07s", userSelect: "none" }}
        onMouseEnter={e => e.currentTarget.style.background = C.hover}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ fontSize: 9, color: C.muted, width: 9, textAlign: "center", flexShrink: 0, transform: isDir && open ? "rotate(90deg)" : "none", transition: "transform 0.1s", display: "inline-block" }}>▸</span>
        <span style={{ fontSize: 12, color: isDir ? C.label : C.text, fontFamily: isDir ? sans : mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.name}</span>
        {loading && <span style={{ fontSize: 10, color: C.o }}>…</span>}
      </div>
      {isDir && open && item.children?.map((c, i) => <VaultNode key={i} item={c} toast={toast} depth={depth + 1} />)}
      {preview !== null && (
        <div style={{ margin: "3px 10px 5px", marginLeft: 10 + depth * 14 + 14, padding: "10px 12px", borderRadius: 7, background: C.bg, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: mono, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto" }}>
          {preview}
        </div>
      )}
    </div>
  );
}

// ── Config Modal ──────────────────────────────────────────────────────────
function ConfigModal({ cfg, system, onSaveSystem, onClose }) {
  const [tab, setTab] = useState("status");
  const [draftSystem, setDraftSystem] = useState(system);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div style={{ width: 540, maxHeight: "88vh", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.bright }}>Hermes 配置</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>后端状态 · Vault · 系统提示词</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: C.muted, cursor: "pointer", background: "none", border: "none", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
          {[["status", "后端状态"], ["system", "System Prompt"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "10px 0", fontSize: 12, fontFamily: sans, fontWeight: 600, background: "transparent", border: "none", cursor: "pointer", color: tab === k ? C.o : C.muted, borderBottom: tab === k ? `2px solid ${C.o}` : "2px solid transparent", transition: "all 0.1s" }}>{l}</button>
          ))}
        </div>

        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {tab === "status" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["后端",       cfg ? "http://localhost:8790" : "未连接",          cfg ? C.green : C.rose],
                ["Codex Auth", cfg?.hasCodexAuth ? "已登录" : "未登录 — 请打开 Codex Desktop", cfg?.hasCodexAuth ? C.green : C.rose],
                ["Auth Mode",  cfg?.authMode || "—",                              C.blue],
                ["Model",      cfg?.model || "—",                                 C.purple],
                ["Vault Path", cfg?.vaultPath || "未配置",                        cfg?.vaultPath ? C.green : C.rose],
              ].map(([k, v, c]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 11.5, color: C.muted, fontFamily: mono, width: 110, flexShrink: 0 }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: c, fontFamily: mono, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop: 6, padding: "12px 14px", borderRadius: 8, background: C.oBg, border: `1px solid ${C.oBd}`, fontSize: 12, color: C.o, lineHeight: 1.75 }}>
                配置项在 <code style={{ background: C.hover, padding: "0 4px", borderRadius: 3 }}>.env</code> 中修改，修改后重启服务：<br />
                <code style={{ fontFamily: mono }}>npm run server</code>
              </div>
            </div>
          )}
          {tab === "system" && (
            <>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontFamily: mono }}>SYSTEM_PROMPT — 注入每次对话</div>
              <textarea value={draftSystem} onChange={e => setDraftSystem(e.target.value)}
                style={{ width: "100%", height: 280, padding: "12px 14px", fontSize: 12.5, fontFamily: mono, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.label, outline: "none", resize: "vertical", lineHeight: 1.8, transition: "border-color 0.12s" }}
                onFocus={e => e.target.style.borderColor = C.o} onBlur={e => e.target.style.borderColor = C.border} />
            </>
          )}
        </div>

        <div style={{ padding: "14px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: `1px solid ${C.border}` }}>
          <Btn onClick={onClose}>关闭</Btn>
          {tab === "system" && <Btn variant="primary" onClick={() => { onSaveSystem(draftSystem); onClose(); }}>保存</Btn>}
        </div>
      </div>
    </div>
  );
}

// ── Rules Panel ───────────────────────────────────────────────────────────
function RulesPanel({ system, onEditSystem, toast }) {
  const [sec, setSec] = useState("memory");
  const [memories, setMemories] = useState([
    { id: 1, text: "Tree 从事数据分析和量化投资研究", pinned: true },
    { id: 2, text: "偏好清晰直接、逻辑严密的写作风格", pinned: true },
    { id: 3, text: "正在进行云南商圈监测月报工作", pinned: false },
    { id: 4, text: "使用三颗粒数据进行另类因子研究", pinned: false },
    { id: 5, text: "Obsidian + n8n + Codex 知识管理流", pinned: false },
    { id: 6, text: "A 股研究使用 DuckDB + Qlib + Alpha158", pinned: false },
  ]);
  const [newMem, setNewMem] = useState("");
  const [skills, setSkills] = useState([
    { name: "yunnan-report",   uses: 15, improved: 3,  enabled: true  },
    { name: "data-validation", uses: 23, improved: 7,  enabled: true  },
    { name: "factor-research", uses: 8,  improved: 12, enabled: true  },
    { name: "bazi-analysis",   uses: 2,  improved: 1,  enabled: false },
    { name: "markdown-export", uses: 5,  improved: 2,  enabled: true  },
  ]);

  const addMem = () => {
    if (!newMem.trim()) return;
    setMemories(p => [...p, { id: Date.now(), text: newMem, pinned: false }]);
    setNewMem("");
  };

  const syncMemory = async () => {
    try {
      const content = "# MEMORY.md\n\n" + memories.map(m => `- ${m.pinned ? "[📌] " : ""}${m.text}`).join("\n");
      await api.writeFile("_hermes/memory/MEMORY.md", content);
      toast("MEMORY.md 已写入 Vault", "success");
    } catch (e) { toast(e.message, "error"); }
  };

  const tabs = [
    { id: "soul",   label: "SOUL",   color: C.amber  },
    { id: "memory", label: "Memory", color: C.purple },
    { id: "skills", label: "Skills", color: C.cyan   },
    { id: "honcho", label: "Honcho", color: C.rose   },
  ];

  return (
    <div style={{ padding: "10px 12px" }}>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 12, padding: 3, background: C.hover, borderRadius: 9, border: `1px solid ${C.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSec(t.id)} style={{ flex: 1, padding: "5px 3px", fontSize: 11, fontFamily: sans, fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 7, transition: "all 0.12s", background: sec === t.id ? C.card : "transparent", color: sec === t.id ? t.color : C.muted, boxShadow: sec === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>{t.label}</button>
        ))}
      </div>

      {sec === "soul" && (
        <div>
          <p style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>SOUL.md — 人格定义，注入每次对话</p>
          <div style={{ fontSize: 11.5, fontFamily: mono, color: C.text, lineHeight: 1.8, padding: "10px 12px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, maxHeight: 180, overflowY: "auto", whiteSpace: "pre-wrap" }}>{system}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <Btn variant="blue" size="xs" onClick={onEditSystem}>✏ 编辑</Btn>
            <Btn size="xs" onClick={async () => { try { await api.writeFile("_hermes/SOUL.md", system); toast("SOUL.md 已写入 Vault", "success"); } catch (e) { toast(e.message, "error"); } }}>↑ 写入 Vault</Btn>
          </div>
        </div>
      )}

      {sec === "memory" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input value={newMem} onChange={e => setNewMem(e.target.value)} onKeyDown={e => e.key === "Enter" && addMem()} placeholder="添加记忆条目…"
              style={{ flex: 1, padding: "6px 10px", fontSize: 12, fontFamily: sans, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.label, outline: "none" }}
              onFocus={e => e.target.style.borderColor = C.o} onBlur={e => e.target.style.borderColor = C.border} />
            <Btn onClick={addMem} style={{ color: C.purple, borderColor: C.purpleBd }}>+</Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 230, overflowY: "auto" }}>
            {[...memories].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderRadius: 7, background: m.pinned ? C.purpleBg : C.bg, border: `1px solid ${m.pinned ? C.purpleBd : C.border}` }}>
                <span onClick={() => setMemories(p => p.map(x => x.id === m.id ? { ...x, pinned: !x.pinned } : x))} style={{ fontSize: 10, cursor: "pointer", color: m.pinned ? C.purple : C.muted, flexShrink: 0 }}>◉</span>
                <span style={{ flex: 1, fontSize: 12, color: C.label, lineHeight: 1.5 }}>{m.text}</span>
                <span onClick={() => setMemories(p => p.filter(x => x.id !== m.id))} style={{ fontSize: 11, color: C.muted, cursor: "pointer" }}>✕</span>
              </div>
            ))}
          </div>
          <Btn size="xs" onClick={syncMemory} style={{ marginTop: 8 }}>↑ 同步到 Vault</Btn>
        </div>
      )}

      {sec === "skills" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 290, overflowY: "auto" }}>
            {skills.map(sk => (
              <div key={sk.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: C.bg, border: `1px solid ${sk.enabled ? C.cyanBd : C.border}`, opacity: sk.enabled ? 1 : 0.5 }}>
                <Toggle on={sk.enabled} onToggle={() => setSkills(p => p.map(s => s.name === sk.name ? { ...s, enabled: !s.enabled } : s))} />
                <span style={{ flex: 1, fontSize: 12, fontFamily: mono, color: C.label }}>{sk.name}</span>
                <span style={{ fontSize: 10.5, color: C.muted, fontFamily: mono }}>×{sk.uses}</span>
                <span style={{ fontSize: 10.5, color: C.green, fontFamily: mono }}>↑{sk.improved}</span>
                <span onClick={() => setSkills(p => p.filter(s => s.name !== sk.name))} style={{ fontSize: 11, color: C.muted, cursor: "pointer" }}>✕</span>
              </div>
            ))}
          </div>
          <Btn size="xs" style={{ color: C.cyan, borderColor: C.cyanBd, marginTop: 8 }} onClick={() => toast("对 Hermes 说「帮我创建一个 Skill…」", "info")}>+ 让 Hermes 创建</Btn>
        </div>
      )}

      {sec === "honcho" && (
        <div>
          <p style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Honcho 用户模型 — 对话历史自动推断</p>
          {[
            { trait: "工作方式", value: "直接高效，不喜冗余确认",          conf: 0.92 },
            { trait: "技术栈",   value: "Python · DuckDB · Qlib · n8n",   conf: 0.95 },
            { trait: "写作偏好", value: "官方报告体，数据驱动",            conf: 0.88 },
            { trait: "决策风格", value: "模糊正确 > 精确错误",             conf: 0.85 },
            { trait: "知识领域", value: "量化 · 消费数据 · 数字经济",      conf: 0.91 },
          ].map(t => (
            <div key={t.trait} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 7, background: C.bg, border: `1px solid ${C.border}`, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.muted, width: 54, flexShrink: 0 }}>{t.trait}</span>
              <span style={{ flex: 1, fontSize: 12, color: C.label }}>{t.value}</span>
              <div style={{ width: 40, height: 3, borderRadius: 2, background: C.border, overflow: "hidden", flexShrink: 0 }}>
                <div style={{ width: `${t.conf * 100}%`, height: "100%", background: C.rose, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10.5, color: C.muted, fontFamily: mono, width: 26, textAlign: "right" }}>{Math.round(t.conf * 100)}%</span>
            </div>
          ))}
          <Btn variant="danger" size="xs" style={{ marginTop: 8 }} onClick={() => toast("重新推断中…", "info")}>⟳ 重推断</Btn>
        </div>
      )}
    </div>
  );
}

// ── Cron tasks (static demo) ──────────────────────────────────────────────
const CRON_TASKS = [
  { name: "每日摘要",   cron: "0 2 * * *",   last: "今天 02:00", next: "明天 02:00", status: "ok",   desc: "扫描最近7天笔记，生成链接建议",  log: "已扫描 23 篇，生成 4 条链接建议，发现 2 个孤立节点" },
  { name: "Inbox 归档", cron: "0 22 * * *",  last: "昨天 22:00", next: "今天 22:00", status: "ok",   desc: "inbox/ 素材自动分类打标签",     log: "归档 3 篇: #quant(1) #consumption(1) #tech(1)" },
  { name: "Skill 自审", cron: "0 3 * * 0",   last: "4月20日",    next: "4月27日",    status: "ok",   desc: "审计 skill 使用频率和改进历史", log: "yunnan-report: 建议拆分月报+季报" },
  { name: "Memory 压缩", cron: "0 4 1 * *",  last: "4月1日",     next: "5月1日",     status: "ok",   desc: "压缩 MEMORY.md 过期/冗余记忆",  log: "47条 → 31条" },
  { name: "知识回顾",   cron: "0 8 * * 1",   last: "4月21日",    next: "4月28日",    status: "warn", desc: "周一早上汇总 → Telegram",       log: "Telegram 推送失败，已保存到 digests/" },
];

// ═══ MAIN APP ═══════════════════════════════════════════════════════════════
export default function App() {
  const [cfg, setCfg]           = useState(null);
  const [cfgError, setCfgError] = useState(null);
  const [system, setSystem]     = useState(() => localStorage.getItem("hermes-system") || DEFAULT_SYSTEM);
  const [showConfig, setShowConfig] = useState(false);

  const [sessions, setSessions]         = useState([{ id: 1, title: "新对话", time: "刚刚", msgs: 0 }]);
  const [activeSession, setActiveSession] = useState(1);
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState("");
  const [sending, setSending]           = useState(false);
  const [sedimentIdx, setSedimentIdx]   = useState(null);
  const [showSlash, setShowSlash]       = useState(false);

  const [vaultTree, setVaultTree]   = useState([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultTotal, setVaultTotal] = useState(0);

  const [rightTab, setRightTab]       = useState("vault");
  const [expandedCron, setExpandedCron] = useState(null);

  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);
  const { toasts, push: toast } = useToast();

  const saveSystem = useCallback((s) => {
    setSystem(s);
    localStorage.setItem("hermes-system", s);
    toast("System Prompt 已保存", "success");
  }, []);

  const loadVault = useCallback(async () => {
    setVaultLoading(true);
    try {
      const d = await api.tree();
      setVaultTree(buildTree(d.files));
      setVaultTotal(d.total);
    } catch {}
    finally { setVaultLoading(false); }
  }, []);

  useEffect(() => {
    api.config().then(setCfg).catch(e => setCfgError(e.message));
    loadVault();
  }, [loadVault]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const slashCmds = [
    { cmd: "/vault",    desc: "浏览 Vault 文件" },
    { cmd: "/search",   desc: "搜索 Vault"       },
    { cmd: "/new",      desc: "新建会话"          },
    { cmd: "/skills",   desc: "浏览 Skills"       },
    { cmd: "/compress", desc: "压缩上下文"        },
  ];

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const ts = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const userMsg = { role: "user", content: input, ts };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setShowSlash(false);
    setSending(true);
    const tid = Date.now();
    setMessages(p => [...p, { role: "hermes", content: "正在思考…", ts: "", thinking: true, _id: tid }]);

    try {
      const { text, events, usage } = await api.chat(next, system);
      const replyTs = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      setMessages(p => [
        ...p.filter(m => m._id !== tid),
        { role: "hermes", content: text || "(空响应)", ts: replyTs, events, usage, canSediment: true },
      ]);
      setSessions(p => p.map(s => s.id === activeSession ? { ...s, msgs: s.msgs + 2 } : s));
      if (events?.some(e => e.name === "write_file" || e.name === "append_file")) loadVault();
    } catch (e) {
      setMessages(p => p.filter(m => m._id !== tid));
      toast(e.message, "error");
    } finally {
      setSending(false);
    }
  };

  const handleSediment = async (msg, action) => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const slug = (msg.content || "").slice(0, 28).replace(/[^\w\u4e00-\u9fff]/g, "-");
    const filePath = action === "skill" ? `_hermes/skills/${slug || "note"}.md` : `_hermes/sessions/${date}-${slug || "note"}.md`;
    const body = action === "skill"
      ? `# Skill: ${slug}\n*${now.toLocaleString("zh-CN")}*\n\n${msg.content}`
      : `# Note\n*${now.toLocaleString("zh-CN")}*\n\n${msg.content}`;
    try { await api.writeFile(filePath, body); toast(`已沉淀 → ${filePath}`, "success"); setSedimentIdx(null); loadVault(); }
    catch (e) { toast(e.message, "error"); }
  };

  const tokensUsed = Math.round(messages.reduce((a, m) => a + (m.content?.length || 0) / 4, 0));
  const currentTitle = sessions.find(s => s.id === activeSession)?.title || "对话";
  const backendOk = Boolean(cfg?.hasCodexAuth && cfg?.vaultPath);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ width: "100vw", height: "100vh", background: C.bg, color: C.text, fontFamily: sans, display: "flex", overflow: "hidden" }}>
      {showConfig && <ConfigModal cfg={cfg} system={system} onSaveSystem={saveSystem} onClose={() => setShowConfig(false)} />}
      <Toasts toasts={toasts} />

      {/* ═══ LEFT SIDEBAR ═══ */}
      <div style={{ width: 230, minWidth: 230, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.surface }}>
        {/* Brand */}
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.border}` }}>
          {/* Hermes logo — warm orange gradient circle */}
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(145deg, ${C.oL} 0%, ${C.o} 60%, ${C.oD} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#fff", flexShrink: 0, boxShadow: `0 2px 8px ${C.o}44` }}>☤</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.bright, letterSpacing: "-0.3px" }}>Hermes</div>
            <div style={{ fontSize: 10.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg?.vaultName || (cfgError ? "未连接" : "…")}</div>
          </div>
          <button onClick={() => setShowConfig(true)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15, padding: "2px 4px", borderRadius: 5, transition: "color 0.1s" }}
            onMouseEnter={e => e.currentTarget.style.color = C.o} onMouseLeave={e => e.currentTarget.style.color = C.muted}>⚙</button>
        </div>

        {/* New session */}
        <div style={{ padding: "10px 12px 6px" }}>
          <button onClick={() => {
            const id = Date.now();
            setSessions(p => [{ id, title: "新对话", time: "刚刚", msgs: 0 }, ...p]);
            setActiveSession(id); setMessages([]);
          }} style={{ width: "100%", padding: "7px 12px", borderRadius: 8, border: `1.5px dashed ${C.border}`, background: "transparent", color: C.muted, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: sans, fontWeight: 500, transition: "all 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.o; e.currentTarget.style.color = C.o; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> 新建会话
          </button>
        </div>

        {/* Sessions */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
          {sessions.map(s => {
            const active = activeSession === s.id;
            return (
              <div key={s.id} onClick={() => setActiveSession(s.id)}
                style={{ padding: "9px 10px", borderRadius: 8, marginBottom: 2, cursor: "pointer", background: active ? C.card : "transparent", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.06)" : "none", border: `1px solid ${active ? C.border : "transparent"}`, borderLeft: `3px solid ${active ? C.o : "transparent"}`, transition: "all 0.1s" }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ fontSize: 12.5, color: active ? C.bright : C.label, fontWeight: active ? 600 : 400, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10.5, color: C.muted }}>{s.time}</span>
                  <span style={{ fontSize: 10.5, color: C.muted }}>{s.msgs} msgs</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Status footer */}
        <div style={{ padding: "10px 14px 12px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Codex",  value: cfg?.hasCodexAuth ? "已连接" : (cfgError ? "离线" : "…"), color: cfg?.hasCodexAuth ? C.green : C.rose  },
            { label: "Vault",  value: vaultTotal ? `${vaultTotal} 篇笔记` : "未连接",           color: vaultTotal ? C.purple : C.muted },
            { label: "Model",  value: cfg?.model || "—",                                         color: C.amber  },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", fontSize: 11 }}>
              <div style={{ width: 5, height: 5, borderRadius: 3, background: s.color, marginRight: 8, flexShrink: 0 }} />
              <span style={{ color: C.muted, flex: 1 }}>{s.label}</span>
              <span style={{ color: s.color, fontFamily: mono, fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ CHAT ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{ height: 48, display: "flex", alignItems: "center", padding: "0 22px", borderBottom: `1px solid ${C.border}`, background: C.card, gap: 12, flexShrink: 0, boxShadow: "0 1px 0 rgba(0,0,0,0.04)" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.bright, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTitle}</span>
          <ContextBar used={tokensUsed} total={128000} />
          <div style={{ width: 1, height: 18, background: C.border }} />
          <Btn size="xs" onClick={() => setShowConfig(true)}>⚙ 配置</Btn>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, paddingTop: 60, gap: 14 }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: `linear-gradient(145deg, ${C.oL}, ${C.o})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, boxShadow: `0 6px 24px ${C.o}33` }}>☤</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.label }}>Hermes 就绪</div>
              <div style={{ fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 1.9, maxWidth: 440 }}>
                {backendOk
                  ? <>Vault <strong style={{ color: C.o }}>{cfg.vaultName}</strong> 已连接，可以开始对话<br /><span style={{ color: C.muted, fontSize: 11.5 }}>Hermes 会自动读写你的笔记，建立交叉引用</span></>
                  : <>请确保 Codex Desktop 已登录，<code style={{ fontSize: 11 }}>.env</code> 中配置了 VAULT_PATH</>
                }
              </div>
              {!backendOk && <Btn variant="outline" onClick={() => setShowConfig(true)}>查看配置 →</Btn>}
            </div>
          )}

          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            return (
              <div key={i} style={{ display: "flex", gap: 12, maxWidth: 860 }}>
                {/* Avatar */}
                <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
                  background: isUser ? C.blueBg : `linear-gradient(145deg, ${C.oL}22, ${C.o}22)`,
                  border: `1.5px solid ${isUser ? C.blueBd : C.oBd}`,
                  color: isUser ? C.blue : C.o,
                }}>
                  {isUser ? "T" : "☤"}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isUser ? C.blue : C.o }}>{isUser ? "Tree" : "Hermes"}</span>
                    <span style={{ fontSize: 10.5, color: C.muted }}>{msg.ts}</span>
                    {msg.usage && <span style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>{msg.usage.input_tokens}→{msg.usage.output_tokens} tokens</span>}
                  </div>

                  <ToolEvents events={msg.events} />

                  <div style={{
                    fontSize: 14, lineHeight: 1.85, color: msg.thinking ? C.muted : C.label,
                    padding: "12px 16px", borderRadius: 11,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    whiteSpace: "pre-wrap",
                    fontStyle: msg.thinking ? "italic" : "normal",
                    animation: msg.thinking ? "pulse 1.6s ease infinite" : undefined,
                    borderLeft: `3px solid ${isUser ? C.blueBd : C.oBd}`,
                  }}>
                    {msg.content}
                  </div>

                  {msg.canSediment && (
                    <div style={{ marginTop: 8, display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                      <Btn size="xs" variant={sedimentIdx === i ? "outline" : "ghost"} onClick={() => setSedimentIdx(sedimentIdx === i ? null : i)}>↓ 沉淀</Btn>
                      {sedimentIdx === i && <>
                        <Btn size="xs" style={{ color: C.green, borderColor: C.greenBd }} onClick={() => handleSediment(msg, "new")}>存为笔记</Btn>
                        <Btn size="xs" style={{ color: C.cyan, borderColor: C.cyanBd }} onClick={() => handleSediment(msg, "skill")}>创建 Skill</Btn>
                      </>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 22px 16px", borderTop: `1px solid ${C.border}`, background: C.card, position: "relative", flexShrink: 0 }}>
          {showSlash && (
            <div style={{ position: "absolute", bottom: "100%", left: 22, right: 22, marginBottom: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 5, boxShadow: "0 -6px 24px rgba(0,0,0,0.08)" }}>
              {slashCmds.map(c => (
                <div key={c.cmd} onClick={() => { setInput(c.cmd + " "); setShowSlash(false); inputRef.current?.focus(); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.hover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: C.o, width: 90 }}>{c.cmd}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{c.desc}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: C.bg, borderRadius: 12, padding: "10px 14px", border: `1.5px solid ${C.border}`, transition: "border-color 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
            onFocusCapture={e => e.currentTarget.style.borderColor = C.o}
            onBlurCapture={e => e.currentTarget.style.borderColor = C.border}>
            <textarea ref={inputRef} value={input}
              onChange={e => { setInput(e.target.value); setShowSlash(e.target.value === "/"); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } if (e.key === "Escape") setShowSlash(false); }}
              placeholder={backendOk ? "输入消息… 或 / 触发命令" : "请先启动 Codex Desktop 并配置 .env…"}
              rows={1}
              style={{ flex: 1, resize: "none", background: "transparent", border: "none", color: C.bright, fontSize: 14, outline: "none", fontFamily: sans, lineHeight: 1.65, maxHeight: 140, overflowY: "auto" }} />
            <button onClick={handleSend} disabled={sending || !input.trim() || !backendOk}
              style={{ width: 34, height: 34, borderRadius: 9, border: "none", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: input.trim() && !sending && backendOk ? "pointer" : "default", transition: "all 0.15s",
                background: input.trim() && !sending && backendOk ? C.o : C.border,
                color: input.trim() && !sending && backendOk ? "#fff" : C.muted,
                boxShadow: input.trim() && !sending && backendOk ? `0 2px 10px ${C.o}44` : "none",
              }}>{sending ? "…" : "↑"}</button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "0 2px" }}>
            <div style={{ display: "flex", gap: 5 }}>
              <span style={{ fontSize: 11, color: C.muted }}>Shift+Enter 换行</span>
              {!backendOk && <span onClick={() => setShowConfig(true)} style={{ fontSize: 11, color: C.rose, cursor: "pointer", textDecoration: "underline" }}>⚠ 后端未就绪</span>}
            </div>
            <span style={{ fontSize: 11, color: C.muted }}>{cfg?.model || "—"}</span>
          </div>
        </div>
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      <div style={{ width: 292, minWidth: 260, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.surface }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.card, flexShrink: 0 }}>
          {[{ k: "vault", l: "Vault" }, { k: "rules", l: "规则层" }, { k: "iterate", l: "自迭代" }].map(t => (
            <button key={t.k} onClick={() => setRightTab(t.k)}
              style={{ flex: 1, fontSize: 12, fontWeight: 600, fontFamily: sans, cursor: "pointer", background: "transparent", border: "none", color: rightTab === t.k ? C.o : C.muted, borderBottom: rightTab === t.k ? `2.5px solid ${C.o}` : "2.5px solid transparent", padding: "11px 0 9px", transition: "all 0.1s" }}>
              {t.l}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* ── VAULT ── */}
          {rightTab === "vault" && (
            <div style={{ padding: "8px 0" }}>
              <div style={{ padding: "6px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: C.muted, fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg?.vaultName || "vault"}</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {vaultLoading && <span style={{ fontSize: 10, color: C.o }}>…</span>}
                  <Btn size="xs" onClick={loadVault}>⟳</Btn>
                </div>
              </div>
              {vaultTree.length > 0
                ? vaultTree.map((item, i) => <VaultNode key={i} item={item} toast={toast} />)
                : (
                  <div style={{ padding: "40px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 12, color: C.border }}>⊠</div>
                    <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.8 }}>{cfgError ? "后端未启动" : (cfg?.vaultPath ? "正在扫描…" : "VAULT_PATH 未配置")}</div>
                    <Btn variant="outline" style={{ marginTop: 14 }} onClick={() => setShowConfig(true)}>查看配置</Btn>
                  </div>
                )
              }
            </div>
          )}

          {/* ── RULES ── */}
          {rightTab === "rules" && <RulesPanel system={system} onEditSystem={() => setShowConfig(true)} toast={toast} />}

          {/* ── ITERATE ── */}
          {rightTab === "iterate" && (
            <div style={{ padding: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.bright }}>自迭代调度</span>
                <Btn size="xs" variant="outline">+ 新任务</Btn>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {CRON_TASKS.map((task, i) => (
                  <div key={task.name} style={{ borderRadius: 9, border: `1px solid ${C.border}`, overflow: "hidden", background: C.card, transition: "box-shadow 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
                    <div onClick={() => setExpandedCron(expandedCron === i ? null : i)}
                      style={{ padding: "9px 12px", display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0, background: task.status === "ok" ? C.green : C.amber }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.bright }}>{task.name}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.desc}</div>
                      </div>
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, flexShrink: 0 }}>{task.cron}</span>
                    </div>
                    {expandedCron === i && (
                      <div style={{ padding: "8px 12px 12px", borderTop: `1px solid ${C.border}`, background: C.bg, animation: "fadeIn 0.12s" }}>
                        <div style={{ display: "flex", gap: 18, marginBottom: 8 }}>
                          <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>上次执行</div><div style={{ fontSize: 11.5, fontFamily: mono, color: C.label }}>{task.last}</div></div>
                          <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>下次执行</div><div style={{ fontSize: 11.5, fontFamily: mono, color: C.green }}>{task.next}</div></div>
                        </div>
                        <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>最近日志</div>
                        <div style={{ fontSize: 11.5, fontFamily: mono, color: C.label, padding: "7px 10px", borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{task.log}</div>
                        <div style={{ display: "flex", gap: 5, marginTop: 9 }}>
                          <Btn size="xs" variant="blue">▶ 执行</Btn>
                          <Btn size="xs">编辑</Btn>
                          <Btn size="xs" variant="danger">⏸ 暂停</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Health */}
              <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 9, background: C.card, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.bright, marginBottom: 10 }}>迭代健康度</div>
                {[
                  { l: "本周自动归档",    v: "12 篇",       c: C.green  },
                  { l: "链接建议 (采纳)", v: "18条 (61%)",  c: C.blue   },
                  { l: "Skill 自改进",   v: "5 次",         c: C.cyan   },
                  { l: "Memory 压缩率",  v: "34%",          c: C.purple },
                  { l: "孤立节点",        v: "3 个",         c: C.amber  },
                ].map(s => (
                  <div key={s.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 12, color: C.muted }}>{s.l}</span>
                    <span style={{ fontSize: 12, color: s.c, fontFamily: mono, fontWeight: 600 }}>{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(-2px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideUp { from { opacity:0; transform:translateX(6px); } to { opacity:1; transform:translateX(0); } }
        @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:2px; }
        ::-webkit-scrollbar-thumb:hover { background:${C.borderHover}; }
        textarea::placeholder, input::placeholder { color:${C.muted}; }
      `}</style>
    </div>
  );
}
