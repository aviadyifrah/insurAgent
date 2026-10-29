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
// memory, so the deployed agent function runs with maxInstances: 1 (see functions.ts).
const queues = new Map<string, Promise<void>>();

export function runAgent(claimId: string, input: ContentBlockParam[]): Promise<void> {
  const prev = queues.get(claimId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => runAgentNow(claimId, input));
  queues.set(claimId, next);
  return next.finally(async () => {
    if (queues.get(claimId) !== next) return;
    queues.delete(claimId);
    await updateClaim(claimId, { agent_status: "idle" });
  });
}

/**
 * How an API request hands work to the agent. It must return quickly: an agent turn can take
 * minutes, longer than Firebase Hosting keeps a request open (60s). Screens follow the progress
 * live through Firestore.
 */
export type Dispatch = (claimId: string, input: ContentBlockParam[]) => Promise<void>;

const markWorking = (claimId: string) => updateClaim(claimId, { agent_status: "working", agent_started_at: now() });

/** Local development: the Node server keeps running, so the agent can run after the response. */
export const dispatchInBackground: Dispatch = async (claimId, input) => {
  await markWorking(claimId);
  runAgent(claimId, input).catch((err) => console.error("agent run failed", err));
};

/** Cloud Functions: CPU stops after the response, so a Firestore-triggered function does the work. */
export const dispatchToQueue: Dispatch = async (claimId, input) => {
  await markWorking(claimId);
  await child(claimId, "inbox").add({ content: JSON.stringify(input), created_at: now() });
};

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

  // A run cut off between a tool call and its result (timeout, crash) would make every later
  // request fail. Close it out by appending results for the dangling calls.
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && Array.isArray(last.content)) {
    const dangling = last.content.filter((b) => b.type === "tool_use");
    if (dangling.length > 0) {
      await push({
        role: "user",
        content: dangling.map((b) => ({
          type: "tool_result" as const,
          tool_use_id: (b as Anthropic.Beta.BetaToolUseBlock).id,
          content: "interrupted: this call did not run; check claim_state before retrying",
          is_error: true,
        })),
      });
    }
  }

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
