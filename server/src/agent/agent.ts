import Anthropic from "@anthropic-ai/sdk";
import { addChat, claimSnapshot } from "../claims";
import crypto from "node:crypto";
import { firestore } from "../firebase";
import { recordUsage } from "../costs";
import { child, claims, getClaim, getUser, list, now, updateClaim, type DocumentRow } from "../store";
import { SYSTEM_PROMPT } from "./prompt";
import { executeTool, toolDefinitions } from "./tools";

const client = new Anthropic();
const MODEL = "claude-opus-5-5";
const MAX_STEPS = 20;

// Official sites of Israeli health insurers, health funds and the government, the only places the
// agent may look up a claim's requirements when the knowledge base has no list for them.
export const OFFICIAL_SITES = [
  "harel-group.co.il", "fnx.co.il", "menoramivt.co.il", "menora.co.il", "migdal.co.il", "clalbit.co.il",
  "clal.co.il", "clal-health.co.il", "ayalon-ins.co.il", "hachshara.co.il", "libra.co.il", "wesure.co.il",
  "aig.co.il", "passportcard.co.il", "maccabi4u.co.il", "clalit.co.il", "meuhedet.co.il", "leumit.co.il", "gov.il",
];

const WEB_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 4, allowed_domains: OFFICIAL_SITES },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, allowed_domains: OFFICIAL_SITES, max_content_tokens: 20000 },
];

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

// Short, and renewed after every model step, so a run that dies frees the claim within minutes.
const LEASE_MS = 3 * 60 * 1000;

/**
 * How an API request hands work to the agent. It must return quickly: an agent turn can take
 * minutes, longer than Firebase Hosting keeps a request open (60s). The input is queued in the
 * claim's inbox and screens follow the progress live through Firestore.
 */
export type Dispatch = (claimId: string, input: ContentBlockParam[]) => Promise<void>;

async function enqueue(claimId: string, input: ContentBlockParam[]) {
  await updateClaim(claimId, { agent_status: "working", agent_started_at: now() });
  await child(claimId, "inbox").add({ content: JSON.stringify(input), created_at: now() });
}

/** Local development: the Node server keeps running, so it can drain the inbox after responding. */
export const dispatchInBackground: Dispatch = async (claimId, input) => {
  await enqueue(claimId, input);
  drainInbox(claimId).catch((err) => console.error("agent run failed", err));
};

/** Cloud Functions: CPU stops after the response, so a Firestore-triggered function drains the inbox. */
export const dispatchToQueue: Dispatch = enqueue;

/** Takes the claim's lease unless another live run holds it. */
async function acquire(claimId: string, owner: string): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(claims.doc(claimId));
    if (!snap.exists) return false;
    const until = snap.get("agent_lock_until") as string | null | undefined;
    if (until && until > now() && snap.get("agent_lock_owner") !== owner) return false;
    tx.update(snap.ref, { agent_lock_owner: owner, agent_lock_until: new Date(Date.now() + LEASE_MS).toISOString() });
    return true;
  });
}

/** Gives the lease back, but only once the inbox is empty; otherwise the holder keeps going. */
async function releaseIfEmpty(claimId: string, owner: string): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const [snap, pending] = await Promise.all([tx.get(claims.doc(claimId)), tx.get(child(claimId, "inbox").limit(1))]);
    if (!pending.empty) return false;
    if (snap.exists && snap.get("agent_lock_owner") === owner) {
      tx.update(snap.ref, { agent_lock_owner: null, agent_lock_until: null, agent_status: "idle" });
    }
    return true;
  });
}

/**
 * Runs the claim's queued inputs one at a time. A Firestore lease makes sure only one run per
 * claim happens across all server instances; whoever holds it drains everything queued meanwhile.
 * Inputs stranded by a crash are picked up by the sweeper (see sweepStranded).
 */
export async function drainInbox(claimId: string): Promise<void> {
  const owner = crypto.randomUUID();
  if (!(await acquire(claimId, owner))) return;
  for (;;) {
    const next = (await child(claimId, "inbox").orderBy("created_at").limit(1).get()).docs[0];
    if (!next) {
      if (await releaseIfEmpty(claimId, owner)) return;
      continue;
    }
    try {
      await runAgentNow(claimId, JSON.parse(next.get("content")), () => acquire(claimId, owner));
    } catch (err) {
      // Drop the input rather than retry a run that keeps failing; the user can send again.
      console.error(`agent run failed (claim ${claimId})`, err);
    }
    await next.ref.delete();
    if (!(await acquire(claimId, owner))) return; // renew the lease; stop if another run took it over
  }
}

/** Retries inputs left in an inbox (crash, timeout) and clears "working" on claims with nothing queued. */
export async function sweepStranded() {
  const stale = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const stranded = await firestore.collectionGroup("inbox").where("created_at", "<", stale).get();
  const claimIds = [...new Set(stranded.docs.map((d) => d.ref.parent.parent!.id))];
  for (const id of claimIds) await drainInbox(id);

  const stuck = await claims.where("agent_status", "==", "working").where("agent_started_at", "<", stale).get();
  for (const doc of stuck.docs) {
    const lockUntil = doc.get("agent_lock_until") as string | null | undefined;
    const pending = await child(doc.id, "inbox").limit(1).get();
    if (pending.empty && (!lockUntil || lockUntil < now())) await doc.ref.update({ agent_status: "idle" });
  }
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

/** One agent run. `renewLease` is called after each model step; a false return means another run took over. */
async function runAgentNow(claimId: string, input: ContentBlockParam[], renewLease: () => Promise<boolean> = async () => true) {
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
        tools: [...toolDefinitions, ...WEB_TOOLS],
        messages,
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        // On a safety decline, the API re-runs the request on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      console.error(`agent API error (claim ${claimId})`, err);
      await addChat(claim, "assistant", "משהו השתבש אצלי בצד. נסה לשלוח שוב בעוד רגע.");
      return;
    }

    if (!(await renewLease())) return;
    await push({ role: "assistant", content: response.content });
    await recordUsage({ userId: claim.user_id, claimId, model: response.model, usage: response.usage });

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
