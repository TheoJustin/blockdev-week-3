import { DemoShell } from "@/components/demo-shell";
import { demoScenarios, presentationPhases, sampleSourceNotes } from "@/lib/demo-data";

export default function WorkbenchPage() {
  return (
    <DemoShell
      defaultSourceNotes={sampleSourceNotes}
      phases={presentationPhases}
      scenarios={demoScenarios}
    />
  );
}
