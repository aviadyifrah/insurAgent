/**
 * The claims the agent has a ready document checklist for (server/knowledge). Shown on the landing
 * page; a server test checks it stays in step with the knowledge files.
 */
export interface SupportedGroup {
  claim_type: "dental" | "*";
  title: string;
  /** claim_url: the insurer's official page for filing this kind of claim, when we have checked it. */
  insurers: { key: string; name: string; claim_url?: string }[];
}

export const SUPPORTED: SupportedGroup[] = [
  {
    claim_type: "dental",
    title: "טיפולי שיניים אצל רופא פרטי",
    insurers: [
      { key: "harel", name: "הראל" },
      { key: "phoenix", name: "הפניקס" },
      { key: "menora", name: "מנורה מבטחים", claim_url: "https://www.menoramivt.co.il/claims/claims-dental-lobby/claims-dental-preservative" },
      { key: "migdal", name: "מגדל" },
      { key: "clal", name: "כלל" },
    ],
  },
  {
    claim_type: "*",
    title: "החזר הוצאות רפואיות (ייעוץ, בדיקות, טיפולים)",
    insurers: [
      { key: "migdal", name: "מגדל" },
      { key: "clal", name: "כלל" },
      { key: "menora", name: "מנורה מבטחים" },
      { key: "maccabi_sheli", name: "מכבי שלי" },
      { key: "clalit_mushlam", name: "כללית מושלם" },
    ],
  },
];

/** The insurer's page for filing this claim, if known (dental claims use the dental group, others the general one). */
export function insurerClaimPage(insurerKey: string | null, claimType: string | null): { name: string; url: string } | null {
  const group = SUPPORTED.find((g) => g.claim_type === (claimType === "dental" ? "dental" : "*"));
  const insurer = group?.insurers.find((i) => i.key === insurerKey);
  return insurer?.claim_url ? { name: insurer.name, url: insurer.claim_url } : null;
}
