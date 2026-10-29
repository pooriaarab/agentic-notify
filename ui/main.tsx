// The demo page the Worker serves at /ui/. It shows the bell with a sign-in and a small send form.
import { useCallback, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { Button, Input, Select, ThemeProvider, TooltipProvider } from "agentic-design/react";
import { ApiError, createClient } from "../src/sdk.js";
import { NotificationBell } from "./Bell.js";
import { describeError } from "./useNotifications.js";

const KEY = "notify-demo-token";
const baseUrl = location.origin;

function SignIn({ onToken }: { onToken(token: string): void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createClient({ baseUrl, token: token.trim() }).unreadCount();
      onToken(token.trim());
    } catch (err) {
      setError(token.trim() ? describeError(err) : "Enter an API token.");
    }
  };
  return (
    <form className="demo-card" onSubmit={submit}>
      <h1>Notifications</h1>
      <p className="demo-muted">Sign in with an API key that holds the notify:read and notify:write scopes.</p>
      <Input label="API token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} error={error} />
      <Button type="submit">Sign in</Button>
    </form>
  );
}

function Send({ token }: { token: string }) {
  const [kind, setKind] = useState<"human" | "agent">("human");
  const [id, setId] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setResult(undefined);
    try {
      await createClient({ baseUrl, token }).send({ recipient: { kind, id: id.trim() }, type: "demo.message", resource: { kind: "demo", id: "1" }, body });
      setResult({ ok: true, text: "Sent." });
      setBody("");
    } catch (err) {
      const refused = err instanceof ApiError && err.status === 403;
      setResult({ ok: false, text: refused ? "This token cannot send. It needs the notify-send:write scope." : describeError(err) });
    }
  };
  return (
    <form className="demo-card" onSubmit={submit}>
      <h2>Send a notification</h2>
      <Select label="Recipient kind" value={kind} onChange={(e) => setKind(e.target.value as "human" | "agent")}>
        <option value="human">Person</option>
        <option value="agent">Agent</option>
      </Select>
      <Input label="Recipient id" value={id} onChange={(e) => setId(e.target.value)} required />
      <Input label="Message" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} required />
      <Button type="submit">Send</Button>
      <p role="status" className="demo-muted">
        {result?.ok ? result.text : ""}
      </p>
      {result && !result.ok && (
        <p role="alert" className="demo-error">
          {result.text}
        </p>
      )}
    </form>
  );
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY) ?? "");
  const getToken = useCallback(() => token, [token]);
  if (!token) {
    return (
      <main className="demo-main">
        <SignIn onToken={(t) => (sessionStorage.setItem(KEY, t), setToken(t))} />
      </main>
    );
  }
  return (
    <>
      <header className="demo-bar">
        <span className="demo-brand">Notifications demo</span>
        <NotificationBell baseUrl={baseUrl} getToken={getToken} pollMs={3000} />
        <Button variant="ghost" size="sm" onClick={() => (sessionStorage.removeItem(KEY), setToken(""))}>
          Sign out
        </Button>
      </header>
      <main className="demo-main">
        <Send token={token} />
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </ThemeProvider>,
);
