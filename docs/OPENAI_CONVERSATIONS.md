# OpenAI Conversations integration

## Purpose

Stabilize uses the OpenAI Responses API to generate model output. For signed-in continuity, it now uses an OpenAI Conversation as the provider-side state container rather than resending the complete remembered message history on every turn.

## Request modes

### Guest chat

- No OpenAI Conversation is created.
- The Worker sends the bounded local input to `POST /v1/responses`.
- The request sets `store: false`.
- No server-side Stabilize conversation memory is created.

### Signed-in chat

- The account's Cloudflare Durable Object stores one OpenAI `conv_*` identifier alongside its bounded local summary and recent-message buffer.
- On the first signed-in model turn, the Worker creates a Conversation with up to 20 bounded seed items from existing local memory.
- Each model turn is generated through `POST /v1/responses` with the stored `conversation` identifier and only the newest user message as input.
- The response request uses `store: true` because items attached to a Conversation are the continuity mechanism.
- If the stored Conversation is no longer available, the Worker creates a replacement once and retries the response once.
- Concurrent first turns may create more than one candidate Conversation. The Durable Object keeps one identifier and schedules deletion of an unused candidate.

## Safety and local state

Deterministic urgent routes still run before any OpenAI call. The Durable Object retains its bounded local state so Stabilize can:

- classify follow-up safety answers before provider generation;
- preserve a small recovery context if a provider Conversation has to be replaced;
- create a privacy-bounded summary;
- retain the existing 30-day lifecycle.

The summary request itself remains stateless and uses `store: false`.

## Retention and deletion

OpenAI Conversation objects are not governed by the default 30-day Response-object retention period. Stabilize therefore enforces its own lifecycle:

1. Every signed-in stored exchange schedules the Durable Object alarm for 30 days later.
2. At expiry, the Durable Object lists Conversation items in bounded pages.
3. It deletes each item.
4. It deletes the Conversation object.
5. Only after provider cleanup succeeds does it erase the local provider identifier, recent messages, and summary.
6. A transient cleanup failure retains the identifier and schedules another attempt after 24 hours.

Deleting only the Conversation object is not sufficient because the OpenAI API documents that its items are not deleted automatically with it.

## Privacy boundaries

- OpenAI Conversation metadata contains only the application name and the intended retention label.
- Stabilize does not put the Google account alias, email address, IP address, or payment identifiers in Conversation metadata.
- Provider request and error logs contain request identifiers and bounded error fields, not user message bodies.
- The public privacy page must remain aligned with this behavior.

## OpenAI project-key permissions

A restricted OpenAI API key must permit both feature families:

- **Responses** — required to generate answers and summaries.
- **Conversations** — required to create, use, list, and delete provider-side conversation state.

Granting Conversations access alone is not enough because Conversations stores state but does not generate the assistant response.

## Validation

The regression suite checks that:

- guest requests remain stateless with `store: false`;
- a signed-in account creates and reuses one Conversation;
- existing local memory seeds a newly created Conversation;
- signed-in Response requests send only the current turn with `conversation` and `store: true`;
- local summary compaction remains stateless;
- the Durable Object adopts only one candidate Conversation ID;
- empty and expired states expose `conversationId: null`.
