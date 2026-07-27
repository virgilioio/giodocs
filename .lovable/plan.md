## What we actually know about Malena

I checked `workspace_invites`, `profiles`, and `auth.users` for anything matching `%malena%`. There is nothing — no invite row, no profile, no auth user. So the "record already exists" theory is not the cause. What's really happening: the edge function is returning a per-invite failure, and the error toast is being rendered *behind* the modal's blurred backdrop, so the reason never becomes visible.

## Scope

Two small, surgical fixes. No schema changes, no edge-function changes.

### 1. Toast layering (`src/lib/toast.tsx`)

The toast container is `z-50`. The Add Members modal (and every other modal in the app — Settings, Export, etc.) is `fixed inset-0` with `backdropFilter: blur(3px)` and no explicit z-index, so it stacks above `z-50` because it mounts later in the DOM. Raise the toast container to `z-[200]` so toasts always sit above every modal backdrop, popover, and command palette (`z-[80]`).

### 2. Surface the real invite error (`src/components/add-members-modal.tsx`)

Right now, when *every* invite fails the modal stays open and pushes a single toast — which is exactly the toast that gets hidden behind the blur. Add an inline error line inside the modal itself (under the hint row) that shows the per-email failure reason returned by the edge function, so the user sees it even without the toast. Keep the toast too (it will now be visible after fix #1). No new state shape — just render `sendInvites.data.results.filter(r => !r.ok)` when the mutation last resolved with failures.

## Out of scope

- No changes to `send-workspace-invite`, `create_workspace_invite`, or any migration.
- No changes to other modals — the toast fix covers all of them at once.
- Not adding a "retry" button; existing Send button already re-sends.

## Files changed

- `src/lib/toast.tsx` — bump container z-index to `z-[200]`.
- `src/components/add-members-modal.tsx` — render inline per-email failure list from the last mutation result.

## Follow-up (after fix ships)

Have the user retry sending to `malena@virgilio.tech`. The inline error will now name the real reason (Resend rejection, RPC failure, invalid email, etc.), and I'll act on that specifically.