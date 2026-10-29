# Buzz

Desktop chat shell with:

- Tauri + React + TypeScript + Vite
- Tailwind CSS
- shadcn/ui-ready shared components
- Biome (lint/format/check)
- Feature-driven frontend structure

## Scripts

- `bun run dev` - run the web frontend
- `bun run tauri dev` - run the desktop app
- `bun run build` - typecheck and build frontend
- `bun run typecheck` - TypeScript checks
- `bun run lint` - Biome lint
- `bun run format` - Biome format (write)
- `bun run check` - Biome check

## Structure

- `src/shared` - reusable app-wide code (`ui`, `lib`, `styles`)
- `src/features` - feature modules (vertical slices)
- `src/app` - top-level app composition
