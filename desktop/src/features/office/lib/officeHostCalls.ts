import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

/**
 * Native capabilities the Office (running in an iframe) asks Buzz to perform
 * on its behalf: file pickers, opening links/paths, OS notifications. Ops and
 * argument shapes mirror the Electron APIs Munder Difflin's main process calls
 * (see src/sidecar/electron-shim.cjs in the office runtime).
 */

type OpenDialogOptions = {
  title?: string;
  defaultPath?: string;
  properties?: string[];
  filters?: { name: string; extensions: string[] }[];
};

// Each handler declares its own argument types; arguments arrive untyped from
// the iframe, so dispatch goes through UntypedHandler below.
type HostHandler = (...args: never[]) => unknown;
type UntypedHandler = (...args: unknown[]) => unknown;

const handlers: Record<string, HostHandler> = {
  "shell.openExternal": async (url: string) => {
    if (!/^https?:\/\//i.test(url))
      throw new Error("only http(s) links can be opened");
    await openUrl(url);
  },
  "shell.openPath": async (path: string) => {
    try {
      await openPath(path);
      return "";
    } catch (error) {
      return String(error);
    }
  },
  "shell.showItemInFolder": async (path: string) => {
    await revealItemInDir(path);
  },
  "dialog.showOpenDialog": async (opts: OpenDialogOptions = {}) => {
    const props = opts.properties ?? [];
    const picked = await invoke<string | string[] | null>(
      "plugin:dialog|open",
      {
        options: {
          title: opts.title,
          defaultPath: opts.defaultPath,
          filters: opts.filters,
          directory: props.includes("openDirectory"),
          multiple: props.includes("multiSelections"),
        },
      },
    );
    const filePaths =
      picked == null ? [] : Array.isArray(picked) ? picked : [picked];
    return { canceled: filePaths.length === 0, filePaths };
  },
  "dialog.showSaveDialog": async (opts: OpenDialogOptions = {}) => {
    const filePath = await invoke<string | null>("plugin:dialog|save", {
      options: {
        title: opts.title,
        defaultPath: opts.defaultPath,
        filters: opts.filters,
      },
    });
    return filePath ? { canceled: false, filePath } : { canceled: true };
  },
  // Not window.confirm: in Buzz it is Tauri's async override, which resolves to
  // a Promise (always truthy) and calls a command this dialog plugin version no
  // longer has. Any failure answers the dialog's own cancel choice.
  "dialog.showMessageBox": async (opts: {
    title?: string;
    message?: string;
    detail?: string;
    buttons?: string[];
    cancelId?: number;
  }) => {
    const cancel = { response: opts.cancelId ?? 1 };
    const labels = opts.buttons ?? [];
    try {
      const result = await invoke<string>("plugin:dialog|message", {
        title: opts.title,
        message: [opts.message, opts.detail].filter(Boolean).join("\n\n"),
        kind: "warning",
        buttons:
          labels.length === 2
            ? { OkCancelCustom: [labels[0], labels[1]] }
            : "OkCancel",
      });
      return result === "Ok" || (labels.length === 2 && result === labels[0])
        ? { response: 0 }
        : cancel;
    } catch {
      return cancel;
    }
  },
  "dialog.showErrorBox": async (title: string, content: string) => {
    await invoke("plugin:dialog|message", {
      title,
      message: content,
      kind: "error",
    });
  },
  "notification.show": ({ title, body }: { title: string; body: string }) => {
    sendNotification({ title, body });
    return false; // click-through isn't reported back
  },
};

export async function runOfficeHostCall(
  op: string,
  args: unknown[],
): Promise<unknown> {
  const handler = handlers[op];
  if (!handler) throw new Error(`unsupported office host call: ${op}`);
  return (handler as UntypedHandler)(...args);
}
