"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import styles from "./auth.module.css";

export default function LogoutForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("Det gick inte att logga ut. Försök igen.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("Det gick inte att logga ut. Försök igen.");
    } finally {
      setPending(false);
    }
  }

  return <div className={styles.logout}><button type="button" onClick={logout} disabled={pending}>{pending ? "Loggar ut..." : "Logga ut"}</button>{error ? <p className={styles.error} role="alert">{error}</p> : null}</div>;
}
