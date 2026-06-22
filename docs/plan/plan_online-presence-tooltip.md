# Plan: online presence + countdown tooltip fixes

## Goal
1. Restore CountdownCircle click-to-show-time tooltip without triggering horizontal scrollbar.
2. Make online member count consistent across all clients in a room.
3. Change member display labels to `{OS} {Browser}#{sessionShortHash}` to avoid duplicates.
4. Add a clickable online-members header area that shows a modal with the full member list.
5. Limit the number of member avatars/labels shown in the header.

## Why these bugs happen
- CountdownCircle: previous custom tooltip overflowed the chat container; the quick fix replaced it with `title`, but `title` only shows on hover and not on click.
- Online count inconsistency:
  - RoomDO only broadcasts `member_join` / `member_leave`; it never sends a full `presence` snapshot.
  - The frontend `RoomPage` incrementally adds/removes members but never reconciles with ground truth, so stale entries survive reconnects.
  - `getOnlineMembers()` iterates sockets in insertion order, so the `#2` suffix attaches to different sessions from each client's perspective.
  - WebSocket close may be delayed by hibernation, so a refreshed client can appear twice temporarily.
- Device labels: both frontend and backend parse UA to the same string, producing duplicates when two identical browsers join.

## Approach
### Backend
1. In `RoomDO.webSocketMessage` on `subscribe`:
   - Broadcast `member_join` to all (existing behavior).
   - Then broadcast `presence` with the full sorted member list to ALL sockets (including the new one) so every client converges.
2. In `RoomDO.webSocketClose`:
   - After broadcasting `member_leave`, broadcast `presence` full list to remaining sockets.
3. In `RoomDO.getOnlineMembers()`:
   - Sort sockets by `session_id` before generating display labels.
   - Use `{device_label}#{shortSessionHash}` where `shortSessionHash` is the first 4 chars of the session id. This is deterministic and avoids duplicates.
4. Update `OnlineMember` shared type if needed (add `short_id?: string`, keep existing fields).

### Frontend
1. CountdownCircle:
   - Add internal `showTooltip` state toggled on click.
   - Render tooltip with `position: fixed` (or a portal) so it is removed from document flow and cannot expand the chat container.
   - Auto-hide tooltip after a short delay or on outside click.
   - Keep native `title` as fallback for accessibility.
2. Online members header (RoomPage):
   - Add a `MemberListModal` component (or reuse BottomSheet/Dialog pattern).
   - Header shows at most 3 members; overflow rendered as "+N".
   - Clicking the member area opens the modal with full list.
   - Mark current user as "你" (or translate key `rooms.you`).
3. RoomSocket / RoomPage:
   - On `presence` event, call `setOnlineMembers` with the full list (replace, don't merge).
   - On `member_join` / `member_leave`, still handle incrementally as a safety net, but the next `presence` will reconcile.
4. `device.ts`:
   - Keep `parseDeviceLabel()` returning `{OS} {Browser}`.
   - Add helper `getDisplayLabel(deviceLabel, sessionId) -> "Windows Edge#a1b2"`.

## Testing strategy
- Unit tests for backend DO presence logic (if existing tests cover DO).
- Frontend TypeScript zero errors.
- Playwright:
  - Open two browser contexts/tabs in the same room.
  - Verify both show the same online count.
  - Verify member labels have `#xxxx` suffix.
  - Click online member area, verify modal opens with full list.
  - Click countdown circle, verify tooltip appears and no horizontal scrollbar.

## Risks
- DO hibernation can delay `webSocketClose`; `presence` broadcast after close may temporarily lag. Acceptable if snapshot eventually converges.
- Changing `OnlineMember.display_label` format is a wire format change but additive; old clients will just show the new string.
