import React, { useState, useEffect, useMemo } from "react";
import {
  Plus,
  X,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Repeat,
  Check,
  ArrowUpCircle,
  ArrowDownCircle,
  Inbox,
  Lock,
  Delete,
  CalendarDays,
  Settings,
  Copy,
} from "lucide-react";
import { storage, getConfig, setConfig, clearConfig, testConnection } from "./storage.js";

// ---------- Design tokens ----------
const COLORS = {
  paper: "#F5F1E8",
  paperDeep: "#ECE4D2",
  ink: "#2A2620",
  inkSoft: "#6B6356",
  line: "#DCD0B8",
  wine: "#7C3B3B",
  wineSoft: "#EFDDD9",
  forest: "#3D6B52",
  forestSoft: "#DCEAE0",
  ochre: "#B5812E",
  ochreSoft: "#F2E3C4",
  cream: "#FFFCF5",
};

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

// ---------- Helpers ----------
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function monthKeyOf(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function fmtAmount(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("mn-MN") + "₮";
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// An entry's schedule can be:
//  - "once": a single dueDate
//  - "monthly": repeats every month forever on dueDay
//  - "custom": a fixed list of specific dates (e.g. a 4-payment installment)
function getScheduleType(entry) {
  if (entry.scheduleType) return entry.scheduleType;
  return entry.isRecurring ? "monthly" : "once";
}

function scheduleLabel(entry) {
  const schedule = getScheduleType(entry);
  if (schedule === "monthly") return "сар бүр";
  if (schedule === "custom") {
    const total = (entry.customDates || []).length;
    const paid = (entry.paidDates || []).length;
    return `${paid}/${total} төлсөн`;
  }
  return null;
}

function formatDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Quick-generate N equally-spaced monthly dates starting from startDateStr,
// used for installment-style debts (e.g. "4 удаа сар бүр адил дүнгээр").
function generateCustomDates(startDateStr, count) {
  const start = new Date(startDateStr + "T00:00:00");
  const dates = [];
  for (let i = 0; i < count; i++) {
    const totalMonth = start.getMonth() + i;
    const year = start.getFullYear() + Math.floor(totalMonth / 12);
    const month = ((totalMonth % 12) + 12) % 12;
    const numDays = daysInMonth(year, month);
    const day = Math.min(start.getDate(), numDays);
    dates.push(formatDateInput(new Date(year, month, day)));
  }
  return dates;
}

function getOccurrencesForMonth(entries, year, month) {
  const numDays = daysInMonth(year, month);
  const mKey = monthKeyOf(year, month);
  const occ = [];
  entries.forEach((e) => {
    const schedule = getScheduleType(e);
    if (schedule === "monthly") {
      const day = Math.min(e.dueDay, numDays);
      occ.push({
        entry: e,
        day,
        occKey: mKey,
        isPaid: (e.paidMonths || []).includes(mKey),
      });
    } else if (schedule === "custom") {
      (e.customDates || []).forEach((ds) => {
        const d = new Date(ds + "T00:00:00");
        if (d.getFullYear() === year && d.getMonth() === month) {
          occ.push({
            entry: e,
            day: d.getDate(),
            occKey: ds,
            isPaid: (e.paidDates || []).includes(ds),
          });
        }
      });
    } else if (e.dueDate) {
      const d = new Date(e.dueDate + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) {
        occ.push({ entry: e, day: d.getDate(), occKey: e.id, isPaid: !!e.isPaid });
      }
    }
  });
  return occ.sort((a, b) => a.day - b.day);
}

// next due date (for sorting the master list), returns a Date or null
function nextDueDate(entry, fromDate) {
  const schedule = getScheduleType(entry);
  if (schedule === "monthly") {
    const y = fromDate.getFullYear();
    const m = fromDate.getMonth();
    const numDaysThis = daysInMonth(y, m);
    const dayThis = Math.min(entry.dueDay, numDaysThis);
    const mKeyThis = monthKeyOf(y, m);
    const paidThis = (entry.paidMonths || []).includes(mKeyThis);
    if (!paidThis) return new Date(y, m, dayThis);
    const nm = m === 11 ? 0 : m + 1;
    const ny = m === 11 ? y + 1 : y;
    const numDaysNext = daysInMonth(ny, nm);
    return new Date(ny, nm, Math.min(entry.dueDay, numDaysNext));
  }
  if (schedule === "custom") {
    const paidSet = new Set(entry.paidDates || []);
    const unpaid = (entry.customDates || []).filter((d) => !paidSet.has(d)).sort();
    if (unpaid.length === 0) return null;
    return new Date(unpaid[0] + "T00:00:00");
  }
  if (entry.dueDate) return new Date(entry.dueDate + "T00:00:00");
  return null;
}

// ---------- Small presentational pieces ----------
function StatCard({ label, amount, tone, icon }) {
  const toneColors = {
    wine: { bg: COLORS.wineSoft, fg: COLORS.wine },
    forest: { bg: COLORS.forestSoft, fg: COLORS.forest },
    ochre: { bg: COLORS.ochreSoft, fg: COLORS.ochre },
  }[tone];
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-3"
      style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
    >
      <div
        className="rounded-full p-2 flex items-center justify-center shrink-0"
        style={{ background: toneColors.bg, color: toneColors.fg }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs" style={{ color: COLORS.inkSoft }}>
          {label}
        </p>
        <p
          className="text-lg font-semibold truncate"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: COLORS.ink }}
        >
          {amount}
        </p>
      </div>
    </div>
  );
}

function MonthRing({ year, month, occurrences }) {
  const numDays = daysInMonth(year, month);
  const total = occurrences.length;
  const paid = occurrences.filter((o) => o.isPaid).length;
  const fraction = total > 0 ? paid / total : 0;
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const R = 58;
  const dotR = 50;
  const circumference = 2 * Math.PI * R;

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  function angleFor(day) {
    const frac = (day - 0.5) / numDays;
    return frac * 2 * Math.PI - Math.PI / 2;
  }

  return (
    <div className="flex items-center justify-center py-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={COLORS.line} strokeWidth="10" />
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={COLORS.forest}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.4s ease" }}
        />
        {occurrences.map((o, i) => {
          const a = angleFor(o.day);
          const x = cx + dotR * Math.cos(a);
          const y = cy + dotR * Math.sin(a);
          const color = o.entry.type === "owe" ? COLORS.wine : COLORS.forest;
          return (
            <circle
              key={o.entry.id + "-" + i}
              cx={x}
              cy={y}
              r={o.isPaid ? 3 : 4.5}
              fill={o.isPaid ? COLORS.cream : color}
              stroke={color}
              strokeWidth={o.isPaid ? 1.5 : 0}
            />
          );
        })}
        {isCurrentMonth &&
          (() => {
            const a = angleFor(today.getDate());
            const x1 = cx + (R + 7) * Math.cos(a);
            const y1 = cy + (R + 7) * Math.sin(a);
            const x2 = cx + (R - 7) * Math.cos(a);
            const y2 = cy + (R - 7) * Math.sin(a);
            return (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.ochre} strokeWidth="3" strokeLinecap="round" />
            );
          })()}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="20"
          fontWeight="600"
          fill={COLORS.ink}
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {total > 0 ? Math.round(fraction * 100) + "%" : "—"}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill={COLORS.inkSoft}>
          {total > 0 ? `${paid}/${total} төлсөн` : "Төлбөр алга"}
        </text>
      </svg>
    </div>
  );
}

// ---------- Entry form modal ----------
function EntryModal({ initial, defaultDate, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState(initial?.type || "owe");
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [scheduleType, setScheduleType] = useState(getScheduleType(initial || {}) || "once");
  const [dueDay, setDueDay] = useState(initial?.dueDay ? String(initial.dueDay) : "1");
  const [dueDate, setDueDate] = useState(initial?.dueDate || defaultDate || "");
  const [customDates, setCustomDates] = useState(initial?.customDates || []);
  const [customCount, setCustomCount] = useState("4");
  const [customStart, setCustomStart] = useState(initial?.customDates?.[0] || defaultDate || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [error, setError] = useState("");

  function handleGenerateCustomDates() {
    const count = Number(customCount);
    if (!customStart) {
      setError("Эхний өдрөө сонгоно уу.");
      return;
    }
    if (!count || count < 1 || count > 36) {
      setError("Удаа тоог 1-36 хооронд оруулна уу.");
      return;
    }
    setError("");
    setCustomDates(generateCustomDates(customStart, count));
  }

  function updateCustomDate(index, value) {
    setCustomDates((prev) => prev.map((d, i) => (i === index ? value : d)));
  }

  function removeCustomDate(index) {
    setCustomDates((prev) => prev.filter((_, i) => i !== index));
  }

  function addBlankCustomDate() {
    const last = customDates[customDates.length - 1];
    setCustomDates((prev) => [...prev, last || formatDateInput(new Date())]);
  }

  function handleSubmit() {
    if (!name.trim()) {
      setError("Нэрээ оруулна уу.");
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Дүнгээ зөв оруулна уу.");
      return;
    }
    if (scheduleType === "monthly") {
      const d = Number(dueDay);
      if (!d || d < 1 || d > 31) {
        setError("Сарын өдрийг 1-31 хооронд оруулна уу.");
        return;
      }
    } else if (scheduleType === "custom") {
      const cleaned = customDates.filter((d) => !!d);
      if (cleaned.length === 0) {
        setError("Дор хаяж нэг өдөр нэмнэ үү.");
        return;
      }
    } else if (!dueDate) {
      setError("Огноогоо сонгоно уу.");
      return;
    }

    const cleanedCustomDates = [...new Set(customDates.filter((d) => !!d))].sort();

    onSave({
      id: initial?.id || genId(),
      name: name.trim(),
      type,
      amount: amt,
      scheduleType,
      isRecurring: scheduleType === "monthly",
      dueDay: scheduleType === "monthly" ? Number(dueDay) : null,
      dueDate: scheduleType === "once" ? dueDate : null,
      customDates: scheduleType === "custom" ? cleanedCustomDates : [],
      notes: notes.trim(),
      isPaid: initial?.isPaid || false,
      paidMonths: initial?.paidMonths || [],
      paidDates: initial?.paidDates || [],
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(38,32,24,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-lg font-semibold"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}
          >
            {initial ? "Засах" : "Шинээр нэмэх"}
          </h2>
          <button onClick={onClose} aria-label="Хаах" style={{ color: COLORS.inkSoft }}>
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
              Нэр (хүн / байгууллага / зориулалт)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Жишээ: Хаан банк зээл, Сараа гуайд өгсэн мөнгө"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper, color: COLORS.ink }}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setType("owe")}
              className="flex-1 rounded-lg py-2 text-sm flex items-center justify-center gap-1.5"
              style={{
                background: type === "owe" ? COLORS.wineSoft : COLORS.paper,
                color: type === "owe" ? COLORS.wine : COLORS.inkSoft,
                border: `1px solid ${type === "owe" ? COLORS.wine : COLORS.line}`,
              }}
            >
              <ArrowUpCircle size={15} /> Би төлнө
            </button>
            <button
              onClick={() => setType("receivable")}
              className="flex-1 rounded-lg py-2 text-sm flex items-center justify-center gap-1.5"
              style={{
                background: type === "receivable" ? COLORS.forestSoft : COLORS.paper,
                color: type === "receivable" ? COLORS.forest : COLORS.inkSoft,
                border: `1px solid ${type === "receivable" ? COLORS.forest : COLORS.line}`,
              }}
            >
              <ArrowDownCircle size={15} /> Надад төлнө
            </button>
          </div>

          <div>
            <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
              Дүн (₮)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="0"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                border: `1px solid ${COLORS.line}`,
                background: COLORS.paper,
                color: COLORS.ink,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            />
          </div>

          <div>
            <label className="text-xs block mb-1.5" style={{ color: COLORS.inkSoft }}>
              Хэрхэн давтагддаг вэ?
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => setScheduleType("once")}
                className="rounded-lg py-2 text-xs"
                style={{
                  background: scheduleType === "once" ? COLORS.paperDeep : COLORS.paper,
                  color: scheduleType === "once" ? COLORS.ink : COLORS.inkSoft,
                  border: `1px solid ${scheduleType === "once" ? COLORS.ink : COLORS.line}`,
                }}
              >
                Нэг удаа
              </button>
              <button
                onClick={() => setScheduleType("monthly")}
                className="rounded-lg py-2 text-xs flex items-center justify-center gap-1"
                style={{
                  background: scheduleType === "monthly" ? COLORS.ochreSoft : COLORS.paper,
                  color: scheduleType === "monthly" ? COLORS.ochre : COLORS.inkSoft,
                  border: `1px solid ${scheduleType === "monthly" ? COLORS.ochre : COLORS.line}`,
                }}
              >
                <Repeat size={12} /> Сар бүр
              </button>
              <button
                onClick={() => setScheduleType("custom")}
                className="rounded-lg py-2 text-xs flex items-center justify-center gap-1"
                style={{
                  background: scheduleType === "custom" ? COLORS.forestSoft : COLORS.paper,
                  color: scheduleType === "custom" ? COLORS.forest : COLORS.inkSoft,
                  border: `1px solid ${scheduleType === "custom" ? COLORS.forest : COLORS.line}`,
                }}
              >
                <CalendarDays size={12} /> X удаа
              </button>
            </div>
          </div>

          {scheduleType === "monthly" && (
            <div>
              <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
                Сарын аль өдөр төлөгддөг вэ?
              </label>
              <input
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="1-31"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper, color: COLORS.ink }}
              />
            </div>
          )}

          {scheduleType === "once" && (
            <div>
              <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
                Төлөх огноо
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper, color: COLORS.ink }}
              />
            </div>
          )}

          {scheduleType === "custom" && (
            <div
              className="rounded-lg p-3"
              style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}
            >
              <p className="text-xs mb-2" style={{ color: COLORS.inkSoft }}>
                Жишээ: 4 удаа сар бүр адил дүнгээр төлөх. Эхний өдөр, удаа тоогоо оруулаад автоматаар үүсгэ,
                дараа нь өдрүүдийг өөрчилж/устгаж болно.
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none"
                  style={{ border: `1px solid ${COLORS.line}`, background: COLORS.cream, color: COLORS.ink }}
                />
                <input
                  value={customCount}
                  onChange={(e) => setCustomCount(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="удаа"
                  className="w-16 rounded-lg px-2 py-1.5 text-xs outline-none text-center"
                  style={{ border: `1px solid ${COLORS.line}`, background: COLORS.cream, color: COLORS.ink }}
                />
                <button
                  onClick={handleGenerateCustomDates}
                  className="rounded-lg px-3 text-xs shrink-0"
                  style={{ background: COLORS.ink, color: COLORS.cream }}
                >
                  Үүсгэх
                </button>
              </div>

              {customDates.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {customDates.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className="text-xs w-5 shrink-0"
                        style={{ color: COLORS.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {i + 1}.
                      </span>
                      <input
                        type="date"
                        value={d}
                        onChange={(e) => updateCustomDate(i, e.target.value)}
                        className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none"
                        style={{ border: `1px solid ${COLORS.line}`, background: COLORS.cream, color: COLORS.ink }}
                      />
                      <button
                        onClick={() => removeCustomDate(i)}
                        aria-label="Устгах"
                        style={{ color: COLORS.inkSoft }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={addBlankCustomDate}
                className="text-xs flex items-center gap-1 mt-2"
                style={{ color: COLORS.inkSoft }}
              >
                <Plus size={12} /> Өдөр нэмэх
              </button>
            </div>
          )}

          <div>
            <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
              Тэмдэглэл (заавал биш)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
              style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper, color: COLORS.ink }}
            />
          </div>

          {error && (
            <p className="text-xs" style={{ color: COLORS.wine }}>
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            className="w-full rounded-lg py-2.5 text-sm font-medium mt-1"
            style={{ background: COLORS.ink, color: COLORS.cream }}
          >
            Хадгалах
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------- Firebase setup screen ----------
function FirebaseSetup({ onConfigured }) {
  const [projectId, setProjectId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect() {
    if (!projectId.trim() || !apiKey.trim()) {
      setError("Project ID болон API Key хоёуланг оруулна уу.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cfg = { projectId: projectId.trim(), apiKey: apiKey.trim() };
      await testConnection(cfg);
      setConfig(cfg);
      onConfigured(cfg);
    } catch (e) {
      setError("Холбогдож чадсангүй: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: COLORS.paper, fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Mono:wght@500&display=swap');`}</style>
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
      >
        <h1
          className="text-lg font-semibold mb-1"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}
        >
          Firebase холболт
        </h1>
        <p className="text-xs mb-4" style={{ color: COLORS.inkSoft }}>
          Firebase Console → Project settings → General хэсгээс мэдээллийг хуулна уу.
        </p>

        <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
          Project ID
        </label>
        <input
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="my-project-12345"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-3"
          style={{
            border: `1px solid ${COLORS.line}`,
            background: COLORS.paper,
            color: COLORS.ink,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        />

        <label className="text-xs block mb-1" style={{ color: COLORS.inkSoft }}>
          Web API Key
        </label>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder="AIza..."
          className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-3"
          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper, color: COLORS.ink }}
        />

        <div
          className="rounded-lg p-3 mb-4 text-xs space-y-1"
          style={{ background: COLORS.ochreSoft, color: COLORS.ochre }}
        >
          <p className="font-medium">Firestore-д хийх нэг удаагийн тохиргоо:</p>
          <p>1. Firebase Console → Firestore Database → Rules таб</p>
          <p>2. Доорх дүрмийг оруулаад Publish дар:</p>
          <pre className="mt-1 p-2 rounded text-xs overflow-x-auto" style={{ background: "rgba(0,0,0,0.06)" }}>{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /debt_tracker/{doc=**} {
      allow read, write: if true;
    }
  }
}`}</pre>
        </div>

        {error && (
          <p className="text-xs mb-2" style={{ color: COLORS.wine }}>
            {error}
          </p>
        )}

        <button
          disabled={loading}
          onClick={handleConnect}
          className="w-full rounded-lg py-2.5 text-sm font-medium"
          style={{ background: COLORS.ink, color: COLORS.cream, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Холбогдож байна..." : "Холбох"}
        </button>
      </div>
    </div>
  );
}

// ---------- PIN lock screen ----------
const APP_PIN = "0302";

function PinLock({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  function press(d) {
    if (pin.length >= 4 || shake) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      if (next === APP_PIN) {
        setTimeout(() => onUnlock(), 150);
      } else {
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin("");
        }, 500);
      }
    }
  }

  function backspace() {
    if (shake) return;
    setPin((p) => p.slice(0, -1));
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-6 px-6"
      style={{ background: COLORS.paper, fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        @keyframes shakeKeys {
          10%, 90% { transform: translateX(-4px); }
          20%, 80% { transform: translateX(6px); }
          30%, 50%, 70% { transform: translateX(-8px); }
          40%, 60% { transform: translateX(8px); }
        }
        .pin-shake { animation: shakeKeys 0.5s; }
      `}</style>

      <div className="rounded-full p-4" style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}>
        <Lock size={22} color={COLORS.ink} />
      </div>

      <div className="text-center">
        <h1
          className="text-lg font-semibold mb-1"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}
        >
          Санхүүгийн дэвтэр
        </h1>
        <p className="text-xs" style={{ color: shake ? COLORS.wine : COLORS.inkSoft }}>
          {shake ? "Код буруу байна, дахин оролдоорой" : "Нэвтрэх кодоо оруулна уу"}
        </p>
      </div>

      <div className={`flex gap-3 ${shake ? "pin-shake" : ""}`}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: 14,
              height: 14,
              background: i < pin.length ? (shake ? COLORS.wine : COLORS.ink) : COLORS.line,
              transition: "background 0.15s",
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {keys.map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="rounded-2xl py-4 text-lg font-medium"
            style={{
              background: COLORS.cream,
              border: `1px solid ${COLORS.line}`,
              color: COLORS.ink,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {d}
          </button>
        ))}
        <div />
        <button
          onClick={() => press("0")}
          className="rounded-2xl py-4 text-lg font-medium"
          style={{
            background: COLORS.cream,
            border: `1px solid ${COLORS.line}`,
            color: COLORS.ink,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          0
        </button>
        <button
          onClick={backspace}
          aria-label="Арилгах"
          className="rounded-2xl py-4 flex items-center justify-center"
          style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.inkSoft }}
        >
          <Delete size={18} />
        </button>
      </div>
    </div>
  );
}


// ---------- Settings modal ----------
function SettingsModal({ firebaseConfig, onClose, onDisconnect }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function copyProjectId() {
    try {
      await navigator.clipboard.writeText(firebaseConfig.projectId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {}
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(38,32,24,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}>
            Тохиргоо
          </h2>
          <button onClick={onClose} style={{ color: COLORS.inkSoft }}><X size={20} /></button>
        </div>

        <p className="text-xs mb-1" style={{ color: COLORS.inkSoft }}>Firebase Project ID</p>
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-4"
          style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}>
          <span className="text-xs flex-1 truncate"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: COLORS.ink }}>
            {firebaseConfig.projectId}
          </span>
          <button onClick={copyProjectId} style={{ color: COLORS.inkSoft }}><Copy size={14} /></button>
        </div>
        {copied && <p className="text-xs mb-2" style={{ color: COLORS.forest }}>Хуулагдсан.</p>}

        {!confirming ? (
          <button onClick={() => setConfirming(true)}
            className="w-full rounded-lg py-2.5 text-sm font-medium"
            style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}`, color: COLORS.wine }}>
            Холболтыг тасалж шинээр тохируулах
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: COLORS.wine }}>
              Firebase дахь дата устахгүй, зөвхөн энэ browser-н холболт тасарна. Үргэлжлүүлэх үү?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg py-2 text-sm"
                style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
                Болих
              </button>
              <button onClick={onDisconnect}
                className="flex-1 rounded-lg py-2 text-sm font-medium"
                style={{ background: COLORS.wine, color: COLORS.cream }}>
                Тийм, тасал
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function DebtTracker() {
  const [unlocked, setUnlocked] = useState(false);
  const [firebaseConfig, setFirebaseConfig] = useState(() => getConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalState, setModalState] = useState(null); // { initial, defaultDate } | null

  // load
  useEffect(() => {
    if (!firebaseConfig) return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const res = await storage.get("debt-entries");
        if (!cancelled && res && res.value) {
          setEntries(JSON.parse(res.value));
        }
      } catch (e) {
        // no saved data yet for a fresh project
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseConfig]);

  // save
  useEffect(() => {
    if (!loaded || !firebaseConfig) return;
    (async () => {
      try {
        await storage.set("debt-entries", JSON.stringify(entries));
        setSaveError(false);
      } catch (e) {
        setSaveError(true);
      }
    })();
  }, [entries, loaded, firebaseConfig]);

  const occurrencesThisViewMonth = useMemo(
    () => getOccurrencesForMonth(entries, viewYear, viewMonth),
    [entries, viewYear, viewMonth]
  );

  const occurrencesRealMonth = useMemo(
    () => getOccurrencesForMonth(entries, today.getFullYear(), today.getMonth()),
    [entries]
  );

  const oweTotalThisMonth = occurrencesThisViewMonth
    .filter((o) => o.entry.type === "owe" && !o.isPaid)
    .reduce((s, o) => s + o.entry.amount, 0);

  const receivableTotalThisMonth = occurrencesThisViewMonth
    .filter((o) => o.entry.type === "receivable" && !o.isPaid)
    .reduce((s, o) => s + o.entry.amount, 0);

  const overdueOccurrences = occurrencesRealMonth.filter(
    (o) => o.day < today.getDate() && !o.isPaid
  );
  const overdueTotal = overdueOccurrences
    .filter((o) => o.entry.type === "owe")
    .reduce((s, o) => s + o.entry.amount, 0);

  const numDaysView = daysInMonth(viewYear, viewMonth);
  const firstDayWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Monday=0

  function togglePaid(occ) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== occ.entry.id) return e;
        const schedule = getScheduleType(e);
        if (schedule === "monthly") {
          const set = new Set(e.paidMonths || []);
          if (set.has(occ.occKey)) set.delete(occ.occKey);
          else set.add(occ.occKey);
          return { ...e, paidMonths: Array.from(set) };
        }
        if (schedule === "custom") {
          const set = new Set(e.paidDates || []);
          if (set.has(occ.occKey)) set.delete(occ.occKey);
          else set.add(occ.occKey);
          return { ...e, paidDates: Array.from(set) };
        }
        return { ...e, isPaid: !e.isPaid };
      })
    );
  }

  function saveEntry(entry) {
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === entry.id);
      return exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [...prev, entry];
    });
    setModalState(null);
  }

  function deleteEntry(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function goToMonth(delta) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
    setSelectedDay(null);
  }

  const dayOccurrences = selectedDay
    ? occurrencesThisViewMonth.filter((o) => o.day === selectedDay)
    : [];

  const sortedAllEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const da = nextDueDate(a, today);
      const db = nextDueDate(b, today);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
  }, [entries]);

  if (!unlocked) {
    return <PinLock onUnlock={() => setUnlocked(true)} />;
  }

  if (!firebaseConfig) {
    return <FirebaseSetup onConfigured={(cfg) => setFirebaseConfig(cfg)} />;
  }

  if (!loaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: COLORS.paper, color: COLORS.inkSoft, fontFamily: "'Inter', sans-serif" }}
      >
        Уншиж байна...
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.paper, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible, textarea:focus-visible {
          outline: 2px solid ${COLORS.ochre};
          outline-offset: 1px;
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10 pb-24">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p
              className="text-xs uppercase mb-1"
              style={{ fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em", color: COLORS.inkSoft }}
            >
              Санхүүгийн дэвтэр
            </p>
            <h1
              className="text-2xl md:text-3xl font-semibold"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}
            >
              Энхжингийн зээл, төлбөрийн хуанли
            </h1>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Тохиргоо"
            className="rounded-full p-2 shrink-0 mt-1"
            style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.inkSoft }}
          >
            <Settings size={16} />
          </button>
        </header>

        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-sm font-medium"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}
          >
            {viewYear} оны {viewMonth + 1}-р сарын төлбөрүүд
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToMonth(-1)}
              aria-label="Өмнөх сар"
              className="p-1 rounded-full"
              style={{ color: COLORS.inkSoft }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => goToMonth(1)}
              aria-label="Дараах сар"
              className="p-1 rounded-full"
              style={{ color: COLORS.inkSoft }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <StatCard
            label="Би төлөх"
            amount={fmtAmount(oweTotalThisMonth)}
            tone="wine"
            icon={<ArrowUpCircle size={18} />}
          />
          <StatCard
            label="Надад төлөгдөх"
            amount={fmtAmount(receivableTotalThisMonth)}
            tone="forest"
            icon={<ArrowDownCircle size={18} />}
          />
          <StatCard
            label="Хугацаа хэтэрсэн (өнөөдрөөс)"
            amount={overdueOccurrences.length > 0 ? fmtAmount(overdueTotal) : "Байхгүй"}
            tone="ochre"
            icon={<AlertTriangle size={18} />}
          />
        </div>

        {saveError && (
          <p className="text-xs mb-4" style={{ color: COLORS.wine }}>
            Хадгалахад алдаа гарлаа. Сүлжээгээ шалгаад дахин оролдоорой.
          </p>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Calendar column */}
          <div className="flex-1 min-w-0">
            <div
              className="rounded-2xl p-4"
              style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
            >
              <div className="flex items-center justify-between mb-1">
                <button
                  onClick={() => goToMonth(-1)}
                  aria-label="Өмнөх сар"
                  className="p-1.5 rounded-full"
                  style={{ color: COLORS.inkSoft }}
                >
                  <ChevronLeft size={18} />
                </button>
                <h2
                  className="text-base font-semibold"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.ink }}
                >
                  {viewYear} оны {viewMonth + 1}-р сар
                </h2>
                <button
                  onClick={() => goToMonth(1)}
                  aria-label="Дараах сар"
                  className="p-1.5 rounded-full"
                  style={{ color: COLORS.inkSoft }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              <MonthRing year={viewYear} month={viewMonth} occurrences={occurrencesThisViewMonth} />

              <div className="grid grid-cols-7 gap-1 mt-2 text-center">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="text-xs py-1" style={{ color: COLORS.inkSoft }}>
                    {w}
                  </div>
                ))}
                {Array.from({ length: firstDayWeekday }).map((_, i) => (
                  <div key={"blank" + i} />
                ))}
                {Array.from({ length: numDaysView }).map((_, i) => {
                  const day = i + 1;
                  const dayOcc = occurrencesThisViewMonth.filter((o) => o.day === day);
                  const isToday =
                    viewYear === today.getFullYear() &&
                    viewMonth === today.getMonth() &&
                    day === today.getDate();
                  const isSelected = selectedDay === day;
                  const hasOwe = dayOcc.some((o) => o.entry.type === "owe" && !o.isPaid);
                  const hasReceivable = dayOcc.some((o) => o.entry.type === "receivable" && !o.isPaid);
                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDay(isSelected ? null : day)}
                      className="rounded-lg py-1.5 flex flex-col items-center gap-0.5 relative"
                      style={{
                        background: isSelected ? COLORS.paperDeep : "transparent",
                        border: isToday ? `1.5px solid ${COLORS.ochre}` : "1px solid transparent",
                      }}
                    >
                      <span className="text-xs" style={{ color: COLORS.ink }}>
                        {day}
                      </span>
                      <span className="flex gap-0.5 h-1.5">
                        {hasOwe && (
                          <span
                            className="block rounded-full"
                            style={{ width: 5, height: 5, background: COLORS.wine }}
                          />
                        )}
                        {hasReceivable && (
                          <span
                            className="block rounded-full"
                            style={{ width: 5, height: 5, background: COLORS.forest }}
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDay && (
              <div
                className="rounded-2xl p-4 mt-3"
                style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium" style={{ color: COLORS.ink }}>
                    {viewMonth + 1}-р сарын {selectedDay}-ны төлбөрүүд
                  </h3>
                  <button
                    onClick={() =>
                      setModalState({
                        initial: null,
                        defaultDate: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(
                          selectedDay
                        ).padStart(2, "0")}`,
                      })
                    }
                    className="text-xs flex items-center gap-1 rounded-full px-2.5 py-1"
                    style={{ background: COLORS.paper, color: COLORS.inkSoft, border: `1px solid ${COLORS.line}` }}
                  >
                    <Plus size={13} /> Нэмэх
                  </button>
                </div>
                {dayOccurrences.length === 0 ? (
                  <p className="text-xs" style={{ color: COLORS.inkSoft }}>
                    Энэ өдөр төлбөр бүртгэгдээгүй байна.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dayOccurrences.map((o) => (
                      <li
                        key={o.entry.id}
                        className="flex items-center gap-2 rounded-lg p-2"
                        style={{ background: COLORS.paper }}
                      >
                        <button
                          onClick={() => togglePaid(o)}
                          aria-label="Төлсөн эсэхийг тэмдэглэх"
                          className="rounded-full p-1 shrink-0"
                          style={{
                            background: o.isPaid ? COLORS.forest : "transparent",
                            border: `1.5px solid ${o.isPaid ? COLORS.forest : COLORS.line}`,
                          }}
                        >
                          <Check size={12} color={o.isPaid ? COLORS.cream : "transparent"} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-sm truncate"
                            style={{
                              color: COLORS.ink,
                              textDecoration: o.isPaid ? "line-through" : "none",
                            }}
                          >
                            {o.entry.name}
                          </p>
                          <p
                            className="text-xs"
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              color: o.entry.type === "owe" ? COLORS.wine : COLORS.forest,
                            }}
                          >
                            {fmtAmount(o.entry.amount)} {scheduleLabel(o.entry) && `· ${scheduleLabel(o.entry)}`}
                          </p>
                        </div>
                        <button
                          onClick={() => setModalState({ initial: o.entry, defaultDate: null })}
                          aria-label="Засах"
                          style={{ color: COLORS.inkSoft }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteEntry(o.entry.id)}
                          aria-label="Устгах"
                          style={{ color: COLORS.inkSoft }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* List column */}
          <div className="md:w-80 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium" style={{ color: COLORS.ink }}>
                Бүх бүртгэл
              </h3>
              <button
                onClick={() => setModalState({ initial: null, defaultDate: null })}
                className="text-xs flex items-center gap-1 rounded-full px-2.5 py-1"
                style={{ background: COLORS.ink, color: COLORS.cream }}
              >
                <Plus size={13} /> Нэмэх
              </button>
            </div>

            {sortedAllEntries.length === 0 ? (
              <div
                className="rounded-2xl p-6 flex flex-col items-center text-center gap-2"
                style={{ background: COLORS.cream, border: `1px dashed ${COLORS.line}` }}
              >
                <Inbox size={22} color={COLORS.inkSoft} />
                <p className="text-sm" style={{ color: COLORS.inkSoft }}>
                  Одоогоор бүртгэл байхгүй байна. Эхний зээл, төлбөрөө нэмээрэй.
                </p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[420px] md:max-h-[640px] overflow-y-auto pr-1">
                {sortedAllEntries.map((e) => {
                  const nd = nextDueDate(e, today);
                  const isOverdue = nd && nd < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                  return (
                    <li
                      key={e.id}
                      className="rounded-xl p-3"
                      style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {e.type === "owe" ? (
                            <ArrowUpCircle size={16} color={COLORS.wine} />
                          ) : (
                            <ArrowDownCircle size={16} color={COLORS.forest} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" style={{ color: COLORS.ink }}>
                            {e.name}
                          </p>
                          <p
                            className="text-xs"
                            style={{ fontFamily: "'IBM Plex Mono', monospace", color: COLORS.inkSoft }}
                          >
                            {fmtAmount(e.amount)}
                            {e.isRecurring ? " · сар бүр" : ""}
                            {scheduleLabel(e) && getScheduleType(e) === "custom" ? ` · ${scheduleLabel(e)}` : ""}
                          </p>
                          {nd && (
                            <p
                              className="text-xs mt-0.5"
                              style={{ color: isOverdue ? COLORS.wine : COLORS.inkSoft }}
                            >
                              {isOverdue ? "Хэтэрсэн: " : "Дараагийн: "}
                              {nd.toLocaleDateString("mn-MN")}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 items-center shrink-0">
                          <button onClick={() => setModalState({ initial: e, defaultDate: null })} style={{ color: COLORS.inkSoft }}>
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => deleteEntry(e.id)} style={{ color: COLORS.inkSoft }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={() => setModalState({ initial: null, defaultDate: null })}
        className="fixed bottom-5 right-5 rounded-full p-4 shadow-lg md:hidden"
        style={{ background: COLORS.ink, color: COLORS.cream }}
        aria-label="Шинэ бүртгэл нэмэх"
      >
        <Plus size={20} />
      </button>

      {modalState && (
        <EntryModal
          initial={modalState.initial}
          defaultDate={modalState.defaultDate}
          onSave={saveEntry}
          onClose={() => setModalState(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          firebaseConfig={firebaseConfig}
          onClose={() => setShowSettings(false)}
          onDisconnect={() => {
            clearConfig();
            setFirebaseConfig(null);
            setEntries([]);
            setLoaded(false);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}
