import {
  type ResearchProject,
  useProjectCover,
} from "@/features/research/lib/research";
import { cn } from "@/shared/lib/cn";

const GRADIENTS = [
  "from-sky-500/70 to-indigo-600/70",
  "from-emerald-500/70 to-teal-700/70",
  "from-amber-400/70 to-rose-500/70",
  "from-fuchsia-500/70 to-purple-700/70",
  "from-lime-400/70 to-emerald-600/70",
  "from-orange-400/70 to-red-600/70",
];

function gradientFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length] ?? GRADIENTS[0];
}

/** The project's cover image, or a colour from its id with its initial. */
export function ProjectCover({
  className,
  project,
  showInitial = false,
}: {
  className?: string;
  project: ResearchProject;
  showInitial?: boolean;
}) {
  const { data: src } = useProjectCover(project);
  if (project.image && src) {
    return (
      <img
        alt=""
        className={cn("shrink-0 object-cover", className)}
        draggable={false}
        src={src}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-linear-to-br font-semibold text-white/90",
        gradientFor(project.id),
        className,
      )}
    >
      {showInitial ? project.name.trim().charAt(0).toUpperCase() : null}
    </div>
  );
}
