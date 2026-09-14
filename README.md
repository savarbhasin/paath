# Nerdy

Nerdy is a single-user learning workspace. This first slice gives each demo learner a workspace with separate courses, notebooks, and durable Tiptap content.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL and Supabase service-role key. Supermemory and OpenAI keys are only needed when those provider-backed features are added.
3. Link a Supabase project, then apply the migration with `supabase db push`. The migration creates every application table, both private Storage buckets, and one demo workspace.
4. Start the app with `npm run dev`.

The current ticket only wires the provider configuration and interfaces. It does not make provider calls yet. Supermemory and OpenAI values are validated when a server route creates its provider client, but neither secret is sent to the browser. The Supabase service-role key is only imported by `lib/supabase/server.ts`.

## Checks

Run the implementation checks with:

```text
npm run typecheck
npm run lint
npm run build
```

## Persistence behavior

Notebook saves send the full Tiptap JSON document with the version the editor last read. The database update includes that version in its `where` clause and increments it on success. A stale save receives a `409` response and the editor shows the server copy alongside actions to reload it or retry the local edits against the current version.

## Course teaching videos

See [the local video setup guide](docs/course-videos.md) for the video migration, Docker renderer build, provider configuration, and local background worker. The worker runs separately from Next.js.
