import { useState, useEffect, useRef, useCallback } from "react";

const API_URL = "https://api.anthropic.com/v1/messages";
const GCAL_CLIENT_ID = "151455022435-retjsd4di2vd9t481l3v0v8u4g3djr52.apps.googleusercontent.com";
const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

function formatHour(h) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function getTodayStr() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const TABS = ["Plan", "Tasks", "Journal", "AI"];

export default function DailyPlanner() {
  const [tab, setTab] = useState("Plan");
  const [blocks, setBlocks] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [journal, setJournal] = useState("");
  const [newTask, setNewTask] = useState("");
  const [blockModal, setBlockModal] = useState(null);
  const [blockForm, setBlockForm] = useState({ title: "", hour: 8, duration: 1, color: "#4f46e5" });
  const [aiMessages, setAiMessages] = useState([
    { role: "assistant", content: "Good morning! I'm here to help you plan your day. Tell me what's on your agenda, or ask me to help structure your schedule." }
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [calConnected, setCalConnected] = useState(false);
  const [calSyncing, setCalSyncing] = useState(false);
  const [calError, setCalError] = useState("");
  const [calToken, setCalToken] = useState(null);
  const aiEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  useEffect(() => {
    if (tab === "AI") aiEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages, tab]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("planner_data") || "{}");
      const today = new Date().toDateString();
      if (saved.date === today) {
        if (saved.blocks) setBlocks(saved.blocks);
        if (saved.tasks) setTasks(saved.tasks);
        if (saved.journal) setJournal(saved.journal);
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("planner_data", JSON.stringify({
      date: new Date().toDateString(), blocks, tasks, journal
    }));
  }, [blocks, tasks, journal]);

  useEffect(() => {
    const hash = window.location.hash || window.location.search;
    const params = new URLSearchParams(hash.replace("#", "?").replace("??", "?"));
    const token = params.get("access_token");
    if (token) {
      setCalToken(token);
      setCalConnected(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      syncCalendar(token);
    }
  }, []);

  const openNewBlock = (hour) => {
    setBlockForm({ title: "", hour, duration: 1, color: "#4f46e5" });
    setBlockModal({ mode: "new" });
  };

  const saveBlock = () => {
    if (!blockForm.title.trim()) return;
    if (blockModal.mode === "edit") {
      setBlocks(b => b.map(bl => bl.id === blockModal.id ? { ...bl, ...blockForm } : bl));
    } else {
      setBlocks(b => [...b, { ...blockForm, id: Date.now() }]);
    }
    setBlockModal(null);
  };

  const deleteBlock = (id) => setBlocks(b => b.filter(bl => bl.id !== id));

  const addTask = () => {
    if (!newTask.trim()) return;
    setTasks(t => [...t, { id: Date.now(), text: newTask.trim(), done: false }]);
    setNewTask("");
  };

  const toggleTask = (id) => setTasks(t => t.map(tk => tk.id === id ? { ...tk, done: !tk.done } : tk));
  const deleteTask = (id) => setTasks(t => t.filter(tk => tk.id !== id));

  const speakText = useCallback((text) => {
    if (!voiceEnabled) return;
    synthRef.current.cancel();
    const clean = text.replace(/[*_~`#]/g, "");
    const utt = new SpeechSynthesisUtterance(clean);
    utt.rate = 1.05;
    utt.pitch = 1;
    const voices = synthRef.current.getVoices();
    const preferred = voices.find(v => v.name.includes("Samantha") || v.name.includes("Karen") || v.name.includes("Moira") || (v.lang === "en-US" && v.localService));
    if (preferred) utt.voice = preferred;
    utt.onstart = () => setIsSpeaking(true);
    utt.onend = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    synthRef.current.speak(utt);
  }, [voiceEnabled]);

  const startListening = () => {
    setVoiceError("");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceError("Voice input not supported."); return; }
    if (recognitionRef.current) recognitionRef.current.abort();
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onstart = () => setIsListening(true);
    rec.onresult = (e) => { setAiInput(e.results[0][0].transcript); setIsListening(false); };
    rec.onerror = (e) => { setIsListening(false); if (e.error !== "aborted") setVoiceError("Couldn't hear you. Try again."); };
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
  };

  const stopListening = () => { recognitionRef.current?.stop(); setIsListening(false); };
  const stopSpeaking = () => { synthRef.current.cancel(); setIsSpeaking(false); };

  const connectCalendar = () => {
    setCalError("");
    const redirectUri = window.location.origin;
    const params = new URLSearchParams({
      client_id: GCAL_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "token",
      scope: GCAL_SCOPES,
      prompt: "consent",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  const syncCalendar = async (token) => {
    setCalSyncing(true);
    setCalError("");
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).toISOString();
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${token || calToken}` } }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      const newBlocks = (data.items || [])
        .filter(e => e.start?.dateTime)
        .map(e => {
          const startDt = new Date(e.start.dateTime);
          const endDt = new Date(e.end?.dateTime || e.start.dateTime);
          const hour = startDt.getHours();
          const duration = Math.max(0.5, Math.round((endDt - startDt) / 3600000 * 2) / 2);
          return { id: e.id || Date.now(), title: e.summary || "Untitled", hour, duration, color: "#0891b2", fromCalendar: true };
        })
        .filter(b => b.hour >= 6 && b.hour <= 21);
      setBlocks(prev => [...prev.filter(b => !b.fromCalendar), ...newBlocks]);
    } catch { setCalError("Couldn't sync. Try reconnecting."); }
    setCalSyncing(false);
  };

  const sendAI = async () => {
    if (!aiInput.trim() || aiLoading) return;
    const userMsg = aiInput.trim();
    setAiInput("");
    const newMessages = [...aiMessages, { role: "user", content: userMsg }];
    setAiMessages(newMessages);
    setAiLoading(true);
    const context = `Today is ${getTodayStr()}. Schedule: ${blocks.length ? blocks.map(b => `${formatHour(b.hour)}: ${b.title} (${b.duration}h)`).join(", ") : "none"}. Tasks: ${tasks.length ? tasks.map(t => `${t.done ? "✓" : "○"} ${t.text}`).join(", ") : "none"}. Journal: ${journal || "empty"}`;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a thoughtful daily planning assistant. Help the user plan their day, prioritize tasks, and reflect. Be concise and warm. Context: ${context}`,
          messages: newMessages.map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      const reply = data.content?.map(c => c.text || "").join("") || "Sorry, couldn't respond right now.";
      setAiMessages(m => [...m, { role: "assistant", content: reply }]);
      speakText(reply);
    } catch {
      setAiMessages(m => [...m, { role: "assistant", content: "Couldn't connect. Please try again." }]);
    }
    setAiLoading(false);
  };

  const COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777"];

  return (
    <div style={{ fontFamily: "'Georgia', serif", minHeight: "100vh", background: "#fafaf9", color: "#1c1917", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ padding: "28px 24px 16px", borderBottom: "1px solid #e7e5e4" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#a8a29e", marginBottom: 4 }}>Daily Planner</div>
        <div style={{ fontSize: 22, fontWeight: 400 }}>{getTodayStr()}</div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#a8a29e" }}>{tasks.filter(t => t.done).length}/{tasks.length} tasks · {blocks.length} time blocks</div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #e7e5e4" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "12px 0", border: "none", background: "none", cursor: "pointer", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: tab === t ? "#1c1917" : "#a8a29e", borderBottom: tab === t ? "1.5px solid #1c1917" : "1.5px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
        {tab === "Plan" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #f5f5f4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {calConnected ? <span style={{ fontSize: 11, color: "#059669" }}>● Calendar connected</span> : <span style={{ fontSize: 11, color: "#a8a29e" }}>Google Calendar</span>}
                {calError && <span style={{ fontSize: 11, color: "#dc2626" }}>{calError}</span>}
              </div>
              <button onClick={calConnected ? () => syncCalendar() : connectCalendar} disabled={calSyncing} style={{ border: "none", borderRadius: 20, padding: "5px 14px", cursor: calSyncing ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit", background: calConnected ? "#f5f5f4" : "#1c1917", color: calConnected ? "#1c1917" : "#fafaf9" }}>
                {calSyncing ? "Syncing..." : calConnected ? "↻ Refresh" : "Connect"}
              </button>
            </div>
            {HOURS.map(hour => {
              const block = blocks.find(b => b.hour === hour);
              return (
                <div key={hour} style={{ display: "flex", alignItems: "stretch", minHeight: 52, borderBottom: "1px solid #f5f5f4" }}>
                  <div style={{ width: 56, flexShrink: 0, padding: "0 8px 0 16px", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                    <span style={{ fontSize: 11, color: "#a8a29e" }}>{formatHour(hour)}</span>
                  </div>
                  <div style={{ flex: 1, padding: "6px 8px 6px 12px", display: "flex", alignItems: "center", borderLeft: "1px solid #e7e5e4" }}>
                    {block ? (
                      <div onClick={() => { setBlockForm({ ...block }); setBlockModal({ mode: "edit", id: block.id }); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, cursor: "pointer", background: block.color + "15", borderLeft: `3px solid ${block.color}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{block.title}</div>
                          <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 1 }}>{block.duration}h{block.fromCalendar ? " · 📅" : ""}</div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteBlock(block.id); }} style={{ border: "none", background: "none", color: "#d4d4d0", cursor: "pointer", fontSize: 16 }}>×</button>
                      </div>
                    ) : (
                      <button onClick={() => openNewBlock(hour)} style={{ flex: 1, textAlign: "left", border: "none", background: "none", cursor: "pointer", color: "#d4d4d0", fontSize: 12, padding: "8px 4px", fontFamily: "inherit" }}>+ add block</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "Tasks" && (
          <div style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Add a task..." style={{ flex: 1, border: "none", borderBottom: "1.5px solid #e7e5e4", background: "none", fontSize: 14, padding: "8px 0", outline: "none", fontFamily: "inherit", color: "#1c1917" }} />
              <button onClick={addTask} style={{ border: "none", background: "#1c1917", color: "#fafaf9", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 18 }}>+</button>
            </div>
            {tasks.length === 0 && <div style={{ textAlign: "center", color: "#a8a29e", fontSize: 13, marginTop: 40 }}>No tasks yet.</div>}
            {tasks.filter(t => !t.done).map(task => (
              <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f5f5f4" }}>
                <button onClick={() => toggleTask(task.id)} style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d4d4d0", background: "none", cursor: "pointer", flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14 }}>{task.text}</span>
                <button onClick={() => deleteTask(task.id)} style={{ border: "none", background: "none", color: "#d4d4d0", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            ))}
            {tasks.filter(t => t.done).length > 0 && <>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "#a8a29e", textTransform: "uppercase", marginTop: 24, marginBottom: 8 }}>Done</div>
              {tasks.filter(t => t.done).map(task => (
                <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f5f5f4", opacity: 0.5 }}>
                  <button onClick={() => toggleTask(task.id)} style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #1c1917", background: "#1c1917", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: "#fafaf9", fontSize: 10 }}>✓</span></button>
                  <span style={{ flex: 1, fontSize: 14, textDecoration: "line-through" }}>{task.text}</span>
                  <button onClick={() => deleteTask(task.id)} style={{ border: "none", background: "none", color: "#d4d4d0", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
            </>}
          </div>
        )}

        {tab === "Journal" && (
          <div style={{ padding: "24px" }}>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#a8a29e", marginBottom: 16 }}>Today's Reflection</div>
            <textarea value={journal} onChange={e => setJournal(e.target.value)} placeholder="How are you feeling today? What do you want to accomplish? What are you grateful for..." style={{ width: "100%", minHeight: 320, border: "none", background: "none", resize: "none", outline: "none", fontSize: 15, lineHeight: 1.8, fontFamily: "'Georgia', serif", color: "#1c1917", boxSizing: "border-box" }} />
            <div style={{ marginTop: 16, fontSize: 11, color: "#d4d4d0", textAlign: "right" }}>{journal.split(/\s+/).filter(Boolean).length} words</div>
          </div>
        )}

        {tab === "AI" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid #f5f5f4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#a8a29e" }}>Voice Mode</span>
                {isSpeaking && <span style={{ fontSize: 11, color: "#4f46e5", display: "flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-flex", gap: 2 }}>{[0,1,2].map(i => <span key={i} style={{ width: 3, height: 12, background: "#4f46e5", borderRadius: 2, display: "inline-block", animation: "wave 0.8s ease-in-out infinite", animationDelay: `${i*0.15}s` }} />)}</span>Speaking...</span>}
                {voiceError && <span style={{ fontSize: 11, color: "#dc2626" }}>{voiceError}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isSpeaking && <button onClick={stopSpeaking} style={{ border: "none", background: "none", cursor: "pointer", color: "#a8a29e", fontSize: 12, fontFamily: "inherit", padding: "4px 8px" }}>Stop ▪</button>}
                <button onClick={() => { setVoiceEnabled(v => !v); synthRef.current.cancel(); setIsSpeaking(false); }} style={{ border: "none", borderRadius: 20, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", background: voiceEnabled ? "#1c1917" : "#f5f5f4", color: voiceEnabled ? "#fafaf9" : "#a8a29e" }}>
                  {voiceEnabled ? "On" : "Off"}
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              {aiMessages.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "82%", padding: "10px 14px", borderRadius: 12, background: msg.role === "user" ? "#1c1917" : "#f5f5f4", color: msg.role === "user" ? "#fafaf9" : "#1c1917", fontSize: 14, lineHeight: 1.6, borderBottomRightRadius: msg.role === "user" ? 4 : 12, borderBottomLeftRadius: msg.role === "assistant" ? 4 : 12 }}>{msg.content}</div>
                </div>
              ))}
              {aiLoading && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ background: "#f5f5f4", borderRadius: 12, borderBottomLeftRadius: 4, padding: "12px 16px" }}>
                    <span style={{ display: "inline-flex", gap: 4 }}>{[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#a8a29e", animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s`, display: "inline-block" }} />)}</span>
                  </div>
                </div>
              )}
              <div ref={aiEndRef} />
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e7e5e4", background: "#fafaf9", display: "flex", gap: 8, alignIt
