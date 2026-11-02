import { z } from "zod";
const noPathOrSecret = (max: number) => z.string().min(1).max(max).refine(v => /^[A-Za-z0-9_.:-]+$/.test(v) && !/[\\/]|\.\.|(?:^|[=:])\s*(?:sk-|ghp_|github_pat_|Bearer\s|api[_-]?key|secret|token)/i.test(v), "Must not contain paths or secret-like values");
const metadataText = noPathOrSecret(128);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const metadataSchema = z.object({
  toolName: metadataText.optional(), inputDigest: digest.optional(), outputDigest: digest.optional(),
  durationMs: z.number().int().nonnegative().optional(), inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), cacheReadTokens: z.number().int().nonnegative().optional(),
  errorCode: metadataText.optional(), diagnosticCode: metadataText.optional(), resultCategory: metadataText.optional(),
  evidenceId: noPathOrSecret(128).optional(), correlationDigest: digest.optional(),
}).strict();
export const eventSchema = z.object({
  schemaVersion: z.literal(1), eventId: z.string().uuid(),
  sourceInstanceId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  provider: z.enum(["codex", "opencode"]), providerVersion: noPathOrSecret(64).nullable().optional(),
  launcher: z.enum(["cli", "t3", "other", "unknown"]).optional(), runtimeMode: noPathOrSecret(64).nullable().optional(),
  nativeSessionId: noPathOrSecret(256), parentNativeSessionId: noPathOrSecret(256).nullable().optional(),
  turnId: noPathOrSecret(256).nullable().optional(), nativeAgentId: noPathOrSecret(256).nullable().optional(),
  parentNativeAgentId: noPathOrSecret(256).nullable().optional(), spanId: noPathOrSecret(128).nullable().optional(),
  parentSpanId: noPathOrSecret(128).nullable().optional(), projectId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  eventType: z.enum(["session.started", "session.ended", "turn.started", "turn.ended", "tool.started", "tool.completed", "subagent.started", "subagent.ended", "message.corrected", "provider.diagnostic"]),
  occurredAt: z.string().datetime({ offset: true }), observedAt: z.string().datetime({ offset: true }),
  privacyClass: z.literal("metadata"), outcome: z.enum(["succeeded", "failed", "cancelled", "blocked", "unknown"]).optional(),
  metadata: metadataSchema.optional(),
}).strict();
export type CanonicalEvent = z.infer<typeof eventSchema>;

