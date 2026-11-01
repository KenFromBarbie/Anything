/**
 * Orchestration presets: one choice that sets the model for every link of the
 * office chain at once. Michael reads and assigns, staff plan and review, the
 * floor does the work, and everyone else (agents the owner hired by hand) runs
 * on `others`.
 *
 * Ids match the claude list in modelCatalog.json.
 */
export interface OrchestrationPreset {
  id: string;
  label: string;
  blurb: string;
  michael: string;
  staff: string;
  floor: string;
  others: string;
}

export const ORCHESTRATION_PRESETS: OrchestrationPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    blurb: 'The smartest model decides, the mid tier plans and reviews, the fast tier does the work.',
    michael: 'claude-opus-5-5',
    staff: 'claude-sonnet-5-5',
    floor: 'claude-haiku-5-5',
    others: 'claude-sonnet-5-5'
  },
  {
    id: 'quality',
    label: 'Best quality',
    blurb: 'Every tier one step up. Slower and costs more; for work that has to be right.',
    michael: 'claude-fable-5-1',
    staff: 'claude-opus-5-5',
    floor: 'claude-sonnet-5-5',
    others: 'claude-opus-5-5'
  },
  {
    id: 'fast',
    label: 'Fast & frugal',
    blurb: 'Every tier one step down. Quick and cheap; for routine work.',
    michael: 'claude-sonnet-5-5',
    staff: 'claude-haiku-5-5',
    floor: 'claude-haiku-5-5',
    others: 'claude-haiku-5-5'
  },
  {
    id: 'opus',
    label: 'All Opus',
    blurb: 'Opus 5.5 everywhere: one strong model at every desk, no hand-offs between tiers.',
    michael: 'claude-opus-5-5',
    staff: 'claude-opus-5-5',
    floor: 'claude-opus-5-5',
    others: 'claude-opus-5-5'
  }
];

/** The models the office runs on now, as a preset would set them. */
export interface ChainModels {
  michael?: string;
  staff?: string;
  floor?: string;
  others?: string;
}

/** The preset these models match, or null when they were set by hand. */
export function matchingPreset(models: ChainModels): OrchestrationPreset | null {
  return (
    ORCHESTRATION_PRESETS.find(
      (p) =>
        p.michael === models.michael &&
        p.staff === models.staff &&
        p.floor === models.floor &&
        p.others === models.others
    ) ?? null
  );
}
