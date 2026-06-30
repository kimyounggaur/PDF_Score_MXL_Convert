import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { JobStatus, Stage } from "@/shared/types";

const STEPS: Array<{ stage: Stage; label: string }> = [
  { stage: "detect", label: "판별/전처리" },
  { stage: "audiveris", label: "OMR" },
  { stage: "render", label: "렌더/슬라이싱" },
  { stage: "vision", label: "AI 대조" },
  { stage: "apply", label: "보정 적용" },
  { stage: "validate", label: "검증" },
  { stage: "eval", label: "완료" }
];

const ORDER = STEPS.map((step) => step.stage);

export function ProgressSteps({ stage, status }: { stage: Stage | null; status: JobStatus }) {
  const activeIndex = stage ? ORDER.indexOf(stage) : -1;
  return (
    <div className="steps" aria-label="진행 단계">
      {STEPS.map((step, index) => {
        const state = status === "done" || index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
        return (
          <div className="step" data-state={state} key={step.stage}>
            {state === "done" ? <CheckCircle2 size={20} aria-hidden /> : state === "active" ? <Loader2 size={20} aria-hidden /> : <Circle size={20} aria-hidden />}
            <span>{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
