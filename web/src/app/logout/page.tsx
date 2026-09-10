import Link from "next/link";

import LogoutForm from "../auth/logout-form";
import styles from "../auth/auth.module.css";

export default function LogoutPage() {
  return <main className={styles.shell}><section className={styles.card}><p className={styles.eyebrow}>AI-jobbcoach</p><h1>Logga ut</h1><p className={styles.intro}>Avsluta din aktuella session på den här enheten.</p><LogoutForm /><p className={styles.footer}><Link href="/">Tillbaka</Link></p></section></main>;
}
