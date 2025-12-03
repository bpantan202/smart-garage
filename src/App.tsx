import React, { useEffect, useRef, useState } from "react";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getDatabase,
  ref as dbRef,
  onValue,
  off,
  update,
  get,
  query,
  orderByChild,
  limitToLast,
} from "firebase/database";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/**
 * Firebase Realtime Tiles Dashboard (2x2) — Fixed Config + Extra Toggles
 * ---------------------------------------------------------------------
 * Shows 4 values in a 2x2 grid from one path, and also provides TWO new
 * toggle buttons bound to a DIFFERENT path: /devices/user_control
 *   - Reads (and can write) /readings/latest → gasPercent, humidity, led, near20cm
 *   - Reads (and can write) /devices/user_control → alert, led
 *
 * No config inputs on UI. Replace CONFIG/paths below with your project values.
 */

// ==== 1) YOUR FIXED SETTINGS HERE ==========================================
const CONFIG = {
  apiKey: "AIzaSyATx8aS8sNj2603nUzjJd-0GpRfxFuq7BU",
  authDomain: "project-4272145136887405780.firebaseapp.com",
  databaseURL:
    "https://project-4272145136887405780-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "project-4272145136887405780",
  storageBucket: "project-4272145136887405780.firebasestorage.app",
  messagingSenderId: "230459885406",
  appId: "1:230459885406:web:54a2d87a0143ba076cb1cf",
  measurementId: "G-C3DW16CMCX",
};

// Path to latest sensor readings object, e.g.
// { timestamp, gasPercent, humidity, led, near20cm }
const DB_PATH = "/devices/device_metrics"; // <-- change if needed

// Path to user control object with fields { alert, led }
const USER_CONTROL_PATH = "/devices/user_control"; // <-- as requested
const PLATES_PATH = "/devices/plates";
const LOGS_PATH = "/devices/logs";

// Field names inside the readings object
const FIELD_KEYS = {
  temp: "temp",
  humidity: "humidity", // number
  door: "door",
  led: "led", // boolean or "ON"/"OFF"
  parked: "parked",
  ts_pi_ms: "ts_pi_ms",
};
// ==========================================================================

// Helpers
function formatMaybeNumber(v: any) {
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(1);
  const n = Number(v);
  if (Number.isFinite(n)) return n.toFixed(2);
  return "-";
}

function toBool(v: any): boolean | null {
  if (typeof v === "boolean") return v;
  if (v == null) return null;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    if (["TRUE", "ON", "1", "YES"].includes(s)) return true;
    if (["FALSE", "OFF", "0", "NO"].includes(s)) return false;
  }
  return null;
}

function nextValueKeepingStyle(original: any, desiredBool: boolean) {
  if (typeof original === "string") {
    const u = original.toUpperCase();
    if (u === "ON" || u === "OFF") return desiredBool ? "ON" : "OFF";
    if (u === "TRUE" || u === "FALSE") return desiredBool ? "TRUE" : "FALSE";
    if (u === "1" || u === "0") return desiredBool ? "1" : "0";
  }
  if (typeof original === "number") return desiredBool ? 1 : 0;
  return desiredBool; // default boolean
}

export default function FirebaseTilesDashboard() {
  const [app, setApp] = useState<FirebaseApp | null>(null);
  const [connected, setConnected] = useState(false);

  // readings/latest
  const [latest, setLatest] = useState<any>(null);

  // devices/user_control
  const [userCtrl, setUserCtrl] = useState<{ door?: any; led?: any } | null>(
    null
  );

  type LogRow = {
    id: string;
    humidity?: number;
    temp?: number;
    ts_pi_ms?: number;
  };

  const [logs, setLogs] = useState<LogRow[]>([]);

  const fmtTime = (ms?: number) =>
    ms ? new Date(ms).toLocaleTimeString() : "-";

  type PlateRow = { id: string; plate?: string; ts_pi_ms?: number };

  const [plates, setPlates] = useState<PlateRow[]>([]);

  function formatMs(ms?: number) {
    if (!ms || !Number.isFinite(ms)) return "-";
    return new Date(ms).toLocaleString();
  }

  const unsubRef = useRef<() => void>();

  // Initialize and subscribe on mount
  useEffect(() => {
    let appInst: FirebaseApp;
    if (!getApps().length) appInst = initializeApp(CONFIG);
    else appInst = getApps()[0]!;
    setApp(appInst);

    const db = getDatabase(appInst, CONFIG.databaseURL);

    // Subscribe to readings
    const readingsRef = dbRef(db, DB_PATH);
    const unsubReadings = onValue(
      readingsRef,
      (snap) => {
        setLatest(snap.val());
        setConnected(true);
      },
      () => setConnected(false)
    );

    // Subscribe to user control
    const ctrlRef = dbRef(db, USER_CONTROL_PATH);
    const unsubCtrl = onValue(
      ctrlRef,
      (snap) => {
        setUserCtrl(snap.val() || {});
      },
      () => {}
    );

    //add
    const intervalId = window.setInterval(async () => {
      try {
        const [readSnap, ctrlSnap] = await Promise.all([
          get(readingsRef),
          get(ctrlRef),
        ]);

        // set state (acts like “fetch”)
        setLatest(readSnap.val());
        setUserCtrl(ctrlSnap.val() || {});
        setConnected(true);
      } catch (e) {
        setConnected(false);
      }
    }, 1000);

    // Subscribe to plates
    const platesRef = dbRef(db, PLATES_PATH);
    const unsubPlates = onValue(
      platesRef,
      (snap) => {
        const v = snap.val() as Record<string, any> | null;

        const rows: PlateRow[] = v
          ? Object.entries(v).map(([id, obj]) => ({
              id,
              plate: obj?.plate,
              ts_pi_ms:
                typeof obj?.ts_pi_ms === "number"
                  ? obj.ts_pi_ms
                  : Number(obj?.ts_pi_ms),
            }))
          : [];

        rows.sort((a, b) => (b.ts_pi_ms ?? 0) - (a.ts_pi_ms ?? 0)); // newest first
        setPlates(rows.slice(0, 10));
      },
      () => {}
    );

    const logsRef = dbRef(db, LOGS_PATH);
    const logsQ = query(logsRef, orderByChild("ts_pi_ms"), limitToLast(60));

    const unsubLogs = onValue(
      logsQ,
      (snap) => {
        const v = snap.val() as Record<string, any> | null;

        const rows: LogRow[] = v
          ? Object.entries(v).map(([id, obj]) => ({
              id,
              humidity:
                typeof obj?.humidity === "number"
                  ? obj.humidity
                  : Number(obj?.humidity),
              temp:
                typeof obj?.temp === "number" ? obj.temp : Number(obj?.temp),
              ts_pi_ms:
                typeof obj?.ts_pi_ms === "number"
                  ? obj.ts_pi_ms
                  : Number(obj?.ts_pi_ms),
            }))
          : [];

        // make it chronological for the graph (old -> new)
        rows.sort((a, b) => (a.ts_pi_ms ?? 0) - (b.ts_pi_ms ?? 0));
        setLogs(rows);
      },
      () => {}
    );

    unsubRef.current = () => {
      off(readingsRef);
      off(ctrlRef);
      off(platesRef);
      off(logsRef);
      unsubReadings();
      unsubCtrl();
      unsubPlates();
      unsubLogs();
    };
    return () => void unsubRef.current?.();
  }, []);

  // Values from readings
  const tempVal = formatMaybeNumber(latest?.[FIELD_KEYS.temp]);
  const humidityVal = formatMaybeNumber(latest?.[FIELD_KEYS.humidity]);
  const ledValBool = toBool(latest?.[FIELD_KEYS.led]);
  const doorValBool = toBool(latest?.[FIELD_KEYS.door]);
  const parkedValBool = toBool(latest?.[FIELD_KEYS.parked]);
  const ts: number = latest?.[FIELD_KEYS.ts_pi_ms];
  const ts_date: Date = new Date(ts);

  // // Writes
  // const writeToggleReadings = async (key: string, current: boolean | null) => {
  //   if (!app) return;
  //   const db = getDatabase(app, CONFIG.databaseURL);
  //   const baseRef = dbRef(db, DB_PATH);
  //   const nextBool = !(current ?? false);
  //   const orig = latest?.[key];
  //   const value = nextValueKeepingStyle(orig, nextBool);
  //   try {
  //     await update(baseRef, { [key]: value, timestamp: Date.now() });
  //   } catch (e) {
  //     console.error(e);
  //     alert("Failed to write. Check Realtime DB rules for write access.");
  //   }
  // };

  const writeToggleUserCtrl = async (
    key: "door" | "led",
    current: boolean | null
  ) => {
    if (!app) return;
    const db = getDatabase(app, CONFIG.databaseURL);
    const ctrlRef = dbRef(db, USER_CONTROL_PATH);
    const nextBool = !Boolean(current);
    const orig = userCtrl?.[key];
    const value = nextValueKeepingStyle(orig, nextBool);
    try {
      await update(ctrlRef, { [key]: value, _ts: Date.now() });
    } catch (e) {
      console.error(e);
      alert("Failed to write to /devices/user_control. Check DB rules.");
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.maxWidth}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Data</h1>

            <div style={{ fontWeight: "bold", fontSize: "16px" }}>
              Last Update: {ts_date.toString()}
            </div>
          </div>
          <div
            style={{
              ...styles.badge,
              ...(connected ? styles.badgeConnected : styles.badgeDisconnected),
            }}
          >
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>

        {/* 2x2 Tiles from readings */}
        <div style={styles.grid}>
          <Tile title="🌡️ Temperature" value={tempVal + "°C"} />
          <Tile title="🫧 Humidity" value={humidityVal + "%"} />

          <Tile
            title="💡 Garage light"
            subtitle=""
            value={ledValBool === null ? "-" : ledValBool ? "ON" : "OFF (AUTO)"}
            actionLabel={ledValBool ? "Turn OFF" : "Turn ON"}
            onAction={() => writeToggleUserCtrl("led", ledValBool)}
          />
          <Tile
            title="🚪 Garage Door"
            value={doorValBool === null ? "-" : doorValBool ? "Close" : "Open"}
            actionLabel={doorValBool ? "Open Door" : "Close Door"}
            onAction={() => writeToggleUserCtrl("door", doorValBool)}
          />
        </div>

        {/* New toggles from /devices/user_control */}
        <div style={styles.grid}>
          <Tile
            title="🚘 Garage Status"
            value={
              parkedValBool === null
                ? "-"
                : parkedValBool
                ? "🔴 Not Available"
                : "🟢 Available"
            }
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Plate
                  </th>

                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {plates.map((r) => (
                  <tr key={r.id}>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {r.plate ?? "-"}
                    </td>

                    <td
                      style={{
                        padding: "8px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {formatMs(r.ts_pi_ms)}
                    </td>
                  </tr>
                ))}
                {plates.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "10px", opacity: 0.7 }}>
                      No data in {PLATES_PATH}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Tile>
        </div>

        <div style={styles.grid}>
          <Tile title={""} value={""}>
            {/* Temp chart */}
            <div
              style={{ background: "#fff", borderRadius: 12, padding: "1rem" }}
            >
              <div style={{ margin: "0 0 0.5rem 0" }}>Temperature(°C)</div>

              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={logs}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="ts_pi_ms"
                      tickFormatter={(v) => fmtTime(v)}
                    />
                    <YAxis domain={['auto', 'auto']} />

                    <Tooltip
                      labelFormatter={(v) =>
                        `Time: ${new Date(Number(v)).toLocaleString()}`
                      }
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="temp"
                      dot={true}
                      name="Temp"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Humidity chart */}
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div style={{ margin: "0 0 0.5rem 0" }}>Humidity(%)</div>

              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={logs}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="ts_pi_ms"
                      tickFormatter={(v) => fmtTime(v)}
                    />
                    <YAxis domain={['dataMin - 2', 'auto']} />

                    <Tooltip
                      labelFormatter={(v) =>
                        `Time: ${new Date(Number(v)).toLocaleString()}`
                      }
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="humidity"
                      dot={true}
                      name="Humidity"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Tile>
        </div>
      </div>
    </div>
  );
}

function Tile({
  title,
  subtitle,
  value,
  actionLabel,
  children,
  onAction,
}: {
  title: string;
  subtitle?: string;
  value: string;
  actionLabel?: string;
  children?: React.ReactNode; // ✅ add
  onAction?: () => void;
}) {
  return (
    <div style={styles.tile}>
      <div style={styles.tileTitle}>{title}</div>
      {subtitle ? <div style={styles.tileSubtitle}>{subtitle}</div> : null}
      <div style={styles.tileValue}>{value}</div>
      <div>
        {children ? (
          <div style={{ marginTop: "0.75rem" }}>{children}</div>
        ) : null}
      </div>

      {onAction ? (
        <div style={styles.tileAction}>
          <button style={styles.button} onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// CSS Styles
const styles = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  maxWidth: {
    maxWidth: "80rem",
    margin: "0 auto",
    padding: "1.5rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "1rem",
  },
  title: {
    fontSize: "1.875rem",
    fontWeight: "bold",
    margin: 0,
  },
  subtitle: {
    fontSize: "0.75rem",
    color: "#475569",
    marginTop: "0.25rem",
    margin: 0,
  },
  badge: {
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    fontWeight: "500",
  },
  badgeConnected: {
    backgroundColor: "#dcfce7",
    color: "#15803d",
  },
  badgeDisconnected: {
    backgroundColor: "#e2e8f0",
    color: "#374151",
  },
  grid: {
    marginTop: "2rem",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "1rem",
  },
  tile: {
    backgroundColor: "white",
    borderRadius: "1rem",
    boxShadow:
      "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
    padding: "1.5rem",
    border: "1px solid #e2e8f0",
  },
  tileTitle: {
    fontSize: "1.2rem",
    fontWeight: "600",
  },
  tileSubtitle: {
    fontSize: "0.75rem",
    color: "#64748b",
  },
  tileValue: {
    marginTop: "1.6rem",
    fontSize: "2.5rem",
    fontWeight: "300",
    letterSpacing: "-0.025em",
  },
  tileAction: {
    marginTop: "1rem",
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.75rem",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    fontSize: "0.875rem",
    fontWeight: "500",
    backgroundColor: "#4f46e5",
    color: "white",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    transition: "background-color 0.15s ease-in-out",
    fontFamily: "inherit",
  },
};

// Add hover effect for button
const buttonHoverStyle = {
  backgroundColor: "#4338ca",
};

// Update button component to handle hover
function Button({
  children,
  onClick,
  style = {},
}: {
  children: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      style={{
        ...styles.button,
        ...(isHovered ? buttonHoverStyle : {}),
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </button>
  );
}
