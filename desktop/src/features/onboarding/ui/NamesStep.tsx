import * as React from "react";

import {
  cleanName,
  DEFAULT_APP_NAME,
  getAppName,
  getOwnerName,
  setAppName,
  setOwnerName,
} from "@/shared/lib/appName";
import { Button } from "@/shared/ui/button";
import { ONBOARDING_PRIMARY_CTA_CLASS } from "./OnboardingChrome";
import { OnboardingFooter } from "./OnboardingFooter";
import { OnboardingInput } from "./OnboardingInput";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "./OnboardingSlideTransition";

/**
 * First run: who you are (the name your communities and agents see, instead
 * of a shortened key) and what this app is called — it's "Anything", so it
 * can be named anything.
 */
export function NamesStep({
  direction,
  onNext,
}: {
  direction: OnboardingTransitionDirection;
  onNext: () => void;
}) {
  const [ownerName, setOwnerNameDraft] = React.useState(getOwnerName);
  const [appName, setAppNameDraft] = React.useState(() =>
    getAppName() === DEFAULT_APP_NAME ? "" : getAppName(),
  );
  const canContinue = cleanName(ownerName).length > 0;

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canContinue) return;
    setOwnerName(ownerName);
    setAppName(appName || DEFAULT_APP_NAME);
    onNext();
  };

  return (
    <OnboardingSlideTransition
      className="flex min-h-0 w-full flex-col items-stretch text-left"
      direction={direction}
      transitionKey={`names-${direction}`}
    >
      <h1 className="text-title font-normal text-foreground">Make it yours</h1>
      <p className="mt-2 w-full text-base leading-6 text-foreground/80">
        What should your team and agents call you? And since the app is called
        Anything, you can call it anything.
      </p>
      <form
        className="mt-8 grid w-full gap-5"
        data-testid="onboarding-names"
        onSubmit={submit}
      >
        <label className="grid gap-2 text-sm font-medium" htmlFor="owner-name">
          Your name
          <OnboardingInput
            autoComplete="name"
            autoFocus
            id="owner-name"
            maxLength={40}
            onChange={(event) => setOwnerNameDraft(event.target.value)}
            placeholder="e.g. Ken"
            value={ownerName}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="app-name">
          Name the app
          <OnboardingInput
            id="app-name"
            maxLength={40}
            onChange={(event) => setAppNameDraft(event.target.value)}
            placeholder={DEFAULT_APP_NAME}
            value={appName}
          />
          <span className="text-xs font-normal text-muted-foreground">
            Shown in the window title and on the start screen. Leave it empty to
            keep "{DEFAULT_APP_NAME}"; change it later in Settings → Appearance.
          </span>
        </label>
        {/* Enter submits from either field. */}
        <button className="hidden" type="submit" />
      </form>
      <OnboardingFooter>
        <Button
          className={ONBOARDING_PRIMARY_CTA_CLASS}
          data-testid="onboarding-names-next"
          disabled={!canContinue}
          onClick={() => submit()}
          type="button"
        >
          Continue
        </Button>
      </OnboardingFooter>
    </OnboardingSlideTransition>
  );
}
