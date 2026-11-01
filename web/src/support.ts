// Contact for anything beyond what the app does: more claims, pricing, questions, problems.
export const SUPPORT_PHONE_DISPLAY = "055-660-2851";
const SUPPORT_PHONE_INTL = "972556602851";

export function whatsappLink(message = "שלום, אני משתמש/ת ב-InsurAgent ויש לי שאלה:") {
  return `https://wa.me/${SUPPORT_PHONE_INTL}?text=${encodeURIComponent(message)}`;
}
