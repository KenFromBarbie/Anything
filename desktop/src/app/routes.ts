import { index, rootRoute, route } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/agents", "agents.tsx"),
  route("/automations", "automations.tsx"),
  route("/pulse", "pulse.tsx"),
  route("/office", "office.tsx"),
  route("/tasks", "tasks.tsx"),
  route("/ask-me", "ask-me.tsx"),
  route("/research", "research.tsx"),
  route("/studio", "studio.tsx"),
  route("/artifacts", "artifacts.tsx"),
  route("/browser", "browser.tsx"),
  route("/files", "files.tsx"),
  route("/notion", "notion.tsx"),
  route("/reminders", "reminders.tsx"),
  route("/settings", "settings.tsx"),
  route("/workflows", "workflows.tsx"),
  route("/workflows/$workflowId", "workflows.$workflowId.tsx"),
  route("/projects", "projects.tsx"),
  route("/projects/$projectId", "projects.$projectId.tsx"),
  route("/messages/new", "messages.new.tsx"),
  route("/channels/$channelId", "channels.$channelId.tsx"),
  route(
    "/channels/$channelId/posts/$postId",
    "channels.$channelId.posts.$postId.tsx",
  ),
]);
