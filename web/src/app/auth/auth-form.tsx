"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import styles from "./auth.module.css";

type AuthMode = "login" | "register";

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (isRegister && password !== confirmation) {
      setError("Lösenorden matchar inte.");
      return;
    }
    setPending(true);
    try {
      const result = isRegister
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(isRegister ? "Kontot kunde inte skapas. Kontrollera uppgifterna eller prova att logga in." : "E-post eller lösenord är felaktigt.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(isRegister ? "Kontot kunde inte skapas. Kontrollera uppgifterna eller prova att logga in." : "E-post eller lösenord är felaktigt.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.shell}>
      <main className={styles.card}>
        <p className={styles.eyebrow}>AI-jobbcoach</p>
        <h1>{isRegister ? "Skapa konto" : "Logga in"}</h1>
        <p className={styles.intro}>{isRegister ? "Skapa ett konto för att komma igång med din jobbsökning." : "Logga in för att fortsätta till din arbetsyta."}</p>
        <form className={styles.form} onSubmit={submit} noValidate>
          {isRegister ? <><label htmlFor="name">Namn</label><input id="name" name="name" type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></> : null}
          <label htmlFor="email">E-post</label>
          <input id="email" name="email" type="email" autoComplete="email username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Lösenord</label>
          <input id="password" name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {isRegister ? <><label htmlFor="confirmation">Bekräfta lösenord</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></> : null}
          <button type="submit" disabled={pending}>{pending ? "Väntar..." : isRegister ? "Skapa konto" : "Logga in"}</button>
        </form>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <p className={styles.footer}>{isRegister ? <>Har du redan ett konto? <Link href="/login">Logga in</Link></> : <>Har du inget konto? <Link href="/register">Skapa konto</Link></>}</p>
      </main>
    </div>
  );
}
