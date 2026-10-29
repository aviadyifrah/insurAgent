import Anthropic from "@anthropic-ai/sdk";
import { addChat, claimSnapshot } from "../claims";
import { child, getClaim, getUser, list, now, updateClaim, type DocumentRow } from "../store";
import { SYSTEM_PROMPT } from "./prompt";
import { executeTool, toolDefinitions } from "./tools";

const client = new Anthropic();
const MODEL = "claude-opus-5-5";
const MAX_STEPS = 20;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

// One agent run per claim at a time; later events queue behind the current run. This lock lives in
// memory, so the deployed function runs with maxInstances: 1 (see functions.ts).
const queues = new Map<string, Promise<void>>();

export function runAgent(claimId: string, input: ContentBlockParam[]): Promise<void> {
  const prev = queues.get(claimId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => runAgentNow(claimId, input));
  queues.set(claimId, next);
  return next.finally(() => {
    if (queues.get(claimId) === next) queues.delete(claimId);
  });
}

/**
 * What the agent learns about uploaded documents: the analysis extracted at upload time, not the
 * file itself, so the conversation never carries document contents.
 */
export function documentBlocks(docs: DocumentRow[]): ContentBlockParam[] {
  return docs.map((doc) => ({
    type: "text",
    text: `<uploaded_document document_id="${doc.id}" filename="${doc.filename}">\n${
      doc.analysis ? JSON.stringify(doc.analysis) : "(automatic analysis unavailable; ask the user what this document is)"
    }\n</uploaded_document>`,
  }));
}

interface StoredTurn {
  id: string;
  role: "user" | "assistant";
  content: string; // JSON: content blocks can nest arrays, which Firestore can't store natively
}

async function loadHistory(claimId: string): Promise<MessageParam[]> {
  const turns = await list<StoredTurn>(child(claimId, "turns").orderBy("seq"));
  return turns.map((t) => ({ role: t.role, content: JSON.parse(t.content) }));
}

async function saveTurn(claimId: string, seq: number, message: MessageParam) {
  await child(claimId, "turns")
    .doc(String(seq).padStart(6, "0"))
    .create({ seq, role: message.role, content: JSON.stringify(message.content), created_at: now() });
}

async function runAgentNow(claimId: string, input: ContentBlockParam[]) {
  const claim = (await getClaim(claimId))!;
  const user = (await getUser(claim.user_id))!;

  // History is append-only and replayed verbatim (thinking blocks included).
  const messages = await loadHistory(claimId);
  const push = async (message: MessageParam) => {
    messages.push(message);
    await saveTurn(claimId, messages.length - 1, message);
  };
  await push({ role: "user", content: [...input, { type: "text", text: await claimSnapshot(claim) }] });

  for (let step = 0; step < MAX_STEPS; step++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: toolDefinitions,
        messages,
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        // On a safety decline, the API re-runs the request on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      console.error("agent API error", err);
      await addChat(claim, "assistant", "משהו השתבש אצלי בצד. נסה לשלוח שוב בעוד רגע.");
      return;
    }

    await push({ role: "assistant", content: response.content });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) await addChat(claim, "assistant", text);

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "refusal") {
      await addChat(claim, "assistant", "לא אוכל לעזור בבקשה הזו.");
      break;
    }
    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const { content, isError } = await executeTool(use.name, use.input, { claim, user });
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError });
    }
    await push({ role: "user", content: results });
  }
  await updateClaim(claimId, {});
}
