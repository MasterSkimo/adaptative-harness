import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eventSchema } from "./index.js";
const valid = () => ({schemaVersion: 1,eventId:randomUUID(),sourceInstanceId:"source_123",provider:"opencode",nativeSessionId:"ses_123",projectId:"project_123",eventType:"tool.completed",occurredAt:"2026-11-02T12:00:00Z",observedAt:"2026-11-02T12:00:00Z",privacyClass:"metadata",outcome:"unknown",metadata:{toolName:"shell",durationMs:3}});
describe("canonical events", () => {
  it("accepts metadata events", () => expect(eventSchema.safeParse(valid()).success).toBe(true));
  it.each([{schemaVersion:2},{eventType:"tool.unknown"},{privacyClass:"redacted_excerpt"},{metadata:{prompt:"private"}},{nativeSessionId:"C:\\Users\\someone"}])("rejects invalid or unsafe values %j", patch => expect(eventSchema.safeParse({...valid(),...patch}).success).toBe(false));
});
