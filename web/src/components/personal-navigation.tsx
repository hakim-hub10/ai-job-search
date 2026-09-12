import Link from "next/link";
import styles from "../app/page.module.css";

type Destination = "overview" | "jobs" | "profile" | "applications" | "analytics" | "reports";

/** All candidate-specific destinations come from the server-authorized owner. */
export default function PersonalNavigation({ candidateId, active }: { candidateId: string; active: Destination }) {
  const id = encodeURIComponent(candidateId);
  const links: Array<[Destination, string, string]> = [
    ["overview", "/", "Översikt"],
    ["jobs", "/jobs", "Hitta jobb"],
    ["profile", `/candidates/${id}`, "Min profil"],
    ["applications", "/applications", "Mina ansökningar"],
    ["analytics", `/analytics/${id}`, "Analys"],
    ["reports", `/reports/${id}`, "Rapporter"],
  ];
  return <nav className={styles.nav} aria-label="Personlig navigation">{links.map(([key, href, label]) => <Link key={key} href={href} className={active === key ? styles.active : undefined} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>;
}
