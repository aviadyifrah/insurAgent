import { whatsappLink } from "../support";

/** Always-visible positioning line: a trial of a helper tool, not an agent or representative. */
export function Disclaimer() {
  return (
    <p className="disclaimer">
      גרסת ניסיון. כלי עזר להכנת מסמכים בלבד. אינו סוכן ביטוח, אינו מייעץ ואינו מגיש בשמך. <a href="#/legal">תנאים ופרטיות</a>
      {" · "}
      <a href={whatsappLink()} target="_blank" rel="noreferrer">
        שאלות? וואטסאפ
      </a>
    </p>
  );
}
