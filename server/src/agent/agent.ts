import Anthropic from "@anthropic-ai/sdk";
import { all, get, run, type Claim, type DocumentRow, type User } from "../db";
import { addChat, claimSnapshot, touchClaim } from "../claims";
import { SYSTEM_PROMPT } from "./prompt";
import { executeTool, toolDefinitions } from "./tools";

const client = new Anthropic();
const MODEL = "claude-opus-5-5";
const MAX_STEPS = 20;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

// One agent run per claim at a time; later events queue behind the current run.
const queues = new Map<number, Promise<void>>();

export function runAgent(claimId: number, input: ContentBlockParam[]): Promise<void> {
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
      doc.analysis ?? "(automatic analysis unavailable; ask the user what this document is)"
    }\n</uploaded_document>`,
  }));
}

function loadHistory(claimId: number): MessageParam[] {
  return all<{ role: "user" | "assistant"; content: string }>(
    "SELECT role, content FROM agent_turns WHERE claim_id = ? ORDER BY id",
    claimId,
  ).map((t) => ({ role: t.role, content: JSON.parse(t.content) }));
}

function saveTurn(claimId: number, message: MessageParam) {
  run("INSERT INTO agent_turns (claim_id, role, content) VALUES (?, ?, ?)", claimId, message.role, JSON.stringify(message.content));
}

async function runAgentNow(claimId: number, input: ContentBlockParam[]) {
  const claim = get<Claim>("SELECT * FROM claims WHERE id = ?", claimId)!;
  const user = get<User>("SELECT * FROM users WHERE id = ?", claim.user_id)!;

  // History is append-only and replayed verbatim (thinking blocks included).
  const messages = loadHistory(claimId);
  const userTurn: MessageParam = { role: "user", content: [...input, { type: "text", text: claimSnapshot(claim) }] };
  messages.push(userTurn);
  saveTurn(claimId, userTurn);

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
      addChat(claimId, "assistant", "משהו השתבש אצלי בצד. נסה לשלוח שוב בעוד רגע.");
      return;
    }

    const assistantTurn: MessageParam = { role: "assistant", content: response.content };
    messages.push(assistantTurn);
    saveTurn(claimId, assistantTurn);

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) addChat(claimId, "assistant", text);

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "refusal") {
      addChat(claimId, "assistant", "לא אוכל לעזור בבקשה הזו.");
      break;
    }
    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const { content, isError } = await executeTool(use.name, use.input, { claim, user });
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError });
    }
    const resultsTurn: MessageParam = { role: "user", content: results };
    messages.push(resultsTurn);
    saveTurn(claimId, resultsTurn);
  }
  touchClaim(claimId);
}
