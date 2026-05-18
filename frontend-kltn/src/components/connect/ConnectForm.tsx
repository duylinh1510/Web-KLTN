import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { isAppApiError } from "../../api/client";
import { useConnectNeo4j } from "../../hooks/useConnectNeo4j";
import { useDatabaseList, useSwitchDatabase } from "../../hooks/useDatabaseSelector";
import { useConnectionStore } from "../../store/connectionStore";
import {
  NEO4J_URI_PRESETS,
  DEFAULT_NEO4J_USER,
  validateNeo4jUri,
  validateNeo4jUser,
  validateNeo4jPassword,
} from "../../constants/presets";

type FieldName = "uri" | "user" | "password" | "database";
type FormErrors = Partial<Record<FieldName, string>>;

export function ConnectForm() {
  const [uri, setUri] = useState<string>(NEO4J_URI_PRESETS[0]?.uri ?? "");
  const [user, setUser] = useState<string>(DEFAULT_NEO4J_USER);
  const [password, setPassword] = useState<string>("");
  const [database, setDatabase] = useState<string>("neo4j");
  const [errors, setErrors] = useState<FormErrors>({});
  const [connectErrorMessages, setConnectErrorMessages] = useState<string[]>([]);

  const mutation = useConnectNeo4j();
  const isConnected = useConnectionStore((s) => s.isConnected);
  const currentDatabase = useConnectionStore((s) => s.database);

  // Database list + switch (chỉ active sau khi connected)
  const { data: databases, isLoading: dbLoading } = useDatabaseList();
  const switchMutation = useSwitchDatabase();

  // Reset password sau khi connect thành công
  useEffect(() => {
    if (mutation.isSuccess) setPassword("");
  }, [mutation.isSuccess]);

  useEffect(() => {
    if (currentDatabase) setDatabase(currentDatabase);
  }, [currentDatabase]);

  useEffect(() => {
    if (mutation.error) {
      setConnectErrorMessages(getErrorMessages(mutation.error));
    }
  }, [mutation.error]);

  function clearFieldError(field: FieldName) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateAll(): FormErrors {
    const e: FormErrors = {};
    const uriErr = validateNeo4jUri(uri);
    const userErr = validateNeo4jUser(user);
    const pwErr = validateNeo4jPassword(password);
    if (!database.trim()) e.database = "Vui lòng nhập Database Name.";
    if (uriErr) e.uri = uriErr;
    if (userErr) e.user = userErr;
    if (pwErr) e.password = pwErr;
    return e;
  }

  function handleSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const next = validateAll();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setConnectErrorMessages([]);
    mutation.mutate({
      uri: uri.trim(),
      user: user.trim(),
      password,
      database: database.trim(),
    });
  }

  const isPending = mutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <Field label="URI" htmlFor="neo4j-uri" error={errors.uri}>
        <input
          id="neo4j-uri"
          type="text"
          value={uri}
          onChange={(e) => {
            setUri(e.target.value);
            clearFieldError("uri");
          }}
          placeholder="bolt://localhost:7687"
          autoComplete="off"
          disabled={isPending}
          className={inputCls(!!errors.uri)}
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {NEO4J_URI_PRESETS.map((p) => (
            <button
              key={p.uri}
              type="button"
              onClick={() => {
                setUri(p.uri);
                clearFieldError("uri");
              }}
              disabled={isPending}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="User" htmlFor="neo4j-user" error={errors.user}>
        <input
          id="neo4j-user"
          type="text"
          value={user}
          onChange={(e) => {
            setUser(e.target.value);
            clearFieldError("user");
          }}
          autoComplete="username"
          disabled={isPending}
          className={inputCls(!!errors.user)}
        />
      </Field>

      <Field label="Password" htmlFor="neo4j-password" error={errors.password}>
        <input
          id="neo4j-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearFieldError("password");
          }}
          autoComplete="current-password"
          disabled={isPending}
          className={inputCls(!!errors.password)}
        />
      </Field>

      <Field label="Database Name" htmlFor="neo4j-database" error={errors.database}>
        <input
          id="neo4j-database"
          type="text"
          value={database}
          onChange={(e) => {
            setDatabase(e.target.value);
            clearFieldError("database");
          }}
          placeholder="VD: neo4j"
          autoComplete="off"
          disabled={isPending}
          className={inputCls(!!errors.database)}
        />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Đang kết nối..." : "Connect"}
      </button>

      {/*
       * ── Database Selector ──
       * Hiển thị sau khi connected. Cho phép switch database
       * mà không cần disconnect (nhưng cần reconnect nếu muốn đổi URI/user).
       * Khi switch, BE cập nhật database trong session, FE invalidate cache.
       */}
      {isConnected && (
        <DatabaseSelector
          databases={databases ?? []}
          currentDatabase={currentDatabase}
          isLoading={dbLoading}
          isSwitching={switchMutation.isPending}
          onSwitch={(db) => switchMutation.mutate(db)}
        />
      )}

      {connectErrorMessages.length > 0 && (
        <ConnectErrorModal
          messages={connectErrorMessages}
          onClose={() => setConnectErrorMessages([])}
        />
      )}
    </form>
  );
}

// ============================================================
// DatabaseSelector — dropdown chọn database
// ============================================================

function DatabaseSelector({
  databases,
  currentDatabase,
  isLoading,
  isSwitching,
  onSwitch,
}: {
  databases: string[];
  currentDatabase: string | null;
  isLoading: boolean;
  isSwitching: boolean;
  onSwitch: (db: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="text-[11px] text-slate-500 animate-pulse">
        Đang tải danh sách database...
      </div>
    );
  }

  if (databases.length === 0) return null;

  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2.5 space-y-1.5">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Database đang dùng
      </label>
      <select
        id="neo4j-database-select"
        value={currentDatabase ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          if (val && val !== currentDatabase) onSwitch(val);
        }}
        disabled={isSwitching}
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none transition focus:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!currentDatabase && (
          <option value="">-- Chọn database --</option>
        )}
        {databases.map((db) => (
          <option key={db} value={db}>
            {db}
          </option>
        ))}
      </select>
      {isSwitching && (
        <div className="text-[10px] text-emerald-400 animate-pulse">
          Đang chuyển database...
        </div>
      )}
    </div>
  );
}

function ConnectErrorModal({
  messages,
  onClose,
}: {
  messages: string[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="neo4j-connect-error-title"
    >
      <div className="w-full max-w-md rounded-lg border border-red-900/70 bg-slate-950 p-4 shadow-2xl shadow-red-950/30">
        <div
          id="neo4j-connect-error-title"
          className="text-sm font-semibold text-red-200"
        >
          Không thể kết nối database
        </div>
        <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">
          {messages.map((message, index) => (
            <div key={index}>{message}</div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs font-semibold text-red-100 transition hover:border-red-700 hover:bg-red-900/70"
        >
          Đóng
        </button>
      </div>
    </div>
  );
}

function getErrorMessages(error: unknown): string[] {
  if (isAppApiError(error)) return error.messages;
  if (error instanceof Error) return [error.message];
  return ["Kết nối Neo4j thất bại"];
}

// ============================================================
// Subcomponents / helpers
// ============================================================

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400"
      >
        {label}
      </label>
      {children}
      {error && <div className="mt-1 text-xs text-red-400">{error}</div>}
    </div>
  );
}

function inputCls(hasError: boolean): string {
  const base =
    "w-full rounded-md border bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-60";
  return hasError
    ? `${base} border-red-600/60 focus:border-red-500`
    : `${base} border-slate-700`;
}
