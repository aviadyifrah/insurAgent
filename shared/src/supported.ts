/**
 * The claims the agent has a ready document checklist for (server/knowledge). Shown on the landing
 * page; a server test checks it stays in step with the knowledge files.
 */
export interface SupportedGroup {
  claim_type: "dental" | "*";
  title: string;
  insurers: { key: string; name: string }[];
}

export const SUPPORTED: SupportedGroup[] = [
  {
    claim_type: "dental",
    title: "טיפולי שיניים אצל רופא פרטי",
    insurers: [
      { key: "harel", name: "הראל" },
      { key: "phoenix", name: "הפניקס" },
      { key: "menora", name: "מנורה מבטחים" },
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
