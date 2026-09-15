export type WizardStep = 1 | 2 | 3;

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 1, label: "Repository" },
  { step: 2, label: "Anforderung" },
  { step: 3, label: "Bewertung" },
];

interface Props {
  currentStep: WizardStep;
  maxReachableStep: WizardStep;
  onStepClick: (step: WizardStep) => void;
}

export function WizardSteps({ currentStep, maxReachableStep, onStepClick }: Props) {
  return (
    <ol className="wizard-steps">
      {STEPS.map(({ step, label }) => {
        const isDone = step < currentStep;
        const isActive = step === currentStep;
        const isReachable = step <= maxReachableStep;
        return (
          <li
            key={step}
            className={`wizard-step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
          >
            <button
              type="button"
              disabled={!isReachable}
              onClick={() => isReachable && onStepClick(step)}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="wizard-step-marker">{isDone ? "✓" : step}</span>
              <span className="wizard-step-label">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
