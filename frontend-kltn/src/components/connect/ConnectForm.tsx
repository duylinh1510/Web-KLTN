import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useConnectNeo4j } from "../../hooks/useConnectNeo4j";
import {
  NEO4J_URI_PRESETS,
  DEFAULT_NEO4J_USER,
  validateNeo4jUri,
  validateNeo4jUser,
  validateNeo4jPassword,
} from "../../constants/presets";

type FieldName = "uri" | "user" | "password";
type FormErrors = Partial<Record<FieldName, string>>;

export function ConnectForm() {
  const [uri, setUri] = useState<string>(NEO4J_URI_PRESETS[0]?.uri ?? "");
  const [user, setUser] = useState<string>(DEFAULT_NEO4J_USER);
  const [password, setPassword] = useState<string>("");
  const [dbId, setDbId] = useState<string>("");
  const [errors, setErrors] = useState<FormErrors>({});

  const mutation = useConnectNeo4j();

  // Reset password sau khi connect thành công (đúng ràng buộc sống còn #1)
  useEffect(() => {
    if (mutation.isSuccess) setPassword("");
  }, [mutation.isSuccess]);

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
    mutation.mutate({
      uri: uri.trim(),
      user: user.trim(),
      password,
      dbId: dbId.trim() || undefined,
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

      <Field label="Database ID (cache schema)" htmlFor="neo4j-dbid">
        <input
          id="neo4j-dbid"
          type="text"
          value={dbId}
          onChange={(e) => setDbId(e.target.value)}
          placeholder="VD: fraud_db_v1 (tuỳ chọn)"
          autoComplete="off"
          disabled={isPending}
          className={inputCls(false)}
        />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Đang kết nối..." : "Connect"}
      </button>
    </form>
  );
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
