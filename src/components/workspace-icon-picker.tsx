import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useCreateCustomEmoji, useCustomEmoji } from "@/hooks/use-custom-emoji";
import { CustomEmojiComposer } from "./custom-emoji-composer";
import { EmojiPicker } from "./emoji-picker";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";
import { MenuIcon, MenuLead, MenuSep } from "./menu-parts";

/* The workspace's icon (Settings › General; Notion's "Upload an image or
 * pick an emoji", 2026-10-11): the page icon picker — every emoji, the
 * workspace's custom emoji, Remove — plus Upload image, which saves the
 * image as a custom emoji and uses it, so the icon is drawn like any page
 * icon wherever the workspace shows. */

const ICON_UPLOAD = "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3";

export function WorkspaceIconPicker({
  icon,
  workspaceName,
  disabled,
  onChange,
}: {
  icon: string | null;
  workspaceName: string;
  disabled: boolean;
  /** null: back to the default icon. */
  onChange: (icon: string | null) => void;
}) {
  const ws = useWorkspaceId();
  const auth = useAuth();
  const toast = useToast();
  const custom = useCustomEmoji(ws).data ?? [];
  const create = useCreateCustomEmoji();
  const [composer, setComposer] = useState<DOMRect | null>(null);

  return (
    <>
      <Popover
        width={330}
        align="end"
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            onClick={onClick}
            aria-label="Change workspace icon"
            aria-expanded={open}
            data-workspace-icon
            className="grid place-items-center rounded-lg border border-line hover:bg-rail disabled:opacity-60"
            style={{ width: 52, height: 52 }}
          >
            <Ico icon={icon || "📄"} size={28} />
          </button>
        )}
      >
        {(close) => (
          <div>
            <EmojiPicker
              removable={!!icon}
              onPick={(e) => {
                if (e !== undefined) onChange(e);
                close();
              }}
            />
            <MenuSep />
            <button
              type="button"
              data-workspace-icon-upload
              onClick={(ev) => {
                const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                close();
                setComposer(r);
              }}
              className="gio-mrow"
            >
              <MenuLead>
                <MenuIcon path={ICON_UPLOAD} />
              </MenuLead>
              <span className="truncate">Upload image</span>
            </button>
          </div>
        )}
      </Popover>
      {composer ? (
        <CustomEmojiComposer
          anchor={composer}
          editing={null}
          existing={custom}
          workspaceName={workspaceName}
          onClose={() => setComposer(null)}
          onSave={async (v) => {
            try {
              await create.mutateAsync({ name: v.name, description: v.description, blob: v.blob!, userId: auth.user!.id });
              onChange(`:${v.name}:`);
              toast.push(`The workspace icon is :${v.name}: now. It's also a custom emoji anyone here can use.`);
              setComposer(null);
            } catch (e) {
              toast.push((e as Error).message || "Could not save that image.");
            }
          }}
        />
      ) : null}
    </>
  );
}
