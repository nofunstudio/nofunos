import { createFileRoute } from "@tanstack/react-router";

import { SideQuestShelfPage } from "../nofun/shelf/SideQuestShelfPage";

export const Route = createFileRoute("/side-quest")({
  component: SideQuestShelfPage,
});
